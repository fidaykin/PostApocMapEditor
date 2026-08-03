#!/usr/bin/env python3
"""
Pack all 512x512 hex sprites into a 4096x4096 atlas.
Outputs: sprites/hex_atlas.png + sprites/hex_atlas.json
"""
import json
import os
from PIL import Image

SPRITES_DIR = os.path.join(os.path.dirname(__file__), "sprites", "hex")
OUT_PNG     = os.path.join(os.path.dirname(__file__), "sprites", "hex_atlas.png")
OUT_JSON    = os.path.join(os.path.dirname(__file__), "sprites", "hex_atlas.json")

ATLAS_SIZE  = 4096
TILE_SIZE   = 512
COLS        = ATLAS_SIZE // TILE_SIZE  # 8

files = sorted(
    f for f in os.listdir(SPRITES_DIR)
    if f.lower().endswith(".png")
)

atlas  = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
frames = {}

for idx, filename in enumerate(files):
    col = idx % COLS
    row = idx // COLS
    x   = col * TILE_SIZE
    y   = row * TILE_SIZE

    img = Image.open(os.path.join(SPRITES_DIR, filename)).convert("RGBA")
    if img.size != (TILE_SIZE, TILE_SIZE):
        img = img.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)

    atlas.paste(img, (x, y))

    name = os.path.splitext(filename)[0]
    frames[name] = {"x": x, "y": y, "w": TILE_SIZE, "h": TILE_SIZE}

atlas.save(OUT_PNG, optimize=True)

meta = {
    "meta": {
        "image": "hex_atlas.png",
        "size":  {"w": ATLAS_SIZE, "h": ATLAS_SIZE},
        "tileSize": TILE_SIZE
    },
    "frames": frames
}
with open(OUT_JSON, "w") as f:
    json.dump(meta, f, indent=2)

print(f"Atlas saved: {OUT_PNG}")
print(f"JSON saved:  {OUT_JSON}")
print(f"Packed {len(files)} sprites ({COLS} cols × {(len(files) + COLS - 1) // COLS} rows)")
