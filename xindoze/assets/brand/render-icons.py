#!/usr/bin/env python3
"""Render Xindoze launcher icons, splash screens and the wordmark from the SVG masters.

Requires Pillow and CairoSVG. Inter SemiBold (OFL) is used only to outline the wordmark.
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
import cairosvg

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]  # xindoze/
ICONS = REPO / "shell" / "src-tauri" / "icons"
BRAND = ROOT
OBSIDIAN = (11, 13, 16, 255)  # #0B0D10

SMALL_AT = 32  # inclusive: this size and below use logo-small.svg


def render_svg(path: Path, size: int) -> Image.Image:
    png = cairosvg.svg2png(url=str(path), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def render_svg_box(path: Path, width: int, height: int) -> Image.Image:
    png = cairosvg.svg2png(url=str(path), output_width=width, output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


def round_mask(size: int, margin: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    inner = size - 2 * margin
    radius = min(radius, max(inner // 2, 0))
    box = [margin, margin, size - margin - 1, size - margin - 1]
    draw.rounded_rectangle(box, radius=radius, fill=255)
    return mask


def masked_launcher(art: Image.Image, size: int, margin: int, radius: int) -> Image.Image:
    """Tauri-style inset: scale the tile down by the margin, then clip the corners."""
    inner = size - 2 * margin
    tile = art.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(tile, (margin, margin), tile)
    mask = round_mask(size, margin, radius)
    r, g, b, a = canvas.split()
    a = ImageChops.multiply(a, mask)
    canvas.putalpha(a)
    return canvas


def write_ico(path: Path, images: list[Image.Image]) -> None:
    pngs: list[bytes] = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        pngs.append(buf.getvalue())
    count = len(pngs)
    blob = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    payload = b""
    for im, png in zip(images, pngs):
        w, h = im.size
        bw = 0 if w >= 256 else w
        bh = 0 if h >= 256 else h
        entries += struct.pack("<BBBBHHII", bw, bh, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        payload += png
    path.write_bytes(blob + entries + payload)


def write_icns(path: Path, sized: dict[int, bytes]) -> None:
    # PNG icons. ic11/ic12/ic13/ic14 are the @2x types Tauri's icns set uses.
    mapping = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"ic11", 32),
        (b"icp6", 64),
        (b"ic12", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic13", 256),
        (b"ic09", 512),
        (b"ic14", 512),
        (b"ic10", 1024),
    ]
    chunks = []
    for ost, size in mapping:
        png = sized[size]
        chunks.append(ost + struct.pack(">I", len(png) + 8) + png)
    body = b"".join(chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def tile_for(size: int) -> Image.Image:
    src = BRAND / ("logo-small.svg" if size <= SMALL_AT else "logo.svg")
    # Supersample tiny sizes so the curves stay smooth, then downscale.
    if size <= SMALL_AT:
        big = render_svg(src, max(size * 4, 128))
        return big.resize((size, size), Image.Resampling.LANCZOS)
    return render_svg(src, size)


def splash_svg(width: int, height: int) -> str:
    short = min(width, height)
    mark = int(short * 0.34)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#0B0D10"/>
  <svg x="{(width - mark) / 2:.2f}" y="{(height - mark) / 2:.2f}" width="{mark}" height="{mark}" viewBox="0 0 1024 1024">
    <g stroke-linecap="round" fill="none" stroke-width="112">
      <path d="M236 176C552 330 552 694 236 848" stroke="#FF5A1F"/>
      <path d="M788 176C472 330 472 694 788 848" stroke="#2BF5C4"/>
    </g>
    <circle cx="512" cy="512" r="48" fill="#0B0D10"/>
    <circle cx="512" cy="512" r="30" fill="#EDE8DF"/>
  </svg>
</svg>"""


