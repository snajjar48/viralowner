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

# Free fonts (SIL Open Font License / Apache) covering the looks short-form videos use.
FONT_FILES = {
    "Anton-Regular.ttf": "ofl/anton/Anton-Regular.ttf",
    "BebasNeue-Regular.ttf": "ofl/bebasneue/BebasNeue-Regular.ttf",
    "ArchivoBlack-Regular.ttf": "ofl/archivoblack/ArchivoBlack-Regular.ttf",
    "DMSerifDisplay-Regular.ttf": "ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf",
    "CourierPrime-Bold.ttf": "ofl/courierprime/CourierPrime-Bold.ttf",
    "PermanentMarker-Regular.ttf": "apache/permanentmarker/PermanentMarker-Regular.ttf",
    "Pacifico-Regular.ttf": "ofl/pacifico/Pacifico-Regular.ttf",
    "LilitaOne-Regular.ttf": "ofl/lilitaone/LilitaOne-Regular.ttf",
}
EXTRA_FONT_DIR = "/usr/share/fonts/truetype/viralowner"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-montserrat", "fontconfig", "curl", "libgl1", "libglib2.0-0")
    .run_commands(
        f"mkdir -p {EXTRA_FONT_DIR}",
        *[f"curl -fsSL -o {EXTRA_FONT_DIR}/{name} https://raw.githubusercontent.com/google/fonts/main/{src}"
          for name, src in FONT_FILES.items()],
        "fc-cache -f",
    )
    .uv_pip_install("fastapi[standard]", "boto3", "anthropic", "scenedetect", "opencv-python<5", "opencv-python-headless<5", "faster-whisper", "pillow")
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


def add_style(path: Path, breakdown: dict) -> dict:
    """Adds the inspo's look to a breakdown. A failure here never fails the analysis."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            style, cost = analyze_style(path, breakdown["shots"], Path(tmp), breakdown.get("transcript"))
        breakdown["style"] = style
        breakdown["meta"]["costUsd"] = round(breakdown["meta"]["costUsd"] + cost, 4)
    except Exception as e:  # noqa: BLE001
        print(f"style analysis failed: {type(e).__name__}: {e}")
    return breakdown


# ---------------------------------------------------------------- the inspo's look
#
# How the inspo is edited, so renders can copy it: the transition into each
# shot, camera-style motion, color filter, and the overlaid text's font,
# colors, size, alignment, animation and placement.

TRANSITIONS = ["cut", "crossfade", "flash", "dip_to_black", "whip", "slide", "slide_up", "zoom", "glitch", "wipe"]
MOTIONS = ["none", "slow_zoom_in", "slow_zoom_out", "punch_in", "shake"]
EDIT_TYPES = ["shots", "jump_cut"]
COLOR_FILTERS = ["none", "warm", "cool", "vintage", "black_and_white", "high_contrast", "faded", "vivid"]
# font key -> (family, bold, rough character width as a fraction of the font size)
FONTS = {
    "clean_sans": ("Montserrat", True, 0.60),
    "heavy_sans": ("Archivo Black", False, 0.66),
    "condensed": ("Anton", False, 0.46),
    "tall_caps": ("Bebas Neue", False, 0.42),
    "serif": ("DM Serif Display", False, 0.55),
    "typewriter": ("Courier Prime", True, 0.62),
    "marker": ("Permanent Marker", False, 0.60),
    "script": ("Pacifico", False, 0.58),
    "rounded": ("Lilita One", False, 0.52),
}
TEXT_ALIGNS = ["left", "center", "right"]
# Height of a capital letter, as a fraction of the frame height, for each size name.
TEXT_SIZES = {"small": 0.028, "medium": 0.038, "large": 0.052, "xl": 0.075}
TEXT_ANIMATIONS = ["none", "pop", "fade", "typewriter", "word_by_word", "slide_up"]
DEFAULT_TEXT_STYLE = {
    "font": "clean_sans", "color": "#FFFFFF", "outline": "thick", "outlineColor": "#000000", "box": False,
    "boxColor": "#FFFFFF", "shadow": False, "align": "center", "size": "large", "animation": "none",
}

STYLE_SYSTEM = """You study how a viral short-form video (TikTok, Reels, Shorts) is edited, so ViralOwner can rebuild the same look with someone else's footage.

You get, for every shot: a frame from the middle of the shot, and a strip of 8 frames 0.1s apart starting 0.25s before the cut into it (for shot 1: the first 0.8s), read left to right.

First decide the edit_type:
- 'jump_cut': the video is really one continuous take (usually one person talking to the camera in the same place) with the pauses, breaths and dead air cut out, so the speech carries straight across the cuts. it may jump between a normal and a zoomed-in framing (alternate_zoom).
- 'shots': separate shots that each need their own footage (different places, angles, subjects or moments), even if someone talks over them.

Then describe only what the frames clearly show:
- transition_in: how the video gets into this shot. most short-form cuts are hard cuts ('cut'); only report another transition when the strip clearly shows it (frames blending = crossfade, a white frame = flash, a black frame = dip_to_black, motion blur sweeping sideways = whip, the new shot pushing in from a side = slide or slide_up, a zoom blur = zoom, digital distortion = glitch, a hard edge sweeping across = wipe). shot 1 is always 'cut'.
- motion: an edit effect moving the whole frame (slow zoom, a quick punch-in, shake). 'none' for normal handheld or static footage.
- color_filter: an obvious grade on the whole video, otherwise 'none'.
- text: the overlaid text (titles, labels, hooks), not burned-in speech captions. pick the closest font: clean_sans (geometric sans like tiktok's classic), heavy_sans (very heavy wide sans), condensed (tall narrow bold, like impact/anton), tall_caps (thin tall capitals, like bebas), serif, typewriter, marker (handwritten marker), script (cursive), rounded (rounded bold, playful). colors as #RRGGBB. box = the text sits on a solid shape. size: small (a label), medium, large (a headline), xl (fills the width). animation: how text appears (pop = scales up, typewriter = letter by letter, word_by_word, fade, slide_up), 'none' if it's just there. if the video has no overlaid text, describe a clean default (clean_sans, white, thick black outline, centered, large, none).
- text_x / text_y per shot: where that shot's overlaid text sits, as fractions of the frame (0 = left/top, 1 = right/bottom). text_x is the left edge for left-aligned text, the center for centered text, the right edge for right-aligned text; text_y is the vertical center of the whole text block. -1 for both when the shot has no overlaid text."""

COLOR_RE = r"^#[0-9A-Fa-f]{6}$"

STYLE_SCHEMA = {
    "type": "object",
    "properties": {
        "shots": {
            "type": "array",
            "description": "one entry per shot, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the shot number, starting at 1."},
                    "transition_in": {"type": "string", "enum": TRANSITIONS},
                    "motion": {"type": "string", "enum": MOTIONS},
                    "text_x": {"type": "number"},
                    "text_y": {"type": "number"},
                    "text_lines": {
                        "type": "string",
                        "description": "the overlaid text exactly as shown, with \\n where its lines break. empty if none.",
                    },
                },
                "required": ["index", "transition_in", "motion", "text_x", "text_y", "text_lines"],
                "additionalProperties": False,
            },
        },
        "edit_type": {"type": "string", "enum": EDIT_TYPES},
        "alternate_zoom": {
            "type": "boolean",
            "description": "jump_cut only: the framing jumps between normal and zoomed in at the cuts.",
        },
        "color_filter": {"type": "string", "enum": COLOR_FILTERS},
        "text": {
            "type": "object",
            "properties": {
                "font": {"type": "string", "enum": list(FONTS)},
                "color": {"type": "string", "description": "#RRGGBB"},
                "outline": {"type": "string", "enum": ["none", "thin", "thick"]},
                "outline_color": {"type": "string", "description": "#RRGGBB"},
                "box": {"type": "boolean"},
                "box_color": {"type": "string", "description": "#RRGGBB"},
                "shadow": {"type": "boolean"},
                "align": {"type": "string", "enum": TEXT_ALIGNS},
                "size": {"type": "string", "enum": list(TEXT_SIZES)},
                "letter_height": {
                    "type": "number",
                    "description": "height of a capital letter as a fraction of the frame height (about 0.03 for a small label, 0.06 for a headline, 0.1 for huge text).",
                },
                "animation": {"type": "string", "enum": TEXT_ANIMATIONS},
            },
            "required": ["font", "color", "outline", "outline_color", "box", "box_color", "shadow", "align", "size",
                         "letter_height", "animation"],
            "additionalProperties": False,
        },
    },
    "required": ["shots", "edit_type", "alternate_zoom", "color_filter", "text"],
    "additionalProperties": False,
}


def cut_strip(path: Path, t: float, dest: Path) -> Path | None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, t):.3f}", "-t", "0.8", "-i", str(path),
         "-vf", "fps=10,scale=144:-2,tile=8x1", "-frames:v", "1", "-q:v", "5", str(dest)],
        capture_output=True,
    )
    return dest if dest.exists() and dest.stat().st_size > 0 else None


