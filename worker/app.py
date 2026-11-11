"""
ViralOwner processing worker (runs on Modal).

The website talks to this over HTTPS with a shared bearer token:
  GET  /health          checks ffmpeg, storage (R2) and Claude are reachable
  POST /jobs/analyze    starts analyzing an inspo video (returns a job id)
  POST /jobs/render     starts making a video from the user's clips (returns a job id)
  POST /jobs/ping       starts a short test job
  GET  /jobs/{job_id}   a job's state, stage and progress (and output when done)

Jobs run as separate Modal function calls; their id is the job id. While a job
runs it reports its stage/progress in a Modal Dict, which /jobs/{id} reads.

Deploy:   modal deploy worker/app.py
Try one:  modal run worker/app.py::try_analyze --path some-video.mp4
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import modal

APP_NAME = "viralowner-worker"
CLAUDE_MODEL = "claude-opus-5-5"
# USD per million tokens (Claude Opus 5.5), for the cost log.
PRICES = {"input": 4.00, "output": 20.00, "cache_write": 5.00, "cache_read": 0.20}
WHISPER_MODEL = "small"
MODELS_DIR = "/models"

MIN_SHOT_S = 0.35  # shorter cuts get merged into a neighbor
MAX_SHOTS = 25  # more than this is too much to ask people to film
MAX_FRAMES = 36  # frames sent to Claude per video
FRAME_WIDTH = 512  # px; enough to read on-screen text

SHOT_ROLES = ["hook", "setup", "build", "reveal", "payoff", "b-roll", "cta"]


def _download_whisper() -> None:
    from faster_whisper import WhisperModel

    WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=MODELS_DIR)


app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-montserrat")
    .uv_pip_install("fastapi[standard]", "boto3", "anthropic", "scenedetect[opencv-headless]", "faster-whisper")
    .run_function(_download_whisper)  # bake the speech model into the image (no download per job)
)

# viralowner-worker:      ANTHROPIC_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# viralowner-worker-auth: WORKER_TOKEN (the same value the website has)
secrets = [modal.Secret.from_name("viralowner-worker"), modal.Secret.from_name("viralowner-worker-auth")]

# job id -> {"stage": str | None, "progress": int, "updated_at": float}
progress_store = modal.Dict.from_name("viralowner-job-progress", create_if_missing=True)


class JobError(Exception):
    """Raise inside a job with a friendly, user-facing message."""


def report(stage: str | None, progress: int) -> None:
    """Called from inside a job to publish how it's going."""
    job_id = modal.current_function_call_id()
    if job_id:
        progress_store[job_id] = {"stage": stage, "progress": max(0, min(100, progress)), "updated_at": time.time()}


def r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def ffmpeg_version() -> str:
    return run(["ffmpeg", "-version"]).splitlines()[0]


r1 = lambda x: round(x, 1)  # noqa: E731
r2 = lambda x: round(x, 2)  # noqa: E731


# ---------------------------------------------------------------- analysis steps


def probe(path: Path) -> dict:
    """Duration and whether the file has audio."""
    try:
        info = json.loads(
            run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)])
        )
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        raise JobError("we couldn’t read that video. try saving it again, or screen-record it and upload that.")
    streams = [s.get("codec_type") for s in info.get("streams", [])]
    duration = float(info.get("format", {}).get("duration") or 0)
    if "video" not in streams or duration <= 0:
        raise JobError("we couldn’t read that video. try saving it again, or screen-record it and upload that.")
    return {"duration": duration, "has_audio": "audio" in streams}


def detect_shots(path: Path, duration: float) -> list[tuple[float, float]]:
    """Where the cuts are, as (start, end) seconds, tidied up so every shot is filmable."""
    from scenedetect import AdaptiveDetector, detect

    scenes = detect(str(path), AdaptiveDetector(), show_progress=False)
    cuts = sorted({s.get_seconds() for s, _ in scenes if 0 < s.get_seconds() < duration})
    bounds = [0.0, *cuts, duration]
    shots = [[a, b] for a, b in zip(bounds, bounds[1:]) if b > a]

    # Merge the shortest shot into its shorter neighbor until all are long enough and few enough.
    while len(shots) > 1:
        lengths = [b - a for a, b in shots]
        i = min(range(len(shots)), key=lengths.__getitem__)
        if lengths[i] >= MIN_SHOT_S and len(shots) <= MAX_SHOTS:
            break
        if i == 0:
            j = 1
        elif i == len(shots) - 1:
            j = i - 1
        else:
            j = i - 1 if lengths[i - 1] <= lengths[i + 1] else i + 1
        a, b = min(i, j), max(i, j)
        shots[a:b + 1] = [[shots[a][0], shots[b][1]]]
    return [(a, b) for a, b in shots]


def frames_per_shot(count: int) -> int:
    return max(1, min(3, MAX_FRAMES // count))


def extract_frames(path: Path, shots: list[tuple[float, float]], workdir: Path) -> list[list[Path]]:
    """A few JPEG stills spread across each shot."""
    per = frames_per_shot(len(shots))
    fractions = {1: [0.5], 2: [0.3, 0.75], 3: [0.15, 0.5, 0.85]}[per]
    out: list[list[Path]] = []
    for i, (a, b) in enumerate(shots):
        stills = []
        for k, f in enumerate(fractions if b - a >= 0.9 else [0.5]):
            t = a + (b - a) * f
            dest = workdir / f"shot{i:02d}_{k}.jpg"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
                 "-vf", f"scale={FRAME_WIDTH}:-2", "-q:v", "4", str(dest)],
                capture_output=True,
            )
            if dest.exists() and dest.stat().st_size > 0:
                stills.append(dest)
        out.append(stills)
    return out


_whisper = None


