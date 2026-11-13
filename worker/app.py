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
import re
import tempfile
import time
from pathlib import Path

import modal

APP_NAME = "viralowner-worker"
CLAUDE_MODEL = "claude-opus-5-5"
# USD per million tokens (Claude Opus 5.5), for the cost log.
PRICES = {"input": 4.00, "output": 20.00, "cache_write": 5.00, "cache_read": 0.20}
WHISPER_MODEL = "large-v3-turbo"  # much more accurate than small, still quick on CPU
CLAP_MODEL = "laion/larger_clap_general"  # recognizes sound effects
MODELS_DIR = "/models"

MIN_SHOT_S = 0.35  # shorter cuts get merged into a neighbor
MAX_SHOTS = 25  # more than this is too much to ask people to film
MAX_FRAMES = 36  # frames sent to Claude per video
FRAME_WIDTH = 512  # px; enough to read on-screen text

SHOT_ROLES = ["hook", "setup", "build", "reveal", "payoff", "b-roll", "cta"]

# Another creator's watermark or handle is never part of the edit, so it's never copied.
WATERMARK_LINE = re.compile(r"^\W*(@[\w.]+|(tik ?tok|instagram|reels|capcut|youtube( shorts)?)(\s*@[\w.]+)?)\W*$", re.I)


def edit_text(text: str | None) -> str:
    """Overlaid text without watermark / @handle lines."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip() and not WATERMARK_LINE.match(ln.strip())]
    return "\n".join(lines).strip()


def _download_whisper() -> None:
    from faster_whisper import WhisperModel

    WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=MODELS_DIR)


def _download_clap() -> None:
    from transformers import ClapModel, ClapProcessor

    ClapModel.from_pretrained(CLAP_MODEL, cache_dir=MODELS_DIR)
    ClapProcessor.from_pretrained(CLAP_MODEL, cache_dir=MODELS_DIR)


# ---- the fire transition's flames, simulated once when the image is built
#
# A small fire simulation (heat rising through a swirling flow, cooled into flame tongues):
# flames climb from the bottom, fill the whole frame by FIRE_COVER[0], hold, and burn off
# the top after FIRE_COVER[1]. The cut sits at FIRE_CUT, while the frame is fully covered.
FIRE_DIR = "/opt/viralowner/fire"
FIRE_SEEDS = (7, 42, 21)  # a few different fires, so back-to-back fire cuts don't repeat
FIRE_W, FIRE_H, FIRE_FPS, FIRE_S = 540, 960, 30, 1.0
FIRE_COVER = (0.36, 0.66)
FIRE_CUT = 0.5


def _fire_noise(rng, h: int, w: int, cell: int):
    import numpy as np

    lat = rng.standard_normal((h // cell + 2, w // cell + 2)).astype(np.float32)
    yy, xx = np.arange(h) / cell, np.arange(w) / cell
    yi, xi = yy.astype(int), xx.astype(int)
    yf, xf = yy - yi, xx - xi
    yf, xf = yf * yf * (3 - 2 * yf), xf * xf * (3 - 2 * xf)
    r = lat[yi] * (1 - yf)[:, None] + lat[yi + 1] * yf[:, None]
    return (r[:, xi] * (1 - xf) + r[:, xi + 1] * xf).astype(np.float32)


def _fire_blur(f, r: int):
    import numpy as np

    for ax in (0, 1):
        c = np.cumsum(np.pad(f, [(r + 1, r) if a == ax else (0, 0) for a in (0, 1)], mode="edge"), axis=ax)
        f = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax)
             - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return f.astype(np.float32)


def make_fire(path: str, seed: int) -> None:
    """Writes the flames as a transparent PNG-in-MOV clip, FIRE_W x FIRE_H, FIRE_S seconds."""
    import numpy as np

    rng = np.random.default_rng(seed)
    s, steps = 2, 6  # simulate at half resolution, 6 steps a frame
    q = 3 / steps
    h, w = FIRE_H // s, FIRE_W // s
    frames_n = int(FIRE_S * FIRE_FPS)
    heat = np.zeros((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    def sample(f, sy, sx):
        sy, sx = np.clip(sy, 0, h - 1.001), np.clip(sx, 0, w - 1.001)
        y0, x0 = sy.astype(int), sx.astype(int)
        fy, fx = sy - y0, sx - x0
        a = f[y0, x0] * (1 - fx) + f[y0, x0 + 1] * fx
        return a * (1 - fy) + (f[y0 + 1, x0] * (1 - fx) + f[y0 + 1, x0 + 1] * fx) * fy

    # Fields that move with the flames (fresh noise every step would only jitter).
    cool_map = 0.05 * _fire_noise(rng, h * 4, w, 22) + 0.03 * _fire_noise(rng, h * 4, w, 9)
    swirl = [_fire_noise(rng, h * 2, w, 40) * 2.4 + _fire_noise(rng, h * 2, w, 14) * 1.2 for _ in range(3)]
    lift = _fire_noise(rng, h * 2, w, 30)
    fuel_map = _fire_noise(rng, h * 2, w, 16)
    edge_map = _fire_noise(rng, h, w, 25)
    streak = _fire_noise(rng, h * 4, w, 16)[np.arange(h * 18) // 5] * 0.7 + _fire_noise(rng, h * 18, w, 40) * 0.5
    out = []
    for k in range(frames_n):
        u = k / frames_n
        for st in range(steps):
            tt = k * steps + st
            ph = tt / (frames_n * steps) * 2
            i0, f = int(ph) % 2, ph - int(ph)
            off = int(tt * 3 * q) % h
            sw = 2.2 * q * (swirl[i0] * (1 - f) + swirl[i0 + 1] * f)[off:off + h]
            vy = -q * (13.0 + 4.0 * lift[off:off + h])
            heat = sample(heat, yy - vy, xx - sw)
            c0 = (h * 3 - int(tt * 13 * q)) % (h * 3)
            burn = 0.0 if u < FIRE_COVER[1] else 0.05 * (u - FIRE_COVER[1]) / (1 - FIRE_COVER[1])
            heat = _fire_blur(np.clip(heat - q * np.clip(0.014 + burn + 1.1 * cool_map[c0:c0 + h], 0, 0.25), 0, None), 1)
            if u < FIRE_COVER[1]:  # fuel below the rising front
                front = 1.08 - 1.25 * min(1.0, u / FIRE_COVER[0]) ** 1.15
                yv = yy / h
                band = (((yv > front + 0.08 * edge_map) & (yv < front + 0.45 + 0.1 * edge_map))
                        | (yv > 0.8 + 0.05 * edge_map))
                f0 = (h - int(tt * 13 * q) % h) % h
                fuel = band * np.clip(0.9 + 0.5 * fuel_map[f0:f0 + h], 0.5, 1.5)
                heat = np.minimum(heat + fuel * 0.3 * q, 1.05)
        so = (h * 17 - int(k * 34)) % (h * 17)
        hv = _fire_blur(np.kron(_fire_blur(heat * (1 + 0.16 * streak[so:so + h]), 2), np.ones((s, s), np.float32)), 2)
        glow = _fire_blur(_fire_blur(hv, 24), 24)  # the light the flames throw around them
        v = np.clip(hv, 0, 1.6)
        r = np.clip(v * 2.6, 0, 1)
        g = np.clip((v - 0.1) * 1.1, 0, 1) ** 1.35
        b = np.clip((v - 0.78) * 2.0, 0, 1) ** 1.2 * 0.95
        a = np.clip(v * 2.6, 0, 1)
        # Never let the cut show through: fully opaque for the few frames around it.
        a = np.maximum(a, np.clip(1 - abs(u - FIRE_CUT) / 0.12, 0, 1))
        ga = np.clip(glow * 0.9, 0, 0.55) * (1 - a)
        tot = np.maximum(a + ga, 1e-4)
        rgba = np.stack([(r * a + ga) / tot, (g * a + 0.55 * ga) / tot, (b * a + 0.15 * ga) / tot, a + ga], -1)
        out.append((rgba.clip(0, 1) * 255).astype(np.uint8).tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{FIRE_W}x{FIRE_H}",
                    "-r", str(FIRE_FPS), "-i", "-", "-c:v", "png", path], input=b"".join(out), check=True)


def _make_fire_assets() -> None:
    os.makedirs(FIRE_DIR, exist_ok=True)
    for seed in FIRE_SEEDS:
        make_fire(f"{FIRE_DIR}/fire-{seed}.mov", seed)


# Sound effects: real recordings (worker/assets/sfx, trimmed and leveled), with the moment each one
# "hits" (its loudest point: a riser's top, a whoosh's middle, a hit's attack), in seconds from its start.
SFX_DIR = "/opt/viralowner/sfx"
SFX_HITS = {"whoosh": 0.55, "swish": 0.06, "pop": 0.03, "click": 0.03, "camera_shutter": 0.08, "flash": 0.07,
            "ding": 0.06, "cash_register": 0.56, "boom": 0.11, "vine_boom": 0.04, "riser": 2.0, "glitch": 0.23,
            "record_scratch": 0.04, "typing": 0.0, "fire": 0.21}


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
    .uv_pip_install("fastapi[standard]", "boto3", "anthropic", "scenedetect", "opencv-python<5", "opencv-python-headless<5", "faster-whisper>=1.1", "pillow")
    .run_function(_download_whisper)  # bake the speech model into the image (no download per job)
    # The sound-effect recognizer (CLAP), CPU-only.
    .uv_pip_install("torch==2.7.1", index_url="https://download.pytorch.org/whl/cpu")
    .uv_pip_install("transformers>=4.46,<5")
    .run_function(_download_clap)
    .run_function(_make_fire_assets)
    .add_local_dir(Path(__file__).parent / "assets" / "sfx", SFX_DIR)
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


def transition_cuts(path: Path, duration: float) -> list[float]:
    """Cuts hidden inside transitions (whips, zooms, blends, glitches), which spread the change over
    several blurry frames and slip past a frame-to-frame detector: the picture 0.4s before and after
    is a different scene. Each is placed at the sharpest change inside it."""
    import cv2
    import numpy as np

    frames = read_frames(path, 0.0, duration + 1)
    if len(frames) < 30:
        return []

    def hist(f):
        hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [16, 12], [0, 180, 0, 256])
        return cv2.normalize(h, h).flatten()

    hs = [hist(f) for f in frames]
    small = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (24, 42)).astype(np.float32) for f in frames]
    gap = 6  # frames each side (0.2s)
    far = np.zeros(len(frames))
    for k in range(gap, len(frames) - gap):
        color = cv2.compareHist(hs[k - gap], hs[k + gap], cv2.HISTCMP_BHATTACHARYYA)
        a, b = small[k - gap].ravel(), small[k + gap].ravel()
        layout = 1 - float(np.corrcoef(a, b)[0, 1]) if a.std() > 1 and b.std() > 1 else 0.0
        far[k] = 0.6 * color + 0.4 * min(1.0, layout)
    cuts, k = [], gap
    while k < len(frames) - gap:
        lo, hi = max(0, k - 12), min(len(frames), k + 13)
        if far[k] > 0.33 and far[k] == far[lo:hi].max():
            # Steady on both sides (not a camera move that keeps changing): compare each side with itself.
            before = cv2.compareHist(hs[max(0, k - 14)], hs[k - gap], cv2.HISTCMP_BHATTACHARYYA)
            after = cv2.compareHist(hs[k + gap], hs[min(len(frames) - 1, k + 14)], cv2.HISTCMP_BHATTACHARYYA)
            if far[k] > 1.6 * max(before, after, 0.05):
                # The middle of the stretch where the two sides differ most is the cut (for a
                # whip or blend that's mid-transition, for a plain cut it's the cut itself).
                top = [j for j in range(lo, hi) if far[j] >= 0.95 * far[k]]
                cuts.append(round(sum(top) / len(top)) / SIG_FPS)
                k += 12
                continue
        k += 1
    return cuts


def detect_shots(path: Path, duration: float) -> list[tuple[float, float]]:
    """Where the cuts are, as (start, end) seconds, tidied up so every shot is filmable."""
    from scenedetect import AdaptiveDetector, detect

    scenes = detect(str(path), AdaptiveDetector(), show_progress=False)
    found = sorted({s.get_seconds() for s, _ in scenes if 0 < s.get_seconds() < duration})
    try:
        extra = transition_cuts(path, duration)
    except Exception as e:  # noqa: BLE001
        print(f"transition cut detection failed: {type(e).__name__}: {e}")
        extra = []
    # A transition's own start can look like a hard cut: the transition detector's time wins nearby.
    extra = [t for t in extra if 0.2 < t < duration - 0.2]
    hard = [c for c in found if all(abs(c - t) > 0.4 for t in extra)]
    cuts = sorted(hard + extra)
    print(f"cuts: {len(found)} hard, {len(extra)} from transitions, {len(cuts)} total")
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
_whisper_lock = __import__("threading").Lock()


def whisper_model():
    """The speech model, loaded once. Two threads loading it at the same moment crash it (seen when a
    clip and an audio file were transcribed side by side), hence the lock."""
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            from faster_whisper import WhisperModel

            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=MODELS_DIR)
    return _whisper


def transcribe(path: Path, hint: str = "") -> dict:
    """What's said, with timings. Empty if there's no audio or no speech. `hint`: words likely to
    come up (the business, products, names), so they're spelled right."""
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
    model = whisper_model()
    segments, info = model.transcribe(audio, vad_filter=True, word_timestamps=True, beam_size=5,
                                      initial_prompt=hint.strip()[:400] or None)
    out = []
    for s in segments:
        text = s.text.strip()
        if text and s.no_speech_prob < 0.7:
            out.append({
                "startS": r2(s.start), "endS": r2(s.end), "text": text,
                # p: how sure Whisper is of the word (a clarity signal when choosing between takes).
                "words": [{"w": w.word.strip(), "s": r2(w.start), "e": r2(w.end), "p": r2(w.probability)}
                          for w in (s.words or [])],
            })
    return {"language": info.language if out else None, "segments": out}


CAPTION_FIX_SCHEMA = {
    "type": "object",
    "properties": {
        "fixes": {
            "type": "array",
            "description": "only words that are clearly misheard. empty if everything is right.",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the word's number."},
                    "word": {"type": "string", "description": "what was actually said, as it should be written (one word, keep its punctuation)."},
                },
                "required": ["index", "word"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["fixes"],
    "additionalProperties": False,
}


def proofread_words(words: list[dict], context: str) -> list[dict]:
    """Fixes words the speech model clearly misheard (a business or product name, a homophone that
    makes no sense), using what the video is about. Timings stay, so captions stay in sync. Best effort."""
    if not words:
        return words
    listing = " ".join(f"[{i}]{w['w']}" for i, w in enumerate(words))
    try:
        result = ask_claude(
            "You proofread automatic speech captions for a short social video. Fix only words that were clearly "
            "misheard: a business, product or person's name spelled wrong, or a word that makes no sense where a "
            "similar-sounding one obviously does. Only make a fix when the description of the video or the rest of "
            "the captions shows what the right word is; never guess a name or product from the sound alone. Never "
            "reword, shorten, censor or change what was said, and never fix grammar. When unsure, leave the word as it is.",
            [{"type": "text", "text": f"what the video is about: {context or '(no description)'}\n\ncaptions, each "
                                     f"word with its number:\n{listing}"}],
            CAPTION_FIX_SCHEMA, "captions", effort="medium")
    except Exception as e:  # noqa: BLE001
        print(f"caption proofread failed: {type(e).__name__}: {e}")
        return words
    out = [dict(w) for w in words]
    for f in result["data"].get("fixes") or []:
        i, word = f.get("index"), (f.get("word") or "").strip()
        if isinstance(i, int) and 0 <= i < len(out) and word and " " not in word:
            print(f"caption fix: {out[i]['w']!r} -> {word!r}")
            out[i]["w"] = word
    return out


CAPTION_FIXES_FIELD = {
    "type": "array",
    "description": ("words the user says the captions got wrong, and what they should say instead (the user's spelling "
                    "and capitals, exactly). keep every earlier fix listed and add the new ones. empty if none."),
    "items": {
        "type": "object",
        "properties": {
            "wrong": {"type": "string", "description": "the word or words as the captions show them now."},
            "right": {"type": "string", "description": "what they should say."},
        },
        "required": ["wrong", "right"],
        "additionalProperties": False,
    },
}


def _word_key(w: str) -> str:
    import re

    return re.sub(r"[^\w']", "", w.lower()).removesuffix("'")


def clean_caption_fixes(*lists) -> list[dict]:
    """The caption fixes in effect: earlier ones first, later ones win for the same words."""
    out: dict[str, dict] = {}
    for fixes in lists:
        for f in fixes or []:
            if not isinstance(f, dict) or not isinstance(f.get("wrong"), str) or not isinstance(f.get("right"), str):
                continue
            wrong, right = " ".join(f["wrong"].split())[:80], " ".join(f["right"].split())[:80]
            key = " ".join(k for k in (_word_key(t) for t in wrong.split()) if k)
            if key and wrong != right:
                out.pop(key, None)
                out[key] = {"wrong": wrong, "right": right}
    return list(out.values())[-40:]


def apply_caption_fixes(words: list[dict], fixes: list[dict]) -> list[dict]:
    """Swaps each wrong word (or run of words) in the captions for what the user says it should be.
    The new words share the old ones' time, so the captions stay in sync."""
    import re

    for f in fixes:
        want = [k for k in (_word_key(t) for t in f["wrong"].split()) if k]
        right = f["right"].split()
        if not want:
            continue
        out, i, hits = [], 0, 0
        while i < len(words):
            span = words[i:i + len(want)]
            if len(span) == len(want) and [_word_key(w["w"]) for w in span] == want:
                s0, e1 = span[0]["s"], span[-1]["e"]
                lead = re.match(r"^[^\w']*", span[0]["w"]).group()
                trail = re.search(r"[^\w']*$", span[-1]["w"]).group()
                step = (e1 - s0) / max(1, len(right))
                for k, t in enumerate(right):
                    text = (lead if k == 0 else "") + t
                    if k == len(right) - 1 and trail and not re.search(r"[^\w']$", t):
                        text += trail
                    # glue: the words of one fix stay together in a caption.
                    out.append({**span[0], "w": text, "s": s0 + k * step, "e": s0 + (k + 1) * step, "glue": k > 0})
                i += len(want)
                hits += 1
            else:
                out.append(words[i])
                i += 1
        if hits:
            print(f"caption fix from the user: {f['wrong']!r} -> {f['right']!r} ({hits}x)")
        words = out
    return words


def transcribe_take(path: Path) -> dict:
    """Like transcribe(), for takes where the same line may be said several times. Whisper, given
    the whole recording, tends to drop a sentence that repeats the one before it, so each stretch
    of speech (found from the audio level, which also catches quiet takes) is transcribed on its own."""
    import numpy as np

    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True,
    ).stdout
    if len(pcm) < 16000:
        return {"language": None, "segments": []}
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    model = whisper_model()

    # Speech = 20ms frames louder than -45 dB; join stretches less than 0.5s apart.
    hop = 320
    frames = audio[: len(audio) // hop * hop].reshape(-1, hop)
    loud = np.sqrt((frames ** 2).mean(axis=1)) > 10 ** (-45 / 20)
    regions: list[list[float]] = []
    for k in np.flatnonzero(loud):
        t = k * hop / 16000
        if regions and t - regions[-1][1] < 0.5:
            regions[-1][1] = t + hop / 16000
        else:
            regions.append([t, t + hop / 16000])
    out, language = [], None
    for a, b in regions:
        if b - a < 0.25:
            continue
        a0, b0 = max(0.0, a - 0.2), min(len(audio) / 16000, b + 0.2)
        chunk = audio[int(a0 * 16000): int(b0 * 16000)]
        segments, info = model.transcribe(chunk, vad_filter=False, word_timestamps=True,
                                             condition_on_previous_text=False)
        for sg in segments:
            text = sg.text.strip()
            if not text or sg.no_speech_prob > 0.7:
                continue
            language = language or info.language
            out.append({
                "startS": r2(a0 + sg.start), "endS": r2(a0 + sg.end), "text": text,
                "words": [{"w": w.word.strip(), "s": r2(a0 + w.start), "e": r2(a0 + w.end), "p": r2(w.probability)}
                          for w in (sg.words or [])],
            })
    return {"language": language, "segments": out}


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
                "text_present": {"type": "boolean", "description": "true if any shot has text overlaid on the video (not burned-in speech captions, watermarks or @handles)."},
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
                    "on_screen_text": {"type": "string", "description": "the exact overlaid text in this shot, as written. leave out watermarks, @handles / usernames, platform logos (tiktok, instagram) and end cards: they aren't part of the edit. empty string if none."},
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


def ask_claude(system: str, content: list[dict], schema: dict, refusal_message: str, effort: str = "high") -> dict:
    """One structured-output request. Returns the parsed JSON plus usage and cost.
    `effort`: how hard Claude thinks. "high" for analysis and planning; "xhigh" where getting
    exactly what the user asked for matters most (their requests and change requests)."""
    import anthropic

    client = anthropic.Anthropic(max_retries=3, timeout=900)
    # Streamed: deep thinking can take minutes, and a large max_tokens needs streaming.
    with client.beta.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if a safety check declines, another model finishes the request
        system=system,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    ) as stream:
        response = stream.get_final_message()
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


END_SCREEN_SCHEMA = {
    "type": "object",
    "properties": {
        "end_screen": {"type": "boolean", "description": "true if the video ends with a platform end screen."},
        "starts_at": {"type": "number", "description": "the time (s) of the first frame of the end screen, from the labels; -1 if none."},
    },
    "required": ["end_screen", "starts_at"],
    "additionalProperties": False,
}


def content_end(path: Path, duration: float, workdir: Path) -> float | None:
    """Where a platform's end screen starts, if the video has one (None if not). Videos saved from
    Instagram or TikTok end with one: Instagram dims the last frame and shows its logo and the
    creator's @handle; TikTok cuts to black with its logo and @handle. It isn't part of the video."""
    span = min(8.0, duration)
    times = [round(duration - span + k * 0.5, 2) for k in range(int(span / 0.5))]
    content: list[dict] = [{"type": "text", "text": f"the last {span:.1f}s of a {duration:.1f}s video, every half second:"}]
    for k, t in enumerate(times):
        p = grab_frame(path, t, workdir / f"end{k:02d}.jpg", 256)
        if p:
            content += [{"type": "text", "text": f"{t:.2f}s"},
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}}]
    content.append({"type": "text", "text": (
        "does this video end with a platform end screen, added by the app it was saved from? Instagram's: the last "
        "frame of the video gets dimmed (darker) and the Instagram logo and the creator's @username appear in the "
        "middle. TikTok's: a black screen with the TikTok logo and the @username, sometimes animated. Other apps "
        "(YouTube Shorts, CapCut, Snapchat) add similar logo cards. Give the time of the first frame that's part of "
        "the end screen (where the dimming or the cut to the logo begins). A logo or @handle watermark sitting in a "
        "corner while the video plays is not an end screen.")})
    try:
        result = ask_claude("You check short videos for app-added end screens.", content, END_SCREEN_SCHEMA,
                            "end screen", effort="medium")
    except Exception as e:  # noqa: BLE001
        print(f"end screen check failed: {type(e).__name__}: {e}")
        return None
    d = result["data"]
    start = float(d.get("starts_at") or -1)
    if not d.get("end_screen") or start <= 0.5 or start >= duration - 0.1:
        return None
    print(f"end screen from {start:.2f}s of {duration:.2f}s (${result['cost_usd']})")
    return start


