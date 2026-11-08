#!/usr/bin/env python3
"""Generate timetable-style "Download for X" SVG buttons for GitHub releases.

Button geometry and styling copy shuakami/timetable docs/download-android.svg:
white rounded rect, dual drop shadow, hairline border, 18px brand icon,
vertical divider at x=35.5, and label text converted to vector paths.

Icon sources (all fetched from the web, see scripts/download-button-icons/):
- linux/macos/qqnt: simple-icons SVGs (CC0-1.0) - Tux, Apple, QQ
- windows: icon path taken from shuakami/gagadown docs/download-windows.svg
  (flat four-pane mark in Microsoft blue #0078D4)
- napcat: VS Code codicon "extensions" (puzzle piece) from
  microsoft/vscode-codicons (MIT) - represents a plugin/extension

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
DIVIDER_X = 35.5
TEXT_X = 48.9
CAP_TOP = 12.85
CAP_PX = 10.19  # cap height of the label, matches timetable glyph metrics
BASELINE_Y = CAP_TOP + CAP_PX  # 23.04
RIGHT_PAD = 15.0
MIN_RECT_W = 120.0

# Optional per-button ribbon badge drawn inside the SVG (top strip, flush
# right, top-right + bottom-left corners rounded like rounded-[0_16px]).
# badge = (text, color) or None. macOS shell is preview/beta; the Windows
# installer is the recommended package.
BADGE_CAP_PX = 6.5
BADGE_BASELINE_Y = 9.4
BADGE_H = 12.0
BADGE_PAD_X = 5.0
BADGE_CORNER_R = 7.0
BADGE_PURPLE = "#8250df"  # best/recommended badge (GitHub purple)
BADGE_AMBER = "#d97706"  # beta/preview, deliberately not green

# CJK fallback for badge text (Segoe UI has no Chinese glyphs)
CJK_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyh.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]

FONT_CANDIDATES = [
    os.environ.get("QCE_BUTTON_FONT"),
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# Per-icon transform inside the 18px icon box at (9,9). Most icons are
# 24x24 marks -> scale(0.75). The Windows mark is also 24x24.
# The codicon puzzle piece is 16x16 -> scale(1.125).
ICON_TRANSFORMS = {
    "napcat": "translate(9.0 9.0) scale(1.125)",
}
DEFAULT_ICON_TRANSFORM = "translate(9.0 9.0) scale(0.75)"

# Display order in release bodies: the recommended Windows Installer sits
# in the C position (first row, second). The rest keep platform grouping.
BUTTONS = [
    # (filename, label, aria-label, icon key, badge=(text,color) or None)
    ("download-windows-shell.svg", "Download for Windows Shell", "Download for Windows Shell package", "windows", None),
    ("download-windows.svg", "Download for Windows Installer", "Download for Windows Installer (recommended)", "windows", ("Best", BADGE_PURPLE)),
    ("download-linux.svg", "Download for Linux Shell", "Download for Linux Shell", "linux", None),
    ("download-macos.svg", "Download for macOS Shell", "Download for macOS Shell (preview)", "macos", ("Beta", BADGE_AMBER)),
    ("download-windows-framework.svg", "Download for Windows Framework", "Download for Windows Framework (QQNT plugin)", "qqnt", None),
    ("download-napcat-plugin.svg", "Download for NapCat Plugin", "Download for NapCat Plugin", "napcat", None),
]


def find_font():
    for cand in FONT_CANDIDATES:
        if cand and Path(cand).is_file():
            return Path(cand)
    sys.exit("error: no usable font found; set QCE_BUTTON_FONT")


def icon_markup(key):
    src = (ICON_DIR / f"{key}.svg").read_text(encoding="utf-8")
    transform = ICON_TRANSFORMS.get(key, DEFAULT_ICON_TRANSFORM)
    tags = re.findall(r"<path\b[^>]*/?>", src)
    if not tags:
        sys.exit(f"error: no <path> in {ICON_DIR / (key + '.svg')}")
    inner = []
    for tag in tags:
        if "fill=" not in tag:
            if tag.rstrip().endswith("/>"):
                tag = tag.rstrip()[:-2] + ' fill="#171717"/>'
            else:
                tag = tag.rstrip()[:-1] + ' fill="#171717">'
        inner.append(tag)
    return f'<g transform="{transform}">{"".join(inner)}</g>'


def rounded(v, nd=2):
    r = round(v, nd)
    if r == int(r):
        return str(int(r))
    return f"{r:.{nd}f}".rstrip("0").rstrip(".")


def text_to_path(font, label, origin_x=TEXT_X, baseline_y=BASELINE_Y, cap_px=CAP_PX):
    """Render label as one <path> d string plus ink bounds. Default metrics
    match the timetable label (cap top 12.85, baseline 23.04)."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    hb = BoundsPen(gs)
    gs[cmap[ord("H")]].draw(hb)
    cap_h = hb.bounds[3] - hb.bounds[1]
    scale = cap_px / cap_h

    d_parts = []
    x = 0.0
    bounds = None
    for ch in label:
        gname = cmap.get(ord(ch))
        if gname is None:
            raise ValueError(f"font lacks glyph for {ch!r}")
        glyph = gs[gname]
        adv = hmtx[gname][0] * scale
        transform = Transform(scale, 0, 0, -scale, origin_x + x, baseline_y)

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