def clean_style(data: dict, n: int) -> dict:
    """Claude's answer as the breakdown's `style` (camelCase, every value checked)."""
    import re

    by_index = {s["index"]: s for s in data.get("shots", [])}
    t = data.get("text") or {}
    color = lambda v, d: v.upper() if isinstance(v, str) and re.match(COLOR_RE, v) else d  # noqa: E731
    pick = lambda v, options, d: v if v in options else d  # noqa: E731
    spots = []
    for i in range(n):
        x, y = (by_index.get(i + 1) or {}).get("text_x", -1), (by_index.get(i + 1) or {}).get("text_y", -1)
        ok = isinstance(x, (int, float)) and isinstance(y, (int, float)) and 0 <= x <= 1 and 0 <= y <= 1
        spots.append([r2(x), r2(y)] if ok else None)
    return {
        "transitions": [pick((by_index.get(i + 2) or {}).get("transition_in"), TRANSITIONS, "cut") for i in range(n - 1)],
        "motions": [pick((by_index.get(i + 1) or {}).get("motion"), MOTIONS, "none") for i in range(n)],
        "colorFilter": pick(data.get("color_filter"), COLOR_FILTERS, "none"),
        # One take with the pauses cut out (n > 2: two shots can't tell us that).
        "editType": pick(data.get("edit_type"), EDIT_TYPES, "shots") if n > 2 else "shots",
        "alternateZoom": bool(data.get("alternate_zoom")) and data.get("edit_type") == "jump_cut",
        "text": {
            "font": pick(t.get("font"), FONTS, "clean_sans"),
            "color": color(t.get("color"), "#FFFFFF"),
            "outline": pick(t.get("outline"), ["none", "thin", "thick"], "thick"),
            "outlineColor": color(t.get("outline_color"), "#000000"),
            "box": bool(t.get("box")),
            "boxColor": color(t.get("box_color"), "#FFFFFF"),
            "shadow": bool(t.get("shadow")),
            "align": pick(t.get("align"), TEXT_ALIGNS, "center"),
            "size": pick(t.get("size"), TEXT_SIZES, "large"),
            "animation": pick(t.get("animation"), TEXT_ANIMATIONS, "none"),
            **({"letterHeight": r2(min(0.15, max(0.015, float(t["letter_height"]))))}
               if isinstance(t.get("letter_height"), (int, float)) and t["letter_height"] > 0 else {}),
        },
        "textSpots": spots,
        "textLines": [((by_index.get(i + 1) or {}).get("text_lines") or "").strip() or None for i in range(n)],
    }


def analyze_style(path: Path, shots: list[dict], workdir: Path, transcript: dict | None = None) -> tuple[dict, float]:
    """The inspo's look (see STYLE_SYSTEM). `shots` are breakdown shots. Returns (style, cost)."""
    said = [f"[{x['startS']:.1f}s–{x['endS']:.1f}s] {x['text']}" for x in (transcript or {}).get("segments", [])]
    content: list[dict] = [{"type": "text", "text": (
        f"the video has {len(shots)} shots.\nwhat's said:\n" + ("\n".join(said) if said else "(no speech)")
    )}]
    for i, s in enumerate(shots):
        a, d = s["startS"], s["durationS"]
        text = s.get("onScreenText")
        content.append({"type": "text", "text": (
            f"shot {i + 1}: {a:.1f}s–{a + d:.1f}s. overlaid text: {json.dumps(text, ensure_ascii=False) if text else 'none'}"
        )})
        mid = grab_frame(path, a + d / 2, workdir / f"style_mid{i:02d}.jpg", FRAME_WIDTH)
        strip = cut_strip(path, a - 0.25 if i else 0.0, workdir / f"style_cut{i:02d}.jpg")
        for p in (mid, strip):
            if p:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
    content.append({"type": "text", "text": f"describe all {len(shots)} shots and the text style."})
    result = ask_claude(STYLE_SYSTEM, content, STYLE_SCHEMA, "we couldn’t read that video’s style.")
    print(f"style: ${result['cost_usd']}, usage={result['usage']}")
    return clean_style(result["data"], len(shots)), result["cost_usd"]


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

Writing: everything is about the user's business or topic, as their clips show it. The video will be posted on TikTok and Instagram, whose buttons and captions cover the top, bottom and right edge of the screen; the app places the text in the safe area, so keep on-screen text short enough to fit there. Never invent facts, prices, results or claims the footage doesn't support. No emoji or hashtags in on-screen text. Keep the inspo's casing style (all lowercase if the inspo uses lowercase)."""

TEXT_RULES = {
    "adapt": (
        "on-screen text: write the user's version of the inspo's overlaid text for each shot where the inspo has text: "
        "same format, rhythm, tone and roughly the same length (if the inspo says 'pov: you finally...', write a pov line "
        "about what the user's clips show), with the same number of lines: put \\n where the inspo's lines break. "
        "give an empty string for shots where the inspo has no "
        "text. if the same text stays on screen across several inspo shots, repeat it for each of those shots."
    ),
    # The words are set without Claude for these: the inspo's exact text, the user's own lines, or kept.
    "exact": "on-screen text: copied from the inspo word for word. return an empty string for every shot.",
    "custom": "on-screen text: the user wrote it already. return an empty string for every shot.",
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
    "required": ["shots", "caption", "hashtags"],
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
                text_mode: str, custom_text: str, fresh: bool, notes: str = "",
                shots: list[dict] | None = None, lines: list[str] | None = None) -> dict:
    """Claude's plan: a clip and start time per shot, on-screen text, and the post copy."""
    b = inspo["breakdown"]
    shots = shots or b["shots"]
    ins = b.get("insights") or {}
    lines = [f"[{s['startS']:.1f}s–{s['endS']:.1f}s] {s['text']}" for s in (b.get("transcript") or {}).get("segments", [])]
    overlay = b.get("textOverlays") or {}

    content: list[dict] = [{"type": "text", "text": (
        f"the inspo is {b['durationS']:.1f}s with {len(shots)} shots.\n"
        f"hook: {ins.get('hook', '')}\nstructure: {ins.get('structure', '')}\n"
        f"overlaid text: {overlay.get('style') or 'none'}\n"
        "inspo transcript:\n" + ("\n".join(lines) if lines else "(no speech)") + "\n\nthe inspo's shots:"
    )}]
    lines_by_shot = lines if lines is not None else ((b.get("style") or {}).get("textLines") or [])
    for i, s in enumerate(shots):
        text = (lines_by_shot[i] if i < len(lines_by_shot) else None) or s.get("onScreenText")
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
        *([
            "the user's additional requests and details about their video (follow them where they fit, use the "
            f"details in the words you write): {json.dumps(notes, ensure_ascii=False)}"
        ] if notes else []),
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


COLOR_FILTER_VF = {
    "warm": "colorbalance=rs=0.06:gs=0.02:bs=-0.06",
    "cool": "colorbalance=rs=-0.05:bs=0.07",
    "vintage": "curves=preset=vintage",
    "black_and_white": "hue=s=0",
    "high_contrast": "eq=contrast=1.18:saturation=1.15",
    "faded": "eq=contrast=0.88:brightness=0.03:saturation=0.8",
    "vivid": "eq=saturation=1.35",
}


def motion_filter(motion: str, frames: int) -> str | None:
    """Camera-style motion over the whole shot (`frames` long)."""
    zoom = lambda z: (  # noqa: E731
        # Zoom on a 2x frame so slow zooms move smoothly instead of in whole-pixel steps.
        f"scale={OUT_W * 2}:{OUT_H * 2}:flags=bicubic,zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={OUT_W}x{OUT_H}:fps={OUT_FPS}"
    )
    n = max(1, frames)
    if motion == "slow_zoom_in":
        return zoom(f"1+0.10*on/{n}")
    if motion == "slow_zoom_out":
        return zoom(f"1.10-0.10*on/{n}")
    if motion == "punch_in":
        return zoom("if(lt(on,5),1+0.035*on,1.17)")
    if motion == "zoomed":
        # Jump-cut style: this cut is framed tighter than the one before (no movement).
        w, h = round(OUT_W * 1.18), round(OUT_H * 1.18)
        # A little above center: talking heads sit in the upper half.
        return f"scale={w}:{h},crop={OUT_W}:{OUT_H}:{(w - OUT_W) // 2}:{round((h - OUT_H) * 0.35)}"
    if motion == "shake":
        w, h = round(OUT_W * 1.08), round(OUT_H * 1.08)
        return f"scale={w}:{h},crop={OUT_W}:{OUT_H}:x='{(w - OUT_W) // 2}+18*sin(n*1.9)':y='{(h - OUT_H) // 2}+14*cos(n*2.7)'"
    return None


