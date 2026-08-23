#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the SkyNeet Survivors / RECURSE codebase.
# Runs after checkout, from the repository root. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/recurse"

# 1. Node dependencies (Vite + TypeScript + Vitest).
npm ci

# 2. Chromium for the optional end-to-end smoke test (`npm run smoke`).
#    tools/smoke.mjs launches Chromium from the fixed path /opt/pw-browsers/chromium,
#    so install the browser there and expose it under that stable name.
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
sudo mkdir -p /opt/pw-browsers
sudo chown -R "$(id -un):$(id -gn)" /opt/pw-browsers
npx --yes playwright install --with-deps chromium

# Point the stable path the smoke harness expects at the versioned binary.
CHROME_BIN="$(find /opt/pw-browsers -maxdepth 3 -type f -name chrome -path '*chrome-linux*' | head -n1)"
if [ -n "$CHROME_BIN" ]; then
  ln -sf "$CHROME_BIN" /opt/pw-browsers/chromium
fi

echo "install.sh: done"
