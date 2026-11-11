"""
ViralOwner processing worker (runs on Modal).

The website talks to this over HTTPS with a shared bearer token:
  GET  /health          checks ffmpeg, storage (R2) and Claude are reachable
  POST /jobs/analyze    starts analyzing an inspo video (returns a job id)
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
    .apt_install("ffmpeg")
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
    import anthropic

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

    client = anthropic.Anthropic(max_retries=3, timeout=240)
    response = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if a safety check declines, another model finishes the request
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA}},
    )
    if response.stop_reason == "refusal":
        raise JobError("we couldn’t analyze that video. try a different one.")
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
