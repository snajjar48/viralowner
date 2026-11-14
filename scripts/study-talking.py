"""Study a folder of viral talking-head ("yapping") videos: measure each one, have the editor's model break
down how it holds attention while someone talks to the camera (and note any content-creation advice the
speaker gives), then write one talking-head playbook and a summary of that advice.

    modal run scripts/study-talking.py --folder ~/Downloads/"talking head:yapping" --out <dir>

Saves talking-playbook.md, creator-advice.md, each study and the measurements to --out. Review them, then
copy the playbook to worker/assets/playbook/talking-playbook.md. A rerun only studies videos not studied yet."""
import json
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import app as w  # noqa: E402

stub = modal.App("viralowner-study-talking")
img = w.image.add_local_file(str(Path(__file__).resolve().parent.parent / "worker" / "app.py"), "/root/app_live.py")


def live():
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_live", "/root/app_live.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STUDY_SYSTEM = """You are a top short-form video editor who specializes in talking-head videos: one person talking to the camera (advice, stories, hot takes, explainers, "yapping"). You study why these go viral on TikTok, Instagram Reels and YouTube Shorts, so an automatic editor can cut a business owner's or creator's own talking footage to hold attention just as well.

You get one viral talking-head video: frames sampled through it (each labelled with its time, with extra frames in the first 3 seconds), a frame just before and just after every cut, every cut time, a motion graph (how much the picture changes every half second), the video's technical quality, everything said with word timings, the gaps between words, and the strongest hits in the audio. Break down exactly what the creator and editor did, with real times and numbers from what you're given. Be specific to this video, then turn it into lessons an editor can apply to other people's talking footage. Never guess numbers you weren't given; read them from the timings.

Zooms and punch-ins: a punch-in is a cut (or a quick zoom) to a tighter frame of the same shot; compare the frames before and after each cut. Say how tight, how often, and what words they land on.

Also listen to what the speaker says: many of these videos give advice about making content (hooks, editing, posting, growth, filming, scripting). Record that advice faithfully in creator_advice, as close to their words as possible. Leave it empty when the video gives none.

Ignore everything the platform added: the TikTok or Instagram logo and @username watermark that floats on the video, and any app UI. They aren't part of the edit, so never describe them as on-screen text, graphics or overlays. Any end screen has already been cut off."""

STUDY_SCHEMA = {
    "type": "object",
    "properties": {
        "format": {"type": "string", "description": "the kind of talking video (advice / tips, storytime, hot take or opinion, explainer, reaction or green screen, podcast clip, business/day-in-the-life talk, listicle)."},
        "topic": {"type": "string", "description": "what it's about, in one sentence."},
        "hook": {"type": "string", "description": "the exact first words (quoted) and when they start, how fast they're said, what's on screen in the first 2 seconds (framing, any opening text and its words), and why it stops the scroll."},
        "beats": {"type": "array", "description": "the structure, in order.", "items": {
            "type": "object",
            "properties": {"t": {"type": "number", "description": "start time, seconds."},
                           "kind": {"type": "string", "enum": ["hook", "context", "point", "example", "story", "turn", "payoff", "cta", "loop", "other"]},
                           "what": {"type": "string"}},
            "required": ["t", "kind", "what"], "additionalProperties": False}},
        "jump_cuts": {"type": "string", "description": "how much dead air, breaths, 'um's, false starts and repeats were cut (use the word gaps: typical and longest gap between words, gaps left in on purpose), cuts per 10 seconds, whether cuts land mid-sentence or between thoughts, and how tight it feels."},
        "zooms_punch_ins": {"type": "string", "description": "every zoom or punch-in: when, how tight (e.g. ~1.15x, ~1.4x), on which words or beats, how they alternate (wide/tight), and how often the visual changes overall (seconds between any visual change)."},
        "captions": {"type": "string", "description": "speech captions: words on screen at once, word-by-word or phrase timing, highlighted or colored words (which kind of words), font weight, case, color, stroke/shadow/box, size, position (% of frame height), animation. 'none' if there are none."},
        "on_screen_text": {"type": "string", "description": "text that isn't speech captions (the hook title, headers, numbered points, labels, keywords): the words, font and style, color, background, position, animation in and out (pop, slide, typewriter, scale bounce), when it appears and how long it stays. 'none' if there is none."},
        "graphics_overlays": {"type": "string", "description": "graphics and overlays: emojis, stickers, icons, images or screenshots, arrows, progress bars, highlight boxes, green screen backgrounds, split screens, frames or borders: what, where, when, how they animate. 'none' if there are none."},
        "transitions": {"type": "string", "description": "how shots change: hard cuts, jump cuts, zoom cuts, whips, swipes, flashes, glitches: which and where. 'hard cuts only' if that's all."},
        "broll_and_interrupts": {"type": "string", "description": "pattern interrupts: b-roll or cutaways (what, how long, how often), text pop-ups, sound effects (which and on what), angle or location changes, props: when each lands and how far apart they are."},
        "audio": {"type": "string", "description": "the voice (clean, close, room sound), music under it (genre, volume, does it change), sound effects, silence used for effect."},
        "length_and_ending": {"type": "string", "description": "how long it is, how the point builds, where the payoff lands (seconds and %), and how it ends: payoff, CTA (what words), loop back into the start, or cliffhanger; how long after the last word it cuts."},
        "quality": {"type": "string", "description": "framing (headroom, eye line, distance), lighting, background, mic sound, sharpness, resolution and frame rate (from what's given), and what makes it feel high-effort or casual on purpose."},
        "why_viral": {"type": "string", "description": "the 2-4 biggest reasons people watch to the end and share it."},
        "lessons": {"type": "array", "items": {"type": "string"}, "description": "4-10 concrete rules an editor can apply to other people's talking footage, with numbers where they matter."},
        "creator_advice": {"type": "array", "items": {"type": "string"}, "description": "advice the speaker gives about making content (hooks, scripting, filming, editing, posting, growth, business), as close to their words as possible. Empty if none."},
    },
    "required": ["format", "topic", "hook", "beats", "jump_cuts", "zooms_punch_ins", "captions", "on_screen_text",
                 "graphics_overlays", "transitions", "broll_and_interrupts", "audio", "length_and_ending", "quality",
                 "why_viral", "lessons", "creator_advice"],
    "additionalProperties": False,
}