def drop_end_screen(path: Path, duration: float, workdir: Path) -> float:
    """Trims a platform end screen off the inspo, in place, so nothing after it (shots, speech, style,
    the inspo's own audio) is ever used. Returns the video's length without it."""
    end = content_end(path, duration, workdir)
    if end is None:
        return duration
    trimmed = workdir / "trimmed.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-t", f"{end:.3f}", "-map", "0:v:0", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-c:a", "aac", "-b:a", "192k",
                    str(trimmed)], check=True, capture_output=True)
    trimmed.replace(path)
    return probe(path)["duration"]


def analyze_path(path: Path) -> dict:
    """Everything after the file is on disk. Returns the website's Breakdown shape."""
    started = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        info = probe(path)
        report("finding every cut", 10)
        full = info["duration"]
        duration = drop_end_screen(path, full, workdir)

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
            "onScreenText": edit_text(s.get("on_screen_text")) or None,
            "whyItWorks": s.get("why_it_works") or "",
        })

    meta = {
        "engine": "modal",
        "model": result["model"],
        "usage": result["usage"],
        "costUsd": result["cost_usd"],
        # The app's end screen (Instagram / TikTok), trimmed off before anything else.
        "contentEndS": r2(duration), "endScreenS": r2(full - duration),
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
        import traceback

        print(f"style analysis failed: {type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}")
    return breakdown


# ---------------------------------------------------------------- the inspo's look
#
# How the inspo is edited, so renders can copy it: the transition into each
# shot, camera-style motion, color filter, and the overlaid text's font,
# colors, size, alignment, animation and placement.

# Everything ViralOwner can copy from an inspo (or add when someone asks for it),
# with a plain description Claude uses to recognize it.
TRANSITION_INFO = {
    "cut": "a hard cut, nothing in between",
    "crossfade": "the two shots blend smoothly into each other",
    "dissolve": "a speckled, grainy blend between the shots",
    "flash": "a quick flash of white between the shots",
    "dip_to_black": "fades to black, then up into the next shot",
    "whip_left": "whip pan: both shots streak sideways with heavy motion blur, moving left",
    "whip_right": "whip pan: both shots streak sideways with heavy motion blur, moving right",
    "whip_up": "whip pan: both shots streak vertically with heavy motion blur, moving up",
    "whip_down": "whip pan: both shots streak vertically with heavy motion blur, moving down",
    "slide_left": "the new shot slides in and pushes the old one out, moving left (sharp, no blur)",
    "slide_right": "the new shot slides in and pushes the old one out, moving right",
    "slide_up": "the new shot slides in from the bottom, pushing the old one up",
    "slide_down": "the new shot slides in from the top, pushing the old one down",
    "zoom_in": "zooms hard into the old shot with zoom blur, landing on the new one",
    "zoom_out": "the new shot starts zoomed in and pulls back out, with zoom blur",
    "spin": "the frame spins with motion blur into the next shot",
    "glitch": "digital glitch: colors split into red/blue, the image jitters and breaks up around the cut",
    "shake": "the camera shakes hard right around the cut",
    "light_leak": "a warm burst of light / overexposure washes over the cut",
    "blur": "defocuses into a blur and back into focus on the new shot",
    "wipe_left": "a hard edge wipes across the frame, moving left",
    "wipe_right": "a hard edge wipes across the frame, moving right",
    "wipe_up": "a hard edge wipes up the frame",
    "wipe_down": "a hard edge wipes down the frame",
    "circle_open": "the new shot opens out from a circle in the middle",
    "pixelate": "the picture breaks into big blocks and back",
    "fire": "a wall of real-looking flames rises over the whole screen, hiding the cut, then burns away into the next shot",
}
TRANSITIONS = list(TRANSITION_INFO)
# Names from analyses made before the list grew.
OLD_TRANSITIONS = {"whip": "whip_left", "slide": "slide_left", "zoom": "zoom_in", "wipe": "wipe_left"}

MOTION_INFO = {
    "none": "no edit effect moving the frame (normal handheld or tripod footage)",
    "slow_zoom_in": "the whole frame slowly zooms in over the shot (ken burns)",
    "slow_zoom_out": "the whole frame slowly zooms out over the shot",
    "punch_in": "a quick zoom-in at the start of the shot that then holds",
    "shake": "the whole frame shakes for the whole shot (an edit effect, not handheld wobble)",
    "pan_left": "the frame slowly slides left across the picture (an edit effect)",
    "pan_right": "the frame slowly slides right across the picture (an edit effect)",
}
MOTIONS = list(MOTION_INFO)
SPEED_INFO = {"normal": "normal speed", "slow_motion": "slow motion", "fast": "sped up / fast forward"}
SPEEDS = list(SPEED_INFO)
SPEED_RATES = {"normal": 1.0, "slow_motion": 0.5, "fast": 1.6}
SHOT_EFFECT_INFO = {
    "zoom_pulse": "a quick zoom pulse in and back out as the shot starts (often on a beat)",
    "flash_in": "the shot starts with a bright white flash",
    "rgb_split": "the colors are split into offset red/blue copies for the whole shot",
    "focus_in": "the shot starts blurry and snaps into focus",
    "black_and_white": "this shot alone is black and white",
}
SHOT_EFFECTS = list(SHOT_EFFECT_INFO)
LOOK_INFO = {
    "grain": "film grain over the whole video",
    "vhs": "retro VHS / camcorder look (soft, noisy, color fringes)",
    "vignette": "dark corners around the whole video",
    "letterbox": "black bars at the top and bottom (cinematic)",
    "soft_glow": "a dreamy glow / bloom on bright areas",
}
LOOKS = list(LOOK_INFO)
SFX_INFO = {
    "whoosh": "an airy whoosh (whip pans, slides, zooms)",
    "swish": "a short, fast swish",
    "pop": "a bubbly pop (text or an item popping up)",
    "click": "a click",
    "camera_shutter": "a camera shutter (photo moments, flashes)",
    "ding": "a bright bell ding",
    "cash_register": "a cha-ching cash register",
    "boom": "a deep cinematic boom / bass hit",
    "riser": "a rising build-up that ends on a moment",
    "glitch": "a digital glitch stutter",
    "record_scratch": "a record scratch (a sudden stop)",
    "typing": "keyboard typing",
    "flash": "a camera flash: a bright zap / pop (white flashes, quick cuts)",
    "vine_boom": "the meme bass boom (a funny or dramatic moment)",
    "fire": "a burst of flames whooshing (fire transitions, something catching fire)",
}
SFX = list(SFX_INFO)
EDIT_TYPES = ["shots", "jump_cut"]
COLOR_FILTERS = ["none", "warm", "cool", "vintage", "black_and_white", "high_contrast", "faded", "vivid"]
STYLE_VERSION = 3  # analyses older than this get their style worked out again on their next render


def catalog(info: dict[str, str]) -> str:
    return "\n".join(f"  {k}: {v}" for k, v in info.items())


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

STYLE_SYSTEM = """You study how a viral short-form video (TikTok, Reels, Shorts) is edited, so ViralOwner can rebuild the same edit with someone else's footage. Getting the transitions between shots right matters most.

You get, for every shot: a frame from the middle of the shot, and a filmstrip of the cut into it: 12 frames 1/30s apart, from 0.2s before the cut to 0.2s after it, in two rows of six (left to right, top row first). For shot 1 the strip is its first 0.4s. With each cut you also get measurements taken from every frame around it (how fast the picture changed, brightness, motion blur, which way and how fast the picture moved, zoom and spin, color splitting) and any sound effect heard there. Trust the measurements: a whip pan shows strong motion blur and fast sideways motion; a crossfade changes gradually over many frames; a flash spikes in brightness; a dip to black drops to dark; a zoom transition shows zoom motion with blur; a glitch shows color splitting and jitter; a hard cut changes completely in one frame with nothing else going on.

First decide the edit_type:
- 'jump_cut': the video is really one continuous take (usually one person talking to the camera in the same place) with the pauses, breaths and dead air cut out, so the speech carries straight across the cuts. it may jump between a normal and a zoomed-in framing (alternate_zoom).
- 'shots': separate shots that each need their own footage (different places, angles, subjects or moments), even if someone talks over them.

Then, per shot:
- transition_in: how the video gets into this shot (shot 1 is always 'cut'):
""" + catalog(TRANSITION_INFO) + """
- motion: an edit effect moving the whole frame through the shot:
""" + catalog(MOTION_INFO) + """
- speed: """ + ", ".join(f"{k} ({v})" for k, v in SPEED_INFO.items()) + """.
- effects: short effects inside the shot (usually none):
""" + catalog(SHOT_EFFECT_INFO) + """
- sound_in: the sound effect on the cut into this shot. Only when the measurements say a new sound starts right at the cut (strength around 6 or more; whooshes build up, so they read weaker than hits) and it isn't just the music or someone talking. The sound model is unreliable at naming sounds over music (it often hears whooshes as record scratches or pops), so: when its top guess is a distinctive sound (ding, cash register, camera shutter, glitch, typing, boom, riser, fire) at 0.3 or more, go with it; otherwise choose with what you see: whips, slides and zooms usually have a whoosh or swish, an impact or big reveal a boom, a white flash a flash, a fire transition a fire whoosh, something popping up a pop. A riser is a sound building up into the cut. 'none' when there's no clear new sound.
- sounds_during: clear sound effects inside the shot (from the ones listed for it), like a pop when text appears or a ding. Usually none.
Sound effects:
""" + catalog(SFX_INFO) + """

And for the whole video:
- looks: overall looks applied to everything (usually none):
""" + catalog(LOOK_INFO) + """
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
                    "speed": {"type": "string", "enum": SPEEDS},
                    "effects": {"type": "array", "items": {"type": "string", "enum": SHOT_EFFECTS}},
                    "sound_in": {"type": "string", "enum": ["none", *SFX],
                                 "description": "the sound effect on the cut into this shot ('none' for shot 1)."},
                    "sounds_during": {"type": "array", "items": {"type": "string", "enum": SFX},
                                      "description": "sound effects inside the shot (only ones listed for it)."},
                    "text_x": {"type": "number"},
                    "text_y": {"type": "number"},
                    "text_lines": {
                        "type": "string",
                        "description": "the overlaid text exactly as shown, with \\n where its lines break. empty if none.",
                    },
                },
                "required": ["index", "transition_in", "motion", "speed", "effects", "sound_in", "sounds_during",
                             "text_x", "text_y", "text_lines"],
                "additionalProperties": False,
            },
        },
        "edit_type": {"type": "string", "enum": EDIT_TYPES},
        "alternate_zoom": {
            "type": "boolean",
            "description": "jump_cut only: the framing jumps between normal and zoomed in at the cuts.",
        },
        "color_filter": {"type": "string", "enum": COLOR_FILTERS},
        "looks": {"type": "array", "items": {"type": "string", "enum": LOOKS}},
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
    "required": ["shots", "edit_type", "alternate_zoom", "color_filter", "looks", "text"],
    "additionalProperties": False,
}


def cut_strip(path: Path, t: float, dest: Path) -> Path | None:
    """12 frames 1/30s apart from `t` (0.4s), as a 6x2 grid."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, t):.3f}", "-t", "0.4", "-i", str(path),
         "-vf", "fps=30,scale=168:-2,tile=6x2", "-frames:v", "1", "-q:v", "4", str(dest)],
        capture_output=True,
    )
    return dest if dest.exists() and dest.stat().st_size > 0 else None


# ---- measuring each cut (so a 0.2s whip or flash isn't missed between still frames)

SIG_W, SIG_H, SIG_FPS = 240, 426, 30


def read_frames(path: Path, start: float, dur: float):
    """RGB frames at 30fps, 240x426 (squashed if the video isn't 9:16, which is fine for measuring)."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-t", f"{dur:.3f}", "-i", str(path),
         "-vf", f"fps={SIG_FPS},scale={SIG_W}:{SIG_H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
    ).stdout
    n = len(raw) // (SIG_W * SIG_H * 3)
    return np.frombuffer(raw[: n * SIG_W * SIG_H * 3], np.uint8).reshape(n, SIG_H, SIG_W, 3)


def cut_signals(path: Path, t: float) -> dict | None:
    """Frame-by-frame measurements around a cut at `t`."""
    import cv2
    import numpy as np

    frames = read_frames(path, t - 0.4, 0.8)
    if len(frames) < 8:
        return None
    gray = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in frames]
    diff = np.array([np.mean(cv2.absdiff(gray[k + 1], gray[k])) for k in range(len(gray) - 1)])
    luma = np.array([g.mean() for g in gray])
    sharp = np.array([cv2.Laplacian(g, cv2.CV_64F).var() for g in gray])
    peak = int(np.argmax(diff))
    spread = int(np.sum(diff[max(0, peak - 6): peak + 7] > 0.4 * diff[peak]))
    near = range(max(0, peak - 4), min(len(gray), peak + 6))

    ys, xs = np.mgrid[0:SIG_H, 0:SIG_W].astype(np.float32)
    xs -= SIG_W / 2
    ys -= SIG_H / 2
    rad = np.sqrt(xs ** 2 + ys ** 2) + 1e-3
    moves = []
    for k in range(max(0, peak - 4), min(len(gray) - 1, peak + 5)):
        if spread <= 2 and diff[k] > 0.5 * diff[peak]:
            continue  # the cut itself: no motion to measure across it
        flow = cv2.calcOpticalFlowFarneback(gray[k], gray[k + 1], None, 0.5, 3, 21, 3, 5, 1.2, 0)
        fx, fy = flow[..., 0], flow[..., 1]
        moves.append((
            float(fx.mean()) / SIG_W * 100, float(fy.mean()) / SIG_W * 100,  # % of the width per frame
            float(np.mean((fx * xs + fy * ys) / rad)) / SIG_W * 100,  # outward = zooming in
            float(np.mean((-fx * ys + fy * xs) / rad)) / SIG_W * 100,  # spin
        ))
    dx, dy, zoom, spin = (float(np.median([m[j] for m in moves])) if moves else 0.0 for j in range(4))
    # Back-and-forth motion (a shake): the direction keeps flipping.
    flips = sum(1 for j in (0, 1) for a, b in zip(moves, moves[1:]) if a[j] * b[j] < 0 and min(abs(a[j]), abs(b[j])) > 0.6)
    warmth = [float(f[..., 0].mean() - f[..., 2].mean()) for f in frames]

    def split(f) -> float:
        r = f[..., 0].astype(np.float32)
        b = f[..., 2].astype(np.float32)
        (sx, sy), _ = cv2.phaseCorrelate(r, b)
        return float(np.hypot(sx, sy))

    splits = [split(frames[k]) for k in near]
    outside = [sharp[k] for k in range(len(sharp)) if abs(k - peak) > 5] or list(sharp)
    return {
        "change_frames": spread,
        "bright": float(max(luma[k] for k in near) - np.median(luma)),
        "max_luma": float(max(luma[k] for k in near)),
        "dark": float(np.median(luma) - min(luma[k] for k in near)),
        "min_luma": float(min(luma[k] for k in near)),
        "blur": float(min(sharp[k] for k in near) / (np.median(outside) + 1e-6)),
        "dx": dx, "dy": dy, "zoom": zoom, "spin": spin,
        "split": float(max(splits)) if splits else 0.0,
        "flips": flips,
        "warm": float(max(warmth[k] for k in near) - np.median(warmth)),
    }


def describe_signals(sig: dict | None) -> str:
    """The measurements in words, for Claude."""
    if not sig:
        return "no measurements"
    parts = [("changes all at once (1 frame)" if sig["change_frames"] <= 1
              else f"changes over {sig['change_frames']} frames ({sig['change_frames'] / SIG_FPS:.2f}s)")]
    if sig["bright"] > 35 and sig["max_luma"] > 170:
        parts.append("flashes bright/white")
    if sig["dark"] > 35 and sig["min_luma"] < 35:
        parts.append("dips to black")
    parts.append("strong motion blur" if sig["blur"] < 0.3 else "some blur" if sig["blur"] < 0.6 else "stays sharp")
    speed = (sig["dx"] ** 2 + sig["dy"] ** 2) ** 0.5
    if speed > 1.5:
        way = ("left" if sig["dx"] < 0 else "right") if abs(sig["dx"]) >= abs(sig["dy"]) else ("up" if sig["dy"] < 0 else "down")
        parts.append(f"{'fast ' if speed > 4 else ''}motion {way} ({speed:.0f}% of the width per frame)")
    else:
        parts.append("no sideways motion")
    if abs(sig["zoom"]) > 0.8:
        parts.append("zooming in" if sig["zoom"] > 0 else "zooming out")
    if abs(sig["spin"]) > 0.8:
        parts.append("spinning")
    if sig["split"] > 1.5:
        parts.append("color channels split apart")
    if sig.get("flips", 0) >= 3:
        parts.append("shaky back-and-forth motion")
    if sig.get("warm", 0) > 12:
        parts.append("a warm orange wash of light")
    return "; ".join(parts)


# ---- hearing sound effects (CLAP: an open model that matches sounds to descriptions)

SFX_PROMPTS = {
    "whoosh": "a whoosh sound effect, air rushing past",
    "swish": "a quick swish sound effect",
    "pop": "a pop sound effect",
    "click": "a click sound",
    "camera_shutter": "a camera shutter clicking",
    "ding": "a bell ding",
    "cash_register": "a cash register cha-ching",
    "boom": "a cinematic boom, a deep bass impact hit",
    "riser": "a rising riser sound effect building up",
    "glitch": "a digital glitch sound effect",
    "record_scratch": "a record scratch",
    "typing": "keyboard typing",
    "flash": "a camera flash sound effect",
    "vine_boom": "a loud meme bass boom",
    "fire": "a fire whoosh, flames bursting",
}
OTHER_SOUNDS = ["people talking", "a person speaking", "music playing", "a song with vocals", "silence",
                "background noise", "laughing", "footsteps"]
_clap = None


def clap_probs(windows: list) -> "list[list[float]]":
    """For each audio window (48 kHz mono), the probability of each SFX_PROMPTS / OTHER_SOUNDS label."""
    global _clap
    import torch

    if _clap is None:
        from transformers import ClapModel, ClapProcessor

        model = ClapModel.from_pretrained(CLAP_MODEL, cache_dir=MODELS_DIR).eval()
        proc = ClapProcessor.from_pretrained(CLAP_MODEL, cache_dir=MODELS_DIR)
        with torch.no_grad():
            t = proc(text=list(SFX_PROMPTS.values()) + OTHER_SOUNDS, return_tensors="pt", padding=True)
            temb = model.get_text_features(**t)
        _clap = (model, proc, temb / temb.norm(dim=-1, keepdim=True))
    model, proc, temb = _clap
    out = []
    with torch.no_grad():
        for k in range(0, len(windows), 16):
            batch = windows[k:k + 16]
            try:
                a = proc(audio=batch, sampling_rate=48000, return_tensors="pt")
            except TypeError:
                a = proc(audios=batch, sampling_rate=48000, return_tensors="pt")
            aemb = model.get_audio_features(**a)
            aemb = aemb / aemb.norm(dim=-1, keepdim=True)
            logits = aemb @ temb.T * model.logit_scale_a.exp()
            out += torch.softmax(logits, dim=-1).tolist()
    return out


def load_audio(path: Path, sr: int = 48000):
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def onsets(audio, sr: int = 48000, limit: int = 30) -> list[tuple[float, float]]:
    """Sudden new sounds (spectral flux peaks) as (time, strength), strongest first."""
    import numpy as np

    hop, nfft = sr // 100, 2048
    if len(audio) < nfft * 2:
        return []
    frames = np.lib.stride_tricks.sliding_window_view(audio, nfft)[::hop] * np.hanning(nfft)
    mag = np.log1p(np.abs(np.fft.rfft(frames, axis=1)) * 10)
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
    med = np.median(flux)
    mad = np.median(np.abs(flux - med)) + 1e-6
    peaks = []
    for i in range(1, len(flux) - 1):
        lo, hi = max(0, i - 15), min(len(flux), i + 16)
        if flux[i] == flux[lo:hi].max() and flux[i] > med + 6 * mad:
            peaks.append(((i + 1) * hop / sr + nfft / 2 / sr, float((flux[i] - med) / mad)))
    return sorted(peaks, key=lambda p: -p[1])[:limit]


def listen(path: Path, cuts: list[float], shots: list[dict]) -> dict:
    """What the sound model hears at each cut, and strong sounds inside shots, as hints for the style
    analysis. The model is good at noticing a new sound but unreliable at naming it over music, so
    Claude makes the final call with what it sees (a whip usually comes with a whoosh, a flash with
    a shutter...)."""
    sr = 48000
    audio = load_audio(path, sr)
    out: dict = {"cuts": [None] * len(cuts), "during": []}
    if len(audio) < sr // 2:
        return out
    total = len(audio) / sr
    clip = lambda a, b: audio[int(max(0.0, a) * sr): int(min(total, max(a + 0.1, b)) * sr)]  # noqa: E731
    hits = onsets(audio, sr, limit=40)
    names = list(SFX_PROMPTS)
    others = [(t, st) for t, st in hits if all(abs(t - c) > 0.35 for c in cuts)][:12]
    windows = [clip(c - 0.3, c + 0.5) for c in cuts] + [clip(t - 0.15, t + 0.65) for t, _ in others]
    windows += [clip(c - 1.3, c + 0.05) for c in cuts]  # risers lead into the cut
    probs = clap_probs(windows) if windows else []
    top = lambda p: sorted(((names[i], p[i]) for i in range(len(names))), key=lambda x: -x[1])[:3]  # noqa: E731
    for i, c in enumerate(cuts):
        near = [(t, st) for t, st in hits if -0.35 <= t - c <= 0.3]
        hit = max(near, key=lambda x: x[1]) if near else None
        riser = probs[len(cuts) + len(others) + i][names.index("riser")]
        out["cuts"][i] = {"strength": round(hit[1], 1) if hit else 0.0, "offset": round(hit[0] - c, 2) if hit else 0.0,
                          "heard": top(probs[i]), "riser": round(riser, 2)}
    starts = [s["startS"] for s in shots]
    for j, (t, st) in enumerate(others):
        guesses = top(probs[len(cuts) + j])
        if guesses[0][1] >= 0.5:
            i = max(0, sum(1 for s0 in starts if s0 <= t) - 1)
            out["during"].append({"shot": i, "t": t, "frac": r2(min(0.99, (t - starts[i]) / max(0.1, shots[i]["durationS"]))),
                                  "strength": round(st, 1), "heard": guesses})
    return out


def describe_heard(h: dict | None) -> str:
    if not h:
        return "nothing measured"
    guesses = ", ".join(f"{n.replace('_', ' ')} {p:.2f}" for n, p in h["heard"])
    hit = (f"a new sound starts {abs(h['offset']):.2f}s {'before' if h['offset'] < 0 else 'after'} the cut "
           f"(strength {h['strength']:.0f})" if h["strength"] else "no new sound starts there")
    riser = f"; something builds up into the cut (riser {h['riser']:.2f})" if h["riser"] >= 0.4 else ""
    return f"{hit}; the sound model's guesses: {guesses}{riser}"


def sfx_from_answers(data: dict, n: int, heard: dict) -> list[dict]:
    """The style analysis' sound choices as sound effects anchored to cuts and shots."""
    by = {s["index"]: s for s in data.get("shots", [])}
    out = []
    for i in range(1, n):
        name = (by.get(i + 1) or {}).get("sound_in")
        if name in SFX:
            h = heard["cuts"][i - 1] if i - 1 < len(heard["cuts"]) else None
            offset = -1.2 if name == "riser" else max(-0.3, min(0.2, (h or {}).get("offset") or -0.05))
            out.append({"anchor": "cut", "index": i - 1, "offset": r2(offset), "name": name, "volume": 0.85, "source": "inspo"})
    for i in range(n):
        spots = [d for d in heard["during"] if d["shot"] == i]
        for k, name in enumerate(x for x in (by.get(i + 1) or {}).get("sounds_during") or [] if x in SFX):
            frac = spots[k]["frac"] if k < len(spots) else 0.5
            out.append({"anchor": "shot", "index": i, "frac": frac, "name": name, "volume": 0.85, "source": "inspo"})
    return out


