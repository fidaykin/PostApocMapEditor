# Post-Apocalyptic Map Editor

A browser-based map editor for creating 450×450 tile maps with 29 terrain types.

## Project Structure

```
Post Apo Map Editor/
├── MapEditor.html          # Main editor (open this in browser)
├── sprites/
│   └── terrain/           # 29 terrain sprite PNGs (512×512 each)
└── README.md              # This file
```

## How to Use

1. **Open the Editor**
   - Double-click `MapEditor.html` or open it in any modern browser
   - Chrome, Firefox, Safari, Edge all supported

2. **Controls**
   - **Left Click**: Paint terrain or place settlements
   - **Right Click**: Sample terrain (eyedropper)
   - **Scroll**: Pan around the map
   - **Zoom Slider**: Adjust view from 25% to 400%

3. **Tools**
   - 🖌️ **Paint**: Draw terrain tiles
   - 🏚️ **Place Settlement**: Mark settlement locations
   - 🧹 **Erase Settlement**: Remove settlements

4. **Toolbar Buttons**
   - 🏙️ **Center**: Center viewport on the city
   - 💾 **Save JSON**: Export full map data (terrain + settlements)
   - 📄 **Save CSV**: Export terrain grid only
   - 🗑️ **Clear Map**: Reset entire map
   - 🎨 **Fill All**: Fill map with selected terrain

## Terrain Categories

- 💧 **Water Types** (9): DirtyWater, River variations
- 🏚️ **Rubble/Wasteland** (3): Rubble variations
- 🌾 **Plains** (3): Plain_1, Plain_2, BrokenPlain
- 🌲 **Forest** (3): Forest variations
- ⛰️ **Rocky/Mountain** (2): Hills, Mountain
- 💎 **Resources** (2): GoldVein, Oil
- 🏜️ **Barren/Desert** (2): Barren, Desert
- 🐊 **Swamp** (2): Swamp, RockySwamp
- 🌋 **Volcanic/Rift** (3): LavaPlain, LavaRift, Rift

## Features

- **450×450 tile map** (202,500 total tiles)
- **29 unique terrain types** with high-quality 512×512 sprites
- **Collapsible terrain palette** - click category headers to expand/collapse
- **City marker** - starts at map center
- **Zoom controls** - 25% to 400% with smooth scaling
- **Settlement placement** - mark locations for settlements
- **Export options** - JSON (full data) or CSV (terrain grid only)

## Technical Details

- **Canvas**: 14,400×14,400 pixels (32px per tile)
- **Default zoom**: 100% (no scaling)
- **Image rendering**: Optimized pixelated mode for crisp terrain
- **File size**: ~22KB HTML + 29 PNG sprites (~350KB each)

## Tips

- Use collapsible categories to quickly find terrain types
- Right-click to sample terrain from the map
- Use zoom to get detailed view or see the full map
- Default terrain is Plain_1 (grass)
- City is placed at center (225, 225) by default
- Center button helps navigate back to city after panning

## Browser Requirements

- Modern browser with HTML5 Canvas support
- JavaScript enabled
- ~10MB RAM for canvas rendering
- Local file access enabled (for loading sprites)

---

**Version**: 1.0
**Created**: March 2026
**For**: PostApocCityBuilder Unity Project
