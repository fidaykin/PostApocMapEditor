# Edge-Adjacency Auto-Tiling — Design Spec

**Date:** 2026-08-03
**Project:** Post Apo Map Editor (MapEditorPro.html)
**Problem:** The 28-tile directional river/lake catalog (`River_*`, `Lake_*`, tagged with a face-adjacency field describing which hex edges carry water) exists in `hex_database.json` but is never used. The procedural `Generator`'s river-carving paints a random flat "deep water" tile (`Water_1`/`Water_Dirty_1`/`Water_Rock_1`) along the entire river path instead of the correct directional tile per cell, so carved rivers look like blocky flat-water snakes rather than a real river. There is also no manual way to paint river/lake tiles that looks right — placing them one at a time by hand means picking the exact directional sprite yourself, tile by tile.

**Reference model:** StarCraft's original map editor (StarEdit) and its terrain system are the target visual bar here — every terrain-to-terrain boundary in that editor blends automatically via an ISOM (isometric edge-data) layer: the mapmaker paints intent ("this region is water"), and the editor derives which pre-authored edge tile belongs at every affected cell, with zero visible tile seams. Confirmed by reviewing footage of the editor in action (a "making a starcraft map" walkthrough): raised terrain meeting grass, an isolated ruins patch sitting in jungle, and a water body meeting land all show fully organic blended borders, none of them hand-placed tile by tile. That's the shape of system this spec builds — narrower today (only water/rivers have the tile catalog and data to resolve against), general enough that any other terrain family gets the same treatment for free once it has matching art and data.

---

## Relationship to prior work

