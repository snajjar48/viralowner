"""Study a folder of viral food & drink videos: measure each one, have the editor's model break down
how it makes the food look irresistible, then write one food & drink playbook from all of them.

    modal run scripts/study-food.py --folder ~/Downloads/"food videos" --out <dir>

Saves food-playbook.md, each study and the measurements to --out. Review the playbook, then copy it
to worker/assets/playbook/food-playbook.md. A rerun only studies videos not studied yet."""
import json
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import app as w  # noqa: E402

stub = modal.App("viralowner-study-food")
img = w.image.add_local_file(str(Path(__file__).resolve().parent.parent / "worker" / "app.py"), "/root/app_live.py")


def live():
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_live", "/root/app_live.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STUDY_SYSTEM = """You are a top short-form food & drink video editor and food stylist. You study why food and drink videos on TikTok and Instagram Reels go viral, so an automatic editor can make a restaurant's, café's or drink shop's own footage look just as irresistible.

You get one viral food or drink video: frames sampled through it (each labelled with its time), a frame just before and just after every cut, every cut time, a motion graph (how much the picture changes every half second, to spot slow motion, speed ramps and still holds), the video's technical quality, what's said with word timings, and the strongest hits in the audio. Break down exactly what the creator and editor did to make the food look delicious, with real times and numbers from what you're given. Be specific to this video, then turn it into lessons an editor can apply to other businesses' footage. Never guess numbers you weren't given; read them from the timings.

Speed: real slow motion shows smooth, low motion with liquids and food moving slowly (pours, drips, cheese pulls); a speed ramp is a sudden change of motion within one shot; a timelapse shows fast, jumpy change. Say which you see and where, and how sure you are.

Ignore everything the platform added: the TikTok or Instagram logo and @username watermark that floats on the video, and any app UI. They aren't part of the edit, so never describe them as on-screen text or count them as a choice the creator made. Any end screen has already been cut off."""