def transcribe(path: Path) -> dict:
    """What's said, with timings. Empty if there's no audio or no speech."""
    global _whisper
    import numpy as np

    # Decode with ffmpeg to 16 kHz mono samples and hand Whisper the array
    # (its own decoder depends on a PyAV API that newer versions removed).
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True,
    ).stdout
    if len(pcm) < 16000:  # under half a second of audio
        return {"language": None, "segments": []}
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    from faster_whisper import WhisperModel

    _whisper = _whisper or WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=MODELS_DIR)
    segments, info = _whisper.transcribe(audio, vad_filter=True, word_timestamps=True)
    out = []
    for s in segments:
        text = s.text.strip()
        if text and s.no_speech_prob < 0.7:
            out.append({
                "startS": r2(s.start), "endS": r2(s.end), "text": text,
                "words": [{"w": w.word.strip(), "s": r2(w.start), "e": r2(w.end)} for w in (s.words or [])],
            })
    return {"language": info.language if out else None, "segments": out}


# ---------------------------------------------------------------- Claude

SYSTEM_PROMPT = """You analyze viral short-form videos (TikTok, Instagram Reels, YouTube Shorts) for ViralOwner, an app that helps creators and small business owners remake a proven viral video with their own footage, so they get the same structure and pacing without hours of editing.

You get still frames from every shot of one video, each shot's exact timing (found by cut detection), and a transcript of what's said. For each shot, explain what's in it, the job it does in the video, and why it works on viewers. Then tell the user how to film their own version of that shot.

Write for a busy business owner, not a video editor: plain words, all lowercase, no jargon, no emoji. Be specific to what the frames actually show (subject, framing, camera angle and movement, lighting, on-screen text); don't invent details the frames don't show. The user will film with a phone, often about a different business or topic, so filming tips describe the kind of shot to capture (framing, action, angle, movement, what to hold or show), not the inspo's exact subject."""

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "video": {
            "type": "object",
            "properties": {
                "hook": {"type": "string", "description": "what happens in the first ~2 seconds and why it stops the scroll. max 30 words."},
                "structure": {"type": "string", "description": "the arc in one line, e.g. 'problem → 3 quick tips → the result → follow for more'."},
                "why_it_works": {"type": "array", "items": {"type": "string"}, "description": "exactly 3 short reasons this video performs. max 18 words each."},
                "audio": {"type": "string", "description": "what you hear: talking to camera, voiceover, trending song, no audio... max 15 words."},
                "pacing": {"type": "string", "description": "the pacing in a short phrase, e.g. 'fast cuts that speed up toward the reveal'."},
                "text_present": {"type": "boolean", "description": "true if any shot has text overlaid on the video (not burned-in speech captions)."},
                "text_style": {"type": "string", "description": "style and placement of overlaid text, e.g. 'bold white headline, top third'. empty string if none."},
                "caption_style": {"type": "string", "description": "style of burned-in speech captions if present, e.g. 'word-by-word yellow pop'. 'none' if there are none."},
            },
            "required": ["hook", "structure", "why_it_works", "audio", "pacing", "text_present", "text_style", "caption_style"],
            "additionalProperties": False,
        },
        "shots": {
            "type": "array",
            "description": "one entry per shot, in order, same count as the shots given.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the shot number given, starting at 1."},
                    "role": {"type": "string", "enum": SHOT_ROLES, "description": "the job this shot does. cta = call to action."},
                    "description": {"type": "string", "description": "what's on screen: subject, framing, movement. max 20 words."},
                    "on_screen_text": {"type": "string", "description": "the exact overlaid text in this shot, as written. empty string if none."},
                    "why_it_works": {"type": "string", "description": "why this shot keeps people watching. max 25 words."},
                    "tip": {"type": "string", "description": "how to film your version, starting with a verb. max 25 words."},
                },
                "required": ["index", "role", "description", "on_screen_text", "why_it_works", "tip"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["video", "shots"],
    "additionalProperties": False,
}


def b64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode("ascii")


def understand(shots: list[tuple[float, float]], frames: list[list[Path]], transcript: dict, duration: float) -> dict:
    lines = [f"[{s['startS']:.1f}s–{s['endS']:.1f}s] {s['text']}" for s in transcript["segments"]]
    content: list[dict] = [{
        "type": "text",
        "text": (
            f"the video is {duration:.1f} seconds long and has {len(shots)} shots.\n\n"
            "transcript:\n" + ("\n".join(lines) if lines else "(no speech)") + "\n\nhere are the shots:"
        ),
    }]
    for i, ((a, b), stills) in enumerate(zip(shots, frames)):
        content.append({"type": "text", "text": f"shot {i + 1}: {a:.1f}s–{b:.1f}s ({b - a:.1f}s)"})
        for p in stills:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
    content.append({"type": "text", "text": f"analyze all {len(shots)} shots and the video as a whole."})
    return ask_claude(SYSTEM_PROMPT, content, ANALYSIS_SCHEMA, "we couldn’t analyze that video. try a different one.")


def ask_claude(system: str, content: list[dict], schema: dict, refusal_message: str) -> dict:
    """One structured-output request. Returns the parsed JSON plus usage and cost."""
    import anthropic

    client = anthropic.Anthropic(max_retries=3, timeout=240)
    response = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if a safety check declines, another model finishes the request
        system=system,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
    )
    if response.stop_reason == "refusal":
        raise JobError(refusal_message)
    if response.stop_reason == "max_tokens":
        raise RuntimeError("Claude ran out of output tokens")
    text = next(b.text for b in response.content if b.type == "text")

    u = response.usage
    usage = {
        "input": u.input_tokens,
        "output": u.output_tokens,
        "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0,
        "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
    }
    cost = sum(usage[k] * PRICES[k] for k in usage) / 1_000_000
    return {"data": json.loads(text), "usage": usage, "cost_usd": round(cost, 4), "model": response.model}


# ---------------------------------------------------------------- the whole analysis


def pacing_label(avg: float) -> str:
    return "fast" if avg < 1.6 else "medium" if avg < 3 else "slow"