def clean_style(data: dict, n: int, heard: dict | None = None) -> dict:
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
    shot = lambda i: by_index.get(i + 1) or {}  # noqa: E731
    return {
        "version": STYLE_VERSION,
        "transitions": [pick(shot(i + 1).get("transition_in"), TRANSITIONS, "cut") for i in range(n - 1)],
        "motions": [pick(shot(i).get("motion"), MOTIONS, "none") for i in range(n)],
        "speeds": [pick(shot(i).get("speed"), SPEEDS, "normal") for i in range(n)],
        "shotEffects": [[e for e in dict.fromkeys(shot(i).get("effects") or []) if e in SHOT_EFFECTS] for i in range(n)],
        "looks": [x for x in dict.fromkeys(data.get("looks") or []) if x in LOOKS],
        "sfx": sfx_from_answers(data, n, heard or {"cuts": [], "during": []}),
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
    """The inspo's edit (see STYLE_SYSTEM). `shots` are breakdown shots. Returns (style, cost)."""
    from concurrent.futures import ThreadPoolExecutor

    cuts = [s["startS"] for s in shots[1:]]
    with ThreadPoolExecutor(4) as pool:
        signals = list(pool.map(lambda t: _safe(cut_signals, path, t), cuts))
    heard = _safe(listen, path, cuts, shots) or {"cuts": [None] * len(cuts), "during": []}

    said = [f"[{x['startS']:.1f}s–{x['endS']:.1f}s] {x['text']}" for x in (transcript or {}).get("segments", [])]
    content: list[dict] = [{"type": "text", "text": (
        f"the video has {len(shots)} shots.\nwhat's said:\n" + ("\n".join(said) if said else "(no speech)")
    )}]
    for i, s in enumerate(shots):
        a, d = s["startS"], s["durationS"]
        text = s.get("onScreenText")
        lines = [f"shot {i + 1}: {a:.1f}s–{a + d:.1f}s. overlaid text: {json.dumps(text, ensure_ascii=False) if text else 'none'}"]
        if i:
            lines.append(f"  the cut into it, measured: {describe_signals(signals[i - 1])}")
            lines.append(f"  sound at the cut: {describe_heard(heard['cuts'][i - 1])}")
        for snd in heard["during"]:
            if snd["shot"] == i:
                lines.append(f"  a sound {snd['frac']:.0%} of the way into the shot (strength {snd['strength']:.0f}); "
                             f"guesses: {', '.join(f'{n} {p:.2f}' for n, p in snd['heard'])}")
        content.append({"type": "text", "text": "\n".join(lines)})
        mid = grab_frame(path, a + d / 2, workdir / f"style_mid{i:02d}.jpg", FRAME_WIDTH)
        strip = cut_strip(path, a - 0.2 if i else 0.0, workdir / f"style_cut{i:02d}.jpg")
        for p in (mid, strip):
            if p:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
    content.append({"type": "text", "text": f"describe all {len(shots)} shots and the text style."})
    result = ask_claude(STYLE_SYSTEM, content, STYLE_SCHEMA, "we couldn’t read that video’s style.")
    print(f"style: ${result['cost_usd']}, usage={result['usage']}")
    style = clean_style(result["data"], len(shots), heard)
    print(f"style: transitions={style['transitions']} motions={style['motions']} speeds={style['speeds']} "
          f"effects={style['shotEffects']} looks={style['looks']} sfx={[(e['name'], e['anchor'], e['index']) for e in style['sfx']]}")
    return style, result["cost_usd"]


def _safe(fn, *args):
    """Runs a measuring step; a failure just means less to go on, never a failed analysis."""
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        print(f"{fn.__name__} failed: {type(e).__name__}: {e}")
        return None


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
MAX_SLOWDOWN = 2.0  # a clip shorter than its shot is slowed down up to this much
MAX_STRETCH = 4.0  # ...and further, up to this, before it plays forward-then-backward. never a held frame
FONT = "Montserrat"
FONT_DIR = "/usr/share/fonts/opentype/montserrat"
KEY_PREFIX_RE = r"^u/[A-Za-z0-9_-]+/p/[A-Za-z0-9_-]+/"

MATCH_SYSTEM = """You edit short-form videos for ViralOwner, an app that helps creators and small business owners remake a proven viral video (the "inspo") with their own footage. The finished video keeps the inspo's exact shot timing; your job is choosing what fills each shot and writing the words.

You get the inspo's shot list with one frame from each shot, then frames sampled from each of the user's clips (with timestamps) and what's said in them.

Picking footage: for every shot, choose the clip and the start time whose footage best does that shot's job (hook, reveal, payoff...) and best matches its look (framing, action, energy). The shot plays from that start time for the shot's length, so pick a start where the action is about to happen. Prefer moments that are in focus with the subject in frame; avoid the first and last half second of a clip, where people fumble with the phone. Never show the same footage twice: give each shot its own clip whenever there are enough clips; when a clip has to fill more than one shot, use clearly different portions of it, at least 1 second apart. Skip clips that don't belong in the video (screen recordings, accidental footage, blurry or black clips): a good clip at a different moment is better than a bad clip. When the user already chose a clip or a moment for a shot, keep it exactly as given.

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
        "format=duration:stream=codec_type,width,height,color_transfer,avg_frame_rate", "-of", "json", str(path),
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
        "fps": frame_rate(video.get("avg_frame_rate")),
    }


def frame_rate(value) -> float:
    """"30000/1001" -> 29.97. Phones often record at a variable rate (an average like 27.3)."""
    try:
        num, _, den = str(value).partition("/")
        fps = float(num) / float(den or 1)
        return fps if 1 <= fps <= 480 else 30.0
    except (ValueError, ZeroDivisionError):
        return 30.0


def to_output_rate(fps: float, stretch: float = 1.0) -> str:
    """The filter putting a shot at OUT_FPS. With at least that many real frames a second (after any
    slow-down), frames are just picked. With fewer (a phone's variable frame rate, around 27; slow
    motion), simply repeating frames makes the picture stutter like it's catching, so the missing
    frames are made by blending their neighbors instead."""
    if fps / max(stretch, 1e-3) >= OUT_FPS - 0.5:
        return f"fps={OUT_FPS}"
    return f"framerate=fps={OUT_FPS}"


def grab_frame(path: Path, t: float, dest: Path, width: int) -> Path | None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "4", str(dest)],
        capture_output=True,
    )
    return dest if dest.exists() and dest.stat().st_size > 0 else None


def sample_clip_frames(clips: list[dict], workdir: Path, limit: int = MAX_CLIP_FRAMES) -> None:
    """Adds clip["frames"] = [(seconds, jpeg), ...], spread evenly, about `limit` in total."""
    from concurrent.futures import ThreadPoolExecutor

    total = sum(c["duration"] for c in clips)
    interval = max(1.0, total / limit)
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


def unused_start(used: list[tuple[float, float]], clip_len: float, length: float, want: float) -> float | None:
    """Where `length` seconds of a clip can start without overlapping any `used` span, as close to
    `want` as possible (None if there's no room). Nobody wants to see the same footage twice."""
    gaps, t = [], 0.0
    for a, b in sorted(used):
        a, b = a - SAME_CLIP_GAP_S, b + SAME_CLIP_GAP_S  # keep clear of what's used
        if a - t >= length:
            gaps.append((t, a))
        t = max(t, b)
    if clip_len - t >= length:
        gaps.append((t, clip_len))
    best = None
    for a, b in gaps:
        start = min(max(want, a), b - length)
        if best is None or abs(start - want) < abs(best - want):
            best = start
    return best


SAME_CLIP_GAP_S = 1.0  # two shots from one clip are at least this far apart in it: clearly different portions


def overlaps(span: tuple[float, float], used: list[tuple[float, float]], gap: float = SAME_CLIP_GAP_S) -> bool:
    """`span` is the same section as (or too close to) one already `used`."""
    return any(span[0] < b + gap and span[1] > a - gap for a, b in used)


MIN_SHOT_S, MAX_SHOT_S = 0.3, 30.0


def with_lengths(shots: list[dict], lengths: list[float]) -> list[dict]:
    """The shots with new lengths, each starting where the one before ends."""
    out, t = [], 0.0
    for s, length in zip(shots, lengths):
        # inspoMidS: where the matching moment is in the inspo, which doesn't move.
        out.append({**s, "startS": r2(t), "durationS": r2(length),
                    "inspoMidS": s.get("inspoMidS", s["startS"] + s["durationS"] / 2)})
        t += length
    return out


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
    return avoid_reused_footage(plan, clips, [f["clip"] is not None and f["start"] is not None for f in fixed])


def avoid_reused_footage(plan: list[dict], clips: list[dict], pinned: list[bool]) -> list[dict]:
    """Moves shots that would show footage another shot already shows to an unused part of their
    clip, or to another clip with room. The user's own exact choices are never moved. Only when
    there's no unused footage left anywhere does a shot repeat some."""
    used: dict[int, list[tuple[float, float]]] = {i: [] for i in range(len(clips))}
    for p, pin in zip(plan, pinned):
        if pin:
            used[p["clip"]].append((p["start"], p["start"] + p["take"]))
    for p, pin in zip(plan, pinned):
        if pin:
            continue
        if used[p["clip"]]:
            # This clip already fills a shot: give this one a clip nobody uses yet, if there is one.
            fresh = [ci for ci in range(len(clips)) if not used[ci] and clips[ci]["duration"] >= min(p["take"], 1.0)]
            if fresh:
                ci = max(fresh, key=lambda c: clips[c]["duration"])
                p["clip"], p["start"] = ci, min(0.3, max(0.0, clips[ci]["duration"] - p["take"]))
        span = (p["start"], p["start"] + p["take"])
        if overlaps(span, used[p["clip"]]):
            start = unused_start(used[p["clip"]], clips[p["clip"]]["duration"], p["take"], p["start"])
            if start is not None:
                p["start"] = start
            else:
                # Another clip with room, the least used first.
                for ci in sorted(range(len(clips)), key=lambda c: sum(b - a for a, b in used[c])):
                    start = unused_start(used[ci], clips[ci]["duration"], p["take"], 0.3)
                    if start is not None:
                        p["clip"], p["start"] = ci, start
                        break
            span = (p["start"], p["start"] + p["take"])
        used[p["clip"]].append(span)
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


def even(x: float) -> int:
    return int(round(x / 2)) * 2


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
    if motion in ("pan_left", "pan_right"):
        w, h = even(OUT_W * 1.15), even(OUT_H * 1.15)
        x = f"(iw-ow)*n/{n}" if motion == "pan_left" else f"(iw-ow)*(1-n/{n})"
        return f"scale={w}:{h},crop={OUT_W}:{OUT_H}:x='{x}':y='(ih-oh)/2'"
    return None


# ---- transitions
#
# name -> (ffmpeg xfade transition, or None for a hard cut; seconds; effect drawn on the shots, or None).
# Effects are drawn onto the end of the outgoing shot and the start of the incoming one
# (fx_filter), building toward the cut, so the cut itself stays exactly on time.
TRANSITION_SPECS = {
    "crossfade": ("fade", 0.35, None), "dissolve": ("dissolve", 0.4, None), "flash": ("fadewhite", 0.22, None),
    "dip_to_black": ("fadeblack", 0.4, None),
    **{f"whip_{d}": (None, 0.34, f"whip_{d}") for d in ("left", "right", "up", "down")},
    **{f"slide_{d}": (f"slide{d}", 0.3, None) for d in ("left", "right", "up", "down")},
    "zoom_in": (None, 0.3, "zoom_in"), "zoom_out": (None, 0.3, "zoom_out"), "spin": (None, 0.34, "spin"),
    "glitch": (None, 0.26, "glitch"), "shake": (None, 0.32, "shake"),
    "light_leak": ("fade", 0.45, "light_leak"), "blur": ("fade", 0.35, "blur"),
    **{f"wipe_{d}": (f"wipe{d}", 0.3, None) for d in ("left", "right", "up", "down")},
    "circle_open": ("circleopen", 0.4, None), "pixelate": ("pixelize", 0.3, None),
    # The flames themselves are laid over the finished video (fire_overlays); the shots get their warm light.
    "fire": (None, 0.5, "fire"),
}


def fx_filter(fx: str, side: str, length: float) -> str:
    """Filters drawing a transition effect on one shot over a window `length` seconds long, in the
    window's own time (t and n start at 0). Strength P builds from 0 to 1 at the cut: toward the
    end of the outgoing shot ('out'), away from the start of the incoming one ('in')."""
    P = f"(t/{length:.4f})" if side == "out" else f"(1-t/{length:.4f})"
    frames = max(1, round(length * OUT_FPS) - 1)
    Pn = f"(on/{frames})" if side == "out" else f"(1-on/{frames})"
    big = lambda k: f"scale={even(OUT_W * k)}:{even(OUT_H * k)}"  # noqa: E731
    if fx.startswith("whip_"):
        way = fx[5:]
        across = way in ("left", "right")
        # The picture sweeps `way` across most of the frame: pad it with mirrored copies of itself
        # so there's picture to sweep into, and streak it with directional blur.
        sign = (1 if way in ("left", "up") else -1) * (1 if side == "out" else -1)
        e = even((OUT_W if across else OUT_H) * 0.7)
        pad = (f"pad=w=iw+{2 * e}:h=ih:x={e}:y=0,fillborders=left={e}:right={e}:mode=mirror" if across else
               f"pad=w=iw:h=ih+{2 * e}:x=0:y={e},fillborders=top={e}:bottom={e}:mode=mirror")
        x = f"{e}+{sign}*{e}*pow({P},1.6)" if across else "0"
        y = "0" if across else f"{e}+{sign}*{e}*pow({P},1.6)"
        return f"{pad},crop={OUT_W}:{OUT_H}:x='{x}':y='{y}',dblur=angle={0 if across else 90}:radius=90"
    if fx in ("zoom_in", "zoom_out"):
        strong = (fx == "zoom_in") == (side == "out")
        z = f"1+{0.8 if strong else 0.2}*pow({Pn},2)"
        return (f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={OUT_W}x{OUT_H}:fps={OUT_FPS},"
                f"gblur=sigma={8 if strong else 4}")
    if fx == "spin":
        # Pad to a square as wide as the frame's diagonal (mirrored edges), so no corners show.
        side_px = even((OUT_W ** 2 + OUT_H ** 2) ** 0.5 + 4)
        ex, ey = (side_px - OUT_W) // 2, (side_px - OUT_H) // 2
        angle = f"{'' if side == 'out' else '-'}PI*0.9*pow({P},2)"
        return (f"pad=w={side_px}:h={side_px}:x={ex}:y={ey},"
                f"fillborders=left={ex}:right={ex}:top={ey}:bottom={ey}:mode=mirror,"
                f"rotate=a='{angle}',crop={OUT_W}:{OUT_H},gblur=sigma=6")
    if fx == "glitch":
        return (f"{big(1.08)},crop={OUT_W}:{OUT_H}:x='(iw-ow)/2+35*sin(n*7.3)':y='(ih-oh)/2+30*sin(n*13.1)',"
                "rgbashift=rh=-24:bh=24:gv=8,noise=alls=40:allf=t")
    if fx == "shake":
        return (f"{big(1.22)},crop={OUT_W}:{OUT_H}:x='(iw-ow)/2+100*{P}*sin(n*2.1)':y='(ih-oh)/2+170*{P}*cos(n*2.9)',"
                "dblur=angle=60:radius=18")
    if fx == "light_leak":
        return "colorbalance=rs=0.3:gs=0.1:bs=-0.25:rm=0.25:gm=0.08:bm=-0.2,eq=brightness=0.16:saturation=1.2,gblur=sigma=2"
    if fx == "blur":
        return "gblur=sigma=16"
    if fx == "fire":
        # Firelight: the picture warms up and brightens as the flames get close.
        return (f"colorbalance=rs=0.25:gs=0.05:bs=-0.25:rm=0.2:bm=-0.15,"
                f"eq=brightness='0.18*{P}':saturation=1.15:eval=frame")
    return "null"


SOFT_EDGE = {"light_leak": "colorbalance=rs=0.12:bs=-0.1,eq=brightness=0.06", "blur": "gblur=sigma=5"}


def transition_windows(t: dict, side: str, cut_at: float) -> list[tuple[float, float, str]]:
    """Where a transition's effect goes on one shot, as (start, end, filters) in the shot's own time.
    `cut_at` is the end of the shot ('out') or 0 ('in')."""
    d, fx = t["d"], t["fx"]
    if t["xfade"]:  # blended: both shots are on screen from the cut to the end of the blend
        main = (cut_at, cut_at + d) if side == "out" else (0.0, d)
    else:  # hard cut in the middle of the effect
        main = (cut_at - d / 2, cut_at) if side == "out" else (0.0, d / 2)
    wins = [(main[0], main[1], fx_filter(fx, side, main[1] - main[0]))]
    if fx in SOFT_EDGE:
        wins.insert(0, (main[0] - 0.15, main[0], SOFT_EDGE[fx])) if side == "out" else wins.append(
            (main[1], main[1] + 0.15, SOFT_EDGE[fx]))
    return wins


def effect_windows(effect: str, duration: float) -> list[tuple[float, float, str]]:
    """A short in-shot effect, as windows in the shot's own time."""
    if effect == "flash_in":
        return [(0.0, 0.1, "eq=brightness=0.55:contrast=0.7"), (0.1, 0.2, "eq=brightness=0.22")]
    if effect == "focus_in":
        return [(0.0, 0.14, "gblur=sigma=18"), (0.14, 0.28, "gblur=sigma=8"), (0.28, 0.4, "gblur=sigma=3")]
    if effect == "zoom_pulse":
        f = round(0.3 * OUT_FPS) - 1
        return [(0.0, 0.3, f"zoompan=z='1+0.12*sin(PI*on/{f})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                           f":d=1:s={OUT_W}x{OUT_H}:fps={OUT_FPS}")]
    return []  # (no freeze frames: a video must never stop moving)


WHOLE_SHOT_EFFECTS = {"rgb_split": "rgbashift=rh=-10:bh=10", "black_and_white": "hue=s=0"}


def windowed(base: str, windows: list[tuple[float, float, str]], total: float) -> str:
    """A filter graph: `base` on the whole shot, plus each window's filters on just that stretch."""
    snap = lambda x: round(max(0.0, min(total, x)) * OUT_FPS) / OUT_FPS  # noqa: E731
    kept: list[tuple[float, float, str]] = []
    for a, b, f in windows:  # earlier windows (transitions) win over later ones
        a, b = snap(a), snap(b)
        if b - a >= 1 / OUT_FPS and all(b <= x or a >= y for x, y, _ in kept):
            kept.append((a, b, f))
    # Motions like shake scale the frame, which can leave non-square pixels; every piece must match.
    base = f"{base},setsar=1"
    if not kept:
        return f"[0:v]{base}[v]"
    pieces, t = [], 0.0
    for a, b, f in sorted(kept):
        if a > t:
            pieces.append((t, a, None))
        pieces.append((a, b, f))
        t = b
    if t < snap(total):
        pieces.append((t, snap(total), None))
    graph = [f"[0:v]{base},split={len(pieces)}" + "".join(f"[s{k}]" for k in range(len(pieces)))]
    for k, (a, b, f) in enumerate(pieces):
        graph.append(f"[s{k}]trim=start={a:.4f}:end={b:.4f},setpts=PTS-STARTPTS"
                     + (f",{f},scale={OUT_W}:{OUT_H},setsar=1" if f else "") + f",format=yuv420p[p{k}]")
    graph.append("".join(f"[p{k}]" for k in range(len(pieces))) + f"concat=n={len(pieces)}:v=1:a=0[v]")
    return ";".join(graph)


def atempo_chain(rate: float) -> str:
    """atempo filters for any speed (each one only goes down to 0.5x), with a trailing comma; "" for 1x."""
    if abs(rate - 1) < 1e-3:
        return ""
    parts = []
    while rate < 0.5:
        parts.append("atempo=0.5")
        rate /= 0.5
    parts.append(f"atempo={rate:.4f}")
    return ",".join(parts) + ","


def boomerang(clip: dict, start: float, need: float, dest: Path) -> dict:
    """The clip from `start`, played forward then backward (and again) until it lasts `need` seconds:
    a shot longer than its footage keeps moving instead of freezing. The sound plays once, then silence."""
    seg = max(0.1, clip["duration"] - start)
    reps = int(need / (2 * seg)) + 1
    vf = ",".join([
        *([tonemap_filter()] if clip["hdr"] else []),
        f"scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:flags=lanczos",
        f"crop={OUT_W}:{OUT_H}", "setsar=1", to_output_rate(clip.get("fps") or OUT_FPS), "format=yuv420p",
    ])
    frames = max(1, round(2 * seg * OUT_FPS))
    graph = (f"[0:v]{vf},split=2[f][r];[r]reverse[b];[f][b]concat=n=2:v=1:a=0,"
             f"loop=loop={reps}:size={frames}:start=0,setpts=N/{OUT_FPS}/TB[v]")
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{seg:.3f}", "-i", str(clip["path"])]
    if clip["has_audio"]:
        audio = ["-map", "0:a:0", "-af", "aresample=48000,apad"]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = ["-map", "1:a:0"]
    cmd += ["-filter_complex", graph, "-map", "[v]", *audio, "-t", f"{need + 0.1:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", str(OUT_FPS),
            "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest)]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    print(f"boomerang: {seg:.2f}s of footage played back and forth to fill {need:.2f}s")
    return {**clip, "path": dest, "duration": need + 0.1, "hdr": False, "has_audio": True, "fps": float(OUT_FPS)}


def cut_shot(clip: dict, start: float, take: float, duration: float, dest: Path,
             tail: float = 0.0, motion: str = "none", color: str = "none",
             t_in: dict | None = None, t_out: dict | None = None, speed: float = 1.0,
             effects: list[str] | tuple = ()) -> None:
    """One shot: the clip from `start`, filling exactly `duration` seconds at 1080x1920, plus `tail`
    extra seconds of picture for a blend into the next shot (its audio is trimmed off later).
    `t_in` / `t_out`: the transitions into and out of it; `speed`: 0.5 = slow motion, 1.6 = sped up."""
    if speed > 1:
        take = max(take, min(clip["duration"] - start, duration * speed))
    elif speed < 1:
        take = min(take, duration * speed)
    stretch = duration / take if abs(take - duration) > 0.02 else 1.0
    stretch = min(MAX_SLOWDOWN, max(0.55, stretch))
    total = duration + tail
    # Never hold a frame: the picture keeps moving to the very end of the shot (and its blend tail).
    # Not enough footage after `start`: start earlier in the clip; then slow it down a bit more;
    # and if the whole clip is still too short, play it forward then backward.
    need = total / stretch
    if start + need > clip["duration"]:
        start = max(0.0, clip["duration"] - need)
    avail = clip["duration"] - start
    if avail < need:
        stretch = min(MAX_STRETCH, total / max(avail, 0.05))
        need = total / stretch
    if avail < need - 0.02:
        clip = boomerang(clip, start, need, dest.with_name(dest.stem + "-loop.mkv"))
        start, avail = 0.0, clip["duration"]
    take, extra = min(avail, need), 0.0
    vf = [
        *([tonemap_filter()] if clip["hdr"] else []),
        f"scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase:flags=lanczos",
        f"crop={OUT_W}:{OUT_H}", "setsar=1",
        *([f"setpts={stretch:.4f}*PTS"] if stretch != 1 else []),
        to_output_rate(clip.get("fps") or OUT_FPS, stretch),
        f"tpad=stop_mode=clone:stop_duration={total:.3f}",
        *([m] if (m := motion_filter(motion, round(total * OUT_FPS))) else []),
        *([COLOR_FILTER_VF[color]] if color in COLOR_FILTER_VF else []),
        *[WHOLE_SHOT_EFFECTS[e] for e in effects if e in WHOLE_SHOT_EFFECTS],
        "format=yuv420p",
    ]
    windows = [
        *(transition_windows(t_in, "in", 0.0) if t_in and t_in.get("fx") else []),
        *(transition_windows(t_out, "out", duration) if t_out and t_out.get("fx") else []),
        *[w for e in effects for w in effect_windows(e, duration)],
    ]
    graph = windowed(",".join(vf), windows, total)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{take + extra:.3f}", "-i", str(clip["path"])]
    if clip["has_audio"]:
        af = f"aresample=48000,{atempo_chain(1 / stretch)}apad"
        audio = ["-map", "0:a:0", "-af", af]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = ["-map", "1:a:0"]
    cmd += [
        "-filter_complex", graph, "-map", "[v]", *audio, "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", str(OUT_FPS),
        # PCM audio, so joining the shots doesn't add clicks or drift at the cuts.
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return
    args = (clip, start, take, duration, dest, tail)
    if clip["hdr"]:
        # Tone mapping can fail on unusual files; plain conversion still gives a usable shot.
        cut_shot({**clip, "hdr": False}, *args[1:], motion, color, t_in, t_out, speed, effects)
    elif windows or effects or speed != 1:
        print(f"shot effects failed, cutting without them: {result.stderr[-400:]}")
        cut_shot(*args, motion, color)
    elif motion != "none":
        print(f"motion '{motion}' failed, cutting without it: {result.stderr[-300:]}")
        cut_shot(*args, "none", color)
    else:
        raise RuntimeError(f"cutting shot failed: {result.stderr[-500:]}")


def transition_plan(durations: list[float], transitions: list[str]) -> list[dict | None]:
    """For each cut: {"xfade", "d", "fx"}, or None for a hard cut. Never more than 40% of either shot."""
    out: list[dict | None] = []
    for i in range(len(durations) - 1):
        name = transitions[i] if i < len(transitions) else "cut"
        name = OLD_TRANSITIONS.get(name, name)
        if name not in TRANSITION_SPECS:
            out.append(None)
            continue
        xfade, d, fx = TRANSITION_SPECS[name]
        d = round(min(d, 0.4 * durations[i], 0.4 * durations[i + 1]), 3)
        out.append({"name": name, "xfade": xfade, "d": d, "fx": fx} if d >= 0.08 else None)
    return out


def join_shots(seg_paths: list[Path], durations: list[float], plan: list[dict | None],
               workdir: Path, dest: Path) -> None:
    """Joins the shots, with the blends in `plan`, keeping every cut at its exact time."""
    cuts = [(c["xfade"], c["d"]) if c and c["xfade"] else None for c in plan]
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
            # concat outputs a 1/1000000 timebase; xfade needs both sides on the same one (1/30).
            parts.append("".join(f"[v{m}]" for m in members) + f"concat=n={len(members)}:v=1:a=0,fps={OUT_FPS}[g{g}]")
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
        print(f"transitions failed, joining with hard cuts: {result.stderr[:700]} ... {result.stderr[-300:]}\n"
              f"graph: {';'.join(parts)[:1500]}")
        # Shots before a transition are longer than their slot: trim them back first.
        parts = [f"[{i}:v]trim=0:{durations[i]:.3f},setpts=PTS-STARTPTS[v{i}];"
                 f"[{i}:a]atrim=0:{durations[i]:.3f},asetpts=PTS-STARTPTS[a{i}]" for i in range(n)]
        parts.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vout][aout]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", *[x for p in seg_paths for x in ("-i", p.name)],
                        "-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "pcm_s16le", dest.name],
                       cwd=workdir, check=True, capture_output=True)


# ---- looks over the whole video (applied with the text, at the end)

def fire_overlays(cuts: list[dict | None], starts: list[float], inputs: list[str]) -> list[str]:
    """Lays the flames over the joined video at each fire cut (adding their inputs); labels the result [fired]."""
    out, src, j = [], "0:v", 0
    for i, c in enumerate(cuts):
        clip = Path(FIRE_DIR) / f"fire-{FIRE_SEEDS[j % len(FIRE_SEEDS)]}.mov"
        if not c or c.get("name") != "fire" or not clip.exists():
            continue
        idx = inputs.count("-i")
        inputs += ["-i", str(clip)]
        lead = starts[i + 1] - FIRE_CUT  # the cut lands in the middle of the fully covered stretch
        head = f"trim=start={-lead:.3f},setpts=PTS-STARTPTS," if lead < 0 else ""
        pad = f",tpad=start_duration={lead:.3f}:color=black@0" if lead > 0 else ""
        out.append(f"[{idx}:v]{head}scale={OUT_W}:{OUT_H}:flags=bicubic,format=rgba,fps={OUT_FPS}{pad}[fire{j}]")
        out.append(f"[{src}][fire{j}]overlay=eof_action=pass:format=auto[fired{j}]")
        src, j = f"fired{j}", j + 1
    out.append(f"[{src}]null[fired]")
    return out


def look_graph(looks: list[str], src: str, dest: str) -> list[str]:
    """Filter-graph lines taking video `src` through each look to `dest` (labels without brackets)."""
    simple = {
        "grain": "noise=alls=9:allf=t+u",
        "vhs": "rgbashift=rh=3:bh=-3,noise=alls=10:allf=t,eq=saturation=0.82:contrast=1.06:gamma=1.04,gblur=sigma=0.7",
        "vignette": "vignette=angle=PI/4.5",
        "letterbox": (f"drawbox=x=0:y=0:w=iw:h={round(OUT_H * 0.09)}:color=black:t=fill,"
                      f"drawbox=x=0:y={OUT_H - round(OUT_H * 0.09)}:w=iw:h={round(OUT_H * 0.09)}:color=black:t=fill"),
    }
    lines, cur = [], src
    for k, look in enumerate(x for x in looks if x in LOOKS):
        nxt = f"look{k}"
        if look == "soft_glow":
            lines += [f"[{cur}]format=gbrp,split[gl{k}a][gl{k}b]", f"[gl{k}b]gblur=sigma=18[gl{k}c]",
                      f"[gl{k}a][gl{k}c]blend=all_mode=screen:all_opacity=0.3,format=yuv420p[{nxt}]"]
        else:
            lines.append(f"[{cur}]{simple[look]}[{nxt}]")
        cur = nxt
    lines.append(f"[{cur}]null[{dest}]")
    return lines


# ---- sound effects
#
# Real recordings from SFX_DIR. The synthesized versions below are only a fallback for when a
# file is missing (e.g. running outside the worker image).

SFX_GAIN = 0.7
# Where a cut's sound lands, from its plan "offset" (which is when the sound starts, measured as if
# its hit came this many seconds in): a riser at -1.2 tops out on the cut; a whoosh at -0.1 peaks on it.
SFX_LEAD = {"riser": 1.2, "whoosh": 0.1, "swish": 0.05, "fire": 0.05}
SFX_FALLBACK = {"flash": "camera_shutter", "vine_boom": "boom", "fire": "whoosh"}


def synth_sfx(name: str, sr: int = 48000):
    """A sound effect as an (n, 2) float array."""
    import numpy as np

    rng = np.random.default_rng(sum(map(ord, name)))
    tt = lambda d: np.arange(int(d * sr)) / sr  # noqa: E731
    noise = lambda d: rng.standard_normal(int(d * sr))  # noqa: E731

    def lowpass(x, fc):
        fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
        a = np.exp(-2 * np.pi * np.clip(fc, 20, sr / 2.2) / sr)
        y = np.empty_like(x)
        acc = 0.0
        for i in range(len(x)):
            acc = (1 - a[i]) * x[i] + a[i] * acc
            y[i] = acc
        return y

    def band(x, fc):
        return lowpass(x, np.asarray(fc) * 1.6) - lowpass(x, np.asarray(fc) * 0.45)

    def tone(freq, t):
        return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(freq, t.shape)) / sr)

    def mono(x):
        return np.stack([x, x], axis=1)

    def sweep(d, lo, hi, peak):
        t = tt(d)
        u = t / d
        fc = np.where(u < peak, lo + (hi - lo) * (u / peak) ** 2, hi - (hi - lo) * 0.7 * ((u - peak) / (1 - peak)))
        env = np.where(u < peak, np.sin(np.pi / 2 * u / peak) ** 2, (1 - (u - peak) / (1 - peak)) ** 2)
        x = band(noise(d), fc) * env
        pan = np.clip(u, 0, 1)
        return np.stack([x * np.cos(pan * np.pi / 2), x * np.sin(pan * np.pi / 2)], axis=1)

    def bell(d, f, ratios=(1, 2.76, 5.4), amps=(1, 0.5, 0.25), taus=(0.6, 0.25, 0.12)):
        t = tt(d)
        x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / tau) for r, a, tau in zip(ratios, amps, taus))
        return x * np.minimum(1, t / 0.003)

    def click(d=0.04, f=2500):
        t = tt(d)
        return np.diff(noise(d), prepend=0) * np.exp(-t / 0.003) * 0.6 + np.sin(2 * np.pi * f * t) * np.exp(-t / 0.01) * 0.5

    def place(total, parts):
        out = np.zeros(int(total * sr))
        for at, x in parts:
            i = int(at * sr)
            out[i:i + len(x)] += x[: len(out) - i]
        return out

    if name == "whoosh":
        y = sweep(0.6, 300, 3200, 0.55)
    elif name == "swish":
        y = sweep(0.25, 900, 6500, 0.4)
    elif name == "pop":
        t = tt(0.14)
        y = mono(tone(300 + 900 * np.exp(-t / 0.015), t) * np.exp(-t / 0.035) + click(0.14) * 0.2)
    elif name == "click":
        y = mono(click(0.05))
    elif name == "camera_shutter":
        burst = lambda: lowpass(noise(0.05), 4500) * np.exp(-tt(0.05) / 0.012) + click(0.05) * 0.5  # noqa: E731
        y = mono(place(0.25, [(0, burst()), (0.085, burst() * 0.8)]))
    elif name == "ding":
        y = mono(bell(1.4, 1760))
    elif name == "cash_register":
        rattle = lowpass(noise(0.5), 7000) * (rng.random(int(0.5 * sr)) > 0.97) * 3
        rattle = lowpass(rattle, 5000) * np.exp(-tt(0.5) / 0.25)
        y = mono(place(1.2, [(0, bell(1.0, 2093) * 0.7), (0.09, bell(1.1, 2637)), (0.15, rattle * 0.6)]))
    elif name == "boom":
        t = tt(1.4)
        x = tone(40 + 70 * np.exp(-t / 0.08), t) * np.exp(-t / 0.45) + lowpass(noise(1.4), 200) * np.exp(-t / 0.05) * 3
        y = mono(np.tanh(1.8 * x))
    elif name == "riser":
        d = 1.25
        t = tt(d)
        u = t / d
        x = band(noise(d), 400 * 15 ** u) * 0.8 + tone(200 * 8 ** u, t) * 0.25
        y = mono(x * u ** 2 * np.minimum(1, (d - t) / 0.02))
    elif name == "glitch":
        parts = []
        for k in range(10):
            seg = int(0.03 * sr)
            if rng.random() < 0.5:
                x = np.sign(np.sin(2 * np.pi * rng.uniform(200, 2000) * np.arange(seg) / sr))
            else:
                x = noise(0.03)
            parts.append((k * 0.035, x * (0.4 + 0.6 * rng.random())))
        y = mono(place(0.36, parts))
    elif name == "record_scratch":
        d = 0.5
        t = tt(d)
        curve = np.abs(np.sin(2 * np.pi * 3 * t))
        y = mono(band(noise(d), 500 + 2800 * curve) * np.minimum(1, (d - t) / 0.05) + tone(150 + 600 * curve, t) * 0.15)
    elif name == "typing":
        key = lambda: lowpass(noise(0.03), 3000) * np.exp(-tt(0.03) / 0.008) + click(0.03, 3500) * 0.3  # noqa: E731
        times = np.cumsum(rng.uniform(0.07, 0.16, 9))
        y = mono(place(float(times[-1]) + 0.05, [(float(a), key() * rng.uniform(0.6, 1)) for a in times]))
    else:
        raise ValueError(name)
    return (y / (np.abs(y).max() + 1e-9) * 0.9).astype(np.float32)


