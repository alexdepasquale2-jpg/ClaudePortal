#!/usr/bin/env python3
"""Xindoze desktop wallpapers. Low contrast, quiet centre, chromosome X at the edges.

Writes SVG (any resolution) and PNG at 1920x1080 and 3840x2160.
Run: python3 xindoze/assets/canvas/make_canvas.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
OBSIDIAN = (11, 13, 16)
BONE = (237, 232, 223)
EMBER = (255, 90, 31)
BIOLUME = (43, 245, 196)
BIOLUME_INK = (11, 143, 114)

# Two chromatids, each passing through the origin (the centromere).
LEFT = [(-118, -198), (48, -96), (36, -36), (0, 0), (-36, 48), (-52, 112), (-128, 208)]
RIGHT = [(118, -198), (-48, -96), (-36, -36), (0, 0), (36, 48), (52, 112), (128, 208)]

# (nx, ny, rot deg, scale, opacity) — kept off the header, the dock, and the quiet middle.
MARKS = [
    (0.09, 0.16, -16, 0.62, 0.16),
    (0.90, 0.14, 22, 0.48, 0.13),
    (0.07, 0.78, 10, 0.78, 0.15),
    (0.93, 0.80, -28, 0.55, 0.14),
    (0.16, 0.46, 6, 0.36, 0.11),
    (0.84, 0.50, -8, 0.40, 0.11),
    (0.50, 0.06, 0, 0.26, 0.07),
]


def cubic(p0, p1, p2, p3, n=40) -> np.ndarray:
    t = np.linspace(0, 1, n)[:, None]
    u = 1 - t
    return u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3


def chromatid(pts) -> np.ndarray:
    a = np.array(pts[:4], dtype=float)
    b = np.array([pts[3], pts[4], pts[5], pts[6]], dtype=float)
    return np.vstack([cubic(*a), cubic(*b)[1:]])


LEFT_PTS = chromatid(LEFT)
RIGHT_PTS = chromatid(RIGHT)


def svg_path(pts) -> str:
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    # Rebuild as the two original cubics so the file stays crisp.
    return ""


def path_d(pts) -> str:
    p = pts
    return (
        f"M{p[0][0]} {p[0][1]}C{p[1][0]} {p[1][1]} {p[2][0]} {p[2][1]} {p[3][0]} {p[3][1]}"
        f"C{p[4][0]} {p[4][1]} {p[5][0]} {p[5][1]} {p[6][0]} {p[6][1]}"
    )


LEFT_D = path_d(LEFT)
RIGHT_D = path_d(RIGHT)


def theme(dark: bool) -> dict:
    if dark:
        return {
            "name": "dark",
            "bg": "#0B0D10",
            "rgb": OBSIDIAN,
            "ink": "#EDE8DF",
            "ink_rgb": BONE,
            "glow": "#2BF5C4",
            "glow_rgb": BIOLUME,
            "ember": "#FF5A1F",
            "vignette": "0,0,0",
            "vig_op": 0.45,
        }
    return {
        "name": "light",
        "bg": "#EDE8DF",
        "rgb": BONE,
        "ink": "#0B0D10",
        "ink_rgb": OBSIDIAN,
        "glow": "#0B8F72",
        "glow_rgb": BIOLUME_INK,
        "ember": "#FF5A1F",
        "vignette": "90,78,62",
        "vig_op": 0.18,
    }


BLOOMS = [
    (0.22, 0.76, 0.28, "ink", 0.07),
    (0.78, 0.22, 0.26, "glow", 0.055),
    (0.50, 0.50, 0.38, "ink", 0.035),
    (0.10, 0.18, 0.16, "ink", 0.05),
    (0.88, 0.84, 0.20, "ember", 0.045),
    (0.58, 0.90, 0.14, "glow", 0.04),
    (0.06, 0.55, 0.13, "ink", 0.045),
]

MEMBRANES = [
    (0.12, 0.20, 0.07, 0.09, 0.22),
    (0.86, 0.16, 0.09, 0.06, 0.16),
    (0.08, 0.62, 0.05, 0.08, 0.18),
    (0.92, 0.58, 0.06, 0.09, 0.16),
    (0.18, 0.88, 0.08, 0.05, 0.14),
    (0.80, 0.86, 0.07, 0.06, 0.15),
    (0.30, 0.10, 0.04, 0.035, 0.12),
    (0.72, 0.08, 0.05, 0.04, 0.1),
    (0.04, 0.40, 0.035, 0.05, 0.12),
    (0.96, 0.38, 0.03, 0.045, 0.12),
]

SPECKS = [
    (0.14, 0.32, 2.2, "glow"),
    (0.20, 0.70, 1.6, "glow"),
    (0.11, 0.84, 2.4, "ember"),
    (0.28, 0.14, 1.4, "glow"),
    (0.74, 0.12, 1.8, "ember"),
    (0.88, 0.30, 2.0, "glow"),
    (0.94, 0.72, 1.5, "glow"),
    (0.70, 0.90, 2.2, "ember"),
    (0.40, 0.92, 1.3, "glow"),
    (0.06, 0.48, 1.7, "glow"),
    (0.97, 0.50, 1.4, "ember"),
    (0.84, 0.42, 1.2, "glow"),
]


def write_svg(dark: bool) -> None:
    t = theme(dark)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="Xindoze wallpaper, {t["name"]}">',
        "<defs>",
        f'<g id="chromosome" fill="none" stroke-linecap="round" stroke-linejoin="round">',
        f'<path d="{LEFT_D}" stroke="currentColor" stroke-width="22"/>',
        f'<path d="{RIGHT_D}" stroke="currentColor" stroke-width="22"/>',
        '<circle cx="0" cy="0" r="11" fill="currentColor"/>',
        f'<circle cx="0" cy="0" r="4.5" fill="{t["glow"]}"/>',
        "</g>",
        f'<radialGradient id="vig" cx="50%" cy="46%" r="72%">',
        '<stop offset="55%" stop-color="#000" stop-opacity="0"/>',
        f'<stop offset="100%" stop-color="rgb({t["vignette"]})" stop-opacity="{t["vig_op"]}"/>',
        "</radialGradient>",
    ]
    for i, (nx, ny, r, tone, _op) in enumerate(BLOOMS):
        color = {"ink": t["ink"], "glow": t["glow"], "ember": t["ember"]}[tone]
        parts.append(
            f'<radialGradient id="b{i}" gradientUnits="userSpaceOnUse" cx="{nx*1920:.0f}" cy="{ny*1080:.0f}" r="{r*1920:.0f}">'
            f'<stop offset="0" stop-color="{color}" stop-opacity="1"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="0"/>'
            "</radialGradient>"
        )
    parts.append("</defs>")
    parts.append(f'<rect width="1920" height="1080" fill="{t["bg"]}"/>')
    for i, (*_, op) in enumerate(BLOOMS):
        parts.append(f'<rect width="1920" height="1080" fill="url(#b{i})" opacity="{op:.3f}"/>')
    for nx, ny, rx, ry, op in MEMBRANES:
        parts.append(
            f'<ellipse cx="{nx*1920:.0f}" cy="{ny*1080:.0f}" rx="{rx*1920:.0f}" ry="{ry*1080:.0f}" '
            f'fill="none" stroke="{t["ink"]}" stroke-width="1.5" opacity="{op:.2f}"/>'
        )
    for nx, ny, rot, scale, op in MARKS:
        parts.append(
            f'<use href="#chromosome" color="{t["ink"]}" opacity="{op:.2f}" '
            f'transform="translate({nx*1920:.0f} {ny*1080:.0f}) rotate({rot}) scale({scale:.2f})"/>'
        )
    for nx, ny, rad, tone in SPECKS:
        color = t["glow"] if tone == "glow" else t["ember"]
        parts.append(
            f'<circle cx="{nx*1920:.1f}" cy="{ny*1080:.1f}" r="{rad}" fill="{color}" opacity="0.55"/>'
        )
    parts.append('<rect width="1920" height="1080" fill="url(#vig)"/>')
    parts.append("</svg>")
    (HERE / f"wallpaper-{t['name']}.svg").write_text("\n".join(parts) + "\n", encoding="utf-8")


def soft_blob(base: Image.Image, cx, cy, rx, ry, rgb, alpha: int, blur: int) -> None:
    pad = blur * 3 + 4
    left, top = int(cx - rx) - pad, int(cy - ry) - pad
    right, bottom = int(cx + rx) + pad, int(cy + ry) + pad
    tw, th = right - left, bottom - top
    if tw < 4 or th < 4:
        return
    tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    ImageDraw.Draw(tile).ellipse([pad, pad, pad + 2 * rx, pad + 2 * ry], fill=(*rgb, alpha))
    if blur:
        tile = tile.filter(ImageFilter.GaussianBlur(radius=blur))
    W, H = base.size
    sx, sy = max(0, -left), max(0, -top)
    dx, dy = max(0, left), max(0, top)
    dw, dh = min(W, right) - dx, min(H, bottom) - dy
    if dw <= 0 or dh <= 0:
        return
    base.alpha_composite(tile.crop((sx, sy, sx + dw, sy + dh)), (dx, dy))


def rot_pts(pts: np.ndarray, rot: float, scale: float, origin) -> np.ndarray:
    a = np.deg2rad(rot)
    c, s = np.cos(a), np.sin(a)
    m = np.array([[c, -s], [s, c]])
    return pts * scale @ m.T + np.array(origin)


def stroke(draw: ImageDraw.ImageDraw, pts: np.ndarray, fill, width: int) -> None:
    seq = [tuple(map(float, p)) for p in pts]
    draw.line(seq, fill=fill, width=width, joint="curve")


def render_png(dark: bool, w: int, h: int) -> None:
    t = theme(dark)
    base = Image.new("RGBA", (w, h), (*t["rgb"], 255))
    s = w / 1920
    for nx, ny, r, tone, op in BLOOMS:
        rgb = {"ink": t["ink_rgb"], "glow": t["glow_rgb"], "ember": EMBER}[tone]
        rad = r * w
        soft_blob(base, nx * w, ny * h, rad, rad * 0.82, rgb, int(op * 255), int(rad * 0.45))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    ink = (*t["ink_rgb"], 0)
    for nx, ny, rx, ry, op in MEMBRANES:
        box = [int((nx - rx) * w), int((ny - ry) * h), int((nx + rx) * w), int((ny + ry) * h)]
        draw.ellipse(box, outline=(*t["ink_rgb"], int(op * 255)), width=max(1, int(1.5 * s)))
    for nx, ny, rot, scale, op in MARKS:
        width = max(1, int(22 * scale * s))
        origin = (nx * w, ny * h)
        color = (*t["ink_rgb"], int(op * 255))
        stroke(draw, rot_pts(LEFT_PTS, rot, scale * s, origin), color, width)
        stroke(draw, rot_pts(RIGHT_PTS, rot, scale * s, origin), color, width)
        r = max(2, int(11 * scale * s))
        draw.ellipse([origin[0] - r, origin[1] - r, origin[0] + r, origin[1] + r], fill=color)
        cr = max(1, int(4.5 * scale * s))
        glow = (*t["glow_rgb"], int(min(255, op * 255 + 40)))
        draw.ellipse([origin[0] - cr, origin[1] - cr, origin[0] + cr, origin[1] + cr], fill=glow)
    for nx, ny, rad, tone in SPECKS:
        rgb = t["glow_rgb"] if tone == "glow" else EMBER
        rr = rad * s
        draw.ellipse([nx * w - rr, ny * h - rr, nx * w + rr, ny * h + rr], fill=(*rgb, 140))
    base = Image.alpha_composite(base, overlay)
    arr = np.asarray(base).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    nx = (xx - w / 2) / (w * 0.72)
    ny = (yy - h * 0.46) / (h * 0.72)
    vig = np.clip(nx * nx + ny * ny, 0, 1)
    vig = np.clip((vig - 0.35) / 0.65, 0, 1) ** 1.4
    shade = t["rgb"] if not dark else (0, 0, 0)
    # Pull edges slightly toward black (dark) or a deeper bone (light).
    edge = np.array([0, 0, 0] if dark else [196, 186, 170], dtype=np.float32)
    amount = vig * (0.42 if dark else 0.16)
    arr[:, :, :3] = arr[:, :, :3] * (1 - amount[..., None]) + edge * amount[..., None]
    img = Image.fromarray(arr.astype(np.uint8), "RGBA").convert("RGB")
    path = HERE / f"wallpaper-{t['name']}-{w}x{h}.png"
    img.save(path, optimize=True, compress_level=9)
    print(path.name, path.stat().st_size)


def main() -> None:
    for dark in (True, False):
        write_svg(dark)
        render_png(dark, 1920, 1080)
        render_png(dark, 3840, 2160)


if __name__ == "__main__":
    main()
