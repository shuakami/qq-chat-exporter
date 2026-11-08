#!/usr/bin/env python3
"""Generate timetable-style "Download for X" SVG buttons for GitHub releases.

Button geometry and styling copy shuakami/timetable docs/download-android.svg:
white rounded rect, dual drop shadow, hairline border, 18px brand icon,
vertical divider at x=35.5, and label text converted to vector paths.

Icon sources (24x24 viewBox, all CC0-1.0):
- linux/macos/qqnt/napcat: raw simple-icons SVGs in
  scripts/download-button-icons/ (Tux, Apple, QQ, Box marks)
- windows: four-pane geometry from simple-icons with Microsoft's official
  pane colors (#F25022 / #7FBA00 / #00A4EF / #FFB900)

Requires fontTools (`pip install fonttools`) and a TrueType font containing
the label glyphs. Override with QCE_BUTTON_FONT=/path/to/font.ttf.
"""

import math
import os
import re
import sys
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs"
ICON_DIR = Path(__file__).resolve().parent / "download-button-icons"

# --- Layout constants (match timetable download-android.svg) ---
VIEW_Y, VIEW_H = -4, 50
RECT_H = 36
ICON_POS = (9.0, 9.0)
ICON_SCALE = 0.75  # 24-unit icon box -> 18px
DIVIDER_X = 35.5
TEXT_X = 48.9
CAP_TOP = 12.85
CAP_PX = 10.19  # cap height of the label, matches timetable glyph metrics
BASELINE_Y = CAP_TOP + CAP_PX  # 23.04
RIGHT_PAD = 15.0
MIN_RECT_W = 120.0

FONT_CANDIDATES = [
    os.environ.get("QCE_BUTTON_FONT"),
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# simple-icons windows.svg pane geometry (viewBox 0 0 24 24), official colors
WINDOWS_ICON = (
    '<rect width="11.377" height="11.372" fill="#F25022"/>'
    '<rect x="12.623" width="11.377" height="11.372" fill="#7FBA00"/>'
    '<rect y="12.623" width="11.377" height="11.377" fill="#00A4EF"/>'
    '<rect x="12.623" y="12.623" width="11.377" height="11.377" fill="#FFB900"/>'
)

BUTTONS = [
    # (filename, label, aria-label, icon key)
    ("download-windows.svg", "Download for Windows", "Download for Windows", "windows"),
    ("download-windows-shell.svg", "Download Windows Shell", "Download Windows Shell package", "windows"),
    ("download-linux.svg", "Download for Linux", "Download for Linux", "linux"),
    ("download-macos.svg", "Download for macOS", "Download for macOS", "macos"),
    ("download-qqnt.svg", "Download for QQNT", "Download for QQNT (Framework mode)", "qqnt"),
    ("download-napcat-plugin.svg", "Download NapCat Plugin", "Download NapCat plugin package", "napcat"),
]


def find_font():
    for cand in FONT_CANDIDATES:
        if cand and Path(cand).is_file():
            return Path(cand)
    sys.exit("error: no usable font found; set QCE_BUTTON_FONT")


def icon_markup(key):
    if key == "windows":
        inner = WINDOWS_ICON
    else:
        src = (ICON_DIR / f"{key}.svg").read_text(encoding="utf-8")
        m = re.search(r'<path d="([^"]+)"', src)
        if not m:
            sys.exit(f"error: no <path> in {src}")
        inner = f'<path fill="#171717" d="{m.group(1)}"/>'
    tx, ty = ICON_POS
    return f'<g transform="translate({tx} {ty}) scale({ICON_SCALE})">{inner}</g>'


def rounded(v, nd=2):
    r = round(v, nd)
    if r == int(r):
        return str(int(r))
    return f"{r:.{nd}f}".rstrip("0").rstrip(".")


def text_to_path(font, label):
    """Render label as one <path> d string plus ink bounds, matching the
    timetable metrics (cap top 12.85, baseline 23.04)."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    hb = BoundsPen(gs)
    gs[cmap[ord("H")]].draw(hb)
    cap_h = hb.bounds[3] - hb.bounds[1]
    scale = CAP_PX / cap_h

    d_parts = []
    x = 0.0
    bounds = None
    for ch in label:
        gname = cmap.get(ord(ch))
        if gname is None:
            raise ValueError(f"font lacks glyph for {ch!r}")
        glyph = gs[gname]
        adv = hmtx[gname][0] * scale
        transform = Transform(scale, 0, 0, -scale, TEXT_X + x, BASELINE_Y)

        spen = SVGPathPen(gs)
        glyph.draw(TransformPen(spen, transform))
        cmd = spen.getCommands()
        if cmd:
            d_parts.append(cmd)

        bpen = BoundsPen(gs)
        glyph.draw(TransformPen(bpen, transform))
        if bpen.bounds is not None:
            b = bpen.bounds
            cur = (b[0], b[1], b[2], b[3])
            bounds = cur if bounds is None else (
                min(bounds[0], cur[0]), min(bounds[1], cur[1]),
                max(bounds[2], cur[2]), max(bounds[3], cur[3]),
            )
        x += adv

    d = " ".join(d_parts)
    d = re.sub(r"(-?\d+\.\d{3,})", lambda m: rounded(float(m.group(1))), d)
    return d, bounds


def build_svg(label, aria, icon_key, font):
    d, bounds = text_to_path(font, label)
    text_right = bounds[2] if bounds else TEXT_X
    rect_w = max(MIN_RECT_W, math.ceil(text_right + RIGHT_PAD))
    total_w = int(rect_w) + 9

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="50" '
        f'viewBox="-1 -4 {total_w} 50" fill="none" role="img" aria-label="{aria}">\n'
        '  <defs>\n'
        '    <filter id="s" x="-10%" y="-30%" width="120%" height="180%" color-interpolation-filters="sRGB">\n'
        '      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#0A0A0A" flood-opacity=".06"/>\n'
        '      <feDropShadow dx="1" dy="3" stdDeviation="3" flood-color="#0A0A0A" flood-opacity=".04"/>\n'
        "    </filter>\n"
        "  </defs>\n"
        f'  <rect width="{rect_w}" height="{RECT_H}" fill="#fff" rx="9" filter="url(#s)"/>\n'
        f'  <rect width="{rect_w - 1}" height="35" x=".5" y=".5" stroke="#000" stroke-opacity=".08" rx="8.5"/>\n'
        f"  {icon_markup(icon_key)}\n"
        f'  <path stroke="#000" stroke-opacity=".08" d="M{DIVIDER_X} 1v34"/>\n'
        f'  <path fill="#171717" d="{d}"/>\n'
        "</svg>\n"
    )


def main():
    font = TTFont(str(find_font()))
    print(f"font: {find_font()}")

    for filename, label, aria, icon_key in BUTTONS:
        svg = build_svg(label, aria, icon_key, font)
        out = OUT_DIR / filename
        out.write_text(svg, encoding="utf-8")
        w = re.search(r'width="(\d+)" height="50"', svg).group(1)
        print(f"{filename}: {w}x50  label={label!r}")


if __name__ == "__main__":
    main()