def sfx_file(name: str, workdir: Path) -> Path:
    import wave

    import numpy as np

    real = Path(SFX_DIR) / f"{name}.mp3"
    if real.exists():
        return real
    name = SFX_FALLBACK.get(name, name)
    dest = workdir / f"sfx-{name}.wav"
    if not dest.exists():
        y = (synth_sfx(name) * 32767).astype(np.int16)
        with wave.open(str(dest), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(y.tobytes())
    return dest


def sfx_times(events: list[dict], starts: list[float], durations: list[float], total: float) -> list[tuple[float, str, float]]:
    """Each sound effect as (when its file starts in the finished video, name, volume). The start can be
    negative: a riser on the first cut begins before the video does, and gets its head trimmed off."""
    out = []
    for e in events:
        i, name = e.get("index", -1), e.get("name")
        if name not in SFX:
            continue
        if e.get("anchor") == "cut" and 0 <= i < len(starts) - 1:
            lands = starts[i + 1] + float(e.get("offset") or 0) + SFX_LEAD.get(name, 0.0)
        elif e.get("anchor") == "shot" and 0 <= i < len(starts):
            lands = starts[i] + float(e.get("frac") or 0) * durations[i]
        else:
            continue
        if 0 <= lands < total - 0.05:
            out.append((round(lands - SFX_HITS.get(name, 0.0), 3), name, float(e.get("volume") or 0.85)))
    return out


# ---- text and captions (ASS subtitles, burned in by libass)
#
# Safe zone: TikTok and Instagram Reels cover parts of a 9:16 video with their own
# interface: the tabs/search bar at the top, the username, caption and music line at
# the bottom, and the like/comment/share/profile column on the right. On-screen text
# and captions always stay inside the area left over, as fractions of the frame.
SAFE = {"top": 0.115, "bottom": 0.75, "left": 0.065, "right": 0.85}
MARGIN_L, MARGIN_R = round(SAFE["left"] * OUT_W), round((1 - SAFE["right"]) * OUT_W)
# Centered text and captions sit on the video's own center line (narrow enough to stay clear of the
# app's buttons on the right), not the middle of the safe area, which is left of center.
CENTER_X = 0.5
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

# Each look matches its sample in the website's caption picker (src/components/caption-styles.tsx).
POP_YELLOW = "&H004DD8FF"  # #FFD84D, in ASS's BGR order
DIM_WHITE = "&H66FFFFFF"  # white at 60%
CAPTION_LOOKS = {
    # bold pop: heavy capitals, white with a black edge, the word being said in yellow; pops in.
    "bold-pop": dict(font="Montserrat Black", bold=0, size=118, primary=WHITE, outline_c=BLACK, border=1, outline=8,
                     shadow=0, words=2, chars=14, upper=True, active=POP_YELLOW),
    # clean: plain white sentences with a soft shadow.
    "clean": dict(font="Montserrat Medium", bold=0, size=70, primary=WHITE, outline_c=BLACK, border=1, outline=0,
                  shadow=3, words=6, chars=30, upper=False, active=None),
    # outline: the clean font and sentences, white with a solid black stroke (tiktok's classic text).
    "outline": dict(font="Montserrat Medium", bold=0, size=76, primary=WHITE, outline_c=BLACK, border=1, outline=6,
                    shadow=0, words=5, chars=26, upper=False, active=None),
    # boxed: black text on a white box.
    "boxed": dict(font="Montserrat SemiBold", bold=0, size=74, primary=BLACK, outline_c=WHITE, border=3, outline=14,
                  shadow=0, words=4, chars=24, upper=False, active=None),
    # highlight: every word dimmed, the word being said lit up white.
    "karaoke": dict(font="Montserrat ExtraBold", bold=0, size=96, primary=DIM_WHITE, outline_c="&H99000000", border=1,
                    outline=4, shadow=0, words=3, chars=20, upper=False, active=WHITE),
}


def scaled(look: dict, scale: float) -> dict:
    return {**look, "size": round(look["size"] * scale), "outline": max(0, round(look["outline"] * scale))}


def caption_style_line(look: dict) -> str:
    bold = -1 if look.get("bold", -1) else 0
    return (f"Style: Caption,{look.get('font', FONT)},{look['size']},{look['primary']},{look['primary']},"
            f"{look['outline_c']},{SHADOW},{bold},0,0,0,100,100,0,0,{look['border']},{look['outline']},{look['shadow']},2,"
            f"{MARGIN_L},{MARGIN_R},{CAPTION_MARGIN},1")


def caption_chunks(words: list[dict], max_words: int, max_chars: int) -> list[list[dict]]:
    chunks: list[list[dict]] = []
    for w in words:
        cur = chunks[-1] if chunks else None
        if cur is not None and w.get("glue"):
            cur.append(w)
        elif (cur is None or len(cur) >= max_words
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


def luminance(hex_color: str) -> float:
    """0 (black) to 1 (white)."""
    try:
        r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    except (ValueError, TypeError):
        return 1.0
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


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
        # Always a stroke, like TikTok's classic text, so the words read over any footage: at least a
        # solid outline, dark around light text and light around dark text.
        outline = max(max(3, round(size * 0.07)),
                      {"none": 0, "thin": round(size * 0.05), "thick": round(size * 0.09)}.get(style.get("outline"), 0))
        text_light = luminance(style.get("color", "#FFFFFF")) >= 0.5
        stroke = style.get("outlineColor") or "#000000"
        if (luminance(stroke) >= 0.5) == text_light:
            stroke = "#000000" if text_light else "#FFFFFF"
        border, outline_c = 1, ass_color(stroke)
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
    return {"left": SAFE["left"] + 0.01, "right": SAFE["right"] - 0.01}.get(align, CENTER_X)


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
    if align == "center":
        x = CENTER_X  # always the video's center line (the lines were already fitted to the width there)
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
            if align == "center":
                x = CENTER_X  # centered means the center of the whole video
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
        cx = round(CENTER_X * OUT_W)
        for n, chunk in enumerate(chunks):
            start = chunk[0]["s"]
            end = chunk[-1]["e"] + 0.3
            if n + 1 < len(chunks):
                end = min(end, chunks[n + 1][0]["s"])
            end = max(end, start + 0.25)
            y = caption_y_at(start)
            pos = f"{{\\an5\\pos({cx},{round(y * OUT_H)})}}" if y is not None else ""
            say = (lambda t: t.upper()) if cap.get("upper") else (lambda t: t)  # noqa: E731
            if cap.get("active"):
                # The word being said stands out (yellow for bold pop, lit up for highlight).
                for k, w in enumerate(chunk):
                    ws = start if k == 0 else w["s"]
                    we = end if k == len(chunk) - 1 else chunk[k + 1]["s"]
                    # ASS colors are &HAABBGGRR: switch the color and the transparency.
                    on = f"\\1c&H{cap['active'][4:]}&\\1a&H{cap['active'][2:4]}&"
                    off = f"\\1c&H{cap['primary'][4:]}&\\1a&H{cap['primary'][2:4]}&"
                    line = " ".join(
                        f"{{{on}}}{ass_text(say(x['w']))}{{{off}}}" if j == k else ass_text(say(x["w"]))
                        for j, x in enumerate(chunk)
                    )
                    if caption_style == "bold-pop" and k == 0:
                        line = "{\\fscx80\\fscy80\\t(0,100,\\fscx100\\fscy100)}" + line
                    events.append(f"Dialogue: 0,{ass_time(ws)},{ass_time(max(we, ws + 0.05))},Caption,,0,0,0,,{pos}{line}")
            else:
                line = " ".join(ass_text(say(x["w"])) for x in chunk)
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

You get the inspo (what's said, its structure and length, its on-screen text) and the user's take as numbered lines, each with numbers describing how it was delivered. Choose which lines to keep:
- people often say the same line several times to see which sounds best. those repeats are listed as "takes of the same line": keep exactly one of them, the one that sounds best and fits the lines around it. you can't hear the audio, so judge by the numbers: clear (high clarity), fluent (no filler, no long pause inside the line), complete (says the whole line), and with a pace and loudness close to the lines you're keeping around it, so the video sounds like one smooth take. when takes are equally good, prefer the later one (people usually get better).
- the video must never say the same thing twice. if two lines say nearly the same thing and weren't flagged, keep only the better one.
- cut flubs, false starts, filler ("um", "uh", "so yeah", "wait let me start over"), mumbling and anything off-topic.
- keep the user's real message complete, and never cut in a way that changes what they mean.
- lines play in the order they were first said (a chosen take plays where that line first appears), so don't worry about where a later take was recorded.
- if the take has much more material than the inspo, aim for a length near the inspo's, but don't cut real content just to hit it.

Writing: everything is about the user's business or topic. Never invent facts, prices or claims. No emoji or hashtags in on-screen text."""

JUMPCUT_SCHEMA = {
    "type": "object",
    "properties": {
        "keep": {"type": "array", "items": {"type": "integer"}, "description": "the line numbers to keep."},
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

FILLERS = {"um", "umm", "uh", "uhh", "er", "erm", "hmm", "mm", "ah"}
RESTART_CUES = {"wait", "sorry", "again", "restart", "over", "actually", "oops", "hold"}
LINE_BREAK_S = 0.9  # a pause this long ends a line even without a full stop
RETAKE_WINDOW = 6  # how many lines later a repeat still counts as a retake
SAME_LINE = 0.75  # word overlap at which two lines are takes of the same line


def take_lines(clips: list[dict]) -> list[dict]:
    """Everything said in the takes (in clip order), as lines (sentences, or runs ended by a long
    pause). Each line keeps its words, so it can be cut again at every pause inside it."""
    lines: list[dict] = []
    budget = MAX_TAKE_S
    for ci, c in enumerate(clips):
        if not c["has_audio"] or budget <= 0:
            continue
        words = [w for seg in transcribe_take(c["path"])["segments"] for w in seg.get("words") or []
                 if w["e"] > w["s"] and w["s"] < budget and w["w"]]
        cur: list[dict] = []
        for w in words:
            if cur and (w["s"] - cur[-1]["e"] > LINE_BREAK_S or cur[-1]["w"][-1:] in ".?!"):
                lines.append({"clip": ci, "words": cur})
                cur = []
            cur.append(w)
        if cur:
            lines.append({"clip": ci, "words": cur})
        budget -= c["duration"]
    for i, ln in enumerate(lines):
        ln["id"] = i + 1
        ln["start"], ln["end"] = ln["words"][0]["s"], ln["words"][-1]["e"]
        ln["text"] = " ".join(w["w"] for w in ln["words"]).strip()
    return lines


def tokens(text: str) -> list[str]:
    import re

    return [t for t in re.findall(r"[a-z0-9']+", text.lower()) if t not in FILLERS]


def similar(a: list[str], b: list[str]) -> float:
    """How much two lines say the same thing (0–1). A false start that matches the beginning of a
    full line counts as the same line."""
    from difflib import SequenceMatcher

    if not a or not b:
        return 0.0
    # Same opening words: a restart ("we started filming, wait...") or another take.
    common = 0
    for x, y in zip(a, b):
        if x != y:
            break
        common += 1
    restart = bool(RESTART_CUES & set(a) or RESTART_CUES & set(b))
    cut_short = min(len(a), len(b)) <= common + 1  # one of them stops right after the shared words
    if (common >= 2 and restart) or (common >= 3 and cut_short):
        return 1.0
    ratio = SequenceMatcher(None, a, b, autojunk=False).ratio()
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 3:
        prefix = SequenceMatcher(None, short, long_[: len(short) + 1], autojunk=False).ratio()
        ratio = max(ratio, prefix * 0.9)
    return ratio


def retake_groups(lines: list[dict]) -> list[list[int]]:
    """Lines that are takes of the same line (by line index), each group in recording order."""
    toks = [tokens(ln["text"]) for ln in lines]
    parent = list(range(len(lines)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(lines)):
        for j in range(i + 1, min(len(lines), i + 1 + RETAKE_WINDOW)):
            if len(toks[i]) >= 2 and len(toks[j]) >= 2 and similar(toks[i], toks[j]) >= SAME_LINE:
                parent[root(j)] = root(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(lines)):
        groups.setdefault(root(i), []).append(i)
    return [g for g in groups.values() if len(g) > 1]


def mean_volume(path: Path, start: float, end: float) -> float | None:
    out = subprocess.run(
        ["ffmpeg", "-v", "info", "-ss", f"{start:.3f}", "-t", f"{max(0.1, end - start):.3f}", "-i", str(path),
         "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True,
    ).stderr
    for line in out.splitlines():
        if "mean_volume:" in line:
            try:
                return float(line.split("mean_volume:")[1].split("dB")[0])
            except ValueError:
                return None
    return None


def delivery_stats(lines: list[dict], clips: list[dict]) -> None:
    """Adds how each line was delivered (lines["stats"]) and an overall score for tie-breaks."""
    import statistics
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(8) as pool:
        volumes = list(pool.map(lambda ln: mean_volume(clips[ln["clip"]]["path"], ln["start"], ln["end"]), lines))
    rates = []
    for ln, vol in zip(lines, volumes):
        ws = ln["words"]
        spoken = [w for w in ws if tokens(w["w"])]
        dur = max(0.2, ln["end"] - ln["start"])
        probs = [w["p"] for w in ws if isinstance(w.get("p"), (int, float))]
        gaps = [b["s"] - a["e"] for a, b in zip(ws, ws[1:])]
        ln["stats"] = {
            "clarity": round(sum(probs) / len(probs), 2) if probs else None,
            "fillers": sum(1 for w in ws if w["w"].lower().strip(".,!?") in FILLERS),
            "longest_pause": round(max(gaps), 2) if gaps else 0.0,
            "words_per_s": round(len(spoken) / dur, 2),
            "volume_db": round(vol, 1) if vol is not None else None,
        }
        rates.append(ln["stats"]["words_per_s"])
    vols = [v for v in volumes if v is not None]
    mid_vol = statistics.median(vols) if vols else None
    mid_rate = statistics.median(rates) if rates else 0.0
    for ln in lines:
        st = ln["stats"]
        st["volume_vs_rest_db"] = round(st["volume_db"] - mid_vol, 1) if st["volume_db"] is not None and mid_vol is not None else None
        st["pace_vs_rest"] = round(st["words_per_s"] - mid_rate, 2)
        ln["score"] = (
            2 * (st["clarity"] or 0.7) - 0.6 * st["fillers"] - 0.8 * max(0.0, st["longest_pause"] - 0.5)
            - abs(st["volume_vs_rest_db"] or 0.0) / 8 - abs(st["pace_vs_rest"]) / 3 + 0.03 * len(tokens(ln["text"]))
        )


def select_lines(inspo: dict, lines: list[dict], groups: list[list[int]], text_mode: str, notes: str,
                 inspo_lines: list[str]) -> dict:
    b = inspo["breakdown"]
    ins = b.get("insights") or {}
    said = [f"[{x['startS']:.1f}s–{x['endS']:.1f}s] {x['text']}" for x in (b.get("transcript") or {}).get("segments", [])]
    shots = [
        f"inspo shot {i + 1} ({s['startS']:.1f}s, {s['durationS']:.1f}s): on-screen text: "
        + (json.dumps(inspo_lines[i] or s.get("onScreenText"), ensure_ascii=False) if (inspo_lines[i] or s.get("onScreenText")) else "none")
        for i, s in enumerate(b["shots"])
    ]
    take = []
    for ln in lines:
        st = ln["stats"]
        take.append(
            f"{ln['id']}. [clip {ln['clip'] + 1}, {ln['start']:.1f}s–{ln['end']:.1f}s] {ln['text']}\n"
            f"   clarity {st['clarity']}, filler words {st['fillers']}, longest pause {st['longest_pause']}s, "
            f"pace {st['words_per_s']} words/s ({st['pace_vs_rest']:+} vs the rest), "
            f"loudness {st['volume_vs_rest_db'] if st['volume_vs_rest_db'] is not None else '?'} dB vs the rest"
        )
    repeats = [f"- lines {', '.join(str(lines[i]['id']) for i in g)} are takes of the same line." for g in groups]
    text = "\n".join([
        f"the inspo is {b['durationS']:.1f}s long. hook: {ins.get('hook', '')}. structure: {ins.get('structure', '')}",
        "what's said in the inspo:", *(said or ["(no speech)"]),
        "", "the inspo's shots and on-screen text:", *shots,
        "", f"the user's take ({len(lines)} lines):", *take,
        "", "takes of the same line (keep exactly one from each):", *(repeats or ["(none found)"]),
        "",
        *([f"the user's additional requests and details: {json.dumps(notes, ensure_ascii=False)}"] if notes else []),
        "choose the lines to keep.",
        TEXT_RULES["adapt"] if text_mode == "adapt" else "on-screen text: set already. return an empty string for every inspo shot.",
    ])
    return ask_claude(JUMPCUT_SYSTEM, [{"type": "text", "text": text}], JUMPCUT_SCHEMA,
                      "we couldn’t edit that take. try filming it again.")


def final_lines(lines: list[dict], groups: list[list[int]], keep_ids: list[int]) -> list[dict]:
    """The lines to use, in script order, with at most one take of each line and nothing said twice
    in a row, whatever the selection was."""
    wanted = {i for i, ln in enumerate(lines) if ln["id"] in set(keep_ids)}
    group_of = {i: g for g in groups for i in g}
    for g in groups:
        chosen = [i for i in g if i in wanted]
        if len(chosen) > 1:  # more than one take kept: keep the best-sounding one
            best = max(chosen, key=lambda i: lines[i]["score"])
            wanted -= set(chosen) - {best}
    # A chosen take plays where its line was first said.
    order = sorted(wanted, key=lambda i: (min(group_of.get(i, [i])), i))
    out: list[int] = []
    toks = [tokens(ln["text"]) for ln in lines]
    for i in order:
        if out and similar(toks[out[-1]], toks[i]) >= SAME_LINE:
            if lines[i]["score"] > lines[out[-1]]["score"]:
                out[-1] = i
            continue
        out.append(i)
    return [lines[i] for i in out]


def line_ranges(chosen: list[dict], clips: list[dict]) -> list[dict]:
    """The chosen lines as cut ranges: each line is cut again at every pause inside it, and parts
    that run straight on in the same clip are joined."""
    ranges: list[dict] = []
    for ln in chosen:
        parts: list[list[float]] = []
        for w in ln["words"]:
            if parts and w["s"] - parts[-1][1] <= JUMPCUT_GAP_S:
                parts[-1][1] = w["e"]
            else:
                parts.append([w["s"], w["e"]])
        dur = clips[ln["clip"]]["duration"]
        for a, b in parts:
            a = max(0.0, a - JUMPCUT_PAD[0])
            b = min(dur, b + JUMPCUT_PAD[1])
            last = ranges[-1] if ranges else None
            if last and last["clip"] == ln["clip"] and last["start"] <= a <= last["end"] + 0.05:
                last["end"] = max(last["end"], b)
                continue
            if b - a >= 0.25:
                ranges.append({"clip": ln["clip"], "start": a, "end": b})
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

REVISE_SYSTEM = """You make changes to a short-form video a user already made with ViralOwner (an app that remakes a proven viral video, the "inspo", with the user's own footage, starting from the inspo's shot timing).

You get the user's request, frames from every shot of the current version exactly as it looks now (with its on-screen text and captions), the plan behind it, where faces are in each shot, and frames from all of the user's clips.

Make the change the user asks for and keep everything else exactly as it is. The user's request always wins over matching the inspo: the inspo is only where the video started, so never refuse or water down a change because it makes the video differ from the inspo. A request about the text or captions in general ("make the words smaller", "move the text up") applies to every shot that has them, unless the user names specific shots. When moving text, give its new position in every shot it appears in.

You can change: how long each shot lasts (length_s: when the user asks to extend, lengthen, shorten or trim a shot or clip, or to make a part longer or shorter, change those shots' lengths by what they ask, or by a clear amount like 1-2 seconds if they don't say; the shots after it simply move later or earlier); which clip and moment fills a shot (to show more of a moment when a shot gets longer, start it earlier in the clip if the clip runs out); the on-screen text of each shot; where the on-screen text sits in each shot; its size, font, color, look (outline, box or plain), alignment (left, center, right) and how it animates in; where captions sit in each shot; the caption size; the words in the captions (caption_fixes: when the user says a word in the captions is wrong, or tells you what a word should say or how to spell it, add it as wrong -> right exactly as they want it, using the current captions below to find the words as they appear now); the post caption and hashtags.
You can't change: the number of shots, the music or audio, whether captions are on or their style (the user changes those in the options under the video), or add stickers. If the request needs something you can't do, do what you can and say what isn't possible in the summary.
Transitions, sound effects, speed (slow motion, sped up), zooms, shakes, filters, looks and other video effects are handled by a separate step: never call them impossible and leave them out of your summary. If the request is only about those, change nothing and return an empty summary.

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
                    "length_s": {"type": "number", "description": "how long the shot lasts, in seconds (its current length unless the user asked to change it)."},
                    "clip": {"type": "integer", "description": "the clip number to use, starting at 1."},
                    "start_s": {"type": "number", "description": "where in that clip the shot starts, in seconds."},
                    "text": {"type": "string", "description": "on-screen text for this shot. empty string for none."},
                    "text_x": {"type": "number", "description": "the on-screen text's x (see above), or -1 to leave it."},
                    "text_y": {"type": "number", "description": "vertical center of the on-screen text, or -1 to leave it."},
                    "caption_y": {"type": "number", "description": "vertical center of the captions, or -1 to leave it."},
                },
                "required": ["index", "length_s", "clip", "start_s", "text", "text_x", "text_y", "caption_y"],
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
        "caption_fixes": CAPTION_FIXES_FIELD,
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
                 "text_animation", "caption", "hashtags", "caption_fixes", "summary"],
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
                one_take: bool = False, caption_text: str = "", caption_fixes: list[dict] | None = None) -> dict:
    cap = scaled(CAPTION_LOOKS.get(caption_style or "bold-pop", CAPTION_LOOKS["bold-pop"]), layout["captionScale"])
    cap_default = caption_center(cap)
    content: list[dict] = [{"type": "text", "text": (
        f"the user's request: {json.dumps(request, ensure_ascii=False)}\n"
        + (f"what the user told us about their video: {json.dumps(notes, ensure_ascii=False)}\n" if notes else "")
        + f"\nthe current version ({len(shots)} shots). on-screen text: {style_summary(style)}, size {layout['textScale']:.2f}; "
        + (f"captions on ('{caption_style}'), size {layout['captionScale']:.2f}." if caption_style else "captions off.")
        + f"\npost caption: {json.dumps(post.get('caption', ''), ensure_ascii=False)}\nhashtags: {' '.join(post.get('hashtags', []))}"
        + (f"\nthe captions now say: {json.dumps(caption_text, ensure_ascii=False)}" if caption_style and caption_text else "")
        + (f"\ncaption fixes already in effect: {json.dumps(caption_fixes, ensure_ascii=False)}" if caption_fixes else "")
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
                   "return every shot's clip, start and length exactly as given.")
    if text_rule:
        ask.append("the user also changed their text settings: " + text_rule)
    content.append({"type": "text", "text": "\n".join(ask)})
    return ask_claude(REVISE_SYSTEM, content, REVISE_SCHEMA, "we couldn’t make that change. try wording it differently.",
                      effort="xhigh")


# ---------------------------------------------------------------- the edit's effects
#
# Per video: the transition at each cut, each shot's motion, speed and short
# effects, looks over the whole video, the color filter and sound effects.
# They start as the inspo's (its style analysis), and change when the user
# asks in "additional requests" or "request a change".


def effects_from(style: dict, n: int, jump: bool) -> dict:
    """The inspo's effects, sized for `n` shots."""
    fit = lambda xs, k, d: (list(xs or []) + [d] * k)[:k]  # noqa: E731
    if jump:
        # One take: the cuts are the user's pauses, not the inspo's shots.
        return {"transitions": ["cut"] * max(0, n - 1),
                "motions": ["zoomed" if style.get("alternateZoom") and j % 2 else "none" for j in range(n)],
                "speeds": ["normal"] * n, "shotEffects": [[] for _ in range(n)],
                "looks": list(style.get("looks") or []), "colorFilter": style.get("colorFilter") or "none", "sfx": []}
    return {
        "transitions": [OLD_TRANSITIONS.get(t, t) for t in fit(style.get("transitions"), n - 1, "cut")],
        "motions": fit(style.get("motions"), n, "none"),
        "speeds": fit(style.get("speeds"), n, "normal"),
        "shotEffects": fit(style.get("shotEffects"), n, []),
        "looks": list(style.get("looks") or []),
        "colorFilter": style.get("colorFilter") or "none",
        "sfx": list(style.get("sfx") or []),
    }


def clean_effects(e, n: int) -> dict | None:
    """Effects saved with an earlier version, if they're valid for `n` shots."""
    if not isinstance(e, dict) or len(e.get("transitions") or []) != n - 1 or len(e.get("motions") or []) != n:
        return None
    ok = lambda v, opts, d: v if v in opts else d  # noqa: E731
    return {
        "transitions": [ok(OLD_TRANSITIONS.get(t, t), TRANSITIONS, "cut") for t in e["transitions"]],
        "motions": [ok(m, MOTIONS + ["zoomed"], "none") for m in e["motions"]],
        "speeds": [ok(x, SPEEDS, "normal") for x in (list(e.get("speeds") or []) + ["normal"] * n)[:n]],
        "shotEffects": [[x for x in (fx or []) if x in SHOT_EFFECTS]
                        for fx in (list(e.get("shotEffects") or []) + [[]] * n)[:n]],
        "looks": [x for x in e.get("looks") or [] if x in LOOKS],
        "colorFilter": ok(e.get("colorFilter"), COLOR_FILTERS, "none"),
        "sfx": [x for x in e.get("sfx") or [] if isinstance(x, dict) and x.get("name") in SFX],
    }


EFFECTS_SYSTEM = """You set the edit of a short-form video ViralOwner is making: the transition at each cut, each shot's motion, speed and short effects, looks over the whole video, the color filter and sound effects. They start out copied from the viral video the user is remaking.

Do exactly what the user's words ask for, and keep everything else exactly as it is. If the words don't ask about any of these, return everything unchanged with an empty summary. When they describe a feeling instead of naming effects ("make it hit harder", "more energy", "make the reveal dramatic"), choose the transitions, effects and sounds from the lists below that best deliver it, where it matters most. When they ask for something that isn't in the lists, use the closest thing that is, and say plainly in the summary what you used instead. A request about "the transitions" or "every cut" in general applies to all cuts. When the user asks for a sound with a transition (e.g. "add a whoosh to the whips"), put the sound at each of those cuts. A riser starts about 1.2s before the cut it builds to (offset -1.2); most other sounds sit right on the cut (offset 0, or about -0.1 for a whoosh). A fire transition goes best with a fire whoosh on the same cut (offset -0.05), and a flash with a flash sound, unless the user says otherwise.

Transitions:
""" + catalog(TRANSITION_INFO) + """
Motions:
""" + catalog(MOTION_INFO) + """
Speeds: """ + ", ".join(SPEEDS) + """
Shot effects:
""" + catalog(SHOT_EFFECT_INFO) + """
Looks:
""" + catalog(LOOK_INFO) + """
Color filters: """ + ", ".join(COLOR_FILTERS) + """
Sound effects:
""" + catalog(SFX_INFO)

EFFECTS_SCHEMA = {
    "type": "object",
    "properties": {
        "transitions": {"type": "array", "description": "one per cut, in order (cut 1 is between shot 1 and shot 2).",
                        "items": {"type": "string", "enum": TRANSITIONS}},
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "the shot number, starting at 1."},
                    "motion": {"type": "string", "enum": MOTIONS},
                    "speed": {"type": "string", "enum": SPEEDS},
                    "effects": {"type": "array", "items": {"type": "string", "enum": SHOT_EFFECTS}},
                },
                "required": ["index", "motion", "speed", "effects"],
                "additionalProperties": False,
            },
        },
        "looks": {"type": "array", "items": {"type": "string", "enum": LOOKS}},
        "color_filter": {"type": "string", "enum": COLOR_FILTERS},
        "sfx": {
            "type": "array",
            "description": "every sound effect in the video (the ones to keep and any new ones).",
            "items": {
                "type": "object",
                "properties": {
                    "at": {"type": "string", "enum": ["cut", "shot"]},
                    "index": {"type": "integer", "description": "the cut or shot number, starting at 1."},
                    "name": {"type": "string", "enum": SFX},
                    "offset": {"type": "number", "description": "at a cut: seconds from the cut. in a shot: how far through it, 0 to 1."},
                },
                "required": ["at", "index", "name", "offset"],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string", "description": (
            "what you changed, for the user, in one short lowercase sentence speaking as 'we', in plain words "
            "(e.g. 'we added a whoosh to every transition.'). empty if nothing changed.")},
    },
    "required": ["transitions", "shots", "looks", "color_filter", "sfx", "summary"],
    "additionalProperties": False,
}


def describe_effects(e: dict, shots: list[dict]) -> str:
    lines = []
    for i, s in enumerate(shots):
        fx = ", ".join(e["shotEffects"][i]) or "no effects"
        lines.append(f"shot {i + 1} ({s.get('role', 'shot')}, {s['durationS']:.1f}s): motion {e['motions'][i]}, "
                     f"speed {e['speeds'][i]}, {fx}")
        if i < len(shots) - 1:
            lines.append(f"  cut {i + 1}: {e['transitions'][i]}")
    lines.append(f"looks: {', '.join(e['looks']) or 'none'}; color filter: {e['colorFilter']}")
    sounds = [f"{x['name']} at {x['anchor']} {x['index'] + 1} ({x.get('offset', x.get('frac', 0))})" for x in e["sfx"]]
    lines.append(f"sound effects: {'; '.join(sounds) or 'none'}")
    return "\n".join(lines)


def plan_effects(words: str, effects: dict, shots: list[dict]) -> tuple[dict, str, float]:
    """Applies what the user asked for to the effects. Returns (effects, summary, cost)."""
    n = len(shots)
    content = [{"type": "text", "text": (
        f"what the user asked for: {json.dumps(words, ensure_ascii=False)}\n\n"
        f"the video now ({n} shots, {n - 1} cuts):\n{describe_effects(effects, shots)}\n\n"
        "return the whole updated edit."
    )}]
    result = ask_claude(EFFECTS_SYSTEM, content, EFFECTS_SCHEMA, "we couldn’t work out those effects.", effort="xhigh")
    d = result["data"]
    by = {x["index"]: x for x in d["shots"]}
    new = {
        "transitions": ([t if t in TRANSITIONS else "cut" for t in d["transitions"]] + effects["transitions"])[: n - 1],
        "motions": [(by.get(i + 1) or {}).get("motion", effects["motions"][i]) for i in range(n)],
        "speeds": [(by.get(i + 1) or {}).get("speed", effects["speeds"][i]) for i in range(n)],
        "shotEffects": [[x for x in (by.get(i + 1) or {}).get("effects", effects["shotEffects"][i]) if x in SHOT_EFFECTS]
                        for i in range(n)],
        "looks": [x for x in dict.fromkeys(d["looks"]) if x in LOOKS],
        "colorFilter": d["color_filter"] if d["color_filter"] in COLOR_FILTERS else effects["colorFilter"],
        "sfx": [],
    }
    # Keep "zoomed" (jump-cut framing) where it was; Claude only sees the named motions.
    new["motions"] = [m if m in MOTIONS else "none" for m in new["motions"]]
    new["motions"] = [effects["motions"][i] if effects["motions"][i] == "zoomed" and new["motions"][i] == "none" else m
                      for i, m in enumerate(new["motions"])]
    old = {(x["anchor"], x["index"], x["name"]): x for x in effects["sfx"]}
    for x in d["sfx"]:
        anchor, i = x["at"], x["index"] - 1
        if x["name"] not in SFX or not (0 <= i < (n - 1 if anchor == "cut" else n)):
            continue
        prev = old.get((anchor, i, x["name"]))
        pos = {"offset": r2(max(-1.5, min(1.5, float(x["offset"]))))} if anchor == "cut" else {
            "frac": r2(max(0.0, min(0.99, float(x["offset"]))))}
        new["sfx"].append({"anchor": anchor, "index": i, "name": x["name"], **pos,
                           "volume": (prev or {}).get("volume", 0.85), "source": (prev or {}).get("source", "request")})
    print(f"effects: ${result['cost_usd']}, summary={d['summary']!r}")
    return new, d["summary"].strip(), result["cost_usd"]


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


# ---- start from scratch: Claude directs the whole edit
#
# No inspo. Claude watches every clip, hears what's said in them, reads the user's
# prompt (written as if talking to Claude directly) and plans the whole video: the
# shots, the words and their look, transitions, effects and sound effects. The plan
# becomes the same shot list and style an analyzed inspo gives, so render_video
# builds it with exactly the same tools. Change requests go back to the director
# with the current version in front of it, so any part of the edit can change.

SCRATCH_MAX_S = 180.0
SCRATCH_MAX_SHOTS = 60
SCRATCH_MIN_SHOT_S = 0.4
SCRATCH_CLIP_FRAMES = 120  # more than matching: Claude is choosing everything
SCRATCH_MAX_WORDS = 5000  # word timings sent to Claude (beyond this, phrase timings only)
POSITIONS = ["top", "middle", "bottom"]

DIRECTOR_SYSTEM = """You are the video editor behind ViralOwner's "start from scratch". A creator or small business owner uploads their own clips and tells you, in their own words, the short-form video they want (TikTok, Instagram Reels, YouTube Shorts: vertical 9:16). You make it for them, exactly as a great editor would if they were sitting next to you describing it: every cut, what's on screen and the words, the transitions, effects and sound effects.

Do exactly what the user asks. Their prompt is the brief: follow every specific instruction (what to show and in what order, the length, the words, the style, the pacing, the effects, the feel). Where they leave something open, make the choice that makes the strongest video for what they're going for. Never quietly skip part of the prompt: if something can't be done with these clips or these tools, do the closest thing you can and say so plainly in the summary.

What you get: the user's prompt; every clip, with frames sampled through it (each labelled with its time in the clip) and what's said in it, with timings; what the sound will be; the on-screen text setting; and, when the user is asking for a change, the current version's plan and a frame from each of its shots.

How the video is built: a list of shots, played in the order you give them. Each shot plays one clip from start_s to end_s (seconds in that clip) at a speed: normal; slow_motion (plays at half speed, so the shot lasts twice as long); fast (1.6x, so it's shorter). The video's length is the sum of its shots. The sound:
- "the clips' own audio": each shot's sound is that clip's own sound at that moment. Cutting to another clip cuts away from whatever was being said, so when someone talks to the camera their words are the backbone of the edit: keep whole sentences and cut only in the gaps between words (start a shot about 0.1s before its first word and end it about 0.15s after its last word, using the word timings); take out retakes, flubs, false starts, long pauses, "um"s and dead air unless the user wants them kept; never cut a word in half; never repeat a sentence. Only cut away to other clips where nothing important is being said, or where the user asks for it.
- "the user's audio file": it plays from the start of the video and the clips' own sound isn't heard. If it has words (a voiceover), the edit follows them: show what's being talked about while it's said. If it's music, cut on its beats and hits (their times are given) and make the video no longer than the file.
- "no sound": only the sound effects you add.

Editing craft:
- The first 1-2 seconds decide whether people keep watching: open on the most striking moment, the result teased, or a bold line.
- Pick moments that are in focus with the subject in frame, where the action is about to happen. Avoid the first and last ~0.3s of a clip, where people fumble with the phone. Skip unusable footage (black, blurry, accidental, screen recordings) unless the user wants it. Give every shot its own clip. Use a second part of a clip only when it's necessary: there aren't enough other clips for the video, or the clip holds a different moment the video needs (like the finished result at the end of a long take). Then the parts must be clearly different portions of the clip: never overlapping, and at least 1 second apart, so nobody sees the same section twice (and no teaser of the ending at the start that plays again later). A clip of someone talking to the camera is the exception: the edit can cut it at the gaps between sentences and cut away and back to it. If the clips run out before the length the user asked for, make the video shorter and say so.
- Pacing: music or b-roll edits usually cut every 0.6-2.5s (faster for hype, slower for calm or aesthetic); a talking video moves at the speed of the speech with the gaps taken out. Build to the payoff and end strong (the result, the reveal, or a call to action if the user wants one).
- Length: what the prompt asks for; otherwise what the content needs, usually 7-40 seconds. Never over 180 seconds. With the user's audio file, never longer than the file.
- Transitions: hard cuts are the default and what most viral edits use. Use other transitions where they add something or where the user asks, and fit them to the moment (whip or zoom for energy, flash on a beat drop, fire for a dramatic transformation or reveal, a crossfade for calm). Pair them with fitting sound effects.
- Sound effects: use them where they help (a whoosh on whips, a pop when text appears, a boom on a big reveal, a riser building into a moment) and never so many that they get annoying. A riser starts about 1.2s before the cut it builds to (offset -1.2); most sounds sit right on the cut (offset 0, or about -0.1 for a whoosh). A fire transition goes best with a fire whoosh (offset -0.05), a flash with a flash sound.
- On-screen text is short and punchy, and it never repeats what's being said (speech captions are added separately when they're turned on, so don't put the spoken words in on-screen text). TikTok and Instagram cover the top ~12%, the bottom ~25% and the right edge of the screen with their own buttons, so keep text short enough to sit in the area left over. Use \\n for line breaks. No emoji or hashtags in on-screen text. A line can stay on screen across several shots: repeat it for each of those shots. Placement: by default (text_y -1) the app puts text at the chosen position and moves it off faces and captions automatically. Set text_y yourself (the vertical center, between 0.15 and 0.72) when the frame needs it, looking at the clip's frames. text_y is the center of the whole block: one line of large text is about 0.06 of the frame tall, two lines about 0.13, so keep half the block's height clear on each side of anything you're avoiding, plus a little margin. if the footage already has text or captions burned into it, never cover them; put your text in the clear space (for example between a burned-in title and the speaker's face), or leave it off. When speech captions are on, they sit around 0.6-0.7 from the top, so keep your text above them.
- Text style: pick the font, color, look, size, animation and position that fit the video's vibe (a bold condensed or heavy font for hype, a serif or script for aesthetic, a typewriter for storytelling). position: top (the upper safe area, the usual place for a hook), middle, or bottom (just above where the app's caption sits).
- Never invent facts, prices, results or claims the clips or the prompt don't support.
- Write the post caption (one or two lines, in the user's voice, with a hook) and 3-8 hashtags.
- Speech captions are written automatically from what's said. When the user says a word in them is wrong, or tells you what a word should say or how to spell it, put it in caption_fixes (the words as the captions show them now -> exactly what the user wants), and keep every fix already in effect. When the user asks for a shot or clip to be longer or shorter, change its start_s/end_s (or the speed) by what they ask, or by a clear amount like 1-2 seconds if they don't say.
- summary: one or two short sentences to the user, all lowercase, saying what you made (or, for a change, what you changed), including anything you couldn't do. Write as "we" ("we cut it down to..."), never "i", and never mention claude, ai or a model.

Transitions (transition_in is how the video gets into that shot; shot 1 is always 'cut'):
""" + catalog(TRANSITION_INFO) + """
Motions (an edit effect moving the whole frame through the shot; usually none):
""" + catalog(MOTION_INFO) + """
Shot effects (short effects inside the shot; usually none):
""" + catalog(SHOT_EFFECT_INFO) + """
Looks over the whole video (usually none):
""" + catalog(LOOK_INFO) + """
Color filters: """ + ", ".join(COLOR_FILTERS) + """
Sound effects:
""" + catalog(SFX_INFO) + """
Fonts: clean_sans (geometric sans, tiktok's classic), heavy_sans (very heavy wide sans), condensed (tall narrow bold, like impact), tall_caps (thin tall capitals), serif, typewriter, marker (handwritten marker), script (cursive), rounded (rounded bold, playful).
Text looks: outline (colored text with a dark outline), box (text on a solid box), plain (no outline, soft shadow).
Text sizes: small (a label), medium, large (a headline), xl (fills the width).
Text animations: none, pop (scales up), fade, typewriter (letter by letter), word_by_word, slide_up."""

DIRECTOR_TEXT_RULES = {
    "adapt": "on-screen text: you write it, from the prompt and what the clips show (or none where the video is better without).",
    "custom": "on-screen text: use the user's own lines below exactly as typed: every line, word for word, in order, each "
              "line on its own line. put them on the shots where they fit best; a line can stay on screen across several "
              "shots (repeat it). don't add any other text.",
    "none": "on-screen text: none. return an empty string for every shot's text.",
}

DIRECTOR_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "one or two short sentences to the user, all lowercase, written as \"we\"."},
        "shots": {
            "type": "array",
            "description": "the video's shots, in the order they play.",
            "items": {
                "type": "object",
                "properties": {
                    "clip": {"type": "integer", "description": "the clip number, starting at 1."},
                    "start_s": {"type": "number", "description": "where the shot starts in that clip, in seconds."},
                    "end_s": {"type": "number", "description": "where the shot ends in that clip, in seconds."},
                    "speed": {"type": "string", "enum": SPEEDS},
                    "transition_in": {"type": "string", "enum": TRANSITIONS},
                    "motion": {"type": "string", "enum": MOTIONS},
                    "effects": {"type": "array", "items": {"type": "string", "enum": SHOT_EFFECTS}},
                    "text": {"type": "string", "description": "on-screen text during this shot, \\n between lines. empty for none."},
                    "text_y": {"type": "number", "description": "where the text's vertical center sits (0 = top, 1 = bottom), or -1 to place it automatically."},
                    "role": {"type": "string", "enum": SHOT_ROLES, "description": "the job this shot does. cta = call to action."},
                    "description": {"type": "string", "description": "what's in the shot, max 12 words."},
                },
                "required": ["clip", "start_s", "end_s", "speed", "transition_in", "motion", "effects", "text", "text_y",
                             "role", "description"],
                "additionalProperties": False,
            },
        },
        "text_style": {
            "type": "object",
            "properties": {
                "font": {"type": "string", "enum": list(FONTS)},
                "color": {"type": "string", "description": "#RRGGBB"},
                "look": {"type": "string", "enum": ["outline", "box", "plain"]},
                "box_color": {"type": "string", "description": "#RRGGBB, used when look is box."},
                "align": {"type": "string", "enum": TEXT_ALIGNS},
                "size": {"type": "string", "enum": list(TEXT_SIZES)},
                "animation": {"type": "string", "enum": TEXT_ANIMATIONS},
                "position": {"type": "string", "enum": POSITIONS},
            },
            "required": ["font", "color", "look", "box_color", "align", "size", "animation", "position"],
            "additionalProperties": False,
        },
        "looks": {"type": "array", "items": {"type": "string", "enum": LOOKS}},
        "color_filter": {"type": "string", "enum": COLOR_FILTERS},
        "sfx": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "at": {"type": "string", "enum": ["cut", "shot"],
                           "description": "cut: on the cut into shot `index`. shot: inside shot `index`."},
                    "index": {"type": "integer", "description": "the shot number, starting at 1 (for a cut: the shot it cuts into, 2 or more)."},
                    "name": {"type": "string", "enum": SFX},
                    "offset": {"type": "number", "description": "at a cut: seconds from the cut. in a shot: how far through it, 0 to 1."},
                },
                "required": ["at", "index", "name", "offset"],
                "additionalProperties": False,
            },
        },
        "caption": {"type": "string", "description": "the post caption."},
        "hashtags": {"type": "array", "items": {"type": "string"}},
        "caption_fixes": CAPTION_FIXES_FIELD,
    },
    "required": ["summary", "shots", "text_style", "looks", "color_filter", "sfx", "caption", "hashtags", "caption_fixes"],
    "additionalProperties": False,
}

