"""Study a folder of viral influencer and vlog videos (day in the life, GRWM, family and lifestyle vlogs,
storytimes, routines, hauls): measure each one, have the editor's model break down what makes it work (the
hook, the story arc, personality, pacing of everyday moments, voiceover, text), then write one influencer/vlog
playbook from all of them, plus research notes from outside sources (--research, optional).

    modal run scripts/study-influencer.py --folder ~/Downloads/influencer --out <dir> [--research notes.md]

Saves influencer-playbook.md, each study and the measurements to --out. Review the playbook, then copy it
to worker/assets/playbook/influencer-playbook.md. A rerun only studies videos not studied yet."""
import json
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import app as w  # noqa: E402

stub = modal.App("viralowner-study-influencer")
# The videos go up once into a volume (sending ~2GB of video inside the calls drops the connection).
vol = modal.Volume.from_name("viralowner-study-influencer", create_if_missing=True)
img = w.image.add_local_file(str(Path(__file__).resolve().parent.parent / "worker" / "app.py"), "/root/app_live.py")


def live():
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_live", "/root/app_live.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STUDY_SYSTEM = """You are a top short-form editor for influencers and vloggers. You study why influencer and vlog videos on TikTok and Instagram Reels go viral (day in the life, get ready with me, family and mom/dad vlogs, couple vlogs, routines, storytimes, hauls and try-ons, "come with me", lifestyle and personal moments), so an automatic editor can make a creator's own everyday footage just as watchable: people stay to the end, rewatch, comment, follow and share.

You get one viral video: frames sampled through it (each labelled with its time), a frame just before and just after every cut, every cut time, a motion graph (how much the picture changes every half second, to spot action, slow motion, speed ramps and still holds), the video's technical quality, what's said with word timings, and the strongest hits in the audio. Break down exactly what the creator and editor did, with real times and numbers from what you're given. Pay close attention to:
- the hook: the first frame and first words or text, and the promise or curiosity it sets up
- the story: how everyday moments become a story with a beginning, build and payoff (a problem, a goal, a reveal, a punchline, a sweet or funny moment), and what keeps people watching to the end
- personality and relatability: talking to camera, facial reactions, kids, partners or pets, humor, honesty, the moments that make viewers feel they know the person
- how ordinary moments are filmed and cut: B-roll of routines (coffee, getting ready, cooking, cleaning, outfits, errands), POV versus filmed, close details, and how long each moment gets
- voiceover versus talking to camera versus music only, and how text carries the story when nobody talks
- what makes people comment, share, save or follow (a question, a relatable line, a series, a cliffhanger)

Be specific to this video, then turn it into lessons an editor can apply to other creators' everyday footage. Never guess numbers you weren't given; read them from the timings.

Ignore everything the platform added: the TikTok or Instagram logo and @username watermark that floats on the video, and any app UI. They aren't part of the edit, so never describe them as on-screen text or count them as a choice the creator made. Any end screen has already been cut off."""