def analyze_path(path: Path) -> dict:
    """Everything after the file is on disk. Returns the website's Breakdown shape."""
    started = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        info = probe(path)
        duration = info["duration"]

        report("finding every cut", 15)
        shots = detect_shots(path, duration)

        report("listening for speech", 35)
        transcript = transcribe(path) if info["has_audio"] else {"language": None, "segments": []}

        report("studying each shot", 55)
        frames = extract_frames(path, shots, workdir)
        result = understand(shots, frames, transcript, duration)

    report("writing your shot list", 95)
    data = result["data"]
    by_index = {s["index"]: s for s in data["shots"]}
    v = data["video"]
    avg = duration / len(shots)

    out_shots = []
    for i, (a, b) in enumerate(shots):
        s = by_index.get(i + 1) or {}
        role = s.get("role") if s.get("role") in SHOT_ROLES else ("hook" if i == 0 else "build")
        out_shots.append({
            "index": i,
            "role": role,
            "tip": s.get("tip") or "film something similar to this shot",
            "startS": r2(a),
            "durationS": r2(b - a),
            "description": s.get("description") or "",
            "onScreenText": s.get("on_screen_text") or None,
            "whyItWorks": s.get("why_it_works") or "",
        })

    meta = {
        "engine": "modal",
        "model": result["model"],
        "usage": result["usage"],
        "costUsd": result["cost_usd"],
        "frames": sum(len(f) for f in frames),
        "seconds": round(time.time() - started, 1),
    }
    print(f"analysis done: {len(shots)} shots, {meta['frames']} frames, ${meta['costUsd']}, {meta['seconds']}s, usage={meta['usage']}")

    breakdown = {
        "durationS": r1(duration),
        "shotCount": len(shots),
        "avgShotS": r1(avg),
        "pacing": {"label": pacing_label(avg), "description": v["pacing"]},
        "textOverlays": {"present": bool(v["text_present"]), "style": v["text_style"] or None},
        "captionStyle": v["caption_style"] or "none",
        "shots": out_shots,
        "insights": {
            "hook": v["hook"],
            "structure": v["structure"],
            "whyItWorks": v["why_it_works"][:3],
            "audio": v["audio"],
        },
        "transcript": {"language": transcript["language"], "segments": transcript["segments"]},
        "meta": meta,
    }
    # Plain JSON types only (scene detection and Whisper return numpy numbers).
    return json.loads(json.dumps(breakdown, default=float))


# ---------------------------------------------------------------- rendering
#
# A render takes the inspo's breakdown and the user's clips and makes a
# 1080x1920 MP4 with the inspo's exact shot timing:
#   analyzing  get the clips, sample frames, listen to what's said
#   matching   Claude picks the moment from a clip for each shot and writes
#              the on-screen text, post caption and hashtags
#   editing    ffmpeg cuts each shot, joins them, adds text and captions
#   finishing  uploads the video to storage

OUT_W, OUT_H, OUT_FPS = 1080, 1920, 30
MATCH_FRAME_WIDTH = 384
MAX_CLIP_FRAMES = 72  # frames of the user's clips sent to Claude
MAX_CLIP_SPEECH_S = 150  # transcribe the clips for matching only if they're this short in total
MAX_SLOWDOWN = 2.0  # a clip shorter than its shot is slowed down up to this much, then held
FONT = "Montserrat"
FONT_DIR = "/usr/share/fonts/opentype/montserrat"
KEY_PREFIX_RE = r"^u/[A-Za-z0-9_-]+/p/[A-Za-z0-9_-]+/"

MATCH_SYSTEM = """You edit short-form videos for ViralOwner, an app that helps creators and small business owners remake a proven viral video (the "inspo") with their own footage. The finished video keeps the inspo's exact shot timing; your job is choosing what fills each shot and writing the words.

You get the inspo's shot list with one frame from each shot, then frames sampled from each of the user's clips (with timestamps) and what's said in them.

Picking footage: for every shot, choose the clip and the start time whose footage best does that shot's job (hook, reveal, payoff...) and best matches its look (framing, action, energy). The shot plays from that start time for the shot's length, so pick a start where the action is about to happen. Prefer moments that are in focus with the subject in frame; avoid the first and last half second of a clip, where people fumble with the phone. Use different clips, or at least different moments, for different shots. Skip clips that don't belong in the video (screen recordings, accidental footage, blurry or black clips): a good clip at a different moment is better than a bad clip. When the user already chose a clip or a moment for a shot, keep it exactly as given.

Writing: everything is about the user's business or topic, as their clips show it. Never invent facts, prices, results or claims the footage doesn't support. No emoji or hashtags in on-screen text. Keep the inspo's casing style (all lowercase if the inspo uses lowercase)."""

TEXT_RULES = {
    "match": (
        "on-screen text: write the user's version of the inspo's overlaid text for each shot where the inspo has text: "
        "same format, rhythm, tone and roughly the same length (if the inspo says 'pov: you finally...', write a pov line "
        "about what the user's clips show). give an empty string for shots where the inspo has no text. if the same text "
        "stays on screen across several inspo shots, repeat it for each of those shots."
    ),
    "custom": (
        "on-screen text: the user wrote their own text (below). use their exact words, in order, without adding, removing "
        "or changing any. split it into short pieces and spread them over the shots where the inspo has text, or over "
        "the first shots if the inspo has none. give an empty string for every other shot."
    ),
    "keep": "on-screen text: already written. return an empty string for every shot.",
}

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "shots": {
            "type": "array",
            "description": "one entry per inspo shot, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the inspo shot number, starting at 1."},
                    "clip": {"type": "integer", "description": "the user's clip number to use, starting at 1."},
                    "start_s": {"type": "number", "description": "where in that clip the shot starts, in seconds."},
                    "text": {"type": "string", "description": "on-screen text for this shot. empty string for none."},
                },
                "required": ["index", "clip", "start_s", "text"],
                "additionalProperties": False,
            },
        },
        "text_position": {
            "type": "string",
            "enum": ["top", "middle", "bottom"],
            "description": "where the inspo places its overlaid text. 'top' if it has none.",
        },
        "text_look": {
            "type": "string",
            "enum": ["outline", "box", "plain"],
            "description": "the inspo's overlaid text look: white with a dark outline, text on a solid box, or plain with a soft shadow.",
        },
        "caption": {
            "type": "string",
            "description": "the post caption in the user's voice: a hook first line, then one short line. up to 2 emoji. max 40 words.",
        },
        "hashtags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "5 to 8 hashtags (with #), mixing broad and niche ones that fit what the clips show.",
        },
    },
    "required": ["shots", "text_position", "text_look", "caption", "hashtags"],
    "additionalProperties": False,
}