_STYLE_LOOK = {"outline": {"box": False, "outline": "thick", "shadow": False},
               "box": {"box": True, "outline": "none", "shadow": False},
               "plain": {"box": False, "outline": "none", "shadow": True}}


def scratch_speech(clips: list[dict]) -> None:
    """Adds clip["speech"]: what's said in each clip, with word timings."""
    for c in clips:
        c["speech"] = transcribe(c["path"])["segments"] if c["has_audio"] else []


def describe_speech(segments: list[dict], words_ok: bool) -> str:
    lines = []
    for s in segments:
        lines.append(f"[{s['startS']:.2f}s-{s['endS']:.2f}s] {s['text']}")
        if words_ok and s.get("words"):
            lines.append("  words: " + " ".join(f"{w['w']}@{w['s']:.2f}-{w['e']:.2f}" for w in s["words"]))
    return "\n".join(lines)


def audio_file_info(path: Path) -> dict:
    """The user's audio file: its length, the strong hits/beats in it, and any words."""
    a = load_audio(path)
    dur = len(a) / 48000
    hits = sorted(t for t, _ in onsets(a, limit=80))
    return {"duration": dur, "hits": [r2(t) for t in hits], "speech": transcribe(path)["segments"]}


def plan_from_render(plan: dict, clip_index: dict[str, int]) -> dict | None:
    """A finished scratch version's plan, in the director's own shape (for change requests and edits)."""
    shots_in = plan.get("shots") or []
    eff = plan.get("effects") or {}
    n = len(shots_in)
    if not n or any(s.get("clipId") not in clip_index for s in shots_in):
        return None
    pick = lambda key, i, d: ((eff.get(key) or []) + [d] * n)[i]  # noqa: E731
    roles = ((plan.get("scratch") or {}).get("roles") or []) + ["build"] * n
    descs = ((plan.get("scratch") or {}).get("descriptions") or []) + [""] * n
    texts = (list(plan.get("texts") or []) + [""] * n)[:n]
    ys = (list(plan.get("textYs") or []) + [None] * n)[:n]
    trans = ["cut"] + list(eff.get("transitions") or [])
    shots = []
    for i, s in enumerate(shots_in):
        shots.append({
            "clip": clip_index[s["clipId"]] + 1, "start_s": float(s.get("trimStartS") or 0.0),
            "end_s": float(s.get("trimEndS") or 0.0), "speed": pick("speeds", i, "normal"),
            "transition_in": trans[i] if i < len(trans) else "cut", "motion": pick("motions", i, "none"),
            "effects": list(pick("shotEffects", i, []) or []), "text": texts[i] or "",
            "text_y": ys[i] if isinstance(ys[i], (int, float)) else -1, "role": roles[i],
            "description": descs[i],
        })
    st = clean_text_style(plan.get("textStyle"))
    look = "box" if st["box"] else ("plain" if st["outline"] == "none" else "outline")
    sfx = []
    for e in eff.get("sfx") or []:
        if e.get("anchor") == "cut":
            sfx.append({"at": "cut", "index": int(e["index"]) + 2, "name": e["name"], "offset": float(e.get("offset") or 0)})
        elif e.get("anchor") == "shot":
            sfx.append({"at": "shot", "index": int(e["index"]) + 1, "name": e["name"], "offset": float(e.get("frac") or 0)})
    return {
        "summary": "", "shots": shots,
        "text_style": {"font": st["font"], "color": st["color"], "look": look, "box_color": st["boxColor"],
                       "align": st["align"], "size": st["size"], "animation": st["animation"],
                       "position": plan.get("textPosition") if plan.get("textPosition") in POSITIONS else "top"},
        "looks": list(eff.get("looks") or []), "color_filter": eff.get("colorFilter") or "none", "sfx": sfx,
        "caption": "", "hashtags": [],
    }


