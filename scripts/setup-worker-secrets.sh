#!/usr/bin/env bash
# Saves the worker's keys into Modal (and the shared worker token into Vercel
# and .env.local). Keys are typed hidden, never printed, never stored in this
# repo. Safe to run again: it overwrites the Modal secrets.
#
#   bash scripts/setup-worker-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

command -v modal >/dev/null || { echo "modal isn't installed (run: uv tool install modal)"; exit 1; }

echo "paste each value and press enter. secret ones stay hidden while you paste."
echo
read -rsp "1/4 anthropic api key (starts with sk-ant-): " ANTHROPIC_API_KEY; echo
read -rp  "2/4 cloudflare account id: " R2_ACCOUNT_ID
read -rp  "3/4 r2 access key id (viralowner-worker token): " R2_ACCESS_KEY_ID
read -rsp "4/4 r2 secret access key (hidden): " R2_SECRET_ACCESS_KEY; echo
echo

trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; printf '%s' "${s%"${s##*[![:space:]]}"}"; }
ANTHROPIC_API_KEY=$(trim "$ANTHROPIC_API_KEY")
R2_ACCOUNT_ID=$(trim "$R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID=$(trim "$R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY=$(trim "$R2_SECRET_ACCESS_KEY")

[[ $ANTHROPIC_API_KEY == sk-ant-* ]] || { echo "that anthropic key doesn't start with sk-ant-. nothing was saved."; exit 1; }
[[ $R2_ACCOUNT_ID =~ ^[0-9a-f]{32}$ ]] || { echo "the account id should be 32 letters/numbers (0-9, a-f). nothing was saved."; exit 1; }
[[ -n $R2_ACCESS_KEY_ID && -n $R2_SECRET_ACCESS_KEY ]] || { echo "the r2 keys can't be empty. nothing was saved."; exit 1; }

# Write to a private temp file (not the command line), hand it to Modal, delete it.
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
umask 077
# JSON (escaped by python) so no extra packages are needed and any characters are safe.
export ANTHROPIC_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
python3 -c 'import json, os, sys
keys = ["ANTHROPIC_API_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
data = {k: os.environ[k] for k in keys}
data["R2_BUCKET"] = "viralowner-media"
json.dump(data, open(sys.argv[1], "w"))' "$tmpdir/worker.json"
modal secret create --force viralowner-worker --from-json "$tmpdir/worker.json" >/dev/null
echo "✓ saved keys in modal (viralowner-worker)"

# Shared token between the website and the worker (reuse if it already exists).
if grep -q '^WORKER_TOKEN=' .env.local 2>/dev/null; then
  WORKER_TOKEN=$(grep '^WORKER_TOKEN=' .env.local | tail -1 | cut -d= -f2-)
else
  WORKER_TOKEN=$(openssl rand -hex 32)
  printf '\nWORKER_TOKEN=%s\n' "$WORKER_TOKEN" >> .env.local
fi
export WORKER_TOKEN
python3 -c 'import json, os, sys; json.dump({"WORKER_TOKEN": os.environ["WORKER_TOKEN"]}, open(sys.argv[1], "w"))' "$tmpdir/auth.json"
modal secret create --force viralowner-worker-auth --from-json "$tmpdir/auth.json" >/dev/null
echo "✓ saved the shared worker token in modal (viralowner-worker-auth) and .env.local"

printf '%s' "$WORKER_TOKEN" | npx vercel env add WORKER_TOKEN production --sensitive --force >/dev/null
echo "✓ saved the shared worker token in vercel"

unset ANTHROPIC_API_KEY R2_SECRET_ACCESS_KEY R2_ACCESS_KEY_ID WORKER_TOKEN
echo
echo "all done. tell claude it worked."
