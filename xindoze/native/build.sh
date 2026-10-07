#!/bin/sh
# Stage a Native Edition layout (Alpine + OpenRC + cage + xinod).
# Requires XZ_NATIVE_BUILD=1. Never writes /boot, EFI variables, or the host init.
# Image packing runs only on GitHub Actions. QEMU stays in test-boot.sh.
set -eu

if [ "${XZ_NATIVE_BUILD:-}" != "1" ]; then
  echo "native/build.sh: refused. Set XZ_NATIVE_BUILD=1 to stage a layout. Host boot is never modified." >&2
  exit 2
fi

ARCH="${1:-x86_64}"
case "$ARCH" in
  x86_64|aarch64) ;;
  *)
    echo "native/build.sh: arch must be x86_64 or aarch64" >&2
    exit 2
    ;;
esac

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT="${XZ_NATIVE_OUT:-$ROOT/native/out}"
case "$OUT" in
  /boot|/boot/*|/efi|/efi/*|/sys|/sys/*|/proc|/proc/*|/dev|/dev/*|/etc|/etc/*|/usr/lib/systemd|/usr/lib/systemd/*)
    echo "native/build.sh: refusing host path $OUT" >&2
    exit 3
    ;;
esac

if [ -n "${XZ_BOOT_BIN:-}" ]; then
  BIN=$XZ_BOOT_BIN
else
  if command -v rustup >/dev/null 2>&1; then
    (cd "$ROOT" && rustup run stable cargo build -p xz-boot --bin xz-boot)
  else
    (cd "$ROOT" && cargo build -p xz-boot --bin xz-boot)
  fi
  BIN=$ROOT/target/debug/xz-boot
fi

mkdir -p "$OUT"
"$BIN" render --arch "$ARCH" --out "$OUT/rootfs"
echo "layout: $OUT/rootfs"

if [ "${XZ_NATIVE_LAYOUT_ONLY:-}" = "1" ]; then
  exit 0
fi

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "native/build.sh: image packing stays on GitHub Actions. Layout is staged." >&2
  exit 0
fi

if ! command -v mke2fs >/dev/null 2>&1 || ! command -v truncate >/dev/null 2>&1; then
  echo "native/build.sh: mke2fs or truncate is missing; leaving the layout unpacked." >&2
  exit 0
fi

IMG="$OUT/xindoze-$ARCH.img"
rm -f "$IMG"
truncate -s 256M "$IMG"
mke2fs -t ext4 -d "$OUT/rootfs" -L xindoze -F "$IMG"
echo "image: $IMG"
