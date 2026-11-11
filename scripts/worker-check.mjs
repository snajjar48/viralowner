// Checks the deployed worker end to end: health (ffmpeg, storage, Claude), then
// a test job followed until it finishes, the way the website follows renders.
//
//   npm run worker:check
const url = (process.env.WORKER_URL ?? "https://snajjar48--viralowner-worker.us-east.modal.run").replace(/\/$/, "");
const token = process.env.WORKER_TOKEN;
if (!token) {
  console.error("WORKER_TOKEN is missing from .env.local (run: bash scripts/setup-worker-secrets.sh)");
  process.exit(1);
}

async function call(path, method = "GET") {
  const res = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const unauth = await fetch(url + "/health");
console.log(`without the token: ${unauth.status} (expected 401)`);

const started = Date.now();
const health = await call("/health");
for (const [name, c] of Object.entries(health.checks)) console.log(`${c.ok ? "✓" : "✗"} ${name}: ${c.detail}`);
console.log(`health took ${((Date.now() - started) / 1000).toFixed(1)}s (includes a cold start if idle)`);

const { jobId } = await call("/jobs/ping", "POST");
console.log(`test job started: ${jobId}`);
for (;;) {
  const s = await call(`/jobs/${jobId}`);
  console.log(`  ${s.state} ${s.stage ?? "-"} ${s.progress}%`);
  if (s.state === "done" || s.state === "failed") {
    console.log(s.state === "done" ? `✓ job finished: ${s.output.ffmpeg}` : `✗ job failed: ${s.error}`);
    process.exit(health.ok && s.state === "done" ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