def cut_shot(clip: dict, start: float, take: float, duration: float, dest: Path,
             tail: float = 0.0, motion: str = "none", color: str = "none") -> None:
    """One shot: the clip from `start`, filling exactly `duration` seconds at 1080x1920, plus `tail`
    extra seconds of picture for a transition into the next shot (its audio is trimmed off later)."""
    slow = min(MAX_SLOWDOWN, duration / take) if take < duration - 0.02 else 1.0
    total = duration + tail
    # Use real footage for the tail when the clip has it; otherwise the last frame holds.
    extra = max(0.0, min(tail / slow, clip["duration"] - start - take))
    vf = [
        *([tonemap_filter()] if clip["hdr"] else []),
        f"scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:flags=lanczos",
        f"crop={OUT_W}:{OUT_H}", "setsar=1", f"fps={OUT_FPS}",
        *([f"setpts={slow:.4f}*PTS"] if slow > 1 else []),
        f"tpad=stop_mode=clone:stop_duration={total:.3f}",
        *([m] if (m := motion_filter(motion, round(total * OUT_FPS))) else []),
        *([COLOR_FILTER_VF[color]] if color in COLOR_FILTER_VF else []),
        "format=yuv420p",
    ]
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{take + extra:.3f}", "-i", str(clip["path"])]
    if clip["has_audio"]:
        af = f"aresample=48000,{f'atempo={1 / slow:.4f},' if slow > 1 else ''}apad"
        audio = ["-map", "0:v:0", "-map", "0:a:0", "-af", af]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = ["-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        *audio, "-vf", ",".join(vf), "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", str(OUT_FPS),
        # PCM audio, so joining the shots doesn't add clicks or drift at the cuts.
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and clip["hdr"]:
        # Tone mapping can fail on unusual files; plain conversion still gives a usable shot.
        cut_shot({**clip, "hdr": False}, start, take, duration, dest, tail, motion, color)
    elif result.returncode != 0 and motion != "none":
        print(f"motion '{motion}' failed, cutting without it: {result.stderr[-300:]}")
        cut_shot(clip, start, take, duration, dest, tail, "none", color)
    elif result.returncode != 0:
        raise RuntimeError(f"cutting shot failed: {result.stderr[-500:]}")


# transition -> (ffmpeg xfade transition, seconds)
XFADES = {
    "crossfade": ("fade", 0.4), "flash": ("fadewhite", 0.2), "dip_to_black": ("fadeblack", 0.4),
    "whip": ("smoothleft", 0.25), "slide": ("slideleft", 0.3), "slide_up": ("slideup", 0.3),
    "zoom": ("zoomin", 0.3), "glitch": ("pixelize", 0.25), "wipe": ("wipeleft", 0.3),
}


def transition_plan(durations: list[float], transitions: list[str]) -> list[tuple[str, float] | None]:
    """For each cut: (xfade name, seconds), or None for a hard cut. Never more than 40% of either shot."""
    out = []
    for i in range(len(durations) - 1):
        t = transitions[i] if i < len(transitions) else "cut"
        if t not in XFADES:
            out.append(None)
            continue
        name, d = XFADES[t]
        d = min(d, 0.4 * durations[i], 0.4 * durations[i + 1])
        out.append((name, round(d, 3)) if d >= 0.08 else None)
    return out


def join_shots(seg_paths: list[Path], durations: list[float], cuts: list[tuple[str, float] | None],
               workdir: Path, dest: Path) -> None:
    """Joins the shots, with the transitions in `cuts`, keeping every cut at its exact time."""
    if not any(cuts):
        list_file = workdir / "shots.txt"
        list_file.write_text("".join(f"file '{p.name}'\n" for p in seg_paths))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list_file.name,
                        "-c", "copy", dest.name], cwd=workdir, check=True, capture_output=True)
        return

    n = len(seg_paths)
    parts = [f"[{i}:v]settb=AVTB,fps={OUT_FPS},format=yuv420p[v{i}]" for i in range(n)]
    # Hard cuts join shots into groups; transitions join the groups. Each shot before a
    # transition carries extra picture (its tail), and the transition starts at the cut.
    groups: list[list[int]] = [[0]]
    for i, c in enumerate(cuts):
        if c:
            groups.append([i + 1])
        else:
            groups[-1].append(i + 1)
    labels = []
    for g, members in enumerate(groups):
        if len(members) == 1:
            labels.append(f"v{members[0]}")
        else:
            parts.append("".join(f"[v{m}]" for m in members) + f"concat=n={len(members)}:v=1:a=0[g{g}]")
            labels.append(f"g{g}")
    current, elapsed = labels[0], sum(durations[m] for m in groups[0])
    for g in range(1, len(groups)):
        name, d = cuts[groups[g][0] - 1]
        parts.append(f"[{current}][{labels[g]}]xfade=transition={name}:duration={d}:offset={elapsed:.3f}[x{g}]")
        current = f"x{g}"
        elapsed += sum(durations[m] for m in groups[g])
    # Audio keeps hard cuts at the exact times.
    parts += [f"[{i}:a]atrim=0:{durations[i]:.3f},asetpts=PTS-STARTPTS[a{i}]" for i in range(n)]
    parts.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[aout]")
    cmd = ["ffmpeg", "-v", "error", "-y", *[x for p in seg_paths for x in ("-i", p.name)],
           "-filter_complex", ";".join(parts), "-map", f"[{current}]", "-map", "[aout]",
           "-t", f"{sum(durations):.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
           "-c:a", "pcm_s16le", dest.name]
    result = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"transitions failed, joining with hard cuts: {result.stderr[-400:]}")
        # Shots before a transition are longer than their slot: trim them back first.
        parts = [f"[{i}:v]trim=0:{durations[i]:.3f},setpts=PTS-STARTPTS[v{i}];"
                 f"[{i}:a]atrim=0:{durations[i]:.3f},asetpts=PTS-STARTPTS[a{i}]" for i in range(n)]
        parts.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vout][aout]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", *[x for p in seg_paths for x in ("-i", p.name)],
                        "-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "pcm_s16le", dest.name],
                       cwd=workdir, check=True, capture_output=True)


# ---- text and captions (ASS subtitles, burned in by libass)
#
# Safe zone: TikTok and Instagram Reels cover parts of a 9:16 video with their own
# interface: the tabs/search bar at the top, the username, caption and music line at
# the bottom, and the like/comment/share/profile column on the right. On-screen text
# and captions always stay inside the area left over, as fractions of the frame.
SAFE = {"top": 0.115, "bottom": 0.75, "left": 0.065, "right": 0.85}
MARGIN_L, MARGIN_R = round(SAFE["left"] * OUT_W), round((1 - SAFE["right"]) * OUT_W)
SAFE_CENTER_X = (SAFE["left"] + SAFE["right"]) / 2
CAPTION_MARGIN = 620  # px from the bottom to the bottom of the captions (inside the safe zone)
TOP_TEXT_Y = 0.2  # where "top" text sits by default (its top edge)
SAFE_ZONE_RULE = (
    "TikTok and Instagram cover parts of the video with their own buttons and text: the top ~12% (tabs and search), "
    "the bottom ~25% (username, caption, music) and the right ~15% (like, comment, share). Keep on-screen text and "
    "captions inside the rest: between 0.12 and 0.75 from the top, and between 0.07 and 0.85 from the left."
)


def ass_time(t: float) -> str:
    cs = max(0, round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def ass_part(text: str) -> str:
    """Escapes ASS override characters and drops emoji (the fonts have no emoji). Keeps spacing."""
    import re

    text = re.sub(r"[\U00010000-\U0010FFFF☀-➿️‍]", "", text)
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def ass_text(text: str) -> str:
    return ass_part(text).strip()


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB -> ASS's &HAABBGGRR."""
    h = hex_color.lstrip("#") if isinstance(hex_color, str) and len(hex_color.lstrip("#")) == 6 else "FFFFFF"
    return f"&H{alpha:02X}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


WHITE, BLACK, SHADOW = "&H00FFFFFF", "&H00000000", "&H90000000"
HIGHLIGHT = "&H0000E5FF"  # yellow, in ASS's BGR order

CAPTION_LOOKS = {
    "bold-pop": dict(size=136, primary=WHITE, outline_c=BLACK, border=1, outline=9, shadow=0, words=2, chars=14),
    "clean": dict(size=80, primary=WHITE, outline_c=BLACK, border=1, outline=4, shadow=2, words=5, chars=28),
    "boxed": dict(size=84, primary=WHITE, outline_c="&H33000000", border=3, outline=16, shadow=0, words=4, chars=22),
    "karaoke": dict(size=104, primary=WHITE, outline_c=BLACK, border=1, outline=8, shadow=0, words=3, chars=20),
}


def scaled(look: dict, scale: float) -> dict:
    return {**look, "size": round(look["size"] * scale), "outline": max(0, round(look["outline"] * scale))}


def caption_style_line(look: dict) -> str:
    return (f"Style: Caption,{FONT},{look['size']},{look['primary']},{look['primary']},{look['outline_c']},{SHADOW},"
            f"-1,0,0,0,100,100,0,0,{look['border']},{look['outline']},{look['shadow']},2,"
            f"{MARGIN_L},{MARGIN_R},{CAPTION_MARGIN},1")


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


def caption_center(cap: dict) -> float:
    lines = 1 if cap["words"] <= 3 else 2
    return 1 - CAPTION_MARGIN / OUT_H - lines * cap["size"] * 1.22 / OUT_H / 2


def caption_height(cap: dict) -> float:
    return (1 - CAPTION_MARGIN / OUT_H - caption_center(cap)) * 2


_font_cache: dict = {}


def font_metrics(key: str) -> dict:
    """The real font file, measured: how libass sizes it, and its capital height."""
    if key in _font_cache:
        return _font_cache[key]
    from PIL import ImageFont

    family, bold, _w = FONTS.get(key, FONTS["clean_sans"])
    path = run(["fc-match", "-f", "%{file}", f"{family}:bold" if bold else family]).strip()
    font = ImageFont.truetype(path, 100)
    ascent, descent = font.getmetrics()
    box = font.getbbox("H")
    m = {
        "font": font,
        # libass sizes a font so ascent + descent = the font size; PIL uses the em.
        "em_per_size": 100 / (ascent + descent),
        "cap": (box[3] - box[1]) / 100,
    }
    _font_cache[key] = m
    return m


def text_look(style: dict, scale: float) -> dict:
    """How on-screen text is drawn, from a text style (see DEFAULT_TEXT_STYLE)."""
    key = style.get("font") if style.get("font") in FONTS else "clean_sans"
    family, bold, _w = FONTS[key]
    m = font_metrics(key)
    letter = style.get("letterHeight") or TEXT_SIZES.get(style.get("size"), TEXT_SIZES["large"])
    size = round(letter * OUT_H / (m["cap"] * m["em_per_size"]) * scale)
    if style.get("box"):
        border, outline, outline_c = 3, max(6, round(size * 0.2)), ass_color(style.get("boxColor", "#FFFFFF"))
    else:
        outline = {"none": 0, "thin": max(2, round(size * 0.04)), "thick": max(4, round(size * 0.08))}.get(
            style.get("outline"), 0)
        border, outline_c = 1, ass_color(style.get("outlineColor", "#000000"))
    return {"family": family, "bold": bold, "key": key, "size": size,
            "primary": ass_color(style.get("color", "#FFFFFF")), "outline_c": outline_c,
            "border": border, "outline": outline, "shadow": 3 if style.get("shadow") else 0}


def text_style_line(look: dict) -> str:
    return (f"Style: Text,{look['family']},{look['size']},{look['primary']},{look['primary']},{look['outline_c']},"
            f"{SHADOW},{-1 if look['bold'] else 0},0,0,0,100,100,0,0,{look['border']},{look['outline']},"
            f"{look['shadow']},5,{MARGIN_L},{MARGIN_R},0,1")


def line_width(line: str, look: dict, size: float) -> float:
    """Width of one line drawn at `size`, as a fraction of the frame (measured with the real font)."""
    m = font_metrics(look["key"])
    return m["font"].getlength(line) * size * m["em_per_size"] / 100 / OUT_W


def fit_lines(text: str, look: dict, avail: float, keep_lines: bool) -> tuple[list[str], int]:
    """The lines to draw and the font size. `keep_lines`: exactly the lines given (shrunk to fit if
    needed). Otherwise wrapped to fit `avail` (a fraction of the width)."""
    size = look["size"]
    if keep_lines:
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()] or [text.strip()]
    else:
        lines = []
        for para in text.split("\n"):
            cur = ""
            for word in para.split():
                trial = f"{cur} {word}".strip()
                if cur and line_width(trial, look, size) > avail:
                    lines.append(cur)
                    cur = word
                else:
                    cur = trial
            if cur:
                lines.append(cur)
        lines = lines or [text.strip()]
    widest = max(line_width(ln, look, size) for ln in lines)
    if widest > avail:
        size = max(round(size * 0.5), int(size * avail / widest))
    return lines, size