FILLERS = {"um", "uh", "erm", "uhm", "hmm", "mm"}


def video_quality(path: Path) -> dict:
    """Resolution, frame rate, bitrate and codec of the video stream."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate,avg_frame_rate,bit_rate,codec_name:format=bit_rate",
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    info = json.loads(out or "{}")
    s = (info.get("streams") or [{}])[0]
    def rate(r: str) -> float | None:
        try:
            a, b = r.split("/")
            return round(float(a) / float(b), 2) if float(b) else None
        except (ValueError, AttributeError):
            return None
    bitrate = s.get("bit_rate") or (info.get("format") or {}).get("bit_rate")
    return {"width": s.get("width"), "height": s.get("height"), "fps": rate(s.get("avg_frame_rate") or s.get("r_frame_rate")),
            "video_kbps": round(int(bitrate) / 1000) if bitrate and str(bitrate).isdigit() else None,
            "codec": s.get("codec_name")}


def motion_graph(path: Path, duration: float, step: float = 0.5) -> list[float]:
    """How much the picture changes, averaged every `step` seconds (0-100). Low and smooth inside a
    shot often means slow motion; a sudden jump inside one shot, a speed ramp."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    buckets: dict[int, list[float]] = {}
    prev = None
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = i / fps
        i += 1
        if t > duration:
            break
        small = cv2.cvtColor(cv2.resize(frame, (64, 112)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        if prev is not None:
            buckets.setdefault(int(t / step), []).append(float(np.mean(np.abs(small - prev))))
        prev = small
    cap.release()
    return [round(min(100.0, statistics.mean(buckets[k]) * 2), 1) for k in sorted(buckets)]


@stub.function(image=img, secrets=w.secrets, timeout=1800, cpu=4, memory=8192, max_containers=8)
def study(name: str, data: bytes) -> dict:
    m = live()
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        path = d / ("v" + Path(name).suffix.lower())
        path.write_bytes(data)
        info = m.probe(path)
        full = float(info["duration"])
        quality = video_quality(path)
        # The platform's end screen (logo + @handle) isn't part of the video: cut it off first.
        dur = m.drop_end_screen(path, full, d)
        info = m.probe(path)
        shots = m.detect_shots(path, dur)
        cuts = [round(a, 2) for a, _ in shots[1:]]
        lengths = [round(b - a, 2) for a, b in shots]
        motion = motion_graph(path, dur)
        segs = m.transcribe(path)["segments"] if info.get("has_audio") else []
        words = [x for s in segs for x in s.get("words") or []]
        gaps = [round(b["s"] - a["e"], 2) for a, b in zip(words, words[1:])]
        pauses = [(round(a["e"], 2), g) for a, g in zip(words, gaps) if g >= 0.3]
        span = (words[-1]["e"] - words[0]["s"]) if words else 0
        fillers = sum(1 for x in words if re.sub(r"[^a-z]", "", x["w"].lower()) in FILLERS)
        hits = []
        if info.get("has_audio"):
            try:
                hits = sorted(round(t, 2) for t, _ in m.onsets(m.load_audio(path), limit=30))
            except Exception as e:  # noqa: BLE001
                print(f"{name}: onsets failed: {e}")
        stats = {
            "duration_s": round(dur, 2), "shots": len(shots), "cuts_per_10s": round(len(cuts) / dur * 10, 2) if dur else 0,
            "median_shot_s": round(statistics.median(lengths), 2) if lengths else None,
            "longest_shot_s": max(lengths) if lengths else None,
            "words": len(words), "words_per_s": round(len(words) / span, 2) if span else 0,
            "first_word_s": round(words[0]["s"], 2) if words else None,
            "speech_share": round(span / dur, 2) if dur and span else 0,
            "median_gap_s": round(statistics.median(gaps), 2) if gaps else None,
            "gaps_over_0_3s": len(pauses), "longest_gap_s": max(gaps) if gaps else None,
            "fillers": fillers, "after_last_word_s": round(dur - words[-1]["e"], 2) if words else None,
            "median_motion": round(statistics.median(motion), 1) if motion else None,
            **{f"quality_{k}": v for k, v in quality.items()},
        }
        n = min(56, max(20, int(dur / 1.1)))
        times = sorted({round(t, 2) for t in [0.15, 0.6, 1.2, 2.0, 2.8] + [dur * (k + 0.5) / n for k in range(n)] if t < dur})
        content: list[dict] = [{"type": "text", "text": (
            f"video: {dur:.1f}s, {len(shots)} shots. cuts at: {', '.join(map(str, cuts)) or 'none'}\n"
            f"shot lengths: {', '.join(map(str, lengths))}\n"
            f"quality: {json.dumps(quality)}\n"
            f"motion every 0.5s (0-100, starting at 0s): {', '.join(map(str, motion)) or 'unavailable'}\n"
            f"measured: {json.dumps(stats)}\n"
            f"strongest audio hits at: {', '.join(map(str, hits)) or 'none'}\n"
            "gaps of 0.3s or more between words (after the word ending at, length): "
            + (", ".join(f"{t}s:{g}s" for t, g in pauses) or "none") + "\n"
            "everything said (start-end, then each word@time):\n"
            + ("\n".join(f"[{s['startS']:.2f}-{s['endS']:.2f}] {s['text']}\n  "
                         + " ".join(f"{x['w']}@{x['s']:.2f}" for x in s.get('words') or []) for s in segs)
               or "(no speech)")
        )}]
        for k, t in enumerate(times):
            f = m.grab_frame(path, t, d / f"f{k:02d}.jpg", 360)
            if f:
                content.append({"type": "text", "text": f"frame at {t:.2f}s"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": m.b64(f)}})
        # Just before and after each cut, to see punch-ins and transitions (first 16 cuts).
        for k, c in enumerate(cuts[:16]):
            pair = [m.grab_frame(path, max(0.0, c - 0.12), d / f"c{k:02d}a.jpg", 240),
                    m.grab_frame(path, min(dur - 0.05, c + 0.12), d / f"c{k:02d}b.jpg", 240)]
            if all(pair):
                content.append({"type": "text", "text": f"cut at {c}s: just before, then just after"})
                for f in pair:
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": m.b64(f)}})
        content.append({"type": "text", "text": "break this video down."})
        result = m.ask_claude(STUDY_SYSTEM, content, STUDY_SCHEMA, "study failed", effort="high")
        print(f"{name}: {dur:.1f}s ${result['cost_usd']}")
        stats["end_screen_cut_s"] = round(full - dur, 2)
        out = {"name": name, "stats": stats, "study": result["data"], "cost": result["cost_usd"]}
        return json.loads(json.dumps(out, default=float))  # plain numbers (Whisper's are numpy's)


PLAYBOOK_SYSTEM = """You write the talking-head playbook an automatic short-form video editor follows, so that when a business owner or creator uploads themselves talking to the camera, the edit holds attention and goes viral. You get detailed breakdowns of real viral talking-head videos, plus measurements across all of them.

Find what they have in common and what separates the best from the rest, and write it as rules the editor can apply to someone's own talking footage when it trims, cuts, zooms, writes and animates text, captions, adds graphics and overlays, picks transitions and pattern interrupts, sets the length and decides the ending. Cover, with the measured numbers (medians and ranges):
- the hook: the first words, how fast speech starts, and opening on-screen text
- jump cuts: how much dead air, breaths, fillers and false starts to cut, and how tight
- zooms and punch-ins: when, how tight, and how often the visual should change
- captions: words at once, timing, highlighted words, size, position and style
- on-screen text styles and animations
- graphics, overlays and transitions
- b-roll, text pop-ups and sound effects as pattern interrupts: what and how often
- audio: voice, music under it, sound effects
- length, structure and ending (payoff, CTA, loop)
Add a short list of the most common mistakes that kill a talking-head video. Platform logos, @username watermarks and end screens were already left out; never make rules about them. No filler and no generic advice any guide would give; every rule should come from these videos. Write it in markdown, under 1300 words.

Separately, write `advice`: everything the speakers themselves advise about making content (hooks, scripting, filming, editing, posting, growth, business), grouped by theme. Say how many videos gave each piece of advice and quote the best lines. Then add a short section, "How an automatic editor can apply this": concrete ways a service that edits people's own clips into viral videos could build each piece of advice into its edits, its suggestions to users or its product. Markdown, under 1000 words."""


@stub.function(image=img, secrets=w.secrets, timeout=1800)
def playbook(studies: list[dict], summary: dict) -> dict:
    m = live()
    content = [{"type": "text", "text": "measurements across all videos:\n" + json.dumps(summary, indent=1)}]
    for s in studies:
        content.append({"type": "text", "text": f"\n### {s['name']}\nmeasured: {json.dumps(s['stats'])}\n"
                                                 + json.dumps(s["study"], ensure_ascii=False)})
    schema = {"type": "object", "properties": {"playbook": {"type": "string"}, "advice": {"type": "string"}},
              "required": ["playbook", "advice"], "additionalProperties": False}
    result = m.ask_claude(PLAYBOOK_SYSTEM, content, schema, "playbook failed", effort="xhigh")
    return {**result["data"], "cost": result["cost_usd"]}


@stub.local_entrypoint()
def main(folder: str, out: str):
    files = sorted(p for p in Path(folder).expanduser().iterdir() if p.suffix.lower() in (".mp4", ".mov"))
    print(f"{len(files)} videos")
    outdir = Path(out)
    outdir.mkdir(parents=True, exist_ok=True)
    # Each study is saved as it arrives, so a rerun only studies what's missing.
    each = outdir / "each"
    each.mkdir(exist_ok=True)
    todo = [p for p in files if not (each / f"{p.name}.json").exists()]
    print(f"{len(todo)} to study")
    for r in study.starmap(((p.name, p.read_bytes()) for p in todo), return_exceptions=True):
        if isinstance(r, Exception):
            print(f"failed: {r}")
            continue
        (each / f"{r['name']}.json").write_text(json.dumps(r, ensure_ascii=False))
    done = [json.loads((each / f"{p.name}.json").read_text()) for p in files if (each / f"{p.name}.json").exists()]
    if len(done) < len(files):
        print(f"only {len(done)} of {len(files)} studied: not writing the playbook yet. run it again.")
        return
    (outdir / "studies.json").write_text(json.dumps(done, indent=1, ensure_ascii=False))
    keys = ["duration_s", "shots", "cuts_per_10s", "median_shot_s", "longest_shot_s", "words_per_s", "first_word_s",
            "speech_share", "median_gap_s", "gaps_over_0_3s", "longest_gap_s", "fillers", "after_last_word_s",
            "median_motion", "quality_fps", "quality_video_kbps", "quality_height"]
    summary = {"videos": len(done)}
    for k in keys:
        vals = sorted(v for r in done if isinstance(v := r["stats"].get(k), (int, float)))
        if vals:
            summary[k] = {"median": round(statistics.median(vals), 2), "p25": vals[len(vals) // 4],
                          "p75": vals[(3 * len(vals)) // 4], "min": vals[0], "max": vals[-1]}
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1))
    pb = playbook.remote(done, summary)
    (outdir / "talking-playbook.md").write_text(pb["playbook"])
    (outdir / "creator-advice.md").write_text(pb["advice"])
    print(f"studied {len(done)}; cost ${round(sum(r['cost'] for r in done) + pb['cost'], 2)}")
