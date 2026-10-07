#!/bin/sh
# Render every launcher icon and the splash from the SVG masters in this directory.
# Needs Python 3, Pillow and CairoSVG (libcairo). Inter SemiBold outlines the wordmark.
set -eu
cd "$(dirname "$0")"
exec python3 render-icons.py
