"""Study a folder of viral videos: measure each one, have Claude break down why it works, then
write one playbook from all of them (it saves viral-playbook.md, studies and measurements to --out; copy the playbook to worker/assets/playbook/)."""
import json
import statistics
import sys
import tempfile
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import app as w  # noqa: E402

stub = modal.App("viralowner-study")
img = w.image.add_local_file(str(Path(__file__).resolve().parent.parent / "worker" / "app.py"), "/root/app_live.py")


def live():
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_live", "/root/app_live.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STUDY_SYSTEM = """You are a top short-form video editor and comedy writer who studies why TikTok and Instagram Reels skits go viral, so an automatic editor can make videos like them.

Every video you get is a skit. You get one viral skit: frames sampled through it (each labelled with its time), every cut, what's said with word timings, the pauses between lines, and the strongest hits in the audio. Break down exactly what the creator and editor did, with real times and numbers from what you're given. Be specific to this video, then turn it into lessons an editor can apply to other people's footage. Never guess numbers you weren't given; read them from the timings.

Ignore everything the platform added: the TikTok or Instagram logo and @username watermark that floats on the video, and any app UI. They aren't part of the edit, so never describe them as on-screen text or count them as a choice the creator made. Any end screen has already been cut off."""

STUDY_SCHEMA = {
    "type": "object",
    "properties": {
        "format": {"type": "string", "description": "the kind of skit (e.g. one person playing both sides of a customer/worker skit, POV skit, prank skit, relatable situation, two-character dialogue)."},
        "premise": {"type": "string", "description": "the joke or idea in one sentence."},
        "hook": {"type": "string", "description": "exactly what happens in the first 0-2 seconds (first frame, first words and when they start, any text), and why it stops the scroll."},
        "beats": {"type": "array", "description": "the video's beats in order.", "items": {
            "type": "object",
            "properties": {"t": {"type": "number", "description": "start time, seconds."},
                           "kind": {"type": "string", "enum": ["hook", "setup", "escalation", "turn", "punchline", "reaction", "tag", "cta", "other"]},
                           "what": {"type": "string"}},
            "required": ["t", "kind", "what"], "additionalProperties": False}},
        "comedic_timing": {"type": "string", "description": "how the timing makes it funny, with numbers: pauses before and after the punchline, how long the reaction is held, when the punchline lands (seconds and % of the video), how fast lines follow each other, where cuts land relative to speech."},
        "dialogue": {"type": "string", "description": "how lines are delivered: speed, overlap, dead air cut or kept, retakes, ad-libs."},
        "captions": {"type": "string", "description": "speech captions: present or not; font weight, case, color, stroke/shadow/box, words on screen at once, where on screen, any word highlighted, how they're timed. 'none' if there are none."},
        "on_screen_text": {"type": "string", "description": "overlaid text that isn't speech captions (hook titles, labels, character names, context): the words, style, position, when it appears and disappears. 'none' if there is none."},
        "audio": {"type": "string", "description": "original dialogue, trending sound, music under dialogue, sound effects (which and where), volume balance, silence used for effect."},
        "pacing": {"type": "string", "description": "shot lengths, cut style (jump cuts, angle changes, character switches), speed changes, zooms, how fast the whole thing moves."},
        "camera": {"type": "string", "description": "framing, angle, handheld or fixed, how two characters are shown, costume/prop changes."},
        "ending": {"type": "string", "description": "how it ends (on the punchline, a reaction, a tag), how long after the last line it cuts, whether it loops back into the start."},
        "why_viral": {"type": "string", "description": "the 2-4 biggest reasons this works."},
        "lessons": {"type": "array", "items": {"type": "string"}, "description": "4-10 concrete rules an editor can apply to other footage, with numbers where they matter."},
    },
    "required": ["format", "premise", "hook", "beats", "comedic_timing", "dialogue", "captions", "on_screen_text",
                 "audio", "pacing", "camera", "ending", "why_viral", "lessons"],
    "additionalProperties": False,
}