STUDY_SCHEMA = {
    "type": "object",
    "properties": {
        "format": {"type": "string", "description": "the kind of video (e.g. day in the life, get ready with me, family/mom vlog, couple vlog, routine, storytime, haul or try-on, come with me, reaction, skit, montage of moments, talking to camera, POV) and how the format is built."},
        "creator": {"type": "string", "description": "who the creator seems to be (mom, dad, family, couple, solo lifestyle creator, student...), the setting, and the persona or vibe that comes across."},
        "audience": {"type": "string", "description": "who it's made for and what it makes them do (relate, laugh, comment, share with a partner or friend, save, follow for the next part)."},
        "hook": {"type": "string", "description": "exactly what's on screen and heard in the first 0-2 seconds (first frame, first sound, any text or question) and why it stops the scroll."},
        "beats": {"type": "array", "description": "the video's beats in order.", "items": {
            "type": "object",
            "properties": {"t": {"type": "number", "description": "start time, seconds."},
                           "kind": {"type": "string", "enum": ["hook", "setup", "routine_moment", "talking_to_camera", "reaction", "kids_or_family", "detail_broll", "transformation", "reveal", "punchline", "emotional_moment", "info_or_tip", "product", "cta", "other"]},
                           "what": {"type": "string"}},
            "required": ["t", "kind", "what"], "additionalProperties": False}},
        "story": {"type": "string", "description": "the story arc: the setup or promise, how it builds, the payoff (reveal, punchline, sweet moment, twist), and where each lands in seconds. What keeps people to the end and makes them rewatch."},
        "personality": {"type": "string", "description": "how the person's personality comes through: faces and reactions, talking to camera, humor, honesty, kids/partner/pets, and the moments that make viewers feel close to them."},
        "everyday_moments": {"type": "string", "description": "which ordinary moments are shown (coffee, getting ready, outfits, cooking, cleaning, errands, kids' routines, car, bedtime), how each is filmed (POV, tripod, close detail, wide), and how long each gets."},
        "voice_and_text": {"type": "string", "description": "voiceover, talking to camera, or music only; how the words carry the story; how text works when nobody speaks (one line over the whole video, a line per moment, a running list)."},
        "engagement": {"type": "string", "description": "what makes people comment, share, save or follow: a question, a relatable line, a series or 'part 2', a cliffhanger, a debate. 'none' if nothing stands out."},
        "pacing": {"type": "string", "description": "shot lengths in numbers, rhythm, which moments are held and which are fast, whether cuts land on beats or words, jump cuts in talking, and how fast the whole thing moves."},
        "speed": {"type": "string", "description": "slow motion, speed ramps, timelapses or sped-up routines: where (seconds), how strong, and what they're used on. 'none' if everything plays at normal speed."},
        "on_screen_text": {"type": "string", "description": "overlaid text (not speech captions): the words, style (font weight, case, color, stroke/shadow/box), position, when it appears and disappears, how many words at once, and emoji. 'none' if there is none."},
        "captions": {"type": "string", "description": "speech captions: present or not, style, position, timing. 'none' if there are none."},
        "audio": {"type": "string", "description": "trending song, voiceover, natural sound (kids talking, laughing, ASMR sounds of routines), sound effects, and how sound and picture line up."},
        "transitions": {"type": "string", "description": "every transition you can see in the before/after-cut frames (hard cut, jump cut, match cut, whip, outfit or hand-over-lens transition, zoom, flash): which and where. 'hard cuts only' if that's all there is."},
        "effects": {"type": "string", "description": "zooms or punch-ins, shakes, color grade, filters, freeze frames, split screens, stickers or graphics: which, where and how strong. 'none' if there are none."},
        "quality": {"type": "string", "description": "how the video looks technically and why it matters: sharpness, resolution and frame rate (from what's given), stability, light, color, phone versus camera, and whether the casual look helps."},
        "ending": {"type": "string", "description": "how it ends (punchline, sweet moment, question, part 2 tease, loop), how long after the last beat it cuts, whether it loops."},
        "why_viral": {"type": "string", "description": "the 2-4 biggest reasons this stops the scroll and makes people watch to the end, comment, share or follow."},
        "lessons": {"type": "array", "items": {"type": "string"}, "description": "4-10 concrete rules an editor can apply to other creators' everyday footage, with numbers where they matter."},
    },
    "required": ["format", "creator", "audience", "hook", "beats", "story", "personality", "everyday_moments",
                 "voice_and_text", "engagement", "pacing", "speed", "on_screen_text", "captions", "audio",
                 "transitions", "effects", "quality", "ending", "why_viral", "lessons"],
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


@stub.function(image=img, secrets=w.secrets, timeout=1800, cpu=4, memory=8192, max_containers=8,
               volumes={"/videos": vol})
def study(name: str) -> dict:
    import shutil

    m = live()
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        path = d / ("v" + Path(name).suffix.lower())
        shutil.copy(f"/videos/{name}", path)
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


PLAYBOOK_SYSTEM = """You write the influencer and vlog playbook an automatic short-form video editor follows, so the videos it makes from a creator's own everyday footage (day in the life, get ready with me, family and mom vlogs, couple vlogs, routines, storytimes, hauls, personal moments) stop the scroll, get watched to the end and rewatched, and make people comment, share and follow. You get detailed breakdowns of real viral influencer and vlog videos, plus measurements across all of them, and sometimes research notes from outside sources.

Find what they have in common and what separates the best from the rest, and write it as rules the editor can apply to someone's own clips when it picks moments, orders shots, sets pacing and speed, writes and places text, chooses transitions and effects, and decides the ending. Cover, with the measured numbers (medians and ranges):
- the hook (first 2 seconds)
- the formats that work and exactly how to build each one (day in the life, GRWM, family/kids vlog, routine, storytime, haul or try-on, montage of moments, and the others you see)
- the story: turning ordinary moments into a beginning, build and payoff, and what keeps people to the end
- personality: which moments of the person, their reactions, kids, partner or pets to pick and keep
- everyday moments: which to pick from the user's clips, how long each gets, and in what order
- voiceover, talking to camera or music only, and how text carries the story when nobody talks
- what makes people comment, share, save and follow
- pacing, with shot lengths, jump cuts in talking, and cutting to the music
- speed: slow motion, speed ramps and sped-up routines, and when each helps or hurts
- on-screen text and captions: wording, style and placement
- audio: songs, voiceover and natural sound
- transitions and video effects, and which feel authentic versus overproduced
- video quality: what looks warm and real versus messy
- the ending and loop
Add a short list of the most common mistakes that make these videos flop. Use the research notes only where they agree with or add to what the videos show; the videos come first. Platform logos, @username watermarks and end screens were already left out; never make rules about them. Never tell the editor to invent facts, prices or claims about the person. No filler and no generic advice any guide would give. Write it in markdown, under 1500 words."""


@stub.function(image=img, secrets=w.secrets, timeout=1800)
def playbook(studies: list[dict], summary: dict, research: str = "") -> dict:
    m = live()
    content = [{"type": "text", "text": "measurements across all videos:\n" + json.dumps(summary, indent=1)}]
    if research.strip():
        content.append({"type": "text", "text": "research notes from outside sources (secondary to the videos):\n" + research})
    for s in studies:
        content.append({"type": "text", "text": f"\n### {s['name']}\nmeasured: {json.dumps(s['stats'])}\n"
                                                 + json.dumps(s["study"], ensure_ascii=False)})
    schema = {"type": "object", "properties": {"playbook": {"type": "string"}}, "required": ["playbook"],
              "additionalProperties": False}
    result = m.ask_claude(PLAYBOOK_SYSTEM, content, schema, "playbook failed", effort="xhigh")
    return {"playbook": result["data"]["playbook"], "cost": result["cost_usd"]}


@stub.local_entrypoint()
def main(folder: str, out: str, research: str = ""):
    files = sorted(p for p in Path(folder).expanduser().iterdir() if p.suffix.lower() in (".mp4", ".mov"))
    print(f"{len(files)} videos")
    outdir = Path(out)
    outdir.mkdir(parents=True, exist_ok=True)
    # Each study is saved as it arrives, so a rerun only studies what's missing.
    each = outdir / "each"
    each.mkdir(exist_ok=True)
    # Every video studied before (studies/influencer.json, kept in the project): never studied again, and
    # still part of the playbook even once its video is deleted.
    kept = Path(__file__).resolve().parent.parent / "studies" / "influencer.json"
    if kept.exists():
        for r in json.loads(kept.read_text()):
            if not (each / f"{r['name']}.json").exists():
                (each / f"{r['name']}.json").write_text(json.dumps(r, ensure_ascii=False))
    todo = [p for p in files if not (each / f"{p.name}.json").exists()]
    print(f"{len(todo)} to study")
    have = {e.path.lstrip("/") for e in vol.listdir("/")}
    missing = [p for p in todo if p.name not in have]
    for p in missing:  # one at a time, so a dropped upload only redoes that one
        for attempt in range(3):
            try:
                with vol.batch_upload(force=True) as up:
                    up.put_file(str(p), f"/{p.name}")
                print(f"uploaded {p.name}")
                break
            except Exception as e:  # noqa: BLE001
                print(f"upload {p.name} failed ({attempt + 1}/3): {e}")
    for r in study.map([p.name for p in todo], return_exceptions=True):
        if isinstance(r, Exception):
            print(f"failed: {r}")
            continue
        (each / f"{r['name']}.json").write_text(json.dumps(r, ensure_ascii=False))
    done = [json.loads(f.read_text()) for f in sorted(each.glob("*.json"))]  # everything ever studied
    kept.write_text(json.dumps(done, indent=1, ensure_ascii=False))  # saved back to the project
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
    notes = Path(research).expanduser().read_text() if research else ""
    pb = playbook.remote(done, summary, notes)
    (outdir / "influencer-playbook.md").write_text(pb["playbook"])
    print(f"studied {len(done)}; cost ${round(sum(r['cost'] for r in done) + pb['cost'], 2)}")