def direct_edit(prompt: str, clips: list[dict], sound: str, audio_info: dict | None, text_mode: str,
                custom_text: str, previous: dict | None, prev_frames: list[Path | None], request: str,
                fresh: bool, captions: bool, fix: tuple[dict, list[str]] | None = None) -> dict:
    """Claude's plan for the whole video (DIRECTOR_SCHEMA), with usage and cost."""
    total_words = sum(len(s.get("words") or []) for c in clips for s in c.get("speech") or [])
    if audio_info:
        total_words += sum(len(s.get("words") or []) for s in audio_info["speech"])
    words_ok = total_words <= SCRATCH_MAX_WORDS

    content: list[dict] = [{"type": "text", "text": "the user's prompt, in their own words:\n" + json.dumps(prompt, ensure_ascii=False)}]
    content.append({"type": "text", "text": f"\nthe user's {len(clips)} clips:"})
    for ci, c in enumerate(clips):
        content.append({"type": "text", "text": f"clip {ci + 1}: {c['duration']:.1f}s long"
                                                 + ("" if c["has_audio"] else ", no sound")})
        for t, p in c["frames"]:
            content.append({"type": "text", "text": f"clip {ci + 1} at {t:.1f}s"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
        said = describe_speech(c.get("speech") or [], words_ok)
        content.append({"type": "text", "text": f"said in clip {ci + 1}:\n{said}" if said else f"nothing is said in clip {ci + 1}."})

    if sound == "upload" and audio_info:
        said = describe_speech(audio_info["speech"], words_ok)
        about = (f"the sound: the user's audio file ({audio_info['duration']:.1f}s long). it plays from the start of the "
                 f"video; the clips' own sound isn't heard. strong hits/beats at: "
                 f"{', '.join(f'{t:.2f}' for t in audio_info['hits']) or 'none found'} (seconds).\n"
                 + (f"words in it:\n{said}" if said else "it has no words (music)."))
    elif sound == "none":
        about = "the sound: no sound, only the sound effects you add."
    else:
        about = "the sound: the clips' own audio."
    content.append({"type": "text", "text": "\n" + about})

    ask = [DIRECTOR_TEXT_RULES[text_mode],
           "speech captions: " + ("on (added automatically from what's said)." if captions else "off.")]
    if text_mode == "custom":
        ask.append("the user's lines: " + json.dumps(custom_text, ensure_ascii=False))
    if previous:
        content.append({"type": "text", "text": "\nthe current version's plan:\n" + json.dumps(
            {k: v for k, v in previous.items() if k not in ("captionText", "captionFixes")}, ensure_ascii=False)})
        if previous.get("captionText"):
            content.append({"type": "text", "text": "the captions now say: " + json.dumps(previous["captionText"], ensure_ascii=False)})
        if previous.get("captionFixes"):
            content.append({"type": "text", "text": "caption fixes already in effect: " + json.dumps(previous["captionFixes"], ensure_ascii=False)})
        for i, p in enumerate(prev_frames):
            if p:
                content.append({"type": "text", "text": f"the current version, shot {i + 1} (as it looks now, with its text):"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64(p)}})
        ask += [
            "the user is asking for a change to the current version. their request, in their own words: "
            + json.dumps(request, ensure_ascii=False),
            "make exactly that change and keep everything else identical: the same shots, moments, words, style, "
            "transitions, effects and sounds, unless the request needs them changed. restructure as much as the request "
            "needs (reorder, add, remove or retime shots). the caption and hashtags stay the same unless the change "
            "affects them. the summary says what you changed.",
        ]
    elif fresh:
        ask.append("this is a fresh take: make a different edit from the obvious one, still following the prompt exactly.")
    ask.append("plan the whole video.")
    if fix:
        ask += ["you already planned it like this:\n" + json.dumps(fix[0], ensure_ascii=False),
                "but it shows the same thing twice: " + "; ".join(fix[1]) + ". fix only that (use other clips or "
                "moments, or drop shots) and keep everything else as it is."]
    content.append({"type": "text", "text": "\n" + "\n".join(ask)})
    return ask_claude(DIRECTOR_SYSTEM, content, DIRECTOR_SCHEMA,
                      "we couldn’t make a video from that. try different clips or a different prompt.", effort="xhigh")


def clean_director(data: dict, clips: list[dict], max_s: float, text_mode: str, talking: set[int] | None = None) -> dict:
    """Checks Claude's plan against the real clips: every shot inside its clip and long enough, the
    video within its length limit. Returns the plan, cleaned."""
    shots = []
    total = 0.0
    for s in data.get("shots") or []:
        ci = s.get("clip")
        if not isinstance(ci, int) or not 1 <= ci <= len(clips):
            continue
        d = clips[ci - 1]["duration"]
        try:
            a, b = float(s["start_s"]), float(s["end_s"])
        except (TypeError, ValueError, KeyError):
            continue
        a = min(max(0.0, a), max(0.0, d - SCRATCH_MIN_SHOT_S))
        b = min(max(b, a + SCRATCH_MIN_SHOT_S), d)
        if b - a < 0.15:
            continue
        speed = s.get("speed") if s.get("speed") in SPEEDS else "normal"
        length = (b - a) / SPEED_RATES[speed]
        if total + length > max_s:
            # The last shot that fits gets shortened to land on the limit.
            room = max_s - total
            if room < SCRATCH_MIN_SHOT_S:
                break
            b = a + room * SPEED_RATES[speed]
            length = room
        total += length
        shots.append({
            "clip": ci - 1, "start": r2(a), "end": r2(b), "speed": speed,
            "transition_in": OLD_TRANSITIONS.get(s.get("transition_in"), s.get("transition_in"))
            if s.get("transition_in") in TRANSITIONS or s.get("transition_in") in OLD_TRANSITIONS else "cut",
            "motion": s.get("motion") if s.get("motion") in MOTIONS else "none",
            "effects": [x for x in s.get("effects") or [] if x in SHOT_EFFECTS],
            "text": "" if text_mode == "none" else edit_text((s.get("text") or "").replace("\\n", "\n")),
            "text_y": r2(min(0.75, max(0.15, float(s["text_y"])))) if isinstance(s.get("text_y"), (int, float))
            and s["text_y"] >= 0 else None,
            "role": s.get("role") if s.get("role") in SHOT_ROLES else "build",
            "description": (s.get("description") or "").strip()[:120],
        })
        if len(shots) >= SCRATCH_MAX_SHOTS or total >= max_s - 0.05:
            break
    # Never the same footage twice: a shot overlapping an earlier one moves to an unused part of its
    # clip, or is shortened to fit one, or is left out.
    used: dict[int, list[tuple[float, float]]] = {}
    kept_shots = []
    for sh in shots:
        spans = used.setdefault(sh["clip"], [])
        if talking is not None and sh["clip"] in talking:
            # Cuts of someone talking follow their sentences: only never overlap.
            if any(sh["start"] < b - 0.05 and sh["end"] > a + 0.05 for a, b in spans):
                print(f"scratch: left out a shot repeating part of talking clip {sh['clip'] + 1}")
                continue
            spans.append((sh["start"], sh["end"]))
            kept_shots.append(sh)
            continue
        length = sh["end"] - sh["start"]
        if overlaps((sh["start"], sh["end"]), spans):
            start = unused_start(spans, clips[sh["clip"]]["duration"], length, sh["start"])
            if start is None:
                # The longest unused stretch, if it's long enough for a shot.
                gaps, t = [], 0.0
                for a, b in sorted(spans):
                    gaps.append((t, a - SAME_CLIP_GAP_S))
                    t = max(t, b + SAME_CLIP_GAP_S)
                gaps.append((t, clips[sh["clip"]]["duration"]))
                a, b = max(gaps, key=lambda g: g[1] - g[0])
                if b - a < SCRATCH_MIN_SHOT_S:
                    print(f"scratch: left out a shot that repeated footage (clip {sh['clip'] + 1})")
                    continue
                start, length = a, b - a
            sh["start"], sh["end"] = r2(start), r2(start + length)
        spans.append((sh["start"], sh["end"]))
        kept_shots.append(sh)
    shots = kept_shots
    if not shots:
        raise JobError("we couldn’t plan a video from these clips. try adding clips or describing the video differently.")
    shots[0]["transition_in"] = "cut"

    ts = data.get("text_style") or {}
    style = clean_text_style({
        "font": ts.get("font"), "color": ts.get("color"), "boxColor": ts.get("box_color"),
        "align": ts.get("align"), "size": ts.get("size"), "animation": ts.get("animation"),
        **_STYLE_LOOK.get(ts.get("look"), {}),
    })
    if style["box"] and style["boxColor"] == style["color"]:
        style["color"] = "#000000" if style["boxColor"] in ("#FFFFFF", "#FFFF00") else "#FFFFFF"
    n = len(shots)
    sfx = []
    for e in data.get("sfx") or []:
        idx, name = e.get("index"), e.get("name")
        if name not in SFX or not isinstance(idx, int):
            continue
        try:
            off = float(e.get("offset") or 0)
        except (TypeError, ValueError):
            off = 0.0
        if e.get("at") == "cut" and 2 <= idx <= n:
            sfx.append({"anchor": "cut", "index": idx - 2, "offset": r2(max(-1.5, min(1.5, off))), "name": name,
                        "volume": 0.85, "source": "request"})
        elif e.get("at") == "shot" and 1 <= idx <= n:
            sfx.append({"anchor": "shot", "index": idx - 1, "frac": r2(max(0.0, min(0.99, off))), "name": name,
                        "volume": 0.85, "source": "request"})
    return {
        "summary": (data.get("summary") or "").strip(),
        "shots": shots,
        "style": style,
        "position": ts.get("position") if ts.get("position") in POSITIONS else "top",
        "looks": [x for x in data.get("looks") or [] if x in LOOKS],
        "colorFilter": data.get("color_filter") if data.get("color_filter") in COLOR_FILTERS else "none",
        "sfx": sfx,
        "caption": (data.get("caption") or "").strip(),
        "hashtags": [h.strip() for h in data.get("hashtags") or [] if isinstance(h, str) and h.strip()],
    }


def reuse_problems(shots: list[dict], talking: set[int], clip_count: int) -> list[str]:
    """Where a plan shows the same thing twice, or reuses a clip it doesn't need to: the same section
    of a clip twice (or too close), or a second shot from a clip while other clips go unused.
    A clip of someone talking can be cut up freely."""
    problems, last, spans = [], {}, {}
    unused = set(range(clip_count)) - {sh["clip"] for sh in shots}
    for i, sh in enumerate(shots):
        c = sh["clip"]
        if c in last and c not in talking and overlaps((sh["start"], sh["end"]), spans.get(c, [])):
            problems.append(f"shot {i + 1} shows the same section of clip {c + 1} as shot {last[c] + 1} (or within "
                            f"{SAME_CLIP_GAP_S:.0f}s of it)")
        elif c in last and c not in talking and unused:
            problems.append(f"shot {i + 1} uses clip {c + 1} again (already shot {last[c] + 1}) while clips "
                            f"{', '.join(str(u + 1) for u in sorted(unused))} aren't used; reuse a clip only if it's necessary")
        spans.setdefault(c, []).append((sh["start"], sh["end"]))
        last[c] = i
    return problems


def custom_lines_kept(shots: list[dict], custom: str) -> bool:
    """The user's own lines all appear, word for word and in order, with nothing added."""
    want = [ln.strip() for ln in custom.replace("\r", "").split("\n") if ln.strip()]
    got: list[str] = []
    prev = None
    for s in shots:
        if s["text"] and s["text"] != prev:
            got += [ln.strip() for ln in s["text"].split("\n") if ln.strip()]
        prev = s["text"] or None
    return got == want


def scratch_inputs(cleaned: dict, clips: list[dict]) -> dict:
    """Turns the director's plan into what render_video builds from: a shot list (like an analyzed
    inspo's), the clip and trim for each shot, the words and their look, and the effects."""
    shots = cleaned["shots"]
    n = len(shots)
    t = 0.0
    bd_shots = []
    for i, s in enumerate(shots):
        length = r2((s["end"] - s["start"]) / SPEED_RATES[s["speed"]])
        bd_shots.append({"index": i, "role": s["role"], "tip": "", "startS": r2(t), "durationS": length,
                         "description": s["description"], "onScreenText": s["text"] or None, "whyItWorks": ""})
        t += length
    style = {
        **default_inspo_style(n), "version": STYLE_VERSION, "editType": "shots", "text": cleaned["style"],
        "textSpots": [None] * n, "textLines": [s["text"] for s in shots],
    }
    return {
        "breakdown": {"durationS": r2(t), "shotCount": n, "shots": bd_shots, "style": style},
        "shots": [{"shotIndex": i, "clipId": clips[s["clip"]]["id"], "trimStartS": s["start"], "trimEndS": s["end"]}
                  for i, s in enumerate(shots)],
        "reuse": {
            "texts": [s["text"] for s in shots], "textStyle": cleaned["style"], "textPosition": cleaned["position"],
            "textYs": [s["text_y"] for s in shots], "keepLines": True,
            "postCopy": {"caption": cleaned["caption"],
                         "hashtags": [h if h.startswith("#") else f"#{h}" for h in cleaned["hashtags"]][:8]},
        },
        "effects": {
            "transitions": [s["transition_in"] for s in shots[1:]], "motions": [s["motion"] for s in shots],
            "speeds": [s["speed"] for s in shots], "shotEffects": [s["effects"] for s in shots],
            "looks": cleaned["looks"], "colorFilter": cleaned["colorFilter"], "sfx": cleaned["sfx"],
        },
    }


def render_scratch(req: dict, workdir: Path, fetch=r2_fetch, store=r2_store) -> dict:
    """A "start from scratch" version: Claude directs (or the earlier version is rebuilt with the
    user's own shot edits), then render_video builds it."""
    from concurrent.futures import ThreadPoolExecutor

    started = time.time()
    sc = req.get("scratch") or {}
    prompt = (sc.get("prompt") or "").strip()[:4000]
    options = req["options"]
    text_opts = options.get("text") or {}
    text_mode = text_opts.get("mode") if text_opts.get("mode") in DIRECTOR_TEXT_RULES else "adapt"
    custom_text = (text_opts.get("custom") or "") if text_mode == "custom" else ""
    sound = options["music"]["mode"] if options["music"]["mode"] in ("upload", "none") else "original"
    request = (req.get("request") or "").strip()[:1500]
    base = req.get("previous") if isinstance(req.get("previous"), dict) else None
    cost = 0.0

    report("analyzing", 3)
    prev_path = workdir / "previous.mp4"
    own_audio = workdir / "own-audio"
    downloads = [(c["storageKey"], workdir / f"clip{i:02d}") for i, c in enumerate(req["clips"])]
    if request and base:
        downloads.append((base["storageKey"], prev_path))
    if sound == "upload" and isinstance(req.get("audio"), dict) and req["audio"].get("storageKey"):
        downloads.append((req["audio"]["storageKey"], own_audio))
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda d: fetch(d[0], d[1]), downloads))

    clips = []
    for i, c in enumerate(req["clips"]):
        path = workdir / f"clip{i:02d}"
        try:
            clips.append({"id": c["id"], "path": path, "storageKey": c["storageKey"], **probe_clip(path)})
        except Exception as e:  # noqa: BLE001
            print(f"skipping unreadable clip {c['id']}: {e}")
    if not clips:
        raise JobError("we couldn’t read your clips. try uploading them again.")
    index_of = {c["id"]: i for i, c in enumerate(clips)}
    has_audio_file = sound == "upload" and own_audio.exists() and own_audio.stat().st_size > 0
    if sound == "upload" and not has_audio_file:
        sound = "original"

    previous = plan_from_render(base["plan"], index_of) if base and isinstance(base.get("plan"), dict) else None
    carry = req.get("carry") if isinstance(req.get("carry"), dict) else {}
    caption_fixes = clean_caption_fixes(((base or {}).get("plan") or {}).get("captionFixes") if base else None,
                                        carry.get("captionFixes"))
    text_changed = bool(base and base.get("textChanged"))
    if previous and not request and text_changed:
        # Only the text setting changed: the director updates the words and nothing else.
        request = {"custom": "use my own on-screen text now (the lines in the text setting).",
                   "none": "take all the on-screen text off.",
                   "adapt": "write the on-screen text for me now."}[text_mode]
    if previous and request:
        report("analyzing", 6)
    max_s = SCRATCH_MAX_S
    audio_info = None
    if previous and not request:
        # An edit without words: the same plan, with the user's own clip and trim choices per shot.
        cleaned = clean_director({**previous, "caption": (base.get("postCopy") or {}).get("caption", ""),
                                  "hashtags": (base.get("postCopy") or {}).get("hashtags", [])}, clips, max_s, text_mode)
        edits = {e.get("shotIndex"): e for e in req.get("shots") or [] if isinstance(e, dict)}
        for i, s in enumerate(cleaned["shots"]):
            e = edits.get(i) or {}
            ci = index_of.get(e.get("clipId"))
            if ci is None:
                continue
            d = clips[ci]["duration"]
            a = e.get("trimStartS") if isinstance(e.get("trimStartS"), (int, float)) else None
            b = e.get("trimEndS") if isinstance(e.get("trimEndS"), (int, float)) else None
            if ci != s["clip"] and a is None and b is None:
                # A different clip, no trim given: the same length from its start.
                a, b = 0.0, min(d, s["end"] - s["start"])
            a = min(max(0.0, a if a is not None else s["start"]), max(0.0, d - SCRATCH_MIN_SHOT_S))
            b = min(max(b if b is not None else s["end"], a + SCRATCH_MIN_SHOT_S), d)
            s.update(clip=ci, start=r2(a), end=r2(b))
        cleaned["summary"] = ""
        print("scratch: rebuilt from the earlier version with the user's shot edits")
    else:
        report("analyzing", 8)
        sample_clip_frames(clips, workdir, limit=SCRATCH_CLIP_FRAMES)
        report("analyzing", 12)
        audio_info_box: list[dict] = []
        jobs = [lambda: scratch_speech(clips)]
        if has_audio_file:
            jobs.append(lambda: audio_info_box.append(audio_file_info(own_audio)))
        with ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda f: f(), jobs))
        audio_info = audio_info_box[0] if audio_info_box else None
        if audio_info:
            max_s = min(max_s, audio_info["duration"])
        prev_frames: list[Path | None] = []
        if previous and request:
            t = 0.0
            for i, s in enumerate(previous["shots"]):
                length = max(0.1, (s["end_s"] - s["start_s"]) / SPEED_RATES.get(s["speed"], 1.0))
                prev_frames.append(grab_frame(prev_path, t + length / 2, workdir / f"prev{i:02d}.jpg", MATCH_FRAME_WIDTH)
                                   if prev_path.exists() else None)
                t += length
            # The current caption and hashtags, so a change can keep them, and what the captions say.
            previous = {**previous, "caption": (base.get("postCopy") or {}).get("caption", ""),
                        "hashtags": (base.get("postCopy") or {}).get("hashtags", []),
                        "captionText": str(base["plan"].get("captionText") or ""),
                        "captionFixes": caption_fixes}
        report("matching", 20)
        result = direct_edit(prompt, clips, sound, audio_info, text_mode, custom_text, previous if request else None,
                             prev_frames, request, bool(req.get("fresh")), bool((options.get("captions") or {}).get("enabled")))
        cost += result["cost_usd"]
        # Checked before clean_director's own fix-up, which can only move or drop shots.
        talking = {i for i, c in enumerate(clips) if sound == "original" and c.get("speech")}
        raw = [{"clip": s.get("clip", 0) - 1, "start": float(s.get("start_s") or 0), "end": float(s.get("end_s") or 0)}
               for s in result["data"].get("shots") or [] if isinstance(s.get("clip"), int)]
        problems = reuse_problems(raw, talking, len(clips))
        if problems:
            print(f"scratch director repeated footage, asking again: {problems}")
            report("matching", 32)
            again = direct_edit(prompt, clips, sound, audio_info, text_mode, custom_text, previous if request else None,
                                prev_frames, request, bool(req.get("fresh")),
                                bool((options.get("captions") or {}).get("enabled")), fix=(result["data"], problems))
            cost += again["cost_usd"]
            result = {**again, "usage": again["usage"]}
        cleaned = clean_director(result["data"], clips, max_s, text_mode, talking)
        caption_fixes = clean_caption_fixes(caption_fixes, result["data"].get("caption_fixes"))
        if text_mode == "custom" and custom_text.strip() and not custom_lines_kept(cleaned["shots"], custom_text):
            # The user's own words go in exactly as typed, whatever Claude did with them.
            placed = spread_lines(custom_text, [{"onScreenText": s["text"] or None,
                                                 "durationS": (s["end"] - s["start"]) / SPEED_RATES[s["speed"]]}
                                                for s in cleaned["shots"]])
            for s, txt in zip(cleaned["shots"], placed):
                s["text"] = txt
        if previous and request and not cleaned["caption"]:
            cleaned["caption"] = previous.get("caption") or ""
            cleaned["hashtags"] = previous.get("hashtags") or []
        print(f"scratch director: {len(cleaned['shots'])} shots, ${result['cost_usd']}, usage={result['usage']}, "
              f"summary={cleaned['summary']!r}")
        for i, s in enumerate(cleaned["shots"]):
            print(f"  {i + 1}. clip {s['clip'] + 1} {s['start']:.2f}-{s['end']:.2f} {s['speed']} {s['transition_in']} "
                  f"{s['motion']} {s['effects']} {s['role']} text={s['text']!r} ({s['description']})")

    built = scratch_inputs(cleaned, clips)
    req2 = {
        **req,
        "inspo": {"storageKey": None, "breakdown": built["breakdown"]},
        "shots": built["shots"],
        "reuse": built["reuse"],
        "effects": built["effects"],
        "options": {**options, "notes": "", "music": {**options["music"], "mode": sound},
                    "text": {**text_opts, "mode": "custom" if text_mode == "custom" else "adapt"}},
        "request": None, "previous": None, "fresh": False, "cuts": None,
        "speechHint": prompt[:600], "carry": {"captionFixes": caption_fixes},
    }

    def fetch_once(key: str, dest: Path) -> None:
        if not dest.exists():
            fetch(key, dest)

    out = render_video(req2, workdir, fetch=fetch_once, store=store)
    out["plan"]["note"] = cleaned["summary"] or None
    out["plan"]["scratch"] = {"roles": [s["role"] for s in cleaned["shots"]],
                              "descriptions": [s["description"] for s in cleaned["shots"]]}
    meta = out.setdefault("meta", {})
    meta["costUsd"] = round(float(meta.get("costUsd") or 0) + cost, 4)
    meta["seconds"] = round(time.time() - started, 1)
    meta["scratch"] = True
    return out


