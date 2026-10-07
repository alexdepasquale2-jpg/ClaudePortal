#!/usr/bin/env python3
"""Desktop wallpapers. Soft cells and blurred copies of the brand X.

The chromatids are the mark from xindoze/assets/brand/logo.svg
(Ember M236 176C552 330 552 694 236 848, Biolume M788 176C472 330 472 694 788 848).
This script does not copy that folder. Run: python3 xindoze/assets/canvas/make_canvas.py
PNG rasters are written by the Chrome step documented in the assets README; this
script writes the SVG sources the shell actually paints.
"""

import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent

MARK = """
<g id="mark" fill="none" stroke-linecap="round" stroke-width="112">
  <path d="M236 176C552 330 552 694 236 848" stroke="#FF5A1F"/>
  <path d="M788 176C472 330 472 694 788 848" stroke="#2BF5C4"/>
</g>
""".strip()

# (cx, cy, scale, rotation deg, blur px, opacity) in a 1920x1080 field.
# Kept off the header, the dock, and the quiet middle.
MARKS = [
    (180, 860, 0.72, -18, 26, 0.22),
    (1760, 180, 0.58, 24, 20, 0.18),
    (120, 220, 0.42, 8, 14, 0.16),
    (1680, 900, 0.5, -12, 18, 0.16),
    (960, 1080, 0.9, 4, 36, 0.1),
    (40, 540, 0.36, 16, 12, 0.14),
    (1880, 480, 0.34, -20, 12, 0.13),
]

MEMBRANES = [
    (0.14, 0.22, 0.09, 0.11, 0.16),
    (0.86, 0.18, 0.1, 0.07, 0.13),
    (0.08, 0.62, 0.055, 0.09, 0.14),
    (0.93, 0.6, 0.07, 0.1, 0.12),
    (0.22, 0.9, 0.08, 0.05, 0.1),
    (0.78, 0.88, 0.075, 0.06, 0.11),
    (0.5, 0.08, 0.06, 0.04, 0.08),
]


def svg(dark: bool) -> str:
    bg = "#0B0D10" if dark else "#EDE8DF"
    ink = "#EDE8DF" if dark else "#0B0D10"
    name = "dark" if dark else "light"
    vig = "0,0,0" if dark else "120,108,90"
    vig_op = "0.42" if dark else "0.16"
    glow_scale = 1 if dark else 0.65
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="Xindoze wallpaper, {name}">',
        "<defs>",
        MARK,
    ]
    for blur in (12, 14, 18, 20, 26, 36):
        parts.append(
            f'<filter id="b{blur}" x="-80%" y="-80%" width="260%" height="260%">'
            f'<feGaussianBlur stdDeviation="{blur}"/></filter>'
        )
    pools = [
        ("p0", 0.18, 0.72, 0.34, "#2BF5C4", 0.55 * glow_scale),
        ("p1", 0.82, 0.2, 0.28, "#FF5A1F", 0.45 * glow_scale),
        ("p2", 0.5, 0.46, 0.42, ink, 0.22),
        ("p3", 0.72, 0.84, 0.2, "#2BF5C4", 0.35 * glow_scale),
        ("p4", 0.08, 0.16, 0.16, "#FF5A1F", 0.28 * glow_scale),
    ]
    for pid, nx, ny, r, color, _ in pools:
        parts.append(
            f'<radialGradient id="{pid}" gradientUnits="userSpaceOnUse" '
            f'cx="{nx * 1920:.0f}" cy="{ny * 1080:.0f}" r="{r * 1080:.0f}">'
            f'<stop offset="0" stop-color="{color}" stop-opacity="1"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="0"/>'
            f"</radialGradient>"
        )
    parts.append(
        f'<radialGradient id="vig" cx="50%" cy="46%" r="75%">'
        f'<stop offset="58%" stop-color="#000" stop-opacity="0"/>'
        f'<stop offset="100%" stop-color="rgb({vig})" stop-opacity="{vig_op}"/>'
        f"</radialGradient>"
    )
    parts.append("</defs>")
    parts.append(f'<rect width="1920" height="1080" fill="{bg}"/>')
    for pid, *_rest, op in pools:
        parts.append(f'<rect width="1920" height="1080" fill="url(#{pid})" opacity="{op:.3f}"/>')
    for nx, ny, rx, ry, op in MEMBRANES:
        parts.append(
            f'<ellipse cx="{nx * 1920:.0f}" cy="{ny * 1080:.0f}" rx="{rx * 1920:.0f}" ry="{ry * 1080:.0f}" '
            f'fill="none" stroke="{ink}" stroke-width="1.6" opacity="{op:.2f}"/>'
        )
    for cx, cy, scale, rot, blur, op in MARKS:
        # Opacity is lower on Bone so the field stays quiet.
        shown = op if dark else op * 0.72
        parts.append(
            f'<use href="#mark" filter="url(#b{blur})" opacity="{shown:.3f}" '
            f'transform="translate({cx:.0f} {cy:.0f}) rotate({rot}) scale({scale:.2f}) translate(-512 -512)"/>'
        )
    parts.append('<rect width="1920" height="1080" fill="url(#vig)"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def raster(svg_path: Path, png_path: Path, width: int, height: int) -> None:
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable")
    if not chrome:
        raise SystemExit("google-chrome is required to rasterize wallpapers")
    page = HERE / f".raster-{png_path.stem}.html"
    bg = "#0B0D10" if "dark" in png_path.name else "#EDE8DF"
    page.write_text(
        f'<!doctype html><html><head><style>html,body{{margin:0;width:{width}px;height:{height}px;'
        f'overflow:hidden;background:{bg}}}img{{width:{width}px;height:{height}px;display:block}}</style></head>'
        f'<body><img src="{svg_path.name}" alt=""></body></html>',
        encoding="utf-8",
    )
    subprocess.run(
        [
            "timeout",
            "18",
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            f"--user-data-dir=/tmp/chrome-{png_path.stem}",
            "--force-device-scale-factor=1",
            "--hide-scrollbars",
            "--virtual-time-budget=400",
            f"--window-size={width},{height}",
            f"--screenshot={png_path}",
            page.as_uri(),
        ],
        check=False,
    )
    if not png_path.exists() or png_path.stat().st_size < 1000:
        raise SystemExit(f"raster failed: {png_path}")
    page.unlink(missing_ok=True)
    print(png_path.name, png_path.stat().st_size)


def main() -> None:
    for dark, name in ((True, "dark"), (False, "light")):
        path = HERE / f"wallpaper-{name}.svg"
        path.write_text(svg(dark), encoding="utf-8")
        print(path.name)
        raster(path, HERE / f"wallpaper-{name}-1920x1080.png", 1920, 1080)
        raster(path, HERE / f"wallpaper-{name}-3840x2160.png", 3840, 2160)


if __name__ == "__main__":
    main()