def badge_markup(fonts, badge, rect_w):
    """Ribbon badge inside the button: top strip flush right, TR+BL corners
    rounded, white text centered. badge=(text, color). Returns path d strings."""
    text, color = badge
    font = next((f for f in fonts
                 if all(ord(c) in f.getBestCmap() for c in text)), fonts[0])
    # measure ink at origin 0, then re-render centered inside the ribbon
    _, b0 = text_to_path(font, text, origin_x=0.0,
                         baseline_y=BADGE_BASELINE_Y, cap_px=BADGE_CAP_PX)
    ink_w = b0[2] - b0[0]
    ink_cx = (b0[0] + b0[2]) / 2
    ribbon_w = math.ceil(ink_w + 2 * BADGE_PAD_X)
    ribbon_left = rect_w - ribbon_w
    final_x = ribbon_left + ribbon_w / 2 - ink_cx
    d_text, _ = text_to_path(font, text, origin_x=final_x,
                             baseline_y=BADGE_BASELINE_Y, cap_px=BADGE_CAP_PX)

    r = BADGE_CORNER_R
    h = BADGE_H
    lx = rounded(ribbon_left)
    rw = rounded(rect_w)
    rr = rounded(r)
    hh = rounded(h)
    d = (
        f"M{lx} 0L{rounded(rect_w - r)} 0Q{rw} 0 {rw} {rr}"
        f"L{rw} {hh}L{rounded(ribbon_left + r)} {hh}"
        f"Q{lx} {hh} {lx} {rounded(h - r)}L{lx} 0Z"
    )
    return d, d_text, color


def build_svg(label, aria, icon_key, badge, fonts):
    font = fonts[0]
    d, bounds = text_to_path(font, label)
    text_right = bounds[2] if bounds else TEXT_X
    rect_w = max(MIN_RECT_W, math.ceil(text_right + RIGHT_PAD))
    total_w = int(rect_w) + 9

    badge_parts = ""
    if badge:
        ribbon_d, badge_d, badge_color = badge_markup(fonts, badge, rect_w)
        badge_parts = (
            f'  <path fill="{badge_color}" d="{ribbon_d}"/>\n'
            f'  <path fill="#ffffff" d="{badge_d}"/>\n'
        )

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
        f"{badge_parts}"
        f'  <path fill="#171717" d="{d}"/>\n'
        "</svg>\n"
    )


def main():
    fonts = [TTFont(str(find_font()))]
    print(f"font: {find_font()}")
    for cand in CJK_FONT_CANDIDATES:
        if Path(cand).is_file():
            fonts.append(TTFont(cand, fontNumber=0))
            print(f"badge fallback font: {cand}")
            break

    for filename, label, aria, icon_key, badge in BUTTONS:
        svg = build_svg(label, aria, icon_key, badge, fonts)
        out = OUT_DIR / filename
        out.write_text(svg, encoding="utf-8")
        w = re.search(r'width="(\d+)" height="50"', svg).group(1)
        print(f"{filename}: {w}x50  label={label!r}")


if __name__ == "__main__":
    main()