def write_splash_png(width: int, height: int, path: Path) -> None:
    png = cairosvg.svg2png(bytestring=splash_svg(width, height).encode(), output_width=width, output_height=height)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def android_vectors() -> None:
    res = ICONS / "android"
    drawable = res / "drawable"
    drawable.mkdir(parents=True, exist_ok=True)
    # Paths are the 1024 master, scaled so a 112-wide stroke stays inside the 66/108 safe circle.
    # translate 14.84, scale 0.07653. Stroke width 112 * 0.07653 = 8.57 in the 108 viewport.
    # Baked into path data so Android's vector renderer does not drop the group scale on the stroke.
    ic = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="M32.9,28.3C57.1,40.1 57.1,67.9 32.9,79.7"
        android:strokeColor="#FF5A1F"
        android:strokeWidth="8.6"
        android:strokeLineCap="round"
        android:fillColor="#00000000"/>
    <path
        android:pathData="M75.1,28.3C50.9,40.1 50.9,67.9 75.1,79.7"
        android:strokeColor="#2BF5C4"
        android:strokeWidth="8.6"
        android:strokeLineCap="round"
        android:fillColor="#00000000"/>
    <path
        android:pathData="M54,51.7a2.3,2.3 0,1 1,0 4.6a2.3,2.3 0,1 1,0 -4.6"
        android:fillColor="#EDE8DF"/>
</vector>
"""
    (drawable / "ic_splash.xml").write_text(ic)
    (drawable / "ic_stat_xindoze.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M6.2,4.2C11.2,8.2 11.2,15.8 6.2,19.8"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.6"
        android:strokeLineCap="round"
        android:fillColor="#00000000"/>
    <path
        android:pathData="M17.8,4.2C12.8,8.2 12.8,15.8 17.8,19.8"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.6"
        android:strokeLineCap="round"
        android:fillColor="#00000000"/>
</vector>
"""
    )
    (drawable / "splash.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/xindoze_splash_background"/>
    <item
        android:gravity="center"
        android:width="192dp"
        android:height="192dp"
        android:drawable="@drawable/ic_splash"/>
</layer-list>
"""
    )
    values = res / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "colors_splash.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="xindoze_splash_background">#0B0D10</color>
</resources>
"""
    )
    (values / "themes_splash.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Pre-Android 12 fallback: full-screen Obsidian with the mark centered. -->
    <style name="Theme.Xindoze.Splash" parent="@android:style/Theme.DeviceDefault.NoActionBar">
        <item name="android:windowBackground">@drawable/splash</item>
        <item name="android:statusBarColor">@color/xindoze_splash_background</item>
        <item name="android:navigationBarColor">@color/xindoze_splash_background</item>
        <item name="android:windowNoTitle">true</item>
    </style>
</resources>
"""
    )
    v31 = res / "values-v31"
    v31.mkdir(parents=True, exist_ok=True)
    (v31 / "themes_splash.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Android 12+ SplashScreen API. Icon sits on Obsidian. postSplash is the app theme. -->
    <style name="Theme.Xindoze.Splash" parent="@android:style/Theme.DeviceDefault.NoActionBar">
        <item name="android:windowSplashScreenBackground">@color/xindoze_splash_background</item>
        <item name="android:windowSplashScreenAnimatedIcon">@drawable/ic_splash</item>
        <item name="android:windowSplashScreenIconBackgroundColor">@color/xindoze_splash_background</item>
        <item name="android:windowBackground">@drawable/splash</item>
        <item name="android:statusBarColor">@color/xindoze_splash_background</item>
        <item name="android:navigationBarColor">@color/xindoze_splash_background</item>
    </style>
</resources>
"""
    )