def block_size(lines: list[str], look: dict, size: int) -> tuple[float, float]:
    """Width and height of a text block, as fractions of the frame."""
    pad = 2 * look["outline"] if look["border"] == 3 else look["outline"]
    w = max(line_width(ln, look, size) for ln in lines) + 2 * pad / OUT_W
    h = (len(lines) * size * 1.2 + 2 * pad) / OUT_H
    return w, h


def default_x(align: str) -> float:
    return {"left": SAFE["left"] + 0.01, "right": SAFE["right"] - 0.01}.get(align, SAFE_CENTER_X)


def available_width(align: str, x: float) -> float:
    if align == "left":
        return SAFE["right"] - x
    if align == "right":
        return x - SAFE["left"]
    return 2 * min(x - SAFE["left"], SAFE["right"] - x)


def clamp_to_safe(align: str, x: float, y: float, w: float, h: float) -> tuple[float, float]:
    lo_x, hi_x = {"left": (SAFE["left"], SAFE["right"] - w), "right": (SAFE["left"] + w, SAFE["right"])}.get(
        align, (SAFE["left"] + w / 2, SAFE["right"] - w / 2))
    x = min(max(x, lo_x), hi_x) if lo_x <= hi_x else default_x(align)
    lo_y, hi_y = SAFE["top"] + h / 2, SAFE["bottom"] - h / 2
    y = min(max(y, lo_y), hi_y) if lo_y <= hi_y else (SAFE["top"] + SAFE["bottom"]) / 2
    return r2(x), r2(y)


def segment_faces(clip: dict, start: float, take: float) -> list[tuple[float, float]]:
    """Vertical ranges (fractions of the finished frame) where faces are in this shot."""
    import cv2
    import numpy as np

    w, h = OUT_W // 3, OUT_H // 3
    vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},format=gray"
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    ranges = []
    for f in (0.2, 0.5, 0.8):
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{start + take * f:.3f}", "-i", str(clip["path"]), "-frames:v", "1",
             "-vf", vf, "-f", "rawvideo", "-"], capture_output=True,
        ).stdout
        if len(raw) != w * h:
            continue
        img = np.frombuffer(raw, np.uint8).reshape(h, w)
        for (_x, y, _fw, fh) in cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=6, minSize=(30, 30)):
            # Include the forehead and chin, not just the detected box.
            ranges.append((max(0.0, (y - 0.2 * fh) / h), min(1.0, (y + 1.3 * fh) / h)))
    ranges.sort()
    merged: list[list[float]] = []
    for y0, y1 in ranges:
        if merged and y0 <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], y1)
        else:
            merged.append([y0, y1])
    return [(r2(a), r2(b)) for a, b in merged]


def free_spot(want: float, h: float, blocked: list[tuple[float, float]]) -> float | None:
    """The nearest center to `want` that keeps a block of height `h` inside the safe zone and off
    everything blocked. None if `want` is already clear (or nothing is)."""
    def clear(c: float) -> bool:
        top, bottom = c - h / 2, c + h / 2
        return (top >= SAFE["top"] and bottom <= SAFE["bottom"]
                and all(bottom + 0.015 <= y0 or top - 0.015 >= y1 for y0, y1 in blocked))

    if clear(want):
        return None
    spots = [c / 100 for c in range(10, 76) if clear(c / 100)]
    return min(spots, key=lambda c: abs(c - want)) if spots else None


def inspo_spot(spots: list, i: int) -> list | None:
    """Where the inspo puts text in shot i, or in the nearest earlier shot that has text."""
    for j in range(min(i, len(spots) - 1), -1, -1):
        if spots[j]:
            return spots[j]
    return next((s for s in spots if s), None)


def place_text(plan: list[dict], texts: list[str], layout: dict, style: dict, inspo_align: str, spots: list,
               position: str, caption_style: str | None, faces: list, keep_lines: bool) -> tuple[list, list]:
    """Where everything goes in each shot. Text: where it was asked for, else where the inspo has it,
    else the default spot moved off faces. Captions: where asked for, else the default spot moved off
    faces and text. Everything stays inside the safe zone. Returns (text layouts, caption ys)."""
    look = text_look(style, layout["textScale"])
    align = style.get("align", "center")
    cap = scaled(CAPTION_LOOKS.get(caption_style or "bold-pop", CAPTION_LOOKS["bold-pop"]), layout["captionScale"])
    cap_default, cap_h = caption_center(cap), caption_height(cap)
    lays, cap_ys = [], []
    for i in range(len(plan)):
        f = faces[i] if i < len(faces) else []
        text = (texts[i] or "").strip()
        lay = None
        if text:
            spot = inspo_spot(spots, i)
            asked_x, asked_y = layout["textXs"][i], layout["textYs"][i]
            x = asked_x if asked_x is not None else (spot[0] if spot and align == inspo_align else default_x(align))
            lines, size = fit_lines(text, look, available_width(align, x), keep_lines)
            w, h = block_size(lines, look, size)
            if asked_y is not None:
                y = asked_y
            elif spot:
                y = spot[1]  # same placement as the inspo
            else:
                y = {"top": TOP_TEXT_Y + h / 2, "middle": 0.45}.get(position, 0.45 if caption_style else cap_default)
                band = [(cap_default - cap_h / 2, cap_default + cap_h / 2)] if caption_style else []
                y = free_spot(y, h, f + band) or y
            x, y = clamp_to_safe(align, x, y, w, h)
            lay = {"x": x, "y": y, "lines": lines, "size": size, "align": align, "h": h}
        lays.append(lay)
        cy = layout["captionYs"][i]
        if caption_style and cy is None:
            blocked = f + ([(lay["y"] - lay["h"] / 2, lay["y"] + lay["h"] / 2)] if lay else [])
            cy = free_spot(cap_default, cap_h, blocked)
        if cy is not None:
            cy = min(max(cy, SAFE["top"] + cap_h / 2), SAFE["bottom"] - cap_h / 2)
        cap_ys.append(cy)
    return lays, cap_ys


def overlay_timeline(plan: list[dict], texts: list[str], lays: list) -> list[tuple[float, float, str, dict]]:
    """Each shot's text over that shot; the same text in the same place on neighboring shots stays
    up as one (no flicker, and its animation plays once)."""
    out: list[tuple[float, float, str, dict]] = []
    t = 0.0
    for p, text, lay in zip(plan, texts, lays):
        end = t + p["duration"]
        text = (text or "").strip()
        # Small differences in where the inspo's text was read in each shot shouldn't make it jump.
        same = out and out[-1][2] == text and abs(out[-1][1] - t) < 0.01 and lay and (
            abs(out[-1][3]["x"] - lay["x"]) < 0.04 and abs(out[-1][3]["y"] - lay["y"]) < 0.04
            and out[-1][3]["lines"] == lay["lines"])
        if text and lay and same:
            out[-1] = (out[-1][0], end, text, out[-1][3])
        elif text and lay:
            out.append((t, end, text, lay))
        t = end
    return out


def text_events(start: float, end: float, lay: dict, look: dict, animation: str) -> list[str]:
    an = {"left": 4, "right": 6}.get(lay["align"], 5)
    px, py = round(lay["x"] * OUT_W), round(lay["y"] * OUT_H)
    size = f"\\fs{lay['size']}" if lay["size"] != look["size"] else ""
    raw = "\n".join(lay["lines"])
    dur = end - start

    def event(a: float, b: float, tags: str, body: str) -> str:
        return f"Dialogue: 1,{ass_time(a)},{ass_time(b)},Text,,0,0,0,,{{\\an{an}\\q2{size}{tags}}}{body}"

    if animation in ("typewriter", "word_by_word"):
        # Reveal letters (or words) one at a time; hidden ones are drawn invisible, so nothing moves.
        if animation == "typewriter":
            cuts = [k for k in range(1, len(raw) + 1) if raw[k - 1] not in " \n"]
            step = min(0.05, 0.6 * dur / max(1, len(cuts)), 0.9 / max(1, len(cuts)))
        else:
            cuts = [k for k in range(1, len(raw) + 1) if (k == len(raw) or raw[k] in " \n") and raw[k - 1] not in " \n"]
            step = min(0.3, 0.6 * dur / max(1, len(cuts)))
        out = []
        for n, k in enumerate(cuts):
            a = start + n * step
            b = end if n == len(cuts) - 1 else start + (n + 1) * step
            out.append(event(a, b, f"\\pos({px},{py})", ass_part(raw[:k]) + "{\\alpha&HFF&}" + ass_part(raw[k:])))
        return out
    tags = f"\\pos({px},{py})"
    if animation == "pop":
        tags += "\\fscx70\\fscy70\\t(0,130,\\fscx100\\fscy100)"
    elif animation == "fade":
        tags += "\\fad(180,120)"
    elif animation == "slide_up":
        tags = f"\\move({px},{py + 50},{px},{py},0,220)\\fad(150,0)"
    return [event(start, end, tags, ass_text(raw))]


