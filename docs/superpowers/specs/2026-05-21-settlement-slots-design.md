# Settlement Slots Implementation Design

**Goal:** Let QA define distance-ring zones where settlements spawn randomly on map load, complementing the existing hard-placement tool.

**Architecture:** `settlementSlots` global array in the editor; right-panel UI; canvas ring overlay; `settlement_slots` JSON section; Unity slot resolver merges results into `CustomSettlementPositions` at map load.

**Tech Stack:** HTML/JS (editor), C# / Unity (runtime resolver)

---

## Data Model

### Editor (JavaScript)

Global array alongside existing `settlements`:

```javascript
let settlementSlots = [];
// Each entry:
// { minDist: number, maxDist: number, count: number, type: string }
```

Default type options: `settlement`, `outpost`, `trading_post` + free-text fallback.

Included in:
- `History._snapshot()` / `_restore()` — full undo/redo
- `_buildJson()` — autosave and export
- `tryRestoreAutosave()` / `openMap()` — restore on load

### Unity (C#)

Four new parallel lists on `MapSaveData`:

```csharp
public List<int>    SlotMinDist  = new List<int>();
public List<int>    SlotMaxDist  = new List<int>();
public List<int>    SlotCount    = new List<int>();
public List<string> SlotTypes    = new List<string>();
```

`DebugController.ResetGame()` preserves these lists (same treatment as `CustomTerrainPositions/Ids`).

---

## Editor UI

Right panel — collapsible "🏘️ Settlement Slots" section below settlement count, visible in map mode only.

Each slot row:
```
[minDist] → [maxDist]   ×[count]   [type ▾]   [✕]
```

- `minDist` / `maxDist`: number inputs, min 0
- `count`: number input `×N`, min 1, max 99
- `type`: `<select>` with options `settlement / outpost / trading_post / Custom…`; selecting "Custom…" reveals a text input for free entry
- `✕`: removes the slot row
- `[+ Add Slot]` button: appends `{minDist:10, maxDist:20, count:1, type:'settlement'}`

All changes call `scheduleAutoSave()` immediately.

---

## Canvas Visualization

Rendered after zone overlay, before settlement markers, when `settlementsVisible` is true.

**Ring tint:** For each visible tile where `minDist ≤ hexDist(appX, appY) ≤ maxDist`, fill with 30% opacity tint. Boundary tiles (`minDist` and `maxDist` exact distance) receive a slightly brighter tint (50%) to make the ring edges visible.

**Colours:** 6-colour fixed palette cycling for up to 6 slots:
```javascript
const SLOT_PALETTE = [
  'rgba(79,195,247,',   // blue
  'rgba(255,183,77,',   // amber
  'rgba(174,213,129,',  // green
  'rgba(240,98,146,',   // pink
  'rgba(206,147,216,',  // purple
  'rgba(255,138,101,',  // orange
];
```

**Label:** `"outpost ×2"` drawn at the due-East tile of `maxDist` (same position as zone ring numbers).

**Selected slot:** When a slot row is focused/clicked in the panel, its ring renders at 50% opacity (all others dim to 15%) so QA can identify which ring corresponds to which row.

---

## JSON Format

`_buildJson()` output — `settlement_slots` omitted when empty:

```json
{
  "width": 450,
  "height": 450,
  "data": [...],
  "settlements": [
    { "col": 225, "row": 224, "type": "city" }
  ],
  "settlement_slots": [
    { "minDist": 10, "maxDist": 20, "count": 1, "type": "settlement" },
    { "minDist": 30, "maxDist": 45, "count": 2, "type": "outpost" }
  ]
}
```

On restore/open: missing `settlement_slots` → empty array (backwards compatible).

---

## Unity Integration

### Parsing

`RuntimeMapApplier.ParseSettlementSlots(json)` reads `settlement_slots` and populates `mapSaveData.Map.SlotMinDist/MaxDist/Count/Types`. Called in both `ApplyMapJSON` (live import) and `RuntimeMapLoader.TryApplyImport` (restart import).

### Slot Resolver

New static class `SettlementSlotResolver`:

```csharp
public static void Resolve(MapSaveData data, TileData[,] grid, int width, int height)
```

- **Runs only at import time** (inside `ApplyMapJSON` / `TryApplyImport`), never on regular startup `LoadFromSave`. This prevents duplicate positions accumulating across restarts — resolved positions are persisted in `CustomSettlementPositions` and reloaded directly on subsequent starts.
- Runs after `ParseSettlements` has populated `CustomSettlementPositions` with hard-placed entries, before `RebuildVisuals()`
- Uses `new System.Random(data.Map.Seed)` — deterministic per seed
- For each slot `i`: finds all tiles where `HexUtils.Distance(worldX, worldY, 0, 0)` is within `[SlotMinDist[i], SlotMaxDist[i]]`, tile is not fogged/blocked, not already in `CustomSettlementPositions`, not city `(0,0)`
- Shuffles candidates and picks `SlotCount[i]` of them
- Encodes positions as `arrayX + arrayY * width` and appends to `data.Map.CustomSettlementPositions`
- Logs: `[SlotResolver] Placed 2 'outpost' in ring 30–45`

### Reset preservation

`DebugController.ResetGame()` copies `SlotMinDist`, `SlotMaxDist`, `SlotCount`, `SlotTypes` into the fresh save alongside terrain overrides.

---

## Constraints

- Slots with `minDist > maxDist` are ignored silently (validated in UI)
- If fewer valid tiles exist than `count`, all available tiles are used (no error)
- Hard-placed `settlements` take priority — slot resolver never overwrites them
- Resolver runs only when `SlotMinDist.Count > 0`