@stub.function(image=img, secrets=w.secrets, timeout=1800, cpu=4, memory=8192, max_containers=8)
def study(name: str, data: bytes) -> dict:
    m = live()
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        path = d / ("v" + Path(name).suffix.lower())
        path.write_bytes(data)
        info = m.probe(path)
        full = float(info["duration"])
        # The platform's end screen (logo + @handle) isn't part of the video: cut it off first.
        dur = m.drop_end_screen(path, full, d)
        info = m.probe(path)
        shots = m.detect_shots(path, dur)
        cuts = [round(a, 2) for a, _ in shots[1:]]
        lengths = [round(b - a, 2) for a, b in shots]
        segs = m.transcribe(path)["segments"] if info.get("has_audio") else []
        words = [x for s in segs for x in s.get("words") or []]
        gaps = [round(b["s"] - a["e"], 2) for a, b in zip(words, words[1:])]
        pauses = [(round(a["e"], 2), g) for a, g in zip(words, gaps) if g >= 0.35]
        span = (words[-1]["e"] - words[0]["s"]) if words else 0
        hits = []
        if info.get("has_audio"):
            try:
                hits = sorted(round(t, 2) for t, _ in m.onsets(m.load_audio(path), limit=25))
            except Exception as e:  # noqa: BLE001
                print(f"{name}: onsets failed: {e}")
        stats = {
            "duration_s": round(dur, 2), "shots": len(shots), "cuts_per_10s": round(len(cuts) / dur * 10, 2) if dur else 0,
            "median_shot_s": round(statistics.median(lengths), 2) if lengths else None,
            "words": len(words), "words_per_s": round(len(words) / span, 2) if span else 0,
            "first_word_s": round(words[0]["s"], 2) if words else None,
            "speech_share": round(span / dur, 2) if dur and span else 0,
            "pauses_over_0_35s": len(pauses), "longest_pause_s": max(gaps) if gaps else None,
            "median_gap_s": round(statistics.median(gaps), 2) if gaps else None,
            "after_last_word_s": round(dur - words[-1]["e"], 2) if words else None,
        }
        n = min(44, max(14, int(dur / 0.8)))
        times = [round(dur * (k + 0.5) / n, 2) for k in range(n)]
        content: list[dict] = [{"type": "text", "text": (
            f"video: {dur:.1f}s, {len(shots)} shots. cuts at: {', '.join(map(str, cuts)) or 'none'}\n"
            f"measured: {json.dumps(stats)}\n"
            f"strongest audio hits at: {', '.join(map(str, hits)) or 'none'}\n"
            "what's said (start-end, then each word@time):\n"
            + ("\n".join(f"[{s['startS']:.2f}-{s['endS']:.2f}] {s['text']}\n  "
                         + " ".join(f"{x['w']}@{x['s']:.2f}" for x in s.get('words') or []) for s in segs)
               or "(no speech)")
            + "\npauses of 0.35s or more (after the word ending at, length): "
            + (", ".join(f"{t}s:{g}s" for t, g in pauses) or "none")
        )}]
        for k, t in enumerate(times):
            f = m.grab_frame(path, t, d / f"f{k:02d}.jpg", 360)
            if f:
                content.append({"type": "text", "text": f"frame at {t:.2f}s"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": m.b64(f)}})
        content.append({"type": "text", "text": "break this video down."})
        result = m.ask_claude(STUDY_SYSTEM, content, STUDY_SCHEMA, "study failed", effort="high")
        print(f"{name}: {dur:.1f}s ${result['cost_usd']}")
        stats["end_screen_cut_s"] = round(full - dur, 2)
        out = {"name": name, "stats": stats, "study": result["data"], "cost": result["cost_usd"]}
        return json.loads(json.dumps(out, default=float))  # plain numbers (Whisper's are numpy's)


PLAYBOOK_SYSTEM = """You write the playbook an automatic short-form video editor follows so the videos it makes go viral. You get detailed breakdowns of real viral skits, plus measurements across all of them.

Find what they have in common and what separates the best from the rest, and write it as rules the editor can apply to a user's own footage when it cuts their clips, times their lines, writes and places text and captions, picks sound effects and decides pacing and the ending. Be concrete and use the measured numbers (medians and ranges). Cover: the hook (first 2 seconds), structure and beats, comedic timing (pauses, punchline placement, reaction holds, tags), dialogue editing (dead air, overlaps, retakes), pacing and speed, captions, on-screen text, audio and sound effects, camera/framing choices the editor can pick between when it has options, and the ending/loop. Add a short list of the most common mistakes that kill a video. Platform logos, @username watermarks and end screens were already left out of the breakdowns; never make rules about them. No filler, no generic advice that any video guide would say; every rule should come from these videos. Write it in markdown, under 1200 words."""


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
    files = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in (".mp4", ".mov"))
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
    keys = ["duration_s", "shots", "cuts_per_10s", "median_shot_s", "words_per_s", "first_word_s", "speech_share",
            "pauses_over_0_35s", "longest_pause_s", "median_gap_s", "after_last_word_s"]
    summary = {"videos": len(done)}
    for k in keys:
        vals = sorted(v for r in done if isinstance(v := r["stats"].get(k), (int, float)))
        if vals:
            summary[k] = {"median": round(statistics.median(vals), 2), "p25": vals[len(vals) // 4],
                          "p75": vals[(3 * len(vals)) // 4], "min": vals[0], "max": vals[-1]}
    (outdir / "summary.json").write_text(json.dumps(summary, indent=1))
    pb = playbook.remote(done, summary)
    (outdir / "viral-playbook.md").write_text(pb["playbook"])
    print(f"studied {len(done)}; cost ${round(sum(r['cost'] for r in done) + pb['cost'], 2)}")
