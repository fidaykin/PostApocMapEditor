# Real-World Elevation Import — Design Spec

**Date:** 2026-08-06
**Project:** Post Apo Map Editor (MapEditorPro.html)
**Problem:** The procedural `Generator` produces elevation from seeded multi-octave noise plus a synthetic continent/coastline mask (`_generateInto`, `MapEditorPro.html:6854`). This is flexible but arbitrary — every map is a fictional landmass. There's no way to base a map's terrain shape on an actual real-world place, even though the rest of the pipeline (biome classification, smoothing, river-carving, resource scatter, and the new edge-adjacency tile resolver) is entirely agnostic to *where* elevation values came from.

This spec adds a way to import a real elevation heightmap (exported from an external tool) and feed it into that same pipeline as an alternate elevation source, so a designer can generate a map whose mountains, valleys, and rivers mirror an actual place, while keeping the existing preset-driven biome/moisture system for everything downstream.

---

## Relationship to prior work

This builds on `2026-08-03-terrain-generation-overhaul-design.md` (the elevation/moisture/coastline/smoothing/river-carving pipeline this reuses unchanged) and `2026-08-03-river-tile-autotiling-design.md` (the directional river/lake tile resolver, which applies identically regardless of where elevation came from — real rivers carved over real elevation will auto-resolve to the correct catalog tiles exactly like procedural rivers already do).

**Out of scope for this spec:**
- Fetching elevation data live from any external API — file upload only (see below).
- Parsing GeoTIFF or other native DEM formats — grayscale/color image only.
- Real-world moisture/precipitation data — moisture stays procedurally generated, driven by the existing presets.
- A live preview while adjusting the sea-level slider — apply-and-inspect, matching how the existing "Generate" button already works (no live preview there either).
- Resizing the map to match the source image's aspect ratio — the map's existing fixed dimensions (`MAP_WIDTH`/`MAP_HEIGHT`) are unchanged; the heightmap is stretched to fit.

---

## UI entry point

A new **"Import Elevation..."** item in the existing Generate panel's menu, alongside the current presets (wasteland/jungle/arctic/desert/volcanic). The designer keeps the currently-selected preset active — that preset continues to supply moisture/biome-noise parameters exactly as it does for ordinary generation; only the elevation source changes.

Clicking it opens a native `<input type="file" accept="image/*">` picker. On selecting a file, the import pipeline (below) runs immediately and overwrites the current map — this is exactly as destructive as the existing "Generate" button already is, and needs no additional confirmation dialog beyond whatever the app already shows for regenerating.

A **sea-level slider** (new control, visible once "Import Elevation" is the active generation mode) lets the designer nudge the water cutoff after the fact without re-uploading — see Calibration below.

---

## Pipeline: image → elevation array → existing generation chain

1. **Decode.** The selected file is drawn into an offscreen `<canvas>`, pixel data read via `getImageData()`.
2. **Grayscale conversion.** Each pixel's RGB is converted to a single luminance value via the standard perceptual weighting (`0.299*R + 0.587*G + 0.114*B`), so both true grayscale heightmaps and color-coded ones (e.g. hypsometric-tinted exports) produce a usable single-channel signal.
3. **Resample.** The luminance grid is resampled from the source image's native resolution to `MAP_WIDTH × MAP_HEIGHT` via nearest-neighbor sampling (simplest, deterministic; bilinear is a possible future refinement, not required for v1). The image is stretched to fit the map's existing fixed dimensions — no aspect-ratio preservation, no map resizing.
4. **Auto-normalize.** Find the actual min/max luminance present in the resampled grid, linearly stretch that range to fill `0–1` — the same normalized scale `_generateInto`'s noise-based `elev` array already uses (see `TARGET_E`/`mThr`/`hThr`/`wThr` usage at `MapEditorPro.html:6868,6901`). This makes the imported array a drop-in replacement for the noise-computed `e` value in that same per-cell loop.
5. **Sea-level offset.** The slider's value is subtracted from every normalized elevation value, clamped back to `0–1`. Moving it up floods more of the low end into water (lower net elevation), moving it down drains more land — a single scalar, no re-decoding of the source image needed, so this can be re-applied cheaply if the designer wants to try a different cutoff.
6. **Feed into the existing chain.** The resulting `elev` array replaces the `e` term in `_generateInto`'s per-cell loop (`MapEditorPro.html:6880-6902`) — moisture (`m`) and biome noise (`b`) continue to be generated exactly as today, from the selected preset's seeded noise. The same `_classify(e, m, b, p.mThr, p.hThr, p.wThr)` call, the same `_smoothTerrain` pass, the same river-carving block (now walking downhill over real elevation instead of synthetic noise — likely producing more geographically plausible rivers with no algorithm changes), the same resource `scatter()` calls, and the same `EdgeTiling` directional-tile resolution for any carved/painted river cells all run completely unmodified.