def probe_clip(path: Path) -> dict:
    """Duration, size, audio, and whether it's HDR (iPhones film HDR by default)."""
    info = json.loads(run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height,color_transfer", "-of", "json", str(path),
    ]))
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    duration = float(info.get("format", {}).get("duration") or 0)
    if not video or duration <= 0:
        raise ValueError("no video stream")
    return {
        "duration": duration,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "hdr": video.get("color_transfer") in ("arib-std-b67", "smpte2084"),
    }


def grab_frame(path: Path, t: float, dest: Path, width: int) -> Path | None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "4", str(dest)],
        capture_output=True,
    )
    return dest if dest.exists() and dest.stat().st_size > 0 else None


def sample_clip_frames(clips: list[dict], workdir: Path) -> None:
    """Adds clip["frames"] = [(seconds, jpeg), ...], spread evenly, about MAX_CLIP_FRAMES in total."""
    from concurrent.futures import ThreadPoolExecutor

    total = sum(c["duration"] for c in clips)
    interval = max(1.0, total / MAX_CLIP_FRAMES)
    jobs = []
    for ci, c in enumerate(clips):
        d = c["duration"]
        n = 1 if d < 1.2 else max(2, min(12, round(d / interval)))
        for k in range(n):
            t = d * (k + 0.5) / n
            jobs.append((ci, t, workdir / f"clip{ci:02d}_{k:02d}.jpg"))
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda j: grab_frame(clips[j[0]]["path"], j[1], j[2], MATCH_FRAME_WIDTH), jobs))
    for c in clips:
        c["frames"] = []
    for (ci, t, _), p in zip(jobs, results):
        if p:
            clips[ci]["frames"].append((t, p))


