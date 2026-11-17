"""Opus vs Fable on the same videos: each model makes its own first versions, and both apply the same
change requests to the same (Opus-made) first version, so the only difference is the model.

    modal volume put viralowner-compare <clips and inspo>     # once
    modal run scripts/compare-models.py --out <dir> --cases <cases.json>

cases.json: {"clips": ["a.mov", ...], "inspo": "inspo.mp4", "breakdown": "<path to breakdown json>",
             "emojiKit": "u/<user>/emoji/kit.json" (optional, read only),
             "firsts": [{"id": "s1", "kind": "scratch", "prompt": "..."}, {"id": "r1", "kind": "remake"}],
             "changes": [{"id": "c1", "on": "s1", "request": "..."}]}
Saves every video and results.json to --out. Real videos never come through here: this app has its
own functions, and the worker's model switch only works through it."""
import json
import sys
import tempfile
import time
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import app as w  # noqa: E402

MODELS = ["claude-opus-5-5", "claude-fable-5-2"]
stub = modal.App("viralowner-compare-models")
img = w.image.add_local_file(str(Path(__file__).resolve().parent.parent / "worker" / "app.py"), "/root/app_live.py")
vol = modal.Volume.from_name("viralowner-compare", create_if_missing=True)


def live():
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_live", "/root/app_live.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@stub.function(image=img, secrets=w.secrets, cpu=8, memory=8192, timeout=1800, volumes={"/data": vol}, max_containers=8)
def render_case(req: dict, model: str, names: dict, prev_video: bytes | None) -> dict:
    m = live()
    m.Speech = modal.Cls.from_name("viralowner-worker", "Speech")  # the deployed GPU speech
    m.start_job(req)
    m.JOB["model"] = model if model in m.TEST_MODELS else m.CLAUDE_MODEL

    def fetch(key: str, dest: Path) -> None:
        if key in names:
            dest.write_bytes(Path("/data", names[key]).read_bytes())
        elif key == "u/test/p/test/renders/previous.mp4" and prev_video:
            dest.write_bytes(prev_video)
        elif key.startswith("u/") and "/emoji/" in key:
            m.r2_fetch(key, dest)  # the maker's phone emoji: read only
        else:
            raise FileNotFoundError(key)

    with tempfile.TemporaryDirectory() as tmp:
        result: dict = {}

        def store(path: Path, key: str) -> None:
            result["video"] = path.read_bytes()

        m.install_emoji_kit(req, Path(tmp), fetch)
        t = time.time()
        render = m.render_scratch if isinstance(req.get("scratch"), dict) else m.render_video
        out = render(req, Path(tmp), fetch=fetch, store=store)
        return {"out": json.loads(json.dumps(out, default=str)), "video": result["video"],
                "seconds": round(time.time() - t, 1), "model": model, "heads_up": m.job_heads_up()}


def base_req(cases: dict, kind: str, prompt: str = "") -> tuple[dict, dict]:
    names = {f"u/test/p/test/clip{i}": n for i, n in enumerate(cases["clips"])}
    clips = [{"id": f"clip{i}", "storageKey": f"u/test/p/test/clip{i}"} for i in range(len(cases["clips"]))]
    req: dict = {"outputKey": "u/test/p/test/renders/out.mp4", "clips": clips, "audio": None,
                 **({"emojiKit": cases["emojiKit"]} if cases.get("emojiKit") else {})}
    if kind == "scratch":
        req.update(shots=[], scratch={"prompt": prompt},
                   options={"text": {"mode": "adapt", "custom": "", "align": "inspo"}, "music": {"mode": "original"},
                            "captions": {"enabled": False, "style": "bold-pop"}, "notes": ""})
    else:
        breakdown = json.loads(Path(cases["breakdown"]).read_text())
        n = len(breakdown["shots"])
        st = breakdown.setdefault("style", w.default_inspo_style(n))
        st["version"] = w.STYLE_VERSION
        names["u/test/p/test/inspo"] = cases["inspo"]
        req.update(inspo={"storageKey": "u/test/p/test/inspo", "breakdown": breakdown},
                   shots=[{"shotIndex": s["index"], "clipId": None, "trimStartS": None, "trimEndS": None} for s in breakdown["shots"]],
                   options={"text": {"mode": "adapt", "custom": ""}, "music": {"mode": "original"},
                            "captions": {"enabled": False, "style": "bold-pop"}, "notes": ""})
    return req, names


@stub.local_entrypoint()
def main(out: str, cases: str):
    spec = json.loads(Path(cases).read_text())
    outdir = Path(out)
    outdir.mkdir(parents=True, exist_ok=True)
    results: dict = {}

    def save(case_id: str, model: str, r: dict, request: str, kind: str) -> None:
        tag = "opus" if "opus" in model else "fable"
        (outdir / f"{case_id}-{tag}.mp4").write_bytes(r["video"])
        meta = r["out"].get("meta") or {}
        results.setdefault(case_id, {"request": request, "kind": kind})[tag] = {
            "video": f"{case_id}-{tag}.mp4", "seconds": r["seconds"], "cost": meta.get("costUsd"),
            "note": (r["out"].get("plan") or {}).get("note") or r["out"].get("note"),
            "headsUp": r["heads_up"], "postCopy": r["out"].get("postCopy")}
        print(f"{case_id} {tag}: {r['seconds']}s ${meta.get('costUsd')}")

    # 1. First versions: each model its own.
    firsts = {}
    calls = []
    for f in spec["firsts"]:
        req, names = base_req(spec, f["kind"], f.get("prompt", ""))
        firsts[f["id"]] = (req, names, f)
        for model in MODELS:
            calls.append((f["id"], model, render_case.spawn({**req, "testModel": model}, model, names, None)))
    base: dict = {}
    for case_id, model, call in calls:
        try:
            r = call.get()
        except Exception as e:  # noqa: BLE001
            print(f"{case_id} {model} failed: {type(e).__name__}: {e}")
            continue
        f = firsts[case_id][2]
        save(case_id, model, r, f.get("prompt") or "(remake, first version)", f["kind"])
        if model == MODELS[0]:
            base[case_id] = r

    # 2. Changes: both models edit the same Opus first version.
    calls = []
    for c in spec["changes"]:
        if c["on"] not in base:
            continue
        req, names, f = firsts[c["on"]]
        b = base[c["on"]]
        plan, post = b["out"]["plan"], b["out"]["postCopy"]
        req2 = {**req, "request": c["request"], "shots": plan["shots"],
                "previous": {"storageKey": "u/test/p/test/renders/previous.mp4", "plan": plan, "postCopy": post,
                             **({"textChanged": False} if f["kind"] == "scratch" else {})}}
        for model in MODELS:
            calls.append((c, model, render_case.spawn({**req2, "testModel": model}, model, names, b["video"])))
    for c, model, call in calls:
        try:
            r = call.get()
        except Exception as e:  # noqa: BLE001
            print(f"{c['id']} {model} failed: {type(e).__name__}: {e}")
            continue
        save(c["id"], model, r, c["request"], "change")
        results[c["id"]]["on"] = c["on"]

    (outdir / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    total = {t: round(sum((v.get(t) or {}).get("cost") or 0 for v in results.values()), 2) for t in ("opus", "fable")}
    print(f"done: {len(results)} cases; AI cost opus ${total['opus']}, fable ${total['fable']}")