**Implementation note:** `_generateInto`'s current loop computes elevation, moisture, and biome noise together per-cell in a single pass (it is not three separate full-array stages). Wiring in an imported elevation source means that loop needs to read `e` from the imported array when in import mode instead of calling `eNoise(col,row)`, while `m`/`b` continue to be computed as today — a small, localized change to that one loop, not a restructuring of the pipeline.

---

## Calibration: sea-level slider

- Range: a signed offset (e.g. `-0.3` to `+0.3`) applied uniformly to the normalized `0–1` elevation array before it reaches `_classify`.
- No live preview (per the earlier scoping decision) — the designer applies, inspects the generated map, and re-applies with a different slider value if the coastline looks wrong. Re-applying does not require re-selecting the file; the decoded/resampled/normalized luminance grid can be cached from the initial import and only the offset step re-run.
- This is the only manual calibration control for v1. No separate elevation-range (min/max) controls — auto-normalize handles that.

---

## Error handling & edge cases

- **Non-image file, or decode failure:** show an inline error, abort, leave the current map untouched — same failure posture as this app's existing map-file import error handling.
- **Degenerate image** (uniform color, so min luminance equals max): normalization has nothing to stretch; treat the whole grid as flat `0.5` (sea-level-ish) rather than dividing by zero, and surface a warning that the source image had no usable elevation variation.
- **Very large source image:** decode/resample cost scales with the source image's own pixel count for the one-time read, but the output is always exactly `MAP_WIDTH × MAP_HEIGHT` — no different from any other generation call afterward. Acceptable to let this be a little slower for a huge file, since it's an explicit one-off action; no special size guard needed beyond what the browser itself imposes.
- **Destructive overwrite:** identical posture to the existing "Generate" button — no separate confirmation needed.

---

## Testing / validation

Same approach as the rest of this project (no automated test harness — a deliberate, standing decision, not something to introduce here): live browser verification via the local dev server.

- Import a real grayscale heightmap export of a known real place (e.g. a coastal region, a mountain range, a flat plain) and confirm the resulting `elev` values land in `0–1`, the map's visible shape roughly matches the source image's light/dark pattern, and biome classification still respects whichever preset's moisture was selected (e.g. jungle preset over a real heightmap should still classify vegetation-heavy biomes where moisture is high, not force a specific biome regardless of preset).
- Confirm rivers still carve successfully and walk plausible downhill paths over the imported elevation, and resolve to correct directional `River_*`/`Lake_*` tiles via the existing `EdgeTiling` resolver — no changes needed there, but worth confirming end-to-end.
- Confirm the sea-level slider visibly shifts the water line on re-apply without needing to re-upload the file.
- Confirm existing procedural presets (no import active) are completely unaffected — this is an additive elevation source, not a replacement of the default path.
- Confirm error states: a non-image file, and a uniform-color image, both produce a clear message and no partial/corrupt map state.

---

## Success criteria

- A designer can upload a grayscale/color heightmap image and generate a map whose terrain shape visibly reflects that image's light/dark pattern.
- Biome distribution still reflects the selected preset's moisture personality, not just elevation.
- Rivers carved over imported elevation resolve to correct directional tiles via the existing, unmodified `EdgeTiling` system.
- The sea-level slider adjusts the water cutoff without requiring a re-upload.
- No changes to existing procedural generation behavior when import is not used.
