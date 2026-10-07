#!/bin/sh
# Check a staged Native layout. Does not read or write /boot.
# QEMU (XZ_NATIVE_QEMU=1) is refused outside GitHub Actions and is not wired:
# this track does not fetch a kernel or boot the host firmware.
set -eu

if [ "${XZ_NATIVE_BUILD:-}" != "1" ]; then
  echo "native/test-boot.sh: refused. Set XZ_NATIVE_BUILD=1. This script never reads or writes /boot." >&2
  exit 2
fi

if [ "${XZ_NATIVE_QEMU:-}" = "1" ]; then
  echo "native/test-boot.sh: QEMU boot is not wired. Refusing to use the host /boot." >&2
  exit 2
fi

if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${XZ_NATIVE_LAYOUT_ONLY:-}" != "1" ]; then
  echo "native/test-boot.sh: native image checks run in GitHub Actions, or locally with XZ_NATIVE_LAYOUT_ONLY=1." >&2
  exit 2
fi

ARCH="${1:-x86_64}"
case "$ARCH" in
  x86_64|aarch64) ;;
  *)
    echo "native/test-boot.sh: arch must be x86_64 or aarch64" >&2
    exit 2
    ;;
esac

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT="${XZ_NATIVE_OUT:-$ROOT/native/out}"
ROOTFS="$OUT/rootfs"

test -f "$ROOTFS/etc/xindoze/boot.json"
grep -q "Xindoze has evolved." "$ROOTFS/etc/xindoze/boot.json"
grep -q '"ancestor_terminal": false' "$ROOTFS/etc/xindoze/boot.json"
test -f "$ROOTFS/etc/init.d/xinod"
test -f "$ROOTFS/usr/libexec/xindoze-session"
test -h "$ROOTFS/etc/runlevels/default/xinod"
test -h "$ROOTFS/etc/runlevels/default/xindoze-session"
test ! -e "$ROOTFS/etc/runlevels/default/xindoze-ancestor"
echo "native layout ok ($ARCH)"