def match_clips(inspo: dict, inspo_frames: list[Path | None], clips: list[dict], fixed: list[dict],
                text_mode: str, custom_text: str, fresh: bool) -> dict:
    """Claude's plan: a clip and start time per shot, on-screen text, and the post copy."""
    b = inspo["breakdown"]
    shots = b["shots"]
    ins = b.get("insights") or {}
    lines = [f"[{s['startS']:.1f}s–{s['endS']:.1f}s] {s['text']}" for s in (b.get("transcript") or {}).get("segments", [])]
    overlay = b.get("textOverlays") or {}

    content: list[dict] = [{"type": "text", "text": (
        f"the inspo is {b['durationS']:.1f}s with {len(shots)} shots.\n"
        f"hook: {ins.get('hook', '')}\nstructure: {ins.get('structure', '')}\n"
        f"overlaid text: {overlay.get('style') or 'none'}\n"
        "inspo transcript:\n" + ("\n".join(lines) if lines else "(no speech)") + "\n\nthe inspo's shots:"
    )}]
    for i, s in enumerate(shots):
        text = s.get("onScreenText")
        content.append({"type": "text", "text": (
            f"inspo shot {i + 1} ({s['role']}, {s['durationS']:.1f}s): {s.get('description') or s.get('tip', '')}"
            f"\n  on-screen text: {json.dumps(text, ensure_ascii=False) if text else 'none'}"
        )})
        if inspo_frames[i]:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(inspo_frames[i])}})

    content.append({"type": "text", "text": f"\nthe user's {len(clips)} clips:"})
    for ci, c in enumerate(clips):
        content.append({"type": "text", "text": f"clip {ci + 1} ({c['duration']:.1f}s long)"})
        for t, p in c["frames"]:
            content.append({"type": "text", "text": f"clip {ci + 1} at {t:.1f}s"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
        said = [f"[{s['startS']:.1f}s–{s['endS']:.1f}s] {s['text']}" for s in c.get("speech") or []]
        if said:
            content.append({"type": "text", "text": f"said in clip {ci + 1}:\n" + "\n".join(said)})

    rules = []
    for i, f in enumerate(fixed):
        if f["clip"] is None:
            continue
        if f["start"] is not None:
            rules.append(f"shot {i + 1}: the user chose clip {f['clip'] + 1} from {f['start']:.1f}s. return exactly that.")
        else:
            rules.append(f"shot {i + 1}: the user chose clip {f['clip'] + 1}. pick the best start time in it.")
    ask = [
        f"plan all {len(shots)} shots.",
        *(["the user's choices:", *rules] if rules else []),
        TEXT_RULES[text_mode],
        *([f"the user's text: {json.dumps(custom_text, ensure_ascii=False)}"] if text_mode == "custom" else []),
        *(["this is a fresh take: make different choices from the most obvious ones where it still works."] if fresh else []),
    ]
    content.append({"type": "text", "text": "\n".join(ask)})
    return ask_claude(MATCH_SYSTEM, content, MATCH_SCHEMA, "we couldn’t make a video from these clips. try different ones.")


def resolve_plan(shots: list[dict], clips: list[dict], fixed: list[dict], picked: dict[int, dict]) -> list[dict]:
    """Final clip, start and length for each shot. User choices win; then Claude's; then a simple fallback."""
    plan = []
    for i, s in enumerate(shots):
        need = s["durationS"]
        f = fixed[i]
        p = picked.get(i + 1) or {}
        ci = f["clip"]
        if ci is None:
            ci = p["clip"] - 1 if isinstance(p.get("clip"), int) and 0 < p["clip"] <= len(clips) else i % len(clips)
        clip = clips[ci]
        d = clip["duration"]
        if f["clip"] is not None and f["start"] is not None:
            start, end = f["start"], f["end"] if f["end"] is not None else d
        else:
            claude_start = p.get("start_s") if p.get("clip") == ci + 1 else None
            start = float(claude_start) if isinstance(claude_start, (int, float)) else min(0.5, max(0.0, d - need))
            start = min(max(0.0, start), max(0.0, d - need))
            end = d
        start = min(max(0.0, start), max(0.0, d - 0.3))
        end = min(max(start + 0.1, end), d)
        take = min(need, end - start)
        # Trims are rounded to 0.1s in the editor: don't slow a shot down for a rounding difference.
        if take >= need - 0.15 and start + need <= d:
            take = need
        plan.append({"clip": ci, "start": start, "take": take, "duration": need})
    return plan


def tonemap_filter() -> str:
    """HDR (HLG/PQ) to normal video, so iPhone footage doesn't look washed out."""
    return ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,"
            "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


def cut_shot(clip: dict, start: float, take: float, duration: float, dest: Path) -> None:
    """One shot: the clip from `start`, filling exactly `duration` seconds at 1080x1920."""
    slow = min(MAX_SLOWDOWN, duration / take) if take < duration - 0.02 else 1.0
    vf = [
        *([tonemap_filter()] if clip["hdr"] else []),
        f"scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:flags=lanczos",
        f"crop={OUT_W}:{OUT_H}", "setsar=1", f"fps={OUT_FPS}",
        *([f"setpts={slow:.4f}*PTS"] if slow > 1 else []),
        f"tpad=stop_mode=clone:stop_duration={duration:.3f}",
        "format=yuv420p",
    ]
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{take:.3f}", "-i", str(clip["path"])]
    if clip["has_audio"]:
        af = f"aresample=48000,{f'atempo={1 / slow:.4f},' if slow > 1 else ''}apad"
        audio = ["-map", "0:v:0", "-map", "0:a:0", "-af", af]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = ["-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        *audio, "-vf", ",".join(vf), "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", str(OUT_FPS),
        # PCM audio, so joining the shots doesn't add clicks or drift at the cuts.
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and clip["hdr"]:
        # Tone mapping can fail on unusual files; plain conversion still gives a usable shot.
        cut_shot({**clip, "hdr": False}, start, take, duration, dest)
    elif result.returncode != 0:
        raise RuntimeError(f"cutting shot failed: {result.stderr[-500:]}")


# ---- text and captions (ASS subtitles, burned in by libass)

def ass_time(t: float) -> str:
    cs = max(0, round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def ass_text(text: str) -> str:
    """Escapes ASS override characters and drops emoji (the font has no emoji)."""
    import re

    text = re.sub(r"[\U00010000-\U0010FFFF☀-➿️‍]", "", text)
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", "\\N").strip()


# Name, Fontsize, Primary, Outline(or box), Back, Bold, BorderStyle, Outline, Shadow, Alignment, MarginV
WHITE, BLACK, NEAR_BLACK, SHADOW = "&H00FFFFFF", "&H00000000", "&H00141414", "&H90000000"
HIGHLIGHT = "&H0000E5FF"  # yellow, in ASS's BGR order

OVERLAY_LOOKS = {
    "outline": dict(size=96, primary=WHITE, outline_c=BLACK, border=1, outline=7, shadow=0),
    "box": dict(size=86, primary=NEAR_BLACK, outline_c=WHITE, border=3, outline=18, shadow=0),
    "plain": dict(size=96, primary=WHITE, outline_c=BLACK, border=1, outline=0, shadow=3),
}
CAPTION_LOOKS = {
    "bold-pop": dict(size=136, primary=WHITE, outline_c=BLACK, border=1, outline=9, shadow=0, words=2, chars=14),
    "clean": dict(size=80, primary=WHITE, outline_c=BLACK, border=1, outline=4, shadow=2, words=5, chars=28),
    "boxed": dict(size=84, primary=WHITE, outline_c="&H33000000", border=3, outline=16, shadow=0, words=4, chars=22),
    "karaoke": dict(size=104, primary=WHITE, outline_c=BLACK, border=1, outline=8, shadow=0, words=3, chars=20),
}


def ass_style(name: str, look: dict, alignment: int, margin_v: int) -> str:
    return (f"Style: {name},{FONT},{look['size']},{look['primary']},{look['primary']},{look['outline_c']},{SHADOW},"
            f"-1,0,0,0,100,100,0,0,{look['border']},{look['outline']},{look['shadow']},{alignment},90,90,{margin_v},1")


def caption_chunks(words: list[dict], max_words: int, max_chars: int) -> list[list[dict]]:
    chunks: list[list[dict]] = []
    for w in words:
        cur = chunks[-1] if chunks else None
        if (cur is None or len(cur) >= max_words
                or len(" ".join(x["w"] for x in cur)) + 1 + len(w["w"]) > max_chars
                or w["s"] - cur[-1]["e"] > 0.6
                or cur[-1]["w"][-1:] in ".?!"):
            chunks.append([w])
        else:
            cur.append(w)
    return chunks


def build_ass(texts: list[tuple[float, float, str]], position: str, look: str,
              words: list[dict], caption_style: str | None) -> str | None:
    """The subtitle file for on-screen text and captions, or None if there's nothing to draw."""
    events = []
    captions = bool(caption_style and words)
    # Captions sit in the lower third, above where the apps put their own buttons and caption.
    caption_v = 620
    if position == "top":
        overlay_align, overlay_v = 8, 340
    elif position == "middle" or captions:
        overlay_align, overlay_v = 5, 0
    else:
        overlay_align, overlay_v = 2, caption_v

    styles = [ass_style("Text", OVERLAY_LOOKS.get(look, OVERLAY_LOOKS["outline"]), overlay_align, overlay_v)]
    for start, end, text in texts:
        if ass_text(text):
            events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Text,,0,0,0,,{ass_text(text)}")

    if captions:
        cap = CAPTION_LOOKS.get(caption_style, CAPTION_LOOKS["bold-pop"])
        styles.append(ass_style("Caption", cap, 2, caption_v))
        chunks = caption_chunks(words, cap["words"], cap["chars"])
        for n, chunk in enumerate(chunks):
            start = chunk[0]["s"]
            end = chunk[-1]["e"] + 0.3
            if n + 1 < len(chunks):
                end = min(end, chunks[n + 1][0]["s"])
            end = max(end, start + 0.25)
            if caption_style == "karaoke":
                for k, w in enumerate(chunk):
                    ws = start if k == 0 else w["s"]
                    we = end if k == len(chunk) - 1 else chunk[k + 1]["s"]
                    line = " ".join(
                        f"{{\\c{HIGHLIGHT}&}}{ass_text(x['w'])}{{\\c{WHITE}&}}" if j == k else ass_text(x["w"])
                        for j, x in enumerate(chunk)
                    )
                    events.append(f"Dialogue: 0,{ass_time(ws)},{ass_time(max(we, ws + 0.05))},Caption,,0,0,0,,{line}")
            else:
                line = " ".join(ass_text(x["w"]) for x in chunk)
                if caption_style == "bold-pop":
                    line = "{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}" + line
                events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{line}")

    if not events:
        return None
    return "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {OUT_W}", f"PlayResY: {OUT_H}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, "
        "MarginV, Encoding",
        *styles, "",
        "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events, "",
    ])


def overlay_timeline(plan: list[dict], texts: list[str]) -> list[tuple[float, float, str]]:
    """Each shot's text over that shot; the same text on neighboring shots stays up without flickering."""
    out: list[tuple[float, float, str]] = []
    t = 0.0
    for p, text in zip(plan, texts):
        end = t + p["duration"]
        text = (text or "").strip()
        if text and out and out[-1][2] == text and abs(out[-1][1] - t) < 0.01:
            out[-1] = (out[-1][0], end, text)
        elif text:
            out.append((t, end, text))
        t = end
    return out


def r2_fetch(key: str, dest: Path) -> None:
    r2_client().download_file(os.environ["R2_BUCKET"], key, str(dest))


def r2_store(path: Path, key: str) -> None:
    r2_client().upload_file(str(path), os.environ["R2_BUCKET"], key, ExtraArgs={"ContentType": "video/mp4"})


def render_video(req: dict, workdir: Path, fetch=r2_fetch, store=r2_store) -> dict:
    """The whole render. Returns the website's RenderOutput shape (plus the plan and meta)."""
    from concurrent.futures import ThreadPoolExecutor

    started = time.time()
    breakdown = req["inspo"]["breakdown"]
    shots = breakdown["shots"]
    options = req["options"]
    cost = 0.0

    # ---- analyzing: get everything and look at the clips
    report("analyzing", 3)
    inspo_path = workdir / "inspo"
    clip_ids = [c["id"] for c in req["clips"]]
    downloads = [(req["inspo"]["storageKey"], inspo_path)] + [
        (c["storageKey"], workdir / f"clip{i:02d}") for i, c in enumerate(req["clips"])
    ]
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda d: fetch(d[0], d[1]), downloads))

    clips = []
    for i, c in enumerate(req["clips"]):
        path = workdir / f"clip{i:02d}"
        try:
            clips.append({"id": c["id"], "path": path, **probe_clip(path)})
        except Exception as e:  # noqa: BLE001
            print(f"skipping unreadable clip {c['id']}: {e}")
    if not clips:
        raise JobError("we couldn’t read your clips. try uploading them again.")
    index_of = {c["id"]: i for i, c in enumerate(clips)}

    # What the user chose in step 2 or the editor, per shot.
    edits = {e["shotIndex"]: e for e in req["shots"]}
    fixed = []
    for i in range(len(shots)):
        e = edits.get(i) or {}
        ci = index_of.get(e.get("clipId"))
        start = e.get("trimStartS") if ci is not None else None
        end = e.get("trimEndS") if ci is not None else None
        end = float(end) if isinstance(end, (int, float)) else None
        # A trim with only an end starts at the beginning of the clip.
        start = float(start) if isinstance(start, (int, float)) else (0.0 if end is not None else None)
        fixed.append({"clip": ci, "start": start, "end": end})

    reuse = req.get("reuse") or None
    text_mode = "keep" if reuse else ("custom" if options["text"]["mode"] == "custom" else "match")
    needs_claude = text_mode != "keep" or any(f["start"] is None for f in fixed)

    plan_texts: list[str] = [""] * len(shots)
    position, look = "top", "outline"
    post = {"caption": "", "hashtags": []}
    if reuse:
        plan_texts = [(t or "") for t in (reuse.get("texts") or [])][: len(shots)]
        plan_texts += [""] * (len(shots) - len(plan_texts))
        position = reuse.get("textPosition") or position
        look = reuse.get("textLook") or look
        post = reuse.get("postCopy") or post

    picked: dict[int, dict] = {}
    if needs_claude:
        report("analyzing", 8)
        sample_clip_frames(clips, workdir)
        inspo_frames = [
            grab_frame(inspo_path, s["startS"] + s["durationS"] / 2, workdir / f"inspo{i:02d}.jpg", MATCH_FRAME_WIDTH)
            for i, s in enumerate(shots)
        ]
        if sum(c["duration"] for c in clips if c["has_audio"]) <= MAX_CLIP_SPEECH_S:
            report("analyzing", 14)
            for c in clips:
                c["speech"] = transcribe(c["path"])["segments"] if c["has_audio"] else []

        report("matching", 25)
        result = match_clips(req["inspo"], inspo_frames, clips, fixed, text_mode,
                             options["text"].get("custom", ""), bool(req.get("fresh")))
        cost += result["cost_usd"]
        data = result["data"]
        picked = {s["index"]: s for s in data["shots"]}
        if text_mode != "keep":
            plan_texts = [(picked.get(i + 1) or {}).get("text", "") for i in range(len(shots))]
            position, look = data["text_position"], data["text_look"]
            post = {"caption": data["caption"].strip(), "hashtags": [h if h.startswith("#") else f"#{h}" for h in data["hashtags"] if h.strip()][:8]}
        print(f"matching: ${result['cost_usd']}, usage={result['usage']}")

    plan = resolve_plan(shots, clips, fixed, picked)

    # ---- editing: cut every shot, join them, add text and captions
    report("editing", 45)
    seg_paths = [workdir / f"shot{i:02d}.mkv" for i in range(len(plan))]
    done = 0

    def cut(i: int) -> None:
        nonlocal done
        p = plan[i]
        cut_shot(clips[p["clip"]], p["start"], p["take"], p["duration"], seg_paths[i])
        done += 1
        report("editing", 45 + int(30 * done / len(plan)))

    with ThreadPoolExecutor(3) as pool:
        list(pool.map(cut, range(len(plan))))

    list_file = workdir / "shots.txt"
    list_file.write_text("".join(f"file '{p.name}'\n" for p in seg_paths))
    joined = workdir / "joined.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list_file.name,
                    "-c", "copy", joined.name], cwd=workdir, check=True, capture_output=True)
    total = sum(p["duration"] for p in plan)

    music = options["music"]["mode"]
    words: list[dict] = []
    if options["captions"]["enabled"]:
        report("editing", 78)
        for seg in transcribe(joined)["segments"]:
            words += [w for w in seg.get("words") or [] if w["w"] and w["e"] <= total + 0.5]

    report("editing", 85)
    ass = build_ass(overlay_timeline(plan, plan_texts), position, look, words,
                    options["captions"]["style"] if options["captions"]["enabled"] else None)
    out = workdir / "final.mp4"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", joined.name]
    if music == "none":
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0"]
    else:
        # "track" has no licensed library behind it yet, so it keeps the clips' audio for now.
        cmd += ["-map", "0:v:0", "-map", "0:a:0"]
    cmd += ["-c:a", "aac", "-b:a", "192k"]
    if ass:
        (workdir / "text.ass").write_text(ass, encoding="utf-8")
        cmd += ["-vf", f"ass=text.ass:fontsdir={FONT_DIR}", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-pix_fmt", "yuv420p", "-profile:v", "high"]
    else:
        cmd += ["-c:v", "copy"]
    cmd += ["-t", f"{total:.3f}", "-movflags", "+faststart", out.name]
    result = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"final encode failed: {result.stderr[-800:]}")

    # ---- finishing
    report("finishing", 92)
    store(out, req["outputKey"])
    report("finishing", 99)

    seconds = round(time.time() - started, 1)
    print(f"render done: {len(plan)} shots, {total:.1f}s, claude={needs_claude}, ${round(cost, 4)}, {seconds}s")
    return {
        "storageKey": req["outputKey"],
        "width": OUT_W,
        "height": OUT_H,
        "durationS": r2(total),
        "postCopy": post,
        "plan": {
            "shots": [
                {"shotIndex": i, "clipId": clips[p["clip"]]["id"], "trimStartS": r2(p["start"]),
                 "trimEndS": r2(p["start"] + p["take"])}
                for i, p in enumerate(plan)
            ],
            "texts": plan_texts,
            "textPosition": position,
            "textLook": look,
        },
        "meta": {"engine": "modal", "costUsd": round(cost, 4), "claude": needs_claude, "seconds": seconds,
                 "clipsSkipped": len(clip_ids) - len(clips)},
    }


