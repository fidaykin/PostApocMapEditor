# Map Format Compatibility Report

## HTML Editor ↔ Unity Game

### ✅ FULLY COMPATIBLE

The map export format from the HTML Map Editor is **100% compatible** with Unity's MapImporter.

---

## Export Format (HTML Editor)

```json
{
  "width": 450,
  "height": 450,
  "data": [
    [0, 12, 12, 15, ...],  // Row 0 (450 columns)
    [12, 12, 15, 15, ...], // Row 1
    ...                     // 450 rows total
  ],
  "settlements": [
    { "x": 225, "y": 225, "type": "city" },
    { "x": 100, "y": 50, "type": "settlement" }
  ]
}
```

**Structure:**
- `width` (int): Map width in tiles (450)
- `height` (int): Map height in tiles (450)
- `data` (2D array): Row-major terrain data `[y][x]`
  - Each element is a terrain type ID (0-28)
  - Array format: `[[row0], [row1], [row2], ...]`
- `settlements` (array, optional): Settlement positions
  - Each object: `{x: int, y: int, type: string}`
  - Coordinates use array indices (0-449)

---

## Import Format (Unity)

Unity's `MapImporter.cs` expects:

```json
{
  "width": 450,
  "height": 450,
  "data": [[...], [...], ...],
  "settlements": [{x, y}, ...]
}
```

**Parsing Logic:**
1. Parse `width` and `height` fields ✅
2. Parse `data` array row-by-row ✅
   - Iterates: `for (jsonY = 0; jsonY < height; jsonY++)`
   - For each row, splits by comma and parses values
   - Stores as: `grid[jsonX, jsonY] = terrainValue`
3. Parse `settlements` array ✅
   - Extracts `x` and `y` fields from each object
   - **Ignores** any extra fields (like `type`) ← This is OK!
   - Stores as: `Vector2Int(x, y)`

---

## Coordinate System Compatibility

### Terrain Data (`data` field)

| System | Format | Example Access |
|--------|--------|----------------|
| **HTML Editor** | `mapData[y][x]` | `mapData[225][225]` |
| **Unity** | `grid[x, y]` | `grid[225, 225]` |
| **JSON** | `[[row0], [row1], ...]` | `data[225][225]` |

**Result:** ✅ Compatible
Unity parser reads rows from JSON (`data[y]`) and columns from each row (`data[y][x]`), then stores in column-major format `grid[x, y]`.

### Settlements (`settlements` field)

| System | Format | Example |
|--------|--------|---------|
| **HTML Export** | `{x: 225, y: 225, type: "city"}` | City at (225, 225) |
| **Unity Import** | `Vector2Int(225, 225)` | Settlement at (225, 225) |

**Result:** ✅ Compatible
Unity ignores the `type` field and only uses `x` and `y` coordinates.

---

## Data Type Mapping

### Terrain IDs

Both systems use the same terrain ID enumeration:

| ID | Terrain Type | HTML | Unity |
|----|-------------|------|-------|
| 0 | DirtyWater | ✅ | ✅ |
| 1 | DirtyWater_1 | ✅ | ✅ |
| ... | ... | ... | ... |
| 28 | Rift | ✅ | ✅ |

**Total:** 29 terrain types (0-28) ✅

---

## Import Behavior in Unity

When you import a map from the HTML editor:

1. **Terrain Data:**
   - Unity compares imported terrain with seed-generated terrain
   - Only stores **differences** as terrain overrides (sparse format)
   - This keeps save files small

2. **Settlements:**
   - Unity stores settlements as encoded positions: `x + y * width`
   - Adds to `CustomSettlementPositions` list in save data
   - The `type` field from HTML export is ignored (all treated as regular settlements)

3. **City Location:**
   - If HTML export includes city at (225, 225), it's imported as a settlement
   - Unity's game logic will recognize this as the city location

---

## Testing Checklist

To verify the import works correctly:

### ✅ Test 1: Create Simple Map
1. Open HTML editor
2. Paint a few different terrain types
3. Place 2-3 settlements
4. Save as `test_map.json`
5. Import into Unity via: `PostApoc → Map Tools → Import Map from Excel`
6. Verify terrain matches what you painted
7. Verify settlements appear at correct positions

### ✅ Test 2: Large Map
1. Fill entire 450×450 map with varied terrain
2. Place 10+ settlements
3. Save and import
4. Check console for parsing errors
5. Verify no crashes or missing data

### ✅ Test 3: Edge Cases
1. Empty map (all default terrain)
2. Map with only city (no other settlements)
3. Map with maximum settlements (100+)
4. Verify all import correctly

---

## Known Differences (Non-Breaking)

1. **Settlement Types:**
   - HTML editor: Supports `"city"` and `"settlement"` types
   - Unity import: Treats all as regular settlements (ignores type)
   - **Impact:** None - Unity doesn't use this distinction during import

2. **Coordinate Systems:**
   - HTML: Row-major `[y][x]`
   - Unity: Column-major `[x, y]`
   - **Impact:** None - JSON format is row-major, Unity parser handles conversion

3. **Save Format:**
   - HTML: Full 450×450 array (always)
   - Unity: Sparse terrain overrides (only differences from seed)
   - **Impact:** None - Unity converts during import

---

## Conclusion

✅ **The HTML Map Editor export format is FULLY COMPATIBLE with Unity's MapImporter.**

You can:
- Create maps in the HTML editor
- Save as JSON
- Import directly into Unity game
- Edit maps in HTML, re-import to Unity
- Round-trip between editor and game

**No format changes needed!** 🎉

---

## File Locations

- **HTML Editor:** `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditor.html`
- **Unity Importer:** `/Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Scripts/Editor/MapImporter.cs`
- **Import Menu:** Unity Editor → `PostApoc → Map Tools → Import Map from Excel`

---

**Last Verified:** 2026-03-13
**HTML Editor Version:** 1.0
**Unity Version:** 6000.3.6f1