def build_ass(timeline: list[tuple[float, float, str, dict]], style: dict, layout: dict,
              words: list[dict], caption_style: str | None, caption_y_at) -> str | None:
    """The subtitle file for on-screen text and captions, or None if there's nothing to draw."""
    events = []
    look = text_look(style, layout["textScale"])
    styles = [text_style_line(look)]
    for start, end, _text, lay in timeline:
        events += text_events(start, end, lay, look, style.get("animation", "none"))

    if caption_style and words:
        cap = scaled(CAPTION_LOOKS.get(caption_style, CAPTION_LOOKS["bold-pop"]), layout["captionScale"])
        styles.append(caption_style_line(cap))
        chunks = caption_chunks(words, cap["words"], cap["chars"])
        cx = round(SAFE_CENTER_X * OUT_W)
        for n, chunk in enumerate(chunks):
            start = chunk[0]["s"]
            end = chunk[-1]["e"] + 0.3
            if n + 1 < len(chunks):
                end = min(end, chunks[n + 1][0]["s"])
            end = max(end, start + 0.25)
            y = caption_y_at(start)
            pos = f"{{\\an5\\pos({cx},{round(y * OUT_H)})}}" if y is not None else ""
            if caption_style == "karaoke":
                for k, w in enumerate(chunk):
                    ws = start if k == 0 else w["s"]
                    we = end if k == len(chunk) - 1 else chunk[k + 1]["s"]
                    line = " ".join(
                        f"{{\\c{HIGHLIGHT}&}}{ass_text(x['w'])}{{\\c{WHITE}&}}" if j == k else ass_text(x["w"])
                        for j, x in enumerate(chunk)
                    )
                    events.append(f"Dialogue: 0,{ass_time(ws)},{ass_time(max(we, ws + 0.05))},Caption,,0,0,0,,{pos}{line}")
            else:
                line = " ".join(ass_text(x["w"]) for x in chunk)
                if caption_style == "bold-pop":
                    line = "{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}" + line
                events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{pos}{line}")

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


def spread_lines(custom: str, shots: list[dict]) -> list[str]:
    """The user's own text, one entry per shot, keeping their lines exactly as typed. Lines go to the
    shots where the inspo has text, in order (split only between lines). If the inspo has no text,
    the lines share the video's running time."""
    lines = [ln.strip() for ln in custom.replace("\r", "").split("\n") if ln.strip()]
    n = len(shots)
    out = [""] * n
    if not lines:
        return out
    # Runs of shots showing the same inspo text count as one place for text.
    places: list[list[int]] = []
    for i, s in enumerate(shots):
        t = (s.get("onScreenText") or "").strip()
        if t and places and (shots[places[-1][-1]].get("onScreenText") or "").strip() == t and places[-1][-1] == i - 1:
            places[-1].append(i)
        elif t:
            places.append([i])
    if not places:
        total = sum(s["durationS"] for s in shots) or 1.0
        k = min(len(lines), n)
        places = [[] for _ in range(k)]
        t = 0.0
        for i, s in enumerate(shots):
            places[min(k - 1, int(k * (t + s["durationS"] / 2) / total))].append(i)
            t += s["durationS"]
        places = [p for p in places if p]
    k = min(len(places), len(lines))
    # Split the lines into k groups in order, as evenly as possible.
    groups, at = [], 0
    for g in range(k):
        size = len(lines) // k + (1 if g < len(lines) % k else 0)
        groups.append("\n".join(lines[at:at + size]))
        at += size
    for g, text in enumerate(groups):
        for i in places[g]:
            out[i] = text
    return out


# ---- one take, pauses cut out ("jump cut" inspos)
#
# Some inspos are one continuous take with every pause and breath cut out. For those
# the user films one long take; we cut it the same way: at every pause, and Claude
# drops retakes, flubs and filler.

JUMPCUT_GAP_S = 0.35  # a pause longer than this is cut out
JUMPCUT_PAD = (0.08, 0.14)  # kept before the first word / after the last word of a phrase
MAX_TAKE_S = 600  # seconds of takes we'll listen to

JUMPCUT_SYSTEM = """You edit talking-to-camera videos for ViralOwner, an app that remakes a proven viral video (the "inspo") with the user's own footage. This inspo is one take with every pause cut out, and the user filmed their own version as one long take (or a few).

You get the inspo (what's said, its structure and length, its on-screen text) and the user's take split into numbered phrases at every pause. Choose which phrases to keep, in their original order, to make a tight video in the inspo's style:
- cut retakes: when they say a line again, keep only the last good version.
- cut flubs, false starts, filler ("um", "uh", "so yeah", "wait let me start over"), mumbling and anything off-topic.
- keep the user's real message complete, and never cut in a way that changes what they mean.
- never reorder phrases.
- if the take has much more material than the inspo, aim for a length near the inspo's, but don't cut real content just to hit it.

Writing: everything is about the user's business or topic. Never invent facts, prices or claims. No emoji or hashtags in on-screen text."""

JUMPCUT_SCHEMA = {
    "type": "object",
    "properties": {
        "keep": {"type": "array", "items": {"type": "integer"}, "description": "the phrase numbers to keep, in order."},
        "texts": {
            "type": "array",
            "description": "one entry per inspo shot, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the inspo shot number, starting at 1."},
                    "text": {"type": "string", "description": "on-screen text for this part of the video. empty string for none."},
                },
                "required": ["index", "text"],
                "additionalProperties": False,
            },
        },
        "caption": {
            "type": "string",
            "description": "the post caption in the user's voice: a hook first line, then one short line. up to 2 emoji. max 40 words.",
        },
        "hashtags": {"type": "array", "items": {"type": "string"}, "description": "5 to 8 hashtags (with #)."},
    },
    "required": ["keep", "texts", "caption", "hashtags"],
    "additionalProperties": False,
}


def take_phrases(clips: list[dict]) -> list[dict]:
    """Everything said in the takes (in clip order), split at every pause."""
    phrases: list[dict] = []
    budget = MAX_TAKE_S
    for ci, c in enumerate(clips):
        if not c["has_audio"] or budget <= 0:
            continue
        words = [w for seg in transcribe(c["path"])["segments"] for w in seg.get("words") or []
                 if w["e"] > w["s"] and w["s"] < budget]
        cur = None
        for w in words:
            if cur and w["s"] - cur["end"] <= JUMPCUT_GAP_S:
                cur["end"] = w["e"]
                cur["words"].append(w["w"])
            else:
                if cur:
                    phrases.append(cur)
                cur = {"clip": ci, "start": w["s"], "end": w["e"], "words": [w["w"]]}
        if cur:
            phrases.append(cur)
        budget -= c["duration"]
    for i, ph in enumerate(phrases):
        ph["id"] = i + 1
        ph["text"] = " ".join(ph["words"]).strip()
    return phrases


def select_phrases(inspo: dict, phrases: list[dict], text_mode: str, notes: str, inspo_lines: list[str]) -> dict:
    b = inspo["breakdown"]
    ins = b.get("insights") or {}
    said = [f"[{x['startS']:.1f}s–{x['endS']:.1f}s] {x['text']}" for x in (b.get("transcript") or {}).get("segments", [])]
    shots = [
        f"inspo shot {i + 1} ({s['startS']:.1f}s, {s['durationS']:.1f}s): on-screen text: "
        + (json.dumps(inspo_lines[i] or s.get("onScreenText"), ensure_ascii=False) if (inspo_lines[i] or s.get("onScreenText")) else "none")
        for i, s in enumerate(b["shots"])
    ]
    take = [f"{ph['id']}. [clip {ph['clip'] + 1}, {ph['start']:.1f}s–{ph['end']:.1f}s] {ph['text']}" for ph in phrases]
    text = "\n".join([
        f"the inspo is {b['durationS']:.1f}s long. hook: {ins.get('hook', '')}. structure: {ins.get('structure', '')}",
        "what's said in the inspo:", *(said or ["(no speech)"]),
        "", "the inspo's shots and on-screen text:", *shots,
        "", f"the user's take ({len(phrases)} phrases):", *take,
        "",
        *([f"the user's additional requests and details: {json.dumps(notes, ensure_ascii=False)}"] if notes else []),
        "choose the phrases to keep.",
        TEXT_RULES["adapt"] if text_mode == "adapt" else "on-screen text: set already. return an empty string for every inspo shot.",
    ])
    return ask_claude(JUMPCUT_SYSTEM, [{"type": "text", "text": text}], JUMPCUT_SCHEMA,
                      "we couldn’t edit that take. try filming it again.")


def phrase_ranges(phrases: list[dict], keep: list[int], clips: list[dict]) -> list[dict]:
    """The kept phrases as cut ranges, joining phrases that run on without a pause."""
    wanted = set(keep)
    ranges: list[dict] = []
    for ph in phrases:
        if ph["id"] not in wanted:
            continue
        a = max(0.0, ph["start"] - JUMPCUT_PAD[0])
        b = min(clips[ph["clip"]]["duration"], ph["end"] + JUMPCUT_PAD[1])
        last = ranges[-1] if ranges else None
        if last and last["clip"] == ph["clip"] and a <= last["end"] + 0.05 and a >= last["start"]:
            last["end"] = max(last["end"], b)
            continue
        if last and last["clip"] == ph["clip"] and last["start"] <= a < last["end"]:
            a = last["end"]
        if b - a >= 0.25:
            ranges.append({"clip": ph["clip"], "start": a, "end": b})
    return ranges


def jumpcut_shots(ranges: list[dict], inspo_shots: list[dict], inspo_duration: float) -> list[dict]:
    """One "shot" per cut range. Each borrows the inspo shot at the same point in the video
    (for its on-screen text and where that text sits)."""
    total = sum(r["end"] - r["start"] for r in ranges) or 1.0
    out, t = [], 0.0
    for j, r in enumerate(ranges):
        d = r["end"] - r["start"]
        at = (t + d / 2) / total * inspo_duration
        k = next((i for i, s in enumerate(inspo_shots) if s["startS"] <= at < s["startS"] + s["durationS"]),
                 len(inspo_shots) - 1)
        src = inspo_shots[k]
        out.append({"index": j, "role": src["role"], "startS": r2(t), "durationS": d,
                    "onScreenText": src.get("onScreenText"), "description": src.get("description"),
                    "tip": src.get("tip", ""), "src": k, "inspoMidS": src["startS"] + src["durationS"] / 2})
        t += d
    return out