def check_render_request(req: dict) -> str | None:
    """Every key must be inside the same user's project folder. Returns a problem, or None."""
    import re

    out = req.get("outputKey")
    if not isinstance(out, str) or ".." in out or not re.match(KEY_PREFIX_RE, out):
        return "invalid output key"
    prefix = re.match(KEY_PREFIX_RE, out).group(0)
    keys = [req.get("inspo", {}).get("storageKey")] + [c.get("storageKey") for c in req.get("clips") or []]
    if not req.get("clips") or any(not isinstance(k, str) or ".." in k or not k.startswith(prefix) for k in keys):
        return "invalid storage keys"
    shots = (req["inspo"].get("breakdown") or {}).get("shots")
    if not isinstance(shots, list) or not shots or not isinstance(req.get("shots"), list):
        return "invalid shots"
    if not isinstance(req.get("options"), dict):
        return "invalid options"
    return None


# ---------------------------------------------------------------- jobs

job_resources = dict(image=image, secrets=secrets, cpu=4, memory=4096)


@app.function(**job_resources, timeout=600)
def analyze_job(storage_key: str) -> dict:
    """Analyzes an uploaded inspo (read from storage by key)."""
    try:
        report("getting your video", 5)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "inspo"
            r2_client().download_file(os.environ["R2_BUCKET"], storage_key, str(path))
            return analyze_path(path)
    except JobError:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"analysis failed: {type(e).__name__}: {e}")
        raise


