#!/usr/bin/env bash
# Debug APK that opens the Canvas. Signing is the SDK's debug key, created
# on the runner. No keystore is committed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHELL_DIR="$ROOT/shell"
APP="$SHELL_DIR/src-tauri/gen/android/app/src/main"
DIST="$ROOT/dist/android"

export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${NDK_HOME:-}" && -n "${ANDROID_NDK_LATEST_HOME:-}" ]]; then
  export NDK_HOME="$ANDROID_NDK_LATEST_HOME"
fi
if [[ -z "${NDK_HOME:-}" && -d "$ANDROID_HOME/ndk" ]]; then
  NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
  export NDK_HOME
fi
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
export ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT:-${NDK_HOME:-}}"
echo "ANDROID_HOME=$ANDROID_HOME"
echo "NDK_HOME=${NDK_HOME:-missing}"

mkdir -p "$DIST"
cd "$SHELL_DIR/ui"
if [[ ! -d node_modules ]]; then
  npm ci
fi

cd "$SHELL_DIR"
export CI=true
# A native CLI. The npm shim is a node script, and Gradle then runs
# `node tauri` inside src-tauri, which is not a module.
cargo install tauri-cli --version 2.11.5 --locked
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
command -v cargo-tauri
cargo tauri android init --ci --skip-targets-install

# Tauri copies icons/android into res on init. Copy again so splash XML is present
# even if an older generated tree is reused, then point the launcher activity at it.
cp -a "$SHELL_DIR/src-tauri/icons/android/." "$APP/res/"
python3 - "$APP/AndroidManifest.xml" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace(
    '    <uses-permission android:name="android.permission.INTERNET" />\n',
    "",
)

def splash_theme(match: re.Match[str]) -> str:
    tag = match.group(0)
    if "android:theme=" in tag:
        return re.sub(
            r'android:theme="[^"]*"',
            'android:theme="@style/Theme.Xindoze.Splash"',
            tag,
            count=1,
        )
    return tag[:-1] + '\n            android:theme="@style/Theme.Xindoze.Splash">'

updated, count = re.subn(r"<activity\b[^>]*>", splash_theme, text, count=1)
if count != 1:
    raise SystemExit("launcher activity not found in AndroidManifest.xml")
path.write_text(updated)
print("launch theme set to Theme.Xindoze.Splash")
PY

cargo tauri android build --debug --apk --target aarch64

mapfile -t APKS < <(find "$SHELL_DIR/src-tauri/gen/android" -path '*outputs/apk*' -name '*debug*.apk' ! -name '*unaligned*' -printf '%T@ %p\n' | sort -n | awk '{print $2}')
if [[ ${#APKS[@]} -eq 0 ]]; then
  echo "no apk produced" >&2
  find "$SHELL_DIR/src-tauri/gen/android" -name '*.apk' -print >&2 || true
  exit 1
fi
cp "${APKS[-1]}" "$DIST/xindoze-debug.apk"
echo "apk: $DIST/xindoze-debug.apk"

AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort | tail -1 || true)"
if [[ -n "$AAPT" ]]; then
  "$AAPT" dump xmltree "$DIST/xindoze-debug.apk" AndroidManifest.xml > "$DIST/manifest.txt"
  if grep -q 'AccessibilityService' "$DIST/manifest.txt"; then
    echo "manifest contains AccessibilityService" >&2
    exit 1
  fi
  if grep -q 'SEND_SMS' "$DIST/manifest.txt"; then
    echo "manifest contains SEND_SMS" >&2
    exit 1
  fi
  grep -q 'XinodService' "$DIST/manifest.txt"
fi
unzip -l "$DIST/xindoze-debug.apk" | tee "$DIST/files.txt"
grep -q 'ic_launcher' "$DIST/files.txt"
grep -q 'xindoze_splash.png' "$DIST/files.txt"
# aapt's manifest dump prints a resource id, not the style name. The name is in the APK.
grep -a -q 'Theme.Xindoze.Splash' "$DIST/xindoze-debug.apk"
echo "apk checks passed"
