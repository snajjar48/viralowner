"""
ViralOwner processing worker (runs on Modal).

The website talks to this over HTTPS with a shared bearer token:
  GET  /health          checks ffmpeg, storage (R2) and Claude are reachable
  POST /jobs/ping       starts a short test job (phase A)
  GET  /jobs/{job_id}   a job's state, stage and progress (and output when done)

Jobs run as separate Modal function calls; their id is the job id. While a job
runs it reports its stage/progress in a Modal Dict, which /jobs/{id} reads.

Deploy:  modal deploy worker/app.py
"""

from __future__ import annotations

import hmac
import os
import subprocess
import time

import modal

APP_NAME = "viralowner-worker"
CLAUDE_MODEL = "claude-opus-5-5"

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .uv_pip_install("fastapi[standard]", "boto3", "anthropic")
)

# viralowner-worker:      ANTHROPIC_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# viralowner-worker-auth: WORKER_TOKEN (the same value the website has)
secrets = [modal.Secret.from_name("viralowner-worker"), modal.Secret.from_name("viralowner-worker-auth")]

# job id -> {"stage": str | None, "progress": int, "updated_at": float}
progress_store = modal.Dict.from_name("viralowner-job-progress", create_if_missing=True)


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


def ffmpeg_version() -> str:
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True).stdout
    return out.splitlines()[0]


# ---------------------------------------------------------------- jobs


@app.function(image=image, secrets=secrets, timeout=120)
def ping_job() -> dict:
    """Phase A test job: walks through the stages so the website can follow along."""
    for i, stage in enumerate(["analyzing", "matching", "editing", "finishing"]):
        report(stage, i * 25)
        time.sleep(1.5)
    report("finishing", 100)
    return {"ffmpeg": ffmpeg_version()}


# ---------------------------------------------------------------- web API


@app.function(image=image, secrets=secrets, timeout=60)
@modal.asgi_app(label=APP_NAME)
def api():
    from fastapi import Depends, FastAPI, Header, HTTPException

    web = FastAPI(title="viralowner worker", docs_url=None, redoc_url=None, openapi_url=None)

    def require_token(authorization: str = Header(default="")) -> None:
        expected = f"Bearer {os.environ['WORKER_TOKEN']}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

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

    @web.post("/jobs/ping", dependencies=[Depends(require_token)])
    def start_ping() -> dict:
        call = ping_job.spawn()
        progress_store[call.object_id] = {"stage": None, "progress": 0, "updated_at": time.time()}
        return {"jobId": call.object_id}

    @web.get("/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str) -> dict:
        try:
            call = modal.FunctionCall.from_id(job_id)
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=404, detail="unknown job")

        try:
            output = call.get(timeout=0)
        except modal.exception.OutputExpiredError:
            return {"state": "failed", "stage": None, "progress": 0, "error": "job expired"}
        except (TimeoutError, modal.exception.TimeoutError):
            p = progress_store.get(job_id) or {"stage": None, "progress": 0}
            state = "queued" if p["stage"] is None else "processing"
            return {"state": state, "stage": p["stage"], "progress": p["progress"]}
        except Exception as e:  # noqa: BLE001 - the job itself raised
            message = str(e) if isinstance(e, JobError) else "something went wrong while making your video."
            return {"state": "failed", "stage": None, "progress": 0, "error": message}

        return {"state": "done", "stage": "finishing", "progress": 100, "output": output}

    return web


class JobError(Exception):
    """Raise inside a job with a friendly, user-facing message."""