@app.function(**job_resources, timeout=600)
def analyze_upload(video: bytes) -> dict:
    """For testing from a laptop: analyzes video bytes sent directly (skips storage)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "inspo"
        path.write_bytes(video)
        return analyze_path(path)


@app.local_entrypoint()
def try_analyze(path: str):
    breakdown = analyze_upload.remote(Path(path).read_bytes())
    print(json.dumps(breakdown, indent=2, ensure_ascii=False))


@app.function(image=image, secrets=secrets, cpu=8, memory=8192, timeout=900)
def render_job(req: dict) -> dict:
    """Makes one version of the user's video (see render_video)."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            return render_video(req, Path(tmp))
    except JobError:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"render failed: {type(e).__name__}: {e}")
        raise


@app.function(**job_resources, timeout=900)
def render_upload(req: dict, files: dict[str, bytes]) -> tuple[dict, bytes]:
    """For testing from a laptop: renders files sent directly (keys map to bytes; skips storage)."""
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        result: dict = {}

        def store(path: Path, key: str) -> None:
            result["video"] = path.read_bytes()

        out = render_video(req, workdir, fetch=lambda key, dest: dest.write_bytes(files[key]), store=store)
        return out, result["video"]


@app.local_entrypoint()
def try_render(inspo: str, clips: str, dest: str, captions: str = "bold-pop", text: str = "match", custom: str = ""):
    """modal run worker/app.py::try_render --inspo a.mp4 --clips b.mp4,c.mp4 --dest out.mp4"""
    files = {"u/test/p/test/inspo": Path(inspo).read_bytes()}
    breakdown = analyze_upload.remote(files["u/test/p/test/inspo"])
    clip_list = []
    for i, c in enumerate(clips.split(",")):
        files[f"u/test/p/test/clip{i}"] = Path(c).read_bytes()
        clip_list.append({"id": f"clip{i}", "storageKey": f"u/test/p/test/clip{i}"})
    req = {
        "outputKey": "u/test/p/test/renders/out.mp4",
        "inspo": {"storageKey": "u/test/p/test/inspo", "breakdown": breakdown},
        "clips": clip_list,
        "shots": [{"shotIndex": s["index"], "clipId": None, "trimStartS": None, "trimEndS": None} for s in breakdown["shots"]],
        "options": {"text": {"mode": text, "custom": custom}, "music": {"mode": "original", "trackId": None},
                    "captions": {"enabled": captions != "off", "style": captions}},
    }
    out, video = render_upload.remote(req, files)
    Path(dest).write_bytes(video)
    print(json.dumps(out, indent=2, ensure_ascii=False))


