#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# This is a private development preview, not a paid production deployment.
export NODE_ENV=development
export PORT=3000
export DATA_DIR="$PWD/data"

# Retain the same local secret and SQLite files when the codespace resumes.
node <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
try {
  fs.writeFileSync('.env', 'SESSION_SECRET=' + crypto.randomBytes(48).toString('hex') + '\n', {
    flag: 'wx', mode: 0o600
  });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
JS

# Reattaching/resuming must not start a second copy on the same port.
if curl --silent --fail http://127.0.0.1:3000/api/auth/me >/dev/null; then
  echo "MM1 is already running: http://localhost:3000"
  exit 0
fi

nohup node server.js > /tmp/mm1-preview.log 2>&1 &
preview_pid=$!
for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:3000/api/auth/me >/dev/null; then
    echo "MM1 is ready: http://localhost:3000"
    exit 0
  fi
  if ! kill -0 "$preview_pid" 2>/dev/null; then
    echo "MM1 could not start. See /tmp/mm1-preview.log." >&2
    exit 1
  fi
  sleep 1
done
echo "MM1 did not become ready. See /tmp/mm1-preview.log." >&2
exit 1