# ---- "request a change": Claude edits an existing version

REVISE_SYSTEM = """You make changes to a short-form video a user already made with ViralOwner (an app that remakes a proven viral video, the "inspo", with the user's own footage, keeping the inspo's exact shot timing).

You get the user's request, frames from every shot of the current version exactly as it looks now (with its on-screen text and captions), the plan behind it, where faces are in each shot, and frames from all of the user's clips.

Make the change the user asks for and keep everything else exactly as it is. A request about the text or captions in general ("make the words smaller", "move the text up") applies to every shot that has them, unless the user names specific shots. When moving text, give its new position in every shot it appears in.

You can change: which clip and moment fills a shot; the on-screen text of each shot; where the on-screen text sits in each shot; its size, font, color, look (outline, box or plain), alignment (left, center, right) and how it animates in; where captions sit in each shot; the caption size; the post caption and hashtags.
You can't change: shot timing or the number of shots, transitions, the music or audio, whether captions are on or their style (the user changes those in the options under the video), or add new effects, filters, zooms or stickers. If the request needs something you can't do, do what you can and say what isn't possible in the summary.

Positions are fractions of the frame: x from 0 (left edge) to 1 (right edge), y from 0 (top) to 1 (bottom). text_x is the left edge of left-aligned text, the center of centered text, the right edge of right-aligned text; text_y and caption_y are the vertical center. """ + SAFE_ZONE_RULE + """ Use -1 to leave a position as it is, and "keep" to leave a setting as it is. Never invent facts, prices or claims the footage doesn't support. No emoji in on-screen text."""

REVISE_SCHEMA = {
    "type": "object",
    "properties": {
        "shots": {
            "type": "array",
            "description": "one entry per shot, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the shot number, starting at 1."},
                    "clip": {"type": "integer", "description": "the clip number to use, starting at 1."},
                    "start_s": {"type": "number", "description": "where in that clip the shot starts, in seconds."},
                    "text": {"type": "string", "description": "on-screen text for this shot. empty string for none."},
                    "text_x": {"type": "number", "description": "the on-screen text's x (see above), or -1 to leave it."},
                    "text_y": {"type": "number", "description": "vertical center of the on-screen text, or -1 to leave it."},
                    "caption_y": {"type": "number", "description": "vertical center of the captions, or -1 to leave it."},
                },
                "required": ["index", "clip", "start_s", "text", "text_x", "text_y", "caption_y"],
                "additionalProperties": False,
            },
        },
        "text_scale": {"type": "number", "description": "on-screen text size, where 1 is the standard size."},
        "caption_scale": {"type": "number", "description": "caption size, where 1 is the standard size."},
        "font": {"type": "string", "enum": ["keep", *FONTS]},
        "text_color": {"type": "string", "description": "#RRGGBB, or 'keep'."},
        "text_look": {"type": "string", "enum": ["keep", "outline", "box", "plain"]},
        "text_align": {"type": "string", "enum": ["keep", *TEXT_ALIGNS]},
        "text_animation": {"type": "string", "enum": ["keep", *TEXT_ANIMATIONS]},
        "caption": {"type": "string", "description": "the post caption (keep it unless asked)."},
        "hashtags": {"type": "array", "items": {"type": "string"}},
        "summary": {
            "type": "string",
            "description": (
                "what you changed, for the user, in one or two short lowercase sentences, speaking as 'we', in plain "
                "words with no numbers or positions (e.g. 'we made the text bigger and moved it above her face in the "
                "first two shots.'). mention anything you couldn't do."
            ),
        },
    },
    "required": ["shots", "text_scale", "caption_scale", "font", "text_color", "text_look", "text_align",
                 "text_animation", "caption", "hashtags", "summary"],
    "additionalProperties": False,
}


def style_summary(style: dict) -> str:
    look = "on a solid box" if style.get("box") else (
        f"with a {style.get('outline')} outline" if style.get("outline") != "none" else "plain")
    return (f"font {style.get('font')}, color {style.get('color')}, {look}, {style.get('align')}-aligned, "
            f"animation {style.get('animation')}")