def render_video(req: dict, workdir: Path, fetch=r2_fetch, store=r2_store) -> dict:
    """The whole render. Returns the website's RenderOutput shape (plus the plan and meta)."""
    import re
    from concurrent.futures import ThreadPoolExecutor

    started = time.time()
    breakdown = req["inspo"]["breakdown"]
    shots = breakdown["shots"]
    for s in shots:  # analyses from before watermarks were left out
        s["onScreenText"] = edit_text(s.get("onScreenText")) or None
    check_end_screen = bool(req["inspo"].get("storageKey")) and "contentEndS" not in (breakdown.get("meta") or {})
    n = len(shots)
    options = req["options"]
    text_opts = options["text"]
    # "match": the inspo's own words; "adapt": the inspo's style, words about the user; "custom": the user's lines.
    text_choice = text_opts.get("mode") if text_opts.get("mode") in ("match", "adapt", "custom") else "match"
    align_choice = text_opts.get("align") if text_opts.get("align") in TEXT_ALIGNS else None
    notes = (options.get("notes") or "").strip()[:600]
    music = options["music"]["mode"]
    caption_style = options["captions"]["style"] if options["captions"]["enabled"] else None
    # What the video is about, so captions spell the business, products and names right.
    speech_hint = (req.get("speechHint") or notes or "").strip()[:600]
    request = (req.get("request") or "").strip()[:600]
    previous = req.get("previous") if request else None
    cost = 0.0

    # ---- analyzing: get everything and look at the clips
    report("analyzing", 3)
    inspo_path = workdir / "inspo"
    prev_path = workdir / "previous.mp4"
    clip_ids = [c["id"] for c in req["clips"]]
    # "start from scratch" versions have no inspo file (render_scratch planned the shots).
    downloads = ([(req["inspo"]["storageKey"], inspo_path)] if req["inspo"].get("storageKey") else []) + [
        (c["storageKey"], workdir / f"clip{i:02d}") for i, c in enumerate(req["clips"])
    ] + ([(previous["storageKey"], prev_path)] if previous else [])
    # The user's own audio file, when that's the chosen sound.
    own_audio = workdir / "own-audio"
    if music == "upload" and isinstance(req.get("audio"), dict) and req["audio"].get("storageKey"):
        downloads.append((req["audio"]["storageKey"], own_audio))
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda d: fetch(d[0], d[1]), downloads))

    if check_end_screen:
        # Analyzed before end screens were trimmed: leave out any shots of the app's end screen.
        end = content_end(inspo_path, probe(inspo_path)["duration"], workdir)
        if end is not None:
            kept = [s for s in shots if s["startS"] < end - 0.3]
            if kept:
                last = kept[-1]
                last["durationS"] = r2(min(last["durationS"], end - last["startS"]))
                print(f"left out the end screen: {len(shots) - len(kept)} shot(s) after {end:.2f}s")
                shots = kept
                breakdown = {**breakdown, "shots": shots, "shotCount": len(shots), "durationS": r2(end)}
                n = len(shots)

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

    # The inspo's look. Inspos analyzed before it (or before its latest version) get it now.
    new_style = None
    inspo_style = breakdown.get("style")
    if not isinstance(inspo_style, dict) or int(inspo_style.get("version") or 1) < STYLE_VERSION:
        report("analyzing", 5)
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
    inspo_lines = [edit_text(t) for t in (list(inspo_style.get("textLines") or []) + [None] * n)[:n]]
    inspo_text = clean_text_style(inspo_style.get("text"))

    def clean_post(caption: str, hashtags: list[str]) -> dict:
        return {"caption": caption.strip(),
                "hashtags": [h if h.startswith("#") else f"#{h}" for h in (x.strip() for x in hashtags) if h][:8]}

    keep = (previous["plan"] | {"postCopy": previous.get("postCopy")}) if previous else req.get("reuse")
    req_shots = req["shots"]

    # One take, pauses cut out: the cuts come from the user's take, not the inspo's timing.
    jump = inspo_style.get("editType") == "jump_cut"
    carry = req.get("carry") if isinstance(req.get("carry"), dict) else {}
    caption_fixes = clean_caption_fixes(((previous or {}).get("plan") or {}).get("captionFixes"), carry.get("captionFixes"))
    inspo_lengths = [s["durationS"] for s in shots]
    lengths = carry.get("shotLengths") or ((previous or {}).get("plan") or {}).get("shotLengths")
    if (not jump and isinstance(lengths, list) and len(lengths) == n
            and all(isinstance(x, (int, float)) and x > 0 for x in lengths)):
        # Shot lengths the user asked for in an earlier version.
        shots = with_lengths(shots, [float(x) for x in lengths])
    jump_ranges: list[dict] = []
    jump_texts: list[str] | None = None
    jump_post = None
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
            lines = take_lines(clips)
            if lines:
                delivery_stats(lines, clips)
                groups = retake_groups(lines)
                for ln in lines:
                    print(f"  line {ln['id']} [{ln['start']:.1f}-{ln['end']:.1f}] {ln['text']!r} "
                          f"{json.dumps(ln['stats'], default=float)}")
                report("matching", 25)
                choice = "keep" if keep else text_choice
                result = select_lines(req["inspo"], lines, groups, "adapt" if choice == "adapt" else "set", notes, inspo_lines)
                cost += result["cost_usd"]
                data = result["data"]
                keep_ids = [k for k in data["keep"] if isinstance(k, int)] or [ln["id"] for ln in lines]
                chosen = final_lines(lines, groups, keep_ids)
                jump_ranges = line_ranges(chosen, clips)
                by_shot = {x["index"]: (x.get("text") or "").strip() for x in data["texts"]}
                jump_texts = [by_shot.get(i + 1, "") for i in range(n)]
                jump_post = clean_post(data["caption"], data["hashtags"])
                print(f"jump cut: {len(lines)} lines, retakes {[[lines[i]['id'] for i in g] for g in groups]}, "
                      f"kept {[ln['id'] for ln in chosen]}")
                print(f"jump cut: {len(jump_ranges)} cuts, ${result['cost_usd']}, usage={result['usage']}")
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
        req_shots = [{"shotIndex": j, "clipId": clips[r["clip"]]["id"], "trimStartS": r["start"], "trimEndS": r["end"]}
                     for j, r in enumerate(jump_ranges)]

    # The edit's effects: kept from the version being edited, or the inspo's. Then whatever the
    # user asked for (their additional requests on a fresh video, or a change request).
    given = clean_effects(req.get("effects") or ((previous or {}).get("plan") or {}).get("effects"), n)
    effects = given or effects_from(inspo_style, n, jump)
    effects_note = ""
    words = request or ("" if given else notes)
    if words.strip():  # Claude reads every request; it changes nothing when none of it is about effects
        report("analyzing", 6)
        try:
            effects, effects_note, effects_cost = plan_effects(words, effects, shots)
            cost += effects_cost
        except Exception as e:  # noqa: BLE001
            print(f"effects planning failed: {type(e).__name__}: {e}")

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
                             one_take=jump, caption_text=str(previous["plan"].get("captionText") or ""),
                             caption_fixes=caption_fixes)
        cost += result["cost_usd"]
        data = result["data"]
        caption_fixes = clean_caption_fixes(caption_fixes, data.get("caption_fixes"))
        by_index = {s["index"]: s for s in data["shots"]}
        new_lengths = [s["durationS"] for s in shots]
        for i in range(n):
            r = by_index.get(i + 1)
            if not r:
                continue
            if not jump and isinstance(r.get("clip"), int) and 0 < r["clip"] <= len(clips):
                ci = r["clip"] - 1
                if ci != current[i]["clip"] or abs(float(r["start_s"]) - current[i]["start"]) > 0.05:
                    fixed[i] = {"clip": ci, "start": max(0.0, float(r["start_s"])), "end": None}
            length = r.get("length_s")
            if not jump and isinstance(length, (int, float)) and abs(length - shots[i]["durationS"]) > 0.05:
                # The user asked for a longer or shorter shot: more (or less) of the same moment.
                new_lengths[i] = min(MAX_SHOT_S, max(MIN_SHOT_S, float(length)))
                f = fixed[i]
                ci = f["clip"] if f["clip"] is not None else current[i]["clip"]
                start = f["start"] if f["clip"] is not None and f["start"] is not None else current[i]["start"]
                d = clips[ci]["duration"]
                if start + new_lengths[i] > d:
                    start = max(0.0, d - new_lengths[i])  # start earlier rather than run out of clip
                fixed[i] = {"clip": ci, "start": start, "end": None}
        if new_lengths != [s["durationS"] for s in shots]:
            print(f"revise: shot lengths {[r2(s['durationS']) for s in shots]} -> {[r2(x) for x in new_lengths]}")
            shots = with_lengths(shots, new_lengths)
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
    cuts = transition_plan(durations, effects["transitions"])
    motions = effects["motions"]
    color = effects["colorFilter"]

    # ---- editing: cut every shot (with the inspo's motion and color), join them with its transitions
    report("editing", 45)
    seg_paths = [workdir / f"shot{i:02d}.mkv" for i in range(len(plan))]
    done = 0

    def cut(i: int) -> None:
        nonlocal done
        p = plan[i]
        t_in = cuts[i - 1] if i > 0 else None
        t_out = cuts[i] if i < len(cuts) else None
        tail = t_out["d"] if t_out and t_out["xfade"] else 0.0
        cut_shot(clips[p["clip"]], p["start"], p["take"], p["duration"], seg_paths[i], tail, motions[i], color,
                 t_in, t_out, SPEED_RATES.get(effects["speeds"][i], 1.0), effects["shotEffects"][i])
        done += 1
        report("editing", 45 + int(28 * done / len(plan)))

    with ThreadPoolExecutor(3) as pool:
        list(pool.map(cut, range(len(plan))))

    joined = workdir / "joined.mkv"
    join_shots(seg_paths, durations, cuts, workdir, joined)
    total = sum(durations)

    use_inspo_audio = music == "inspo" and probe(inspo_path)["has_audio"]
    use_own_audio = music == "upload" and own_audio.exists() and own_audio.stat().st_size > 0
    words: list[dict] = []
    if caption_style:
        report("editing", 76)
        if use_inspo_audio:
            # What you hear is the inspo's audio, so caption that.
            segments = (breakdown.get("transcript") or {}).get("segments") or []
        elif use_own_audio:
            # A voiceover gets captioned; a song without words simply has none.
            segments = transcribe(own_audio, speech_hint)["segments"]
        else:
            segments = transcribe(joined, speech_hint)["segments"]
        for seg in segments:
            words += [w for w in seg.get("words") or [] if w.get("w") and w["e"] <= total + 0.5]
        words = proofread_words(words, speech_hint)
        words = apply_caption_fixes(words, caption_fixes)

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
    inputs = ["-i", joined.name]
    if music == "none":
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        main = "[1:a]anull[m]"
    elif use_inspo_audio:
        # Same timing as the inspo, so its audio lines up from the first frame.
        inputs += ["-i", inspo_path.name]
        main = "[1:a]aresample=48000,apad[m]"
    elif use_own_audio:
        # Plays from the start; cut at the video's end, or silence after it if it's shorter.
        inputs += ["-i", own_audio.name]
        main = "[1:a]aresample=48000,apad[m]"
    else:
        # The clips' own audio ("original", and anything unknown).
        main = "[0:a]anull[m]"
    # Sound effects: the inspo's are already in its own audio, so only add the ones asked for then.
    sounds = sfx_times([e for e in effects["sfx"] if not (use_inspo_audio and e.get("source") == "inspo")],
                       starts, durations, total)
    graph = [main]
    first_sfx = 1 if main.startswith("[0:a]") else 2  # input number of the first sound effect
    for k, (t, name, vol) in enumerate(sounds):
        inputs += ["-i", str(sfx_file(name, workdir))]
        ms = round(max(0.0, t) * 1000)
        head = f"atrim=start={-t:.3f},asetpts=PTS-STARTPTS," if t < 0 else ""
        graph.append(f"[{first_sfx + k}:a]{head}aresample=48000,aformat=channel_layouts=stereo,"
                     f"volume={vol * SFX_GAIN:.2f},adelay={ms}|{ms}[x{k}]")
    graph.append("[m]" + "".join(f"[x{k}]" for k in range(len(sounds)))
                 + (f"amix=inputs={len(sounds) + 1}:normalize=0:duration=first[aout]" if sounds else "anull[aout]"))
    graph += fire_overlays(cuts, starts, inputs)
    graph += look_graph(effects["looks"], "fired", "looked")
    if ass:
        (workdir / "text.ass").write_text(ass, encoding="utf-8")
    graph.append("[looked]" + ("ass=text.ass," if ass else "") + "format=yuv420p[vout]")
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "[aout]",
           "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
           "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", out.name]
    result = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"final encode failed: {result.stderr[-800:]}")
    # Watch for frozen picture (there should never be any): logged so it can be fixed at the source.
    frozen = subprocess.run(["ffmpeg", "-v", "info", "-i", out.name, "-map", "0:v", "-vf",
                             "freezedetect=n=0.0005:d=0.4", "-f", "null", "-"], cwd=workdir, capture_output=True, text=True)
    spans = [ln.split("] ")[-1] for ln in frozen.stderr.splitlines() if "freeze_start" in ln or "freeze_duration" in ln]
    if spans:
        print(f"WARNING frozen picture in the finished video: {spans[:10]}")

    # ---- finishing
    report("finishing", 92)
    store(out, req["outputKey"])
    report("finishing", 99)

    seconds = round(time.time() - started, 1)
    print(f"render done: {len(plan)} shots, {total:.1f}s, claude={needs_claude}, ${round(cost, 4)}, {seconds}s, "
          f"faces={sum(map(len, faces))}, transitions={sum(1 for c in cuts if c)}, motions={sum(m != 'none' for m in motions)}, "
          f"color={color}, font={style['font']}, animation={style['animation']}, "
          f"cuts={[c['name'] if c else 'cut' for c in cuts]}, speeds={effects['speeds']}, effects={effects['shotEffects']}, "
          f"looks={effects['looks']}, sfx={[(t, nm) for t, nm, _ in sounds]}")
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
            "note": " ".join(x for x in (note, effects_note if request else "") if x) or None,
            "effects": effects,
            **({"captionFixes": caption_fixes} if caption_fixes else {}),
            **({"captionText": " ".join(w["w"] for w in words)[:5000]} if words else {}),
            **({"shotLengths": [r2(s["durationS"]) for s in shots]}
               if not jump and req.get("inspo", {}).get("storageKey") and len(shots) == len(inspo_lengths)
               and any(abs(s["durationS"] - L) > 0.05 for s, L in zip(shots, inspo_lengths)) else {}),
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
    scratch = isinstance(req.get("scratch"), dict)
    keys = ([] if scratch else [(req.get("inspo") or {}).get("storageKey")]) + [c.get("storageKey") for c in req.get("clips") or []]
    if isinstance(req.get("audio"), dict):
        keys.append(req["audio"].get("storageKey"))
    if isinstance(req.get("previous"), dict) and (req.get("request") or scratch):
        keys.append(req["previous"].get("storageKey"))
        if not isinstance(req["previous"].get("plan"), dict):
            return "invalid previous version"
    if not req.get("clips") or any(not isinstance(k, str) or ".." in k or not k.startswith(prefix) for k in keys):
        return "invalid storage keys"
    if scratch:
        if not isinstance(req["scratch"].get("prompt"), str) or not req["scratch"]["prompt"].strip():
            return "missing prompt"
        if not isinstance(req.get("shots"), list):
            return "invalid shots"
    else:
        shots = ((req.get("inspo") or {}).get("breakdown") or {}).get("shots")
        if not isinstance(shots, list) or not shots or not isinstance(req.get("shots"), list):
            return "invalid shots"
    if not isinstance(req.get("options"), dict):
        return "invalid options"
    return None