This builds directly on `2026-08-03-terrain-generation-overhaul-design.md` — same `Generator` module, same river-carving code (`_generateInto`'s `if (p.rivers > 0 && !opts.skipExpensive)` block). That spec fixed the carving *algorithm* (coastline, smoothing, reliability); this spec fixes what tile gets *painted* once a cell is part of a river.

**Out of scope:** ocean/land coastline edges. Confirmed via the Unity source (`CoastlineEdgeDetector.cs`, `CoastlineManager.cs`) that this is already fully automatic in the shipped game — a runtime overlay compositing small edge sprites based on live neighbor detection, not a swapped base tile. It needs no pre-authored "coastline tile" and no web-editor-side logic; as long as water tiles are correctly typed (they already are), Unity renders the coastline overlay itself once the map loads. This spec is specifically about the river/lake *directional tile* catalog.

---

## Generalizing the mechanism, not just the tile set

The resolver, the data field, and the call sites are all built generic from day one — nothing here is hardcoded to water — so that the day someone authors edge tiles for another terrain family (e.g. a forest-meets-plains transition), it plugs into the same system with no rework. Concretely:

- **Data field rename:** `waterFaces` → **`edgeFaces`** on the hex record schema. It's the same 29 records, same values, just a field name that isn't misleading the moment a non-water record wants to use it too. One-time mechanical migration (rename the key in `hex_database.json` for the 29 existing records) plus updating the few code references that currently read `waterFaces` directly.
- **Resolver takes an explicit family**, rather than assuming water: `_resolveEdgeTile(col, row, familyTypes, rng)` where `familyTypes` is an array of `HexDB` `type` values that count as "connects to me" for *this* resolution (e.g. `['Water', 'Rivers']` for the water/river system; a hypothetical future forest system would pass `['Forests']`). The mask table itself is filtered to only records whose `type` is in `familyTypes`, so two unrelated terrain families with their own `edgeFaces` data can never cross-match each other.
- **No other terrain family is implemented now.** This is a scope guardrail, not a caveat: building new edge-tile art and hex records for forest/desert/rubble/etc. is a content investment for whoever authors that art, entirely separate from this code change. Nothing in this spec blocks that from happening later; nothing in this spec does it today.

---

## The existing catalog (water/rivers, the first — and today's only — family)

29 hex records carry an `edgeFaces` array (e.g. `River_L_1: ['N','S']`, `River_D_2: ['SW','SE']`, `Lake_1: ['SW']`, `Lake_7: []`), all typed `'Rivers'`. Accounting for the hex grid's 6-fold rotational symmetry, a thin 1-tile-wide river path (which never branches under normal carving — each step has at most 2 path-neighbors) only ever needs 4 fundamental shapes:

| Shape | Connections | Coverage |
|---|---|---|
| Dead-end | 1 | All 6 directions covered (`Lake_1`–`Lake_6`) |
| 120° bend | 2, one gap apart | All 6 rotational positions covered |
| Straight-through | 2, opposite sides | All 3 axis orientations covered |
| Sharp 60° bend | 2, adjacent sides | **Not covered in any rotation** |

No rotation logic is needed — the catalog already has a distinct hand-authored sprite for every position of the first three shapes. Only the sharp 60° bend has zero coverage; it falls back to flat water (see below). A handful of 3-way fork tiles also exist (`River_D_3`, etc.) for the rarer case of a river cell touching an existing river/lake tile.

---

## A. Shared resolver

New pure functions inside the `Generator` module (mirroring its existing private-helper style, not a new file):

- **`_buildEdgeMaskTable(familyTypes)`** — built per family, cached by the `familyTypes` key (same lazy-cache pattern as `_getGenT()`): iterate `HexDB.getAll()`, for every record whose `type` is in `familyTypes` and has a non-empty `edgeFaces`, convert the face-name array to a 6-bit mask and append the record's id to `table[mask]` (an array, since multiple tiles can share a mask — e.g. `River_L_1`/`River_R_1` both cover the same straight-through shape for visual variety).
- **Face-name ↔ bit-position mapping**: reuse the Roads module's existing neighbor convention (`SE=0, NE=1, N=2, NW=3, SW=4, S=5`) rather than inventing a new one — `FACE_NAMES = ['SE','NE','N','NW','SW','S']` indexed the same way, so bit `i` of a mask always means "neighbor in direction `FACE_NAMES[i]`."
- **`_resolveEdgeTile(col, row, familyTypes, rng)`**: for each of the 6 real neighbors (via the existing `_DIRS_EVEN`/`_DIRS_ODD` offset tables), check whether that neighbor's placed tile belongs to `familyTypes` to build the mask, then look up `_buildEdgeMaskTable(familyTypes)[mask]`. If multiple ids share that mask, pick one via the passed-in `rng`. Fallback order: mask `0` (no same-family neighbors at all) → the family's empty-`edgeFaces` tile if one exists (`Lake_7` for water); mask not found in the table at all (the uncovered sharp-bend case, or any 4+-connection case that shouldn't occur for a thin path anyway) → the family's flat/default tile (flat water, for the water family). The Generator call site passes its own seeded `rng` (so generation stays deterministic per seed, matching the rest of the pipeline); the manual-paint call site can pass `Math.random` directly — determinism doesn't matter for a live, one-off interactive stroke.
- **Water/river call sites** pass `familyTypes = ['Water', 'Rivers']` — this is the *only* concrete family wired up in this spec.

---

## B. Generator integration

Current behavior: during the river-carving walk, each visited cell is immediately assigned a random flat water id and buffered; the buffer is committed to `dest` only if the walk reaches the 18-step success threshold (per the terrain-generation-overhaul fix).

Change: stop assigning a specific tile id during the walk. Instead, buffer just the *cell indices* that belong to a committed river path (across **all** rivers carved in this generation, not per-attempt — a cell's true neighbors can include a different river or the base coastline, which aren't fully known until every river has been carved). After the full `while (carved < p.rivers ...)` loop finishes, run one resolution pass: for every buffered river-cell index, call `_resolveEdgeTile(col, row, ['Water','Rivers'], rng)` against the *final* `dest` array and write the result in place.

This ordering matters: resolving too early (per-river, before other rivers/coastline are finalized) would see an incomplete picture and misclassify edge cells (e.g. a river cell that later turns out to be adjacent to the coast, or to a second river).

---

## C. Manual tool

No new dedicated tool — extend the existing Paint/Fill tools. After any paint stroke completes, check the terrain that was actually placed: if its `HexDB` record has a non-empty `edgeFaces` (i.e. the user painted river/lake content, not plain ocean), immediately re-resolve that cell **and its 6 neighbors** through `_resolveEdgeTile(..., ['Water','Rivers'], Math.random)`, then re-render the affected cells. This is the StarEdit/SCMDraft ISOM model directly: you paint intent ("there's a river here"), the tool derives which exact tile belongs at every affected position — you never pick `River_L_1` vs `River_D_2` yourself.

Painting plain open water (`Water_1`/`Water_Dirty_1`/`Water_Rock_1`, no `edgeFaces`) is unaffected — open water is intentionally flat, no auto-resolution triggers for it.

---

## Data flow summary

```
Generator (procedural):
  carve river paths → buffer cell indices only (no tile id yet)
  all rivers done → resolve pass over buffered cells → write final ids into dest

Manual paint (interactive):
  user paints a water/river cell → check if it has edgeFaces
    if yes → resolve this cell + 6 neighbors → re-render affected cells
    if no (plain ocean) → unchanged, no resolution
```

Both paths call the same `_resolveEdgeTile`/`_buildEdgeMaskTable` functions, parameterized with `familyTypes = ['Water','Rivers']` — one shared, family-agnostic resolver, two call sites, one concrete family wired up today.

---

## Testing / validation

Same approach as the rest of this project (no automated test harness — a deliberate, standing decision, not something to introduce here): live browser verification via the local dev server. Concretely:
- Generate rivers across all 5 presets and confirm cells now show varied directional sprites (not a uniform flat-water look) by sampling generated tile ids and checking they resolve to `River_*`/`Lake_*` ids where expected, matching each cell's actual computed neighbor mask.
- Confirm the previously-verified river-carving success rates (Task 6 of the prior spec: 100%/100%/100%/88% across presets) are unaffected — this change only affects which tile id gets written, not whether a river carve succeeds.
- Manually paint a short river-like line with the Paint tool and confirm dead-ends, bends, and straight segments all resolve to the geometrically-correct tile, and that painting a new segment next to an existing dead-end correctly turns that old dead-end into a through-tile (the neighbor-re-resolution behavior).
- Confirm painting plain ocean/lake tiles is completely unaffected (no resolution triggers, no performance cost added to non-water painting).
- Confirm the `edgeFaces` rename didn't break anything reading the old `waterFaces` key — grep the codebase for any remaining reference to the old name after the migration.

---

## Out of scope

- Ocean/land coastline edges (already automatic in Unity, see above).
- New sprite art or hex records for any terrain family other than water/rivers — the resolver supports it, but authoring that content is a separate content task for whoever draws it.
- New sprite art for the one uncovered sharp-60°-bend shape — falls back to flat water; revisit only if it turns out to matter visually in practice.
- Any change to the Zone Painter, the map JSON export format, or Unity-side rendering code.

---

## Success criteria

- Generated rivers show geometrically-correct directional tiles (dead-ends, bends, straight segments) instead of uniform flat water, across all 5 presets.
- River-carving success rates from the prior spec's Task 6 verification are unaffected.
- Manually painting river/lake terrain with the existing Paint/Fill tools auto-resolves the correct tile for the painted cell and its neighbors, without requiring the user to pick a specific directional sprite.
- Painting plain open water is visually and behaviorally unchanged.
- The resolver's public shape (`_resolveEdgeTile`/`_buildEdgeMaskTable`, parameterized by `familyTypes`) has no water-specific naming or logic baked in — verified by reading the implementation, not just the water call sites working.