STUDY_SCHEMA = {
    "type": "object",
    "properties": {
        "format": {"type": "string", "description": "the kind of food video (e.g. making-of / process, pour or drink build, ASMR, restaurant or menu reveal, POV ordering, taste test or reaction, recipe, product showcase, mukbang)."},
        "item": {"type": "string", "description": "what food or drink it shows, and what makes it visually special (color, layers, texture, steam, size)."},
        "hook": {"type": "string", "description": "exactly what's on screen and heard in the first 0-2 seconds (first frame, first sound, any text) and why it stops the scroll."},
        "beats": {"type": "array", "description": "the video's beats in order.", "items": {
            "type": "object",
            "properties": {"t": {"type": "number", "description": "start time, seconds."},
                           "kind": {"type": "string", "enum": ["hook", "ingredients", "prep", "cooking", "pour", "assembly", "reveal", "money_shot", "bite_or_sip", "reaction", "cta", "other"]},
                           "what": {"type": "string"}},
            "required": ["t", "kind", "what"], "additionalProperties": False}},
        "how_food_is_shown": {"type": "string", "description": "angles (overhead, eye level, 45°, macro), distance, hands in frame, lighting (natural, warm, backlit, steam visible), backgrounds and props, color and texture emphasis."},
        "close_ups_and_pours": {"type": "string", "description": "every close-up, pour, drip, drizzle, cheese pull, cut-open or crunch: when (seconds), how long it's held, how close, the speed it plays at, and what it shows."},
        "money_shot": {"type": "string", "description": "the single most appetizing moment: what it is, when it lands (seconds and % of the video), how long it's held, how it's set up beforehand, and what follows it."},
        "pacing": {"type": "string", "description": "ASMR-style long holds versus fast cuts (or a mix, and where each is used), shot lengths in numbers, rhythm, whether cuts land on beats or sounds, and how fast the whole thing moves."},
        "speed": {"type": "string", "description": "slow motion, speed ramps, timelapses or sped-up prep: where (seconds), how strong, and what they're used on. 'none' if everything plays at normal speed."},
        "on_screen_text": {"type": "string", "description": "overlaid text (not speech captions): the words, item names and prices, style (font weight, case, color, stroke/shadow/box), position, when it appears and disappears, how many words at once. 'none' if there is none."},
        "captions": {"type": "string", "description": "speech captions: present or not, style, position, timing. 'none' if there are none."},
        "audio": {"type": "string", "description": "ASMR sounds (sizzle, crunch, pour, ice), music, voiceover, sound effects, and how sound and picture line up."},
        "transitions": {"type": "string", "description": "every transition you can see in the before/after-cut frames (hard cut, match cut, whip, zoom, flash, hand or object wipe, jump cut): which and where. 'hard cuts only' if that's all there is."},
        "effects": {"type": "string", "description": "zooms or push-ins, shakes, color grade (warmth, saturation, contrast), sharpening, glow, light leaks, freeze frames, split screens: which, where and how strong. 'none' if there are none."},
        "quality": {"type": "string", "description": "how the video looks technically and why it matters: sharpness, resolution and frame rate (from what's given), stability or handheld, exposure, noise, color. What makes the food look high-end or homemade."},
        "ending": {"type": "string", "description": "how it ends (on the money shot, a bite or sip, a reaction, the finished item, a CTA), how long after the last beat it cuts, whether it loops."},
        "why_viral": {"type": "string", "description": "the 2-4 biggest reasons this makes people hungry and stops the scroll."},
        "lessons": {"type": "array", "items": {"type": "string"}, "description": "4-10 concrete rules an editor can apply to other businesses' food footage, with numbers where they matter."},
    },
    "required": ["format", "item", "hook", "beats", "how_food_is_shown", "close_ups_and_pours", "money_shot", "pacing",
                 "speed", "on_screen_text", "captions", "audio", "transitions", "effects", "quality", "ending",
                 "why_viral", "lessons"],
    "additionalProperties": False,
}


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
        hits = []
        if info.get("has_audio"):
            try:
                hits = sorted(round(t, 2) for t, _ in m.onsets(m.load_audio(path), limit=25))
            except Exception as e:  # noqa: BLE001
                print(f"{name}: onsets failed: {e}")
        stats = {
            "duration_s": round(dur, 2), "shots": len(shots), "cuts_per_10s": round(len(cuts) / dur * 10, 2) if dur else 0,
            "median_shot_s": round(statistics.median(lengths), 2) if lengths else None,
            "longest_shot_s": max(lengths) if lengths else None, "shortest_shot_s": min(lengths) if lengths else None,
            "words": len(words), "first_word_s": round(words[0]["s"], 2) if words else None,
            "median_motion": round(statistics.median(motion), 1) if motion else None,
            **{f"quality_{k}": v for k, v in quality.items()},
        }
        n = min(48, max(16, int(dur / 0.6)))
        times = [round(dur * (k + 0.5) / n, 2) for k in range(n)]
        content: list[dict] = [{"type": "text", "text": (
            f"video: {dur:.1f}s, {len(shots)} shots. cuts at: {', '.join(map(str, cuts)) or 'none'}\n"
            f"shot lengths: {', '.join(map(str, lengths))}\n"
            f"quality: {json.dumps(quality)}\n"
            f"motion every 0.5s (0-100, starting at 0s): {', '.join(map(str, motion)) or 'unavailable'}\n"
            f"measured: {json.dumps(stats)}\n"
            f"strongest audio hits at: {', '.join(map(str, hits)) or 'none'}\n"
            "what's said (start-end, then each word@time):\n"
            + ("\n".join(f"[{s['startS']:.2f}-{s['endS']:.2f}] {s['text']}\n  "
                         + " ".join(f"{x['w']}@{x['s']:.2f}" for x in s.get('words') or []) for s in segs)
               or "(no speech)")
        )}]
        for k, t in enumerate(times):
            f = m.grab_frame(path, t, d / f"f{k:02d}.jpg", 360)
            if f:
                content.append({"type": "text", "text": f"frame at {t:.2f}s"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": m.b64(f)}})
        # Just before and after each cut, to see the transition (first 12 cuts).
        for k, c in enumerate(cuts[:12]):
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


PLAYBOOK_SYSTEM = """You write the food & drink playbook an automatic short-form video editor follows, so the videos it makes from a restaurant's, café's or drink shop's own footage make people hungry and go viral. You get detailed breakdowns of real viral food and drink videos, plus measurements across all of them.

Find what they have in common and what separates the best from the rest, and write it as rules the editor can apply to a business's own clips when it picks moments, orders shots, sets pacing and speed, writes and places text, chooses transitions and effects, and decides the ending. Cover, with the measured numbers (medians and ranges):
- the hook (first 2 seconds)
- how the food is shown: angles, distance, hands, lighting, texture and color, and which of the user's moments to pick
- close-ups and pours: when to use them and how long to hold them
- the money shot: what it is, where it lands, how it's set up and how long it's held
- pacing: when to hold ASMR-style and when to cut fast, with shot lengths
- speed: slow motion, speed ramps and sped-up prep, and when each helps or hurts
- on-screen text and captions: item names, prices, style and placement
- audio: ASMR sounds, music and sound effects
- transitions and video effects (zooms, grade, saturation, sharpening), and which ones make food look better or cheaper
- video quality: what keeps food looking appetizing
- the ending and loop
Add a short list of the most common mistakes that make food look unappetizing or kill a video. Platform logos, @username watermarks and end screens were already left out; never make rules about them. No filler and no generic advice any guide would give; every rule should come from these videos. Write it in markdown, under 1300 words."""


@stub.function(image=img, secrets=w.secrets, timeout=1800)
def playbook(studies: list[dict], summary: dict) -> dict:
    m = live()
    content = [{"type": "text", "text": "measurements across all videos:\n" + json.dumps(summary, indent=1)}]
    for s in studies:
        content.append({"type": "text", "text": f"\n### {s['name']}\nmeasured: {json.dumps(s['stats'])}\n"
                                                 + json.dumps(s["study"], ensure_ascii=False)})
    schema = {"type": "object", "properties": {"playbook": {"type": "string"}}, "required": ["playbook"],
              "additionalProperties": False}
    result = m.ask_claude(PLAYBOOK_SYSTEM, content, schema, "playbook failed", effort="xhigh")
    return {"playbook": result["data"]["playbook"], "cost": result["cost_usd"]}


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
    (outdir / "studies.json").write_text(json.dumps(done, indent=1, ensure_ascii=False))
    keys = ["duration_s", "shots", "cuts_per_10s", "median_shot_s", "longest_shot_s", "shortest_shot_s", "words",
            "first_word_s", "median_motion", "quality_fps", "quality_video_kbps", "quality_height"]
    summary = {"videos": len(done)}
    for k in keys:
        vals = sorted(v for r in done if isinstance(v := r["stats"].get(k), (int, float)))
        if vals:
            summary[k] = {"median": round(statistics.median(vals), 2), "p25": vals[len(vals) // 4],
                          "p75": vals[(3 * len(vals)) // 4], "min": vals[0], "max": vals[-1]}
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1))
    pb = playbook.remote(done, summary)
    (outdir / "food-playbook.md").write_text(pb["playbook"])
    print(f"studied {len(done)}; cost ${round(sum(r['cost'] for r in done) + pb['cost'], 2)}")