# ---------------------------------------------------------------- jobs

job_resources = dict(image=image, secrets=secrets, cpu=4, memory=4096)


@app.function(**job_resources, timeout=900)
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


# The website's "a render finished" endpoint. Only these hosts ever get the
# worker token, whatever a request asks for.
NOTIFY_HOSTS = {"www.viralowner.com", "viralowner.com", "viralowner.vercel.app"}
NOTIFY_PATH = "/api/worker/render-done"


def notify_target(req: dict) -> tuple[str, dict] | None:
    from urllib.parse import urlparse

    n = req.get("notify")
    if not isinstance(n, dict) or not isinstance(n.get("url"), str):
        return None
    u = urlparse(n["url"])
    if u.scheme != "https" or u.hostname not in NOTIFY_HOSTS or u.path != NOTIFY_PATH:
        return None
    payload = {"projectId": str(n.get("projectId", "")), "renderId": str(n.get("renderId", ""))}
    return n["url"], payload


@app.function(image=image, secrets=secrets, timeout=120)
def notify_job(url: str, payload: dict) -> None:
    """Tells the website a render finished (so it can email the user). Runs a
    few seconds after the render returns, so its result is ready to read."""
    import json as _json
    import urllib.request

    time.sleep(4)
    for attempt in range(3):
        try:
            r = urllib.request.Request(
                url,
                data=_json.dumps(payload).encode(),
                headers={"content-type": "application/json", "authorization": f"Bearer {os.environ['WORKER_TOKEN']}"},
                method="POST",
            )
            urllib.request.urlopen(r, timeout=40).read()
            return
        except Exception as e:  # noqa: BLE001
            print(f"notify failed ({attempt + 1}/3): {e}")
            time.sleep(5 * (attempt + 1))


@app.function(image=image, secrets=secrets, cpu=8, memory=8192, timeout=900)
def render_job(req: dict) -> dict:
    """Makes one version of the user's video (see render_video)."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            if isinstance(req.get("scratch"), dict):
                return render_scratch(req, Path(tmp))
            return render_video(req, Path(tmp))
    except JobError:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"render failed: {type(e).__name__}: {e}")
        raise
    finally:
        target = notify_target(req)
        if target:
            try:
                notify_job.spawn(*target)
            except Exception as e:  # noqa: BLE001
                print(f"couldn't schedule notify: {e}")


@app.function(**job_resources, timeout=900)
def render_upload(req: dict, files: dict[str, bytes]) -> tuple[dict, bytes]:
    """For testing from a laptop: renders files sent directly (keys map to bytes; skips storage)."""
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        result: dict = {}

        def store(path: Path, key: str) -> None:
            result["video"] = path.read_bytes()

        render = render_scratch if isinstance(req.get("scratch"), dict) else render_video
        out = render(req, workdir, fetch=lambda key, dest: dest.write_bytes(files[key]), store=store)
        return out, result["video"]


@app.local_entrypoint()
def try_render(inspo: str, clips: str, dest: str, captions: str = "bold-pop", text: str = "match", custom: str = "",
               notes: str = "", music: str = "original", request: str = "", audio: str = "", transitions: str = "",
               sfx: str = "", speeds: str = "", effects: str = "", looks: str = "", breakdown_json: str = ""):
    """modal run worker/app.py::try_render --inspo a.mp4 --clips b.mp4,c.mp4 --dest out.mp4
    With --request, also makes a second version with that change (saved as <dest>-changed.mp4).
    To test the edit, override the inspo's: --transitions whip_left,zoom_in (cycled over the cuts),
    --sfx whoosh@1,pop@s2 (at cut 1, in shot 2), --speeds normal,slow_motion, --effects ,zoom_pulse, --looks grain.
    --breakdown-json reuses a saved analysis instead of analyzing the inspo again."""
    files = {"u/test/p/test/inspo": Path(inspo).read_bytes()}
    if breakdown_json and Path(breakdown_json).exists():
        breakdown = json.loads(Path(breakdown_json).read_text())
    else:
        breakdown = analyze_upload.remote(files["u/test/p/test/inspo"])
        if breakdown_json:
            Path(breakdown_json).write_text(json.dumps(breakdown))
    n = len(breakdown["shots"])
    st = breakdown.setdefault("style", default_inspo_style(n))
    st["version"] = STYLE_VERSION
    cyc = lambda v, k: [v.split(",")[i % len(v.split(","))] for i in range(k)]  # noqa: E731
    if transitions:
        st["transitions"] = cyc(transitions, n - 1)
    if speeds:
        st["speeds"] = cyc(speeds, n)
    if effects:
        st["shotEffects"] = [[x] if x else [] for x in cyc(effects, n)]
    if looks:
        st["looks"] = looks.split(",")
    if sfx:
        st["sfx"] = []
        for item in sfx.split(","):
            name, at = item.split("@")
            shot = at.startswith("s")
            st["sfx"].append({"anchor": "shot" if shot else "cut", "index": int(at.lstrip("s")) - 1, "name": name,
                              **({"frac": 0.1} if shot else {"offset": -1.2 if name == "riser" else -0.05}),
                              "volume": 0.9, "source": "request"})
    clip_list = []
    for i, c in enumerate(clips.split(",")):
        files[f"u/test/p/test/clip{i}"] = Path(c).read_bytes()
        clip_list.append({"id": f"clip{i}", "storageKey": f"u/test/p/test/clip{i}"})
    if audio:
        files["u/test/p/test/audio"] = Path(audio).read_bytes()
        music = "upload"
    req = {
        "audio": {"storageKey": "u/test/p/test/audio"} if audio else None,
        "outputKey": "u/test/p/test/renders/out.mp4",
        "inspo": {"storageKey": "u/test/p/test/inspo", "breakdown": breakdown},
        "clips": clip_list,
        "shots": [{"shotIndex": s["index"], "clipId": None, "trimStartS": None, "trimEndS": None} for s in breakdown["shots"]],
        "options": {"text": {"mode": text, "custom": custom}, "music": {"mode": music},
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


@app.local_entrypoint()
def try_scratch(clips: str, dest: str, prompt: str, text: str = "adapt", custom: str = "", music: str = "original",
                audio: str = "", captions: str = "bold-pop", request: str = ""):
    """modal run worker/app.py::try_scratch --clips a.mp4,b.mp4 --dest out.mp4 --prompt "..."
    A "start from scratch" video. With --request, also makes a changed version (<dest>-changed.mp4)."""
    files: dict[str, bytes] = {}
    clip_list = []
    for i, c in enumerate(clips.split(",")):
        files[f"u/test/p/test/clip{i}"] = Path(c).read_bytes()
        clip_list.append({"id": f"clip{i}", "storageKey": f"u/test/p/test/clip{i}"})
    if audio:
        files["u/test/p/test/audio"] = Path(audio).read_bytes()
        music = "upload"
    req = {
        "outputKey": "u/test/p/test/renders/out.mp4",
        "clips": clip_list, "shots": [],
        "audio": {"storageKey": "u/test/p/test/audio"} if audio else None,
        "options": {"text": {"mode": text, "custom": custom, "align": "inspo"}, "music": {"mode": music},
                    "captions": {"enabled": captions != "off", "style": captions if captions != "off" else "bold-pop"},
                    "notes": ""},
        "scratch": {"prompt": prompt},
    }
    out, video = render_upload.remote(req, files)
    Path(dest).write_bytes(video)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    if request:
        files[req["outputKey"]] = video
        req2 = {**req, "request": request, "shots": out["plan"]["shots"],
                "previous": {"storageKey": req["outputKey"], "plan": out["plan"], "postCopy": out["postCopy"],
                             "textChanged": False}}
        out2, video2 = render_upload.remote(req2, files)
        Path(dest.removesuffix(".mp4") + "-changed.mp4").write_bytes(video2)
        print(json.dumps(out2, indent=2, ensure_ascii=False))


@app.function(**job_resources, timeout=600)
def detect_debug(video: bytes) -> dict:
    """For tuning: the cuts found, and what the sound model hears."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "v.mp4"
        path.write_bytes(video)
        duration = probe(path)["duration"]
        shots = [{"startS": a, "durationS": b - a} for a, b in detect_shots(path, duration)]
        cuts = [x["startS"] for x in shots[1:]]
        heard = listen(path, cuts, shots)
        rows = [f"cut {c:6.2f}: {describe_heard(h)}" for c, h in zip(cuts, heard["cuts"])]
        rows += [f"during shot {d['shot'] + 1} at {d['t']:.2f}: {d['heard']} (strength {d['strength']})" for d in heard["during"]]
        return {"cuts": [round(c, 2) for c in cuts], "rows": rows}


@app.local_entrypoint()
def try_detect(path: str):
    out = detect_debug.remote(Path(path).read_bytes())
    print("cuts:", out["cuts"])
    print("\n".join(out["rows"]))


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


CLIP_KEY_RE = r"^u/[A-Za-z0-9_-]+/p/[A-Za-z0-9_-]+/clips/[A-Za-z0-9_-]+\.(mp4|mov|m4v|webm)$"


@app.function(image=image, secrets=secrets, timeout=120)
def thumb_job(key: str) -> dict:
    """A clip's still (<key>.jpg), for when the browser couldn't make one. ffmpeg reads the clip
    straight from storage, only the parts it needs (no full download)."""
    with tempfile.TemporaryDirectory() as tmp:
        url = r2_client().generate_presigned_url(
            "get_object", Params={"Bucket": os.environ["R2_BUCKET"], "Key": key}, ExpiresIn=600)
        info = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                               "stream=color_transfer:format=duration", "-of", "json", url]))
        hdr = (info.get("streams") or [{}])[0].get("color_transfer") in ("arib-std-b67", "smpte2084")
        t = min(0.5, float(info.get("format", {}).get("duration") or 1) / 3)
        out = Path(tmp) / "thumb.jpg"
        vf = ",".join([*([tonemap_filter()] if hdr else []),
                       "scale=360:640:force_original_aspect_ratio=increase", "crop=360:640"])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", url, "-frames:v", "1", "-vf", vf,
                        "-q:v", "4", str(out)], check=True, capture_output=True)
        r2_client().upload_file(str(out), os.environ["R2_BUCKET"], f"{key}.jpg", ExtraArgs={"ContentType": "image/jpeg"})
    return {"ok": True}


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

    @web.post("/jobs/thumb", dependencies=[Depends(require_token)])
    def start_thumb(storage_key: str = Body(embed=True, alias="storageKey")) -> dict:
        import re

        if not re.match(CLIP_KEY_RE, storage_key) or ".." in storage_key:
            raise HTTPException(status_code=400, detail="invalid storage key")
        return started(thumb_job.spawn(storage_key))

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