@app.function(image=image, secrets=secrets, timeout=300)
def read_object(key: str) -> bytes:
    """For checking renders from a laptop (the website's keys stay server-side)."""
    if not key.startswith("u/") or ".." in key:
        raise ValueError("only user files")
    return r2_client().get_object(Bucket=os.environ["R2_BUCKET"], Key=key)["Body"].read()


@app.local_entrypoint()
def download(key: str, dest: str):
    Path(dest).write_bytes(read_object.remote(key))
    print(f"saved {dest}")


@app.function(image=image, secrets=secrets, timeout=120)
def ping_job() -> dict:
    """Test job: walks through the stages so the website can follow along."""
    for i, stage in enumerate(["analyzing", "matching", "editing", "finishing"]):
        report(stage, i * 25)
        time.sleep(1.5)
    report("finishing", 100)
    return {"ffmpeg": ffmpeg_version()}


# ---------------------------------------------------------------- web API


@app.function(image=image, secrets=secrets, timeout=60)
@modal.asgi_app(label=APP_NAME)
def api():
    from fastapi import Body, Depends, FastAPI, Header, HTTPException

    web = FastAPI(title="viralowner worker", docs_url=None, redoc_url=None, openapi_url=None)

    def require_token(authorization: str = Header(default="")) -> None:
        expected = f"Bearer {os.environ['WORKER_TOKEN']}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    def started(call) -> dict:
        progress_store[call.object_id] = {"stage": None, "progress": 0, "updated_at": time.time()}
        return {"jobId": call.object_id}

    @web.get("/health", dependencies=[Depends(require_token)])
    def health() -> dict:
        checks: dict[str, dict] = {}

        try:
            checks["ffmpeg"] = {"ok": True, "detail": ffmpeg_version()}
        except Exception as e:  # noqa: BLE001
            checks["ffmpeg"] = {"ok": False, "detail": type(e).__name__}

        fonts = list(Path(FONT_DIR).glob("*.otf")) if Path(FONT_DIR).exists() else []
        has_zscale = " zscale " in run(["ffmpeg", "-hide_banner", "-filters"])
        has_ass = " ass " in run(["ffmpeg", "-hide_banner", "-filters"])
        checks["render"] = {
            "ok": bool(fonts) and has_ass,
            "detail": f"{len(fonts)} fonts, ass={has_ass}, zscale={has_zscale}",
        }

        try:
            r2_client().list_objects_v2(Bucket=os.environ["R2_BUCKET"], MaxKeys=1)
            checks["storage"] = {"ok": True, "detail": "bucket reachable"}
        except Exception as e:  # noqa: BLE001
            checks["storage"] = {"ok": False, "detail": type(e).__name__}

        try:
            import anthropic

            # Reads model info only: confirms the key works without spending tokens.
            model = anthropic.Anthropic().models.retrieve(CLAUDE_MODEL)
            checks["claude"] = {"ok": True, "detail": model.id}
        except Exception as e:  # noqa: BLE001
            checks["claude"] = {"ok": False, "detail": type(e).__name__}

        return {"ok": all(c["ok"] for c in checks.values()), "checks": checks}

    @web.post("/jobs/analyze", dependencies=[Depends(require_token)])
    def start_analyze(storage_key: str = Body(embed=True, alias="storageKey")) -> dict:
        # Only user uploads (u/<user>/p/<project>/...); never arbitrary keys.
        if not storage_key.startswith("u/") or ".." in storage_key:
            raise HTTPException(status_code=400, detail="invalid storage key")
        return started(analyze_job.spawn(storage_key))

    @web.post("/jobs/render", dependencies=[Depends(require_token)])
    def start_render(req: dict = Body()) -> dict:
        problem = check_render_request(req)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        return started(render_job.spawn(req))

    @web.post("/jobs/ping", dependencies=[Depends(require_token)])
    def start_ping() -> dict:
        return started(ping_job.spawn())

    @web.get("/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str) -> dict:
        try:
            call = modal.FunctionCall.from_id(job_id)
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=404, detail="unknown job")

        try:
            output = call.get(timeout=0)
        except modal.exception.OutputExpiredError:
            return {"state": "failed", "stage": None, "progress": 0, "error": "this took too long. please try again."}
        except (TimeoutError, modal.exception.TimeoutError):
            p = progress_store.get(job_id) or {"stage": None, "progress": 0}
            state = "queued" if p["stage"] is None else "processing"
            return {"state": state, "stage": p["stage"], "progress": p["progress"]}
        except JobError as e:
            return {"state": "failed", "stage": None, "progress": 0, "error": str(e)}
        except Exception:  # noqa: BLE001 - the job itself crashed
            return {"state": "failed", "stage": None, "progress": 0, "error": "something went wrong on our side. please try again."}

        return {"state": "done", "stage": None, "progress": 100, "output": output}

    return web