def find_inter() -> Path:
    candidates = [
        Path("/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf"),
        Path("/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf"),
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise SystemExit("Inter SemiBold (OFL) not found; cannot outline the wordmark")


def write_wordmarks() -> None:
    from fontTools.ttLib import TTFont
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen

    font = TTFont(find_inter())
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    text = "Xindoze"
    em_px = 640.0
    scale = em_px / upem

    commands: list[str] = []
    x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyph_set)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x * scale, 0))
        glyph_set[name].draw(tpen)
        commands.append(pen.getCommands())
        x += glyph_set[name].width

    bounds = BoundsPen(glyph_set)
    x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        tpen = TransformPen(bounds, (scale, 0, 0, -scale, x * scale, 0))
        glyph_set[name].draw(tpen)
        x += glyph_set[name].width
    xmin, ymin, xmax, ymax = bounds.bounds
    pad = 8
    text_w = xmax - xmin
    text_h = ymax - ymin
    # Mark sits at the same visual height as the text block.
    mark = text_h
    gap = text_h * 0.28
    total_w = mark + gap + text_w + pad * 2
    total_h = text_h + pad * 2
    text_x = pad + mark + gap - xmin
    text_y = pad - ymin
    mark_y = pad

    def svg(fill: str) -> str:
        paths = "".join(f'<path d="{d}"/>' for d in commands if d)
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.2f} {total_h:.2f}" fill="none">
  <title>Xindoze wordmark</title>
  <svg x="{pad:.2f}" y="{mark_y:.2f}" width="{mark:.2f}" height="{mark:.2f}" viewBox="180 120 664 784">
    <g stroke-linecap="round" fill="none" stroke-width="112">
      <path d="M236 176C552 330 552 694 236 848" stroke="#FF5A1F"/>
      <path d="M788 176C472 330 472 694 788 848" stroke="#2BF5C4"/>
    </g>
    <circle cx="512" cy="512" r="48" fill="#0B0D10"/>
    <circle cx="512" cy="512" r="30" fill="#EDE8DF"/>
  </svg>
  <g transform="translate({text_x:.2f} {text_y:.2f})" fill="{fill}">
    {paths}
  </g>