def revise_plan(request: str, notes: str, shots: list[dict], clips: list[dict], current: list[dict],
                texts: list[str], layout: dict, style: dict, post: dict, lays: list, cap_ys: list,
                faces: list, frames: list[Path | None], caption_style: str | None, text_rule: str | None,
                one_take: bool = False) -> dict:
    cap = scaled(CAPTION_LOOKS.get(caption_style or "bold-pop", CAPTION_LOOKS["bold-pop"]), layout["captionScale"])
    cap_default = caption_center(cap)
    content: list[dict] = [{"type": "text", "text": (
        f"the user's request: {json.dumps(request, ensure_ascii=False)}\n"
        + (f"what the user told us about their video: {json.dumps(notes, ensure_ascii=False)}\n" if notes else "")
        + f"\nthe current version ({len(shots)} shots). on-screen text: {style_summary(style)}, size {layout['textScale']:.2f}; "
        + (f"captions on ('{caption_style}'), size {layout['captionScale']:.2f}." if caption_style else "captions off.")
        + f"\npost caption: {json.dumps(post.get('caption', ''), ensure_ascii=False)}\nhashtags: {' '.join(post.get('hashtags', []))}"
    )}]
    for i, s in enumerate(shots):
        c = current[i]
        lay = lays[i]
        face_text = ", ".join(f"{a:.2f}–{b:.2f}" for a, b in faces[i]) if faces[i] else "none found"
        cy = cap_ys[i] if cap_ys[i] is not None else cap_default
        content.append({"type": "text", "text": (
            f"shot {i + 1} ({s['role']}, {s['durationS']:.1f}s): clip {c['clip'] + 1} from {c['start']:.1f}s"
            + f"\n  on-screen text: {json.dumps(texts[i], ensure_ascii=False) if texts[i] else 'none'}"
            + (f", x {lay['x']:.2f}, y {lay['y']:.2f}" if lay else "")
            + (f"\n  captions centered at y {cy:.2f}" if caption_style else "")
            + f"\n  faces (top–bottom): {face_text}"
        )})
        if frames[i]:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(frames[i])}})
    content.append({"type": "text", "text": f"\nthe user's {len(clips)} clips:"})
    for ci, c in enumerate(clips):
        content.append({"type": "text", "text": f"clip {ci + 1} ({c['duration']:.1f}s long)"})
        for t, p in c["frames"]:
            content.append({"type": "text", "text": f"clip {ci + 1} at {t:.1f}s"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
    ask = ["make the requested change and return the whole updated plan."]
    if one_take:
        ask.append("this video is the user's one take with the pauses cut out, so its footage can't be swapped: "
                   "return every shot's clip and start exactly as given.")
    if text_rule:
        ask.append("the user also changed their text settings: " + text_rule)
    content.append({"type": "text", "text": "\n".join(ask)})
    return ask_claude(REVISE_SYSTEM, content, REVISE_SCHEMA, "we couldn’t make that change. try wording it differently.")


def r2_fetch(key: str, dest: Path) -> None:
    r2_client().download_file(os.environ["R2_BUCKET"], key, str(dest))


def r2_store(path: Path, key: str) -> None:
    r2_client().upload_file(str(path), os.environ["R2_BUCKET"], key, ExtraArgs={"ContentType": "video/mp4"})


def layout_from(src: dict | None, n: int) -> dict:
    """Text and caption sizes, and any positions asked for per shot (None = automatic)."""
    src = src or {}

    def per_shot(key: str) -> list:
        vals = [y if isinstance(y, (int, float)) else None for y in (src.get(key) or [])][:n]
        return vals + [None] * (n - len(vals))

    def scale(key: str) -> float:
        v = src.get(key)
        return min(1.6, max(0.5, float(v))) if isinstance(v, (int, float)) else 1.0

    return {"textXs": per_shot("textXs"), "textYs": per_shot("textYs"), "captionYs": per_shot("captionYs"),
            "textScale": scale("textScale"), "captionScale": scale("captionScale")}


def default_inspo_style(n: int) -> dict:
    return {"transitions": ["cut"] * max(0, n - 1), "motions": ["none"] * n, "colorFilter": "none",
            "text": dict(DEFAULT_TEXT_STYLE), "textSpots": [None] * n}


def clean_text_style(src: dict | None) -> dict:
    import re

    out = dict(DEFAULT_TEXT_STYLE)
    for k, v in (src or {}).items():
        if k in ("color", "outlineColor", "boxColor"):
            if isinstance(v, str) and re.match(COLOR_RE, v):
                out[k] = v.upper()
        elif k in ("box", "shadow"):
            out[k] = bool(v)
        elif k in out and v in {"font": FONTS, "outline": ["none", "thin", "thick"], "align": TEXT_ALIGNS,
                                "size": TEXT_SIZES, "animation": TEXT_ANIMATIONS}.get(k, []):
            out[k] = v
    return out


def look_name(style: dict) -> str:
    return "box" if style.get("box") else ("plain" if style.get("outline") == "none" else "outline")


def render_video(req: dict, workdir: Path, fetch=r2_fetch, store=r2_store) -> dict:
    """The whole render. Returns the website's RenderOutput shape (plus the plan and meta)."""
    import re
    from concurrent.futures import ThreadPoolExecutor

    started = time.time()
    breakdown = req["inspo"]["breakdown"]
    shots = breakdown["shots"]
    n = len(shots)
    options = req["options"]
    text_opts = options["text"]
    # "match": the inspo's own words; "adapt": the inspo's style, words about the user; "custom": the user's lines.
    text_choice = text_opts.get("mode") if text_opts.get("mode") in ("match", "adapt", "custom") else "match"
    align_choice = text_opts.get("align") if text_opts.get("align") in TEXT_ALIGNS else None
    notes = (options.get("notes") or "").strip()[:600]
    music = options["music"]["mode"]
    caption_style = options["captions"]["style"] if options["captions"]["enabled"] else None
    request = (req.get("request") or "").strip()[:600]
    previous = req.get("previous") if request else None
    cost = 0.0

    # ---- analyzing: get everything and look at the clips
    report("analyzing", 3)
    inspo_path = workdir / "inspo"
    prev_path = workdir / "previous.mp4"
    clip_ids = [c["id"] for c in req["clips"]]
    downloads = [(req["inspo"]["storageKey"], inspo_path)] + [
        (c["storageKey"], workdir / f"clip{i:02d}") for i, c in enumerate(req["clips"])
    ] + ([(previous["storageKey"], prev_path)] if previous else [])
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

    # The inspo's look. Inspos analyzed before it was part of the analysis get it now.
    new_style = None
    inspo_style = breakdown.get("style")
    if not isinstance(inspo_style, dict):
        try:
            inspo_style, style_cost = analyze_style(inspo_path, shots, workdir, breakdown.get("transcript"))
            cost += style_cost
            new_style = inspo_style
        except Exception as e:  # noqa: BLE001
            print(f"style analysis failed: {type(e).__name__}: {e}")
            inspo_style = default_inspo_style(n)
    base = default_inspo_style(n)
    inspo_style = {**base, **{k: v for k, v in inspo_style.items() if v is not None}}
    spots = (list(inspo_style.get("textSpots") or []) + [None] * n)[:n]
    inspo_lines = [(t or "").strip() for t in (list(inspo_style.get("textLines") or []) + [None] * n)[:n]]
    inspo_text = clean_text_style(inspo_style.get("text"))

    def clean_post(caption: str, hashtags: list[str]) -> dict:
        return {"caption": caption.strip(),
                "hashtags": [h if h.startswith("#") else f"#{h}" for h in (x.strip() for x in hashtags) if h][:8]}

    keep = (previous["plan"] | {"postCopy": previous.get("postCopy")}) if previous else req.get("reuse")
    req_shots = req["shots"]

    # One take, pauses cut out: the cuts come from the user's take, not the inspo's timing.
    jump = inspo_style.get("editType") == "jump_cut"
    jump_ranges: list[dict] = []
    jump_texts: list[str] | None = None
    jump_post = None
    inspo_motions, inspo_transitions = inspo_style["motions"], inspo_style["transitions"]
    if jump:
        earlier = req.get("cuts") or (keep or {}).get("jumpcut") or []
        jump_ranges = [
            {"clip": index_of[r["clipId"]], "start": float(r["startS"]), "end": float(r["endS"])}
            for r in earlier
            if isinstance(r, dict) and r.get("clipId") in index_of and isinstance(r.get("startS"), (int, float))
            and isinstance(r.get("endS"), (int, float)) and r["endS"] > r["startS"]
        ]
        if len(jump_ranges) != len(earlier):
            jump_ranges = []  # a clip was removed since: cut the take again
        if not jump_ranges:
            report("analyzing", 8)
            phrases = take_phrases(clips)
            if phrases:
                report("matching", 25)
                choice = "keep" if keep else text_choice
                result = select_phrases(req["inspo"], phrases, "adapt" if choice == "adapt" else "set", notes, inspo_lines)
                cost += result["cost_usd"]
                data = result["data"]
                keep_ids = [k for k in data["keep"] if isinstance(k, int)] or [ph["id"] for ph in phrases]
                jump_ranges = phrase_ranges(phrases, keep_ids, clips)
                by_shot = {x["index"]: (x.get("text") or "").strip() for x in data["texts"]}
                jump_texts = [by_shot.get(i + 1, "") for i in range(n)]
                jump_post = clean_post(data["caption"], data["hashtags"])
                print(f"jump cut: kept {len(keep_ids)}/{len(phrases)} phrases -> {len(jump_ranges)} cuts, "
                      f"${result['cost_usd']}, usage={result['usage']}")
        if not jump_ranges:
            print("jump cut: no speech in the takes, editing them as separate shots instead")
            jump = False
    if jump:
        pseudo = jumpcut_shots(jump_ranges, shots, breakdown["durationS"])
        src = [p["src"] for p in pseudo]
        spots = [spots[k] for k in src]
        inspo_lines = [inspo_lines[k] for k in src]
        if jump_texts is not None:
            jump_texts = [jump_texts[k] for k in src]
        shots, n = pseudo, len(pseudo)
        inspo_motions = ["zoomed" if inspo_style.get("alternateZoom") and j % 2 else "none" for j in range(n)]
        inspo_transitions = ["cut"] * max(0, n - 1)
        req_shots = [{"shotIndex": j, "clipId": clips[r["clip"]]["id"], "trimStartS": r["start"], "trimEndS": r["end"]}
                     for j, r in enumerate(jump_ranges)]

    # What the user chose in step 2 or the editor, per shot.
    edits = {e["shotIndex"]: e for e in req_shots}
    fixed = []
    for i in range(n):
        e = edits.get(i) or {}
        ci = index_of.get(e.get("clipId"))
        start = e.get("trimStartS") if ci is not None else None
        end = e.get("trimEndS") if ci is not None else None
        end = float(end) if isinstance(end, (int, float)) else None
        # A trim with only an end starts at the beginning of the clip.
        start = float(start) if isinstance(start, (int, float)) else (0.0 if end is not None else None)
        fixed.append({"clip": ci, "start": start, "end": end})

    # Words, text style and layout: kept from an earlier version, or set fresh below.
    if keep and len(keep.get("texts") or []) != n:
        # The number of cuts changed (a jump-cut take was cut again): keep the look, not the per-cut layout.
        keep = {k: v for k, v in keep.items() if k not in ("texts", "textXs", "textYs", "captionYs")}
    layout = layout_from(keep, n)
    style = clean_text_style((keep or {}).get("textStyle") or inspo_text)
    if align_choice:
        style["align"] = align_choice
    position = (keep or {}).get("textPosition") or "top"
    post = (keep or {}).get("postCopy") or {"caption": "", "hashtags": []}
    keep_lines = bool(keep.get("keepLines")) if keep and keep.get("texts") else text_choice == "custom"
    if keep and keep.get("texts"):
        plan_texts = ([(t or "") for t in (keep.get("texts") or [])] + [""] * n)[:n]
        text_mode = "keep"
    elif jump and text_choice == "adapt" and jump_texts is not None:
        plan_texts, text_mode, keep_lines = jump_texts, "set", any(inspo_lines)
    elif text_choice == "custom":
        plan_texts, text_mode = spread_lines(text_opts.get("custom", ""), shots), "custom"
    elif text_choice == "match":
        # Word for word, line for line.
        plan_texts = [inspo_lines[i] or (s.get("onScreenText") or "").strip() for i, s in enumerate(shots)]
        text_mode, keep_lines = "exact", any(inspo_lines)
    else:
        plan_texts, text_mode, keep_lines = [""] * n, "adapt", any(inspo_lines)
    note = None
    if jump_post and not keep:
        post = jump_post

    # In jump-cut mode the take-editing call already wrote the post copy (and any words).
    needs_claude = bool(previous) or (not jump_post and (text_mode != "keep" or any(f["start"] is None for f in fixed)))
    picked: dict[int, dict] = {}
    if needs_claude:
        report("analyzing", 8)
        sample_clip_frames(clips, workdir)

    if previous:
        # "request a change": Claude edits the current version.
        report("analyzing", 14)
        current = resolve_plan(shots, clips, fixed, {})
        with ThreadPoolExecutor(6) as pool:
            faces = list(pool.map(lambda p: segment_faces(clips[p["clip"]], p["start"], p["take"]), current))
        lays, cap_ys = place_text(current, plan_texts, layout, style, inspo_text["align"], spots, position,
                                  caption_style, faces, keep_lines)
        t = 0.0
        frames = []
        for i, p in enumerate(current):
            frames.append(grab_frame(prev_path, t + p["duration"] / 2, workdir / f"prev{i:02d}.jpg", MATCH_FRAME_WIDTH))
            t += p["duration"]
        text_rule = None
        if previous.get("textChanged"):
            if text_choice == "custom":
                text_rule = ("use exactly the user's own text, line by line as typed: "
                             + json.dumps(text_opts.get("custom", ""), ensure_ascii=False))
            elif text_choice == "match":
                text_rule = "use the inspo's own on-screen text, word for word."
            else:
                text_rule = TEXT_RULES["adapt"]
        report("matching", 25)
        result = revise_plan(request, notes, shots, clips, [{"clip": p["clip"], "start": p["start"]} for p in current],
                             plan_texts, layout, style, post, lays, cap_ys, faces, frames, caption_style, text_rule,
                             one_take=jump)
        cost += result["cost_usd"]
        data = result["data"]
        by_index = {s["index"]: s for s in data["shots"]}
        for i in range(n):
            r = by_index.get(i + 1)
            if not r:
                continue
            if not jump and isinstance(r.get("clip"), int) and 0 < r["clip"] <= len(clips):
                ci = r["clip"] - 1
                if ci != current[i]["clip"] or abs(float(r["start_s"]) - current[i]["start"]) > 0.05:
                    fixed[i] = {"clip": ci, "start": max(0.0, float(r["start_s"])), "end": None}
            plan_texts[i] = (r.get("text") or "").strip()
            for key, field in (("text_x", "textXs"), ("text_y", "textYs"), ("caption_y", "captionYs")):
                v = r.get(key)
                if isinstance(v, (int, float)) and 0 <= v <= 1:
                    layout[field][i] = float(v)
        layout["textScale"] = min(1.6, max(0.5, float(data["text_scale"])))
        layout["captionScale"] = min(1.6, max(0.5, float(data["caption_scale"])))
        if data["font"] in FONTS:
            style["font"] = data["font"]
        if isinstance(data["text_color"], str) and re.match(COLOR_RE, data["text_color"]):
            style["color"] = data["text_color"].upper()
        if data["text_look"] == "box":
            style["box"] = True
        elif data["text_look"] == "outline":
            style.update(box=False, outline="thick")
        elif data["text_look"] == "plain":
            style.update(box=False, outline="none", shadow=True)
        if data["text_align"] in TEXT_ALIGNS and data["text_align"] != style["align"]:
            style["align"] = data["text_align"]
            # x positions were for the old alignment; use the new one's unless new ones were given.
            layout["textXs"] = [x if x is not None and (by_index.get(i + 1) or {}).get("text_x", -1) >= 0 else None
                                for i, x in enumerate(layout["textXs"])]
        if data["text_animation"] in TEXT_ANIMATIONS:
            style["animation"] = data["text_animation"]
        post = clean_post(data["caption"], data["hashtags"])
        note = data["summary"].strip()
        print(f"revise: ${result['cost_usd']}, usage={result['usage']}, summary={note!r}")
    elif needs_claude:
        inspo_frames = [
            grab_frame(inspo_path, s.get("inspoMidS", s["startS"] + s["durationS"] / 2), workdir / f"inspo{i:02d}.jpg",
                       MATCH_FRAME_WIDTH)
            for i, s in enumerate(shots)
        ]
        if sum(c["duration"] for c in clips if c["has_audio"]) <= MAX_CLIP_SPEECH_S:
            report("analyzing", 14)
            for c in clips:
                c["speech"] = transcribe(c["path"])["segments"] if c["has_audio"] else []

        report("matching", 25)
        result = match_clips(req["inspo"], inspo_frames, clips, fixed, text_mode if text_mode != "set" else "keep",
                             text_opts.get("custom", ""), bool(req.get("fresh")), notes, shots, inspo_lines)
        cost += result["cost_usd"]
        data = result["data"]
        picked = {s["index"]: s for s in data["shots"]}
        if text_mode == "adapt":
            plan_texts = [(picked.get(i + 1) or {}).get("text", "").strip() for i in range(n)]
        if text_mode != "keep":
            post = clean_post(data["caption"], data["hashtags"])
        print(f"matching: ${result['cost_usd']}, usage={result['usage']}")

    plan = resolve_plan(shots, clips, fixed, picked)
    durations = [p["duration"] for p in plan]
    cuts = transition_plan(durations, inspo_transitions)
    motions = (list(inspo_motions) + ["none"] * n)[:n]
    color = inspo_style["colorFilter"]

    # ---- editing: cut every shot (with the inspo's motion and color), join them with its transitions
    report("editing", 45)
    seg_paths = [workdir / f"shot{i:02d}.mkv" for i in range(len(plan))]
    done = 0

    def cut(i: int) -> None:
        nonlocal done
        p = plan[i]
        tail = cuts[i][1] if i < len(cuts) and cuts[i] else 0.0
        cut_shot(clips[p["clip"]], p["start"], p["take"], p["duration"], seg_paths[i], tail, motions[i], color)
        done += 1
        report("editing", 45 + int(28 * done / len(plan)))

    with ThreadPoolExecutor(3) as pool:
        list(pool.map(cut, range(len(plan))))

    joined = workdir / "joined.mkv"
    join_shots(seg_paths, durations, cuts, workdir, joined)
    total = sum(durations)

    use_inspo_audio = music == "inspo" and probe(inspo_path)["has_audio"]
    words: list[dict] = []
    if caption_style:
        report("editing", 76)
        if use_inspo_audio:
            # What you hear is the inspo's audio, so caption that.
            segments = (breakdown.get("transcript") or {}).get("segments") or []
        else:
            segments = transcribe(joined)["segments"]
        for seg in segments:
            words += [w for w in seg.get("words") or [] if w.get("w") and w["e"] <= total + 0.5]

    report("editing", 80)
    faces: list = [[] for _ in plan]
    if any(t.strip() for t in plan_texts) or words:
        with ThreadPoolExecutor(6) as pool:
            faces = list(pool.map(lambda p: segment_faces(clips[p["clip"]], p["start"], p["take"]), plan))
    shown_captions = caption_style if words else None
    lays, cap_ys = place_text(plan, plan_texts, layout, style, inspo_text["align"], spots, position,
                              shown_captions, faces, keep_lines)
    starts = [sum(durations[:i]) for i in range(len(durations))]

    def caption_y_at(time_s: float):
        i = max(0, sum(1 for s0 in starts if s0 <= time_s + 1e-6) - 1)
        return cap_ys[i]

    report("editing", 85)
    ass = build_ass(overlay_timeline(plan, plan_texts, lays), style, layout, words, shown_captions, caption_y_at)
    out = workdir / "final.mp4"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", joined.name]
    if music == "none":
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0"]
    elif use_inspo_audio:
        # Same timing as the inspo, so its audio lines up from the first frame.
        cmd += ["-i", inspo_path.name, "-map", "0:v:0", "-map", "1:a:0", "-af", "apad"]
    else:
        # "track" has no licensed library behind it yet, so it keeps the clips' audio for now.
        cmd += ["-map", "0:v:0", "-map", "0:a:0"]
    cmd += ["-c:a", "aac", "-b:a", "192k"]
    if ass:
        (workdir / "text.ass").write_text(ass, encoding="utf-8")
        cmd += ["-vf", "ass=text.ass", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-pix_fmt", "yuv420p", "-profile:v", "high"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p"]
    cmd += ["-t", f"{total:.3f}", "-movflags", "+faststart", out.name]
    result = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"final encode failed: {result.stderr[-800:]}")

    # ---- finishing
    report("finishing", 92)
    store(out, req["outputKey"])
    report("finishing", 99)

    seconds = round(time.time() - started, 1)
    print(f"render done: {len(plan)} shots, {total:.1f}s, claude={needs_claude}, ${round(cost, 4)}, {seconds}s, "
          f"faces={sum(map(len, faces))}, transitions={sum(1 for c in cuts if c)}, motions={sum(m != 'none' for m in motions)}, "
          f"color={color}, font={style['font']}, animation={style['animation']}")
    out = {
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
            "textLook": look_name(style),
            "textStyle": style,
            "keepLines": keep_lines,
            # Only positions someone asked for; automatic ones are worked out again for each version.
            "textXs": layout["textXs"],
            "textYs": layout["textYs"],
            "captionYs": layout["captionYs"],
            "textScale": layout["textScale"],
            "captionScale": layout["captionScale"],
            "note": note,
            **({"jumpcut": [{"clipId": clips[p["clip"]]["id"], "startS": r2(p["start"]), "endS": r2(p["start"] + p["take"])}
                            for p in plan]} if jump else {}),
        },
        **({"inspoStyle": new_style} if new_style else {}),
        "meta": {"engine": "modal", "costUsd": round(cost, 4), "claude": needs_claude, "seconds": seconds,
                 "clipsSkipped": len(clip_ids) - len(clips), "oneTake": jump},
    }
    # Plain JSON types only (Whisper's timings are numpy numbers).
    return json.loads(json.dumps(out, default=float))


