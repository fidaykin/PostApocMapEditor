# Editor improvement roadmap (2026-10-02)

Based on a code survey plus a live run of `MapEditorPro.html` (build 2026.09.30.f3509a4, served via `python3 -m http.server`, driven in Chrome).

## Verified in the running app

| Claim | Result |
|---|---|
| Packages: local HexDB edits are lost on reload | **Confirmed.** `HexDB.add()` saved `NewHex_107` to `hexdb_autosave`; after reload it was gone (count 107 → 106). Startup load from the server overwrites the local copy. |
| Map load does not check packages or tile ids | **Confirmed.** A map listing missing package `ghostpack` with tile `Ghost_Tile_9` loaded with only the toast "Map loaded". |
| Oversized maps are clamped silently | **Confirmed.** A 600×600 map loaded as 450×450 with no warning. |
| Autosave is large | **Confirmed.** `map_autosave` is ~2.2-2.4 MB of the ~5 MB localStorage quota. |
| Render cost at minimum zoom | **Confirmed.** `Canvas.render()` ≈ 6-13 ms at 100%, ≈ 55-67 ms at 25% (about 16 fps). Minimap redraw ≈ 3 ms. |
| PACKAGES tab is a bare table | **Confirmed.** Columns ID/Name/Version/Actions, no help text, no active-package marker, no entry counts. The active-package dropdown sits in a separate toolbar. |
| 450×450 does not fit the screen | **Confirmed.** Fit-to-screen stops at 25% zoom. |

Not confirmed or lower priority than first estimated:
- Per-stroke undo snapshot cost: `History.push` took 0.2 ms in a quick call. Memory use over 50 steps was not measured, so treat the undo rewrite as "measure first".
- Render at normal zoom is fine, so the render work is mainly about low zoom.
- The page title says build 2026.07.16 while the status bar says 2026.09.30; the title is stale.

Not tested (needs a GitHub token, so it was not run): Create/Publish/Delete/Import of packages. Those findings come from reading the code only.

## Phase 0: data safety (do first)
1. Do not let the startup server load overwrite the local HexDB/BldDB autosave. Load each registry package's hex and building files and merge them.
2. Import ZIP loads the imported entries into the editor.
3. Publish: refuse an id that already exists on the server, show a diff, keep `description` and `preview` in `package.json`, write `package.json` last.
4. Delete package: list entries and maps that use it, choose "keep" or "remove" entries, allow restore.
5. Map load: warn about packages missing from the registry and about tile ids unknown to HexDB/BldDB (with a count); tell the user when a map is clamped.
6. Autosave: surface errors instead of swallowing them, and move the map to IndexedDB.
7. Replace `alert()` and `prompt()` with modals and toasts that carry details.

## Phase 1: performance at low zoom and on large maps
1. Range-based culling in `Canvas.render` and cached overlay layers.
2. Cached minimap with incremental updates.
3. Measure undo memory; if it is a problem, switch to diff-based history and cover Expand Map, roads and buildings.
4. Fill with an indexed queue, chunked so the UI does not block.
5. Generator and satellite import in a Web Worker.
6. Allow zoom below 25% so the whole 450×450 map fits.

## Phase 2: editing tools
1. Region selection with copy, cut, paste, move, rotate and mirror.
2. Stamps/prefabs library saved from a selection.
3. Line, circle, polygon tools; larger brush sizes with shortcuts.
4. Replace X with Y, and a real eraser to the default tile.
5. Edge re-resolution for Fill and Rectangle, same as Paint.
6. Scatter tool for decoration variants; symmetric painting.
7. Restore the road, building and bridge tools in the UI with undo support.
8. Layers panel (visibility, lock); Clear Map clears every layer.

## Phase 3: generation and map design
1. Generate into a selection and blend with existing terrain.
2. Heightmap import (spec: `docs/superpowers/specs/2026-08-06-heightmap-elevation-import-design.md`).
3. Configurable city position and difficulty zones.
4. Resource/artifact/mega-city placement helper that mirrors the real game's maps.
5. Generator driven by tile classes rather than hard-coded ids.

## Phase 4: navigation and feedback
1. Go-to coordinates, bookmarks, bigger minimap showing zones and settlements.
2. Shortcuts for zoom, brush size, overlays; a shortcut help panel.
3. Map validator (unknown ids, missing city, unreachable settlements, orphan roads, missing sprites), run before export.
4. PNG export; export in the game's format if it differs from the editor JSON.
5. History panel.

## Phase 5: packages UX
1. PACKAGES tab: purpose text, empty state, active marker, entry counts, tooltips, PAT-missing message, guide link, note that the game does not load non-default packages yet.
2. Active-package selector in the HEXDB and BUILDINGS toolbars.
3. Per-package sprite folders, name-collision check, PNG-only validation or conversion.
4. Reskin picker with sprite preview instead of `prompt()`.
5. Publish: list missing sprites in a dialog, choose version bump, changelog note, retry-safe writes.
6. Import: validate ZIP, show a summary, roll back on failure, keep reskin ids, rewrite cross-references.
7. Export uses local state, with a warning about unpublished changes.
8. Package dependencies, 512×512 preview, palette grouping by package.
9. Local-only mode without a PAT.

## Phase 6: quality and docs
1. Unit tests for pure logic (history, autotiling, map format, migrations, id prefixing) and Playwright flows for core actions.
2. Split the 13k-line `MapEditorPro.html` into modules (optional, after the data-safety work).
3. Update README, CHANGELOG and the EN/UA guides; link help from the UI.
4. Map format versioning and schema validation on load.
5. Remove unused assets (unused atlas, duplicate `sprites/`) and dead tool code once replaced.

## Order of work
1. Phase 0 in full.
2. Phase 1 items 1, 2, 4, 6.
3. Phase 2 items 1, 2, 7, 8.
4. Phase 4 items 3, 4 and Phase 5 items 1, 2.
5. The rest as needed.

## Open questions for the owner
- Does the game load non-default packages yet (guide says no; game repo SP3/SP4)?
- What map format does the game expect, and is the editor JSON it?
- Is the editor shared with a team (raises the priority of Phase 0 and package onboarding)?
