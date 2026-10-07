#!/usr/bin/env bash
# Build the debug APKs. Run on GitHub Actions, which has the Android SDK.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHELL_DIR="$ROOT/shell"
BRIDGE="$SHELL_DIR/plugins/android-bridge/android"
CPP="$BRIDGE/src/main/cpp"
ASSETS="$BRIDGE/src/main/assets/models"
DIST="$ROOT/dist/android"
MODEL_URL="https://huggingface.co/ggml-org/models-moved/resolve/main/tinyllamas/stories15M-q4_0.gguf"

export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${NDK_HOME:-}" && -n "${ANDROID_NDK_LATEST_HOME:-}" ]]; then
  export NDK_HOME="$ANDROID_NDK_LATEST_HOME"
fi
if [[ -z "${NDK_HOME:-}" && -d "$ANDROID_HOME/ndk" ]]; then
  export NDK_HOME
  NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
fi
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$NDK_HOME}"
export ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT:-$NDK_HOME}"
echo "ANDROID_HOME=$ANDROID_HOME"
echo "NDK_HOME=${NDK_HOME:-missing}"

mkdir -p "$ASSETS" "$DIST"
if [[ ! -s "$ASSETS/xindoze-tiny.gguf" ]]; then
  curl -fL --retry 3 -o "$ASSETS/xindoze-tiny.gguf" "$MODEL_URL"
fi
if [[ ! -f "$CPP/llama.cpp/CMakeLists.txt" ]]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$CPP/llama.cpp"
fi

cd "$SHELL_DIR/ui"
if [[ ! -d node_modules ]]; then
  npm ci
fi

cd "$SHELL_DIR"
export CI=true
npx --yes @tauri-apps/cli@2 android init --ci --skip-targets-install
npx --yes @tauri-apps/cli@2 android build --debug --apk --target aarch64

mapfile -t APKS < <(find "$SHELL_DIR/src-tauri/gen/android" -path '*outputs/apk*' -name '*.apk' -printf '%T@ %p\n' | sort -n | awk '{print $2}')
if [[ ${#APKS[@]} -eq 0 ]]; then
  echo "no apk produced" >&2
  exit 1
fi
FDROID="${APKS[-1]}"
cp "$FDROID" "$DIST/xindoze-fdroid-debug.apk"
echo "fdroid apk: $DIST/xindoze-fdroid-debug.apk"

# Play Lite: same binary tree, HOME takeover switched off, then rebuild resources.
PLAY_RES="$SHELL_DIR/src-tauri/gen/android/app/src/main/res/values"
mkdir -p "$PLAY_RES"
cat > "$PLAY_RES/xindoze_play.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="xindoze_home_launcher">false</bool>
    <string name="xindoze_edition">play</string>
</resources>
XML
cd "$SHELL_DIR/src-tauri/gen/android"
chmod +x ./gradlew
./gradlew :app:assembleDebug --offline || ./gradlew :app:assembleDebug
mapfile -t APKS < <(find "$SHELL_DIR/src-tauri/gen/android" -path '*outputs/apk*' -name '*.apk' -printf '%T@ %p\n' | sort -n | awk '{print $2}')
cp "${APKS[-1]}" "$DIST/xindoze-play-debug.apk"
rm -f "$PLAY_RES/xindoze_play.xml"
echo "play apk: $DIST/xindoze-play-debug.apk"

AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort | tail -1 || true)"
if [[ -n "$AAPT" ]]; then
  "$AAPT" dump xmltree "$DIST/xindoze-fdroid-debug.apk" AndroidManifest.xml > "$DIST/fdroid-manifest.txt"
  if grep -q 'AccessibilityService' "$DIST/fdroid-manifest.txt"; then
    echo "manifest contains AccessibilityService" >&2
    exit 1
  fi
  if grep -q 'SEND_SMS' "$DIST/fdroid-manifest.txt"; then
    echo "manifest contains SEND_SMS" >&2
    exit 1
  fi
  grep -q 'XinodService' "$DIST/fdroid-manifest.txt"
  grep -q 'HOME' "$DIST/fdroid-manifest.txt"
fi
unzip -l "$DIST/xindoze-fdroid-debug.apk" | tee "$DIST/fdroid-files.txt"
grep -q 'libxindoze_llama.so' "$DIST/fdroid-files.txt"
grep -q 'xindoze-tiny.gguf' "$DIST/fdroid-files.txt"
echo "apk checks passed"