</svg>
'''

    (BRAND / "wordmark.svg").write_text(svg("#EDE8DF"))
    (BRAND / "wordmark-light.svg").write_text(svg("#0B0D10"))


def expected_sizes() -> dict[Path, tuple[int, int]]:
    icons = ICONS
    out: dict[Path, tuple[int, int]] = {
        icons / "32x32.png": (32, 32),
        icons / "128x128.png": (128, 128),
        icons / "128x128@2x.png": (256, 256),
        icons / "icon.png": (512, 512),
        icons / "Square30x30Logo.png": (30, 30),
        icons / "Square44x44Logo.png": (44, 44),
        icons / "Square71x71Logo.png": (71, 71),
        icons / "Square89x89Logo.png": (89, 89),
        icons / "Square107x107Logo.png": (107, 107),
        icons / "Square142x142Logo.png": (142, 142),
        icons / "Square150x150Logo.png": (150, 150),
        icons / "Square284x284Logo.png": (284, 284),
        icons / "Square310x310Logo.png": (310, 310),
        icons / "StoreLogo.png": (50, 50),
    }
    launchers = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for density, (launcher, foreground) in launchers.items():
        folder = icons / "android" / f"mipmap-{density}"
        out[folder / "ic_launcher.png"] = (launcher, launcher)
        out[folder / "ic_launcher_round.png"] = (launcher, launcher)
        out[folder / "ic_launcher_foreground.png"] = (foreground, foreground)
    return out


def assert_sizes() -> None:
    for path, (w, h) in expected_sizes().items():
        im = Image.open(path)
        if im.size != (w, h):
            raise SystemExit(f"{path} is {im.size}, expected {(w, h)}")


def contact_sheet() -> None:
    """A first sheet of the launcher, the foreground and the splash. Canvas icons are added later."""
    sheet = Image.new("RGB", (1400, 980), (11, 13, 16))
    draw = ImageDraw.Draw(sheet)
    draw.text((32, 24), "Xindoze  launcher  +  splash", fill=(237, 232, 223))

    tiles = [
        (ICONS / "icon.png", 256),
        (ICONS / "128x128.png", 128),
        (ICONS / "32x32.png", 64),
        (ICONS / "android" / "mipmap-xxxhdpi" / "ic_launcher.png", 192),
        (ICONS / "android" / "mipmap-xxxhdpi" / "ic_launcher_round.png", 192),
        (ICONS / "android" / "mipmap-xxxhdpi" / "ic_launcher_foreground.png", 220),
    ]
    x = 32
    y = 70
    for path, box in tiles:
        im = Image.open(path).convert("RGBA")
        im.thumbnail((box, box), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (box, box), (0, 0, 0, 0))
        frame.paste(im, ((box - im.width) // 2, (box - im.height) // 2), im)
        # Checker under the foreground so the safe-zone padding is visible.
        if "foreground" in path.name:
            checker = Image.new("RGBA", (box, box), (26, 30, 36, 255))
            sheet.paste(checker, (x, y))
        sheet.paste(frame, (x, y), frame)
        draw.text((x, y + box + 6), path.name, fill=(162, 157, 148))
        x += box + 28
        if x > 1180:
            x = 32
            y += box + 48

    splash = Image.open(BRAND / "splash" / "splash-1080x2400.png").convert("RGB")
    splash.thumbnail((220, 480), Image.Resampling.LANCZOS)
    sheet.paste(splash, (32, 520))
    draw.text((32, 520 + splash.height + 8), "splash 1080x2400", fill=(162, 157, 148))

    word = BRAND / "wordmark.svg"
    if word.is_file():
        im = render_svg_box(word, 720, 160)
        sheet.paste(im, (280, 640), im)

    save_png(sheet.convert("RGBA"), BRAND / "preview.png")


def main() -> None:
    write_wordmarks()

    # Desktop and store tiles. Same file names and pixel sizes as the Tauri set.
    desktop = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    rendered: dict[int, Image.Image] = {}
    for name, size in desktop.items():
        im = tile_for(size)
        rendered[size] = im
        save_png(im, ICONS / name)

    # Also the loose shell master used beside the Tauri set.
    save_png(render_svg(BRAND / "logo.svg", 1024), REPO / "shell" / "icons" / "xindoze-1024.png")
    (REPO / "shell" / "icons" / "xindoze.svg").write_text((BRAND / "logo.svg").read_text())
    (REPO / "shell" / "ui" / "public" / "favicon.svg").write_text((BRAND / "logo.svg").read_text())

    for size in (16, 24, 48, 64, 1024):
        if size not in rendered:
            rendered[size] = tile_for(size)
    ico_sizes = [16, 24, 32, 48, 64, 256]
    write_ico(ICONS / "icon.ico", [rendered[s] for s in ico_sizes])
    icns_sizes = [16, 32, 64, 128, 256, 512, 1024]
    write_icns(ICONS / "icon.icns", {s: png_bytes(rendered[s]) for s in icns_sizes})

    # Android. Foreground is the safe-zone SVG. Launchers are masked tiles on Obsidian.
    densities = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    # Square bleed (no baked corner radius) so the mask owns the shape.
    bleed = Image.new("RGBA", (1024, 1024), OBSIDIAN)
    mark = render_svg(BRAND / "mark.svg", 1024)
    bleed.paste(mark, (0, 0), mark)

    for density, (launcher, foreground) in densities.items():
        folder = ICONS / "android" / f"mipmap-{density}"
        regular_r = round(launcher * 0.0833)
        save_png(masked_launcher(bleed, launcher, regular_r, regular_r), folder / "ic_launcher.png")
        round_m = round(launcher * 0.04)
        save_png(masked_launcher(bleed, launcher, round_m, round(launcher * 0.5)), folder / "ic_launcher_round.png")
        save_png(render_svg(BRAND / "adaptive-foreground.svg", foreground), folder / "ic_launcher_foreground.png")

    android_vectors()

    splash_dir = BRAND / "splash"
    for w, h in ((720, 1280), (1080, 1920), (1080, 2400), (1440, 2560), (1440, 3120)):
        write_splash_png(w, h, splash_dir / f"splash-{w}x{h}.png")
    write_splash_png(1080, 2400, ICONS / "android" / "drawable-nodpi" / "xindoze_splash.png")

    # Mirror the Android XML the launcher project should copy, next to the PNG set.
    mirror = splash_dir / "res"
    for src in [
        ICONS / "android" / "drawable" / "ic_splash.xml",
        ICONS / "android" / "drawable" / "splash.xml",
        ICONS / "android" / "drawable" / "ic_stat_xindoze.xml",
        ICONS / "android" / "values" / "colors_splash.xml",
        ICONS / "android" / "values" / "themes_splash.xml",
        ICONS / "android" / "values-v31" / "themes_splash.xml",
    ]:
        dest = mirror / src.relative_to(ICONS / "android")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(src.read_text())

    assert_sizes()
    contact_sheet()
    print("rendered", len(list(expected_sizes())), "png sizes ok")


if __name__ == "__main__":
    sys.exit(main())