def check_render_request(req: dict) -> str | None:
    """Every key must be inside the same user's project folder. Returns a problem, or None."""
    import re

    out = req.get("outputKey")
    if not isinstance(out, str) or ".." in out or not re.match(KEY_PREFIX_RE, out):
        return "invalid output key"
    prefix = re.match(KEY_PREFIX_RE, out).group(0)
    keys = [req.get("inspo", {}).get("storageKey")] + [c.get("storageKey") for c in req.get("clips") or []]
    if req.get("request") and req.get("previous"):
        keys.append(req["previous"].get("storageKey"))
        if not isinstance(req["previous"].get("plan"), dict):
            return "invalid previous version"
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
            breakdown = analyze_path(path)
            report("reading the editing style", 97)
            return add_style(path, breakdown)
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
        return add_style(path, analyze_path(path))


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
def try_render(inspo: str, clips: str, dest: str, captions: str = "bold-pop", text: str = "match", custom: str = "",
               notes: str = "", music: str = "original", request: str = ""):
    """modal run worker/app.py::try_render --inspo a.mp4 --clips b.mp4,c.mp4 --dest out.mp4
    With --request, also makes a second version with that change (saved as <dest>-changed.mp4)."""
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
        "options": {"text": {"mode": text, "custom": custom}, "music": {"mode": music, "trackId": None},
                    "captions": {"enabled": captions != "off", "style": captions}, "notes": notes},
    }
    out, video = render_upload.remote(req, files)
    Path(dest).write_bytes(video)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    if request:
        files[req["outputKey"]] = video
        req2 = {**req, "shots": out["plan"]["shots"], "request": request,
                "previous": {"storageKey": req["outputKey"], "plan": out["plan"], "postCopy": out["postCopy"]}}
        out2, video2 = render_upload.remote(req2, files)
        Path(dest.removesuffix(".mp4") + "-changed.mp4").write_bytes(video2)
        print(json.dumps(out2, indent=2, ensure_ascii=False))


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

        families = run(["fc-list", ":", "family"])
        fonts = [f for f, _b, _w in FONTS.values() if f in families]
        has_zscale = " zscale " in run(["ffmpeg", "-hide_banner", "-filters"])
        has_ass = " ass " in run(["ffmpeg", "-hide_banner", "-filters"])
        try:
            import cv2

            faces = hasattr(cv2, "CascadeClassifier")
            cv = f"opencv {cv2.__version__} {getattr(cv2, '__file__', '?')}"
        except Exception as e:  # noqa: BLE001
            faces, cv = False, type(e).__name__
        checks["render"] = {
            "ok": bool(fonts) and has_ass and faces and len(fonts) == len(FONTS),
            "detail": f"{len(fonts)}/{len(FONTS)} fonts, ass={has_ass}, zscale={has_zscale}, faces={faces}, {cv}",
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
