# Task report: structured editor UI (map screen)

Branch `feature/editor-roadmap`, base c1258cf. Owner request: "bring the UI to an adequate state so it is not all smeared,
but has a structured look". Only reorganised, regrouped and restyled: no tool, shortcut, History/Layers/lock/gating logic
changed, no new global shortcut, `tests/perf-baseline.json` untouched.

## Final layout (default `auto` layout, 1400x900)

```
Top bar (40 px row, scrolls inside itself in auto layout)
MAP HEX DB BUILDINGS SETTLEMENTS KEYS PACKAGES MORE▾ | FILE [Open][Save] | VIEW [◎][10] | Block:[A:1] [Rulers][Coastline]

Left palette (220 px)                 Right panel (rail / drawer / inline, T4.11 unchanged)
+--------------------------------+    +----------------------------+
| Draw   [P][F][R][L][O][G]      |    | »                          |
|        [X][A][H][Z]            |    | +------------------------+ |
| Select [M][S][E]               |    | |        Minimap         | |
| Place  [B][b][W][C][Q][U]      |    | +------------------------+ |
|        [T][D]                  |    | (Selected Tile: contextual)|
|--------------------------------|    | Settlements: N             |
| [•][3x3][5x5][○7] [====o=====] |    | 🏘 SETTLEMENT SLOTS      ▶ |
| Radius 0 (1 tile) [Symmetry ▾] |    | (Zone Config: contextual)  |
| (scatter / selection / paste   |    +----------------------------+
|  rows appear here when needed) |
|--------------------------------|
| TILES [Post-Apoc…|Decameroon]  |
| ▼ Post-Apocalypse (103)        |
|   ▶ WATER / RIVER  ...         |
|   (picker: all remaining       |
|    height, min 320, scrolls)   |
| [hex] Plain_1  Plain_1         |
|--------------------------------|
| VIEW                           |
|  ▶ Minimap / Go to / Bookmarks |
| EDIT                           |
|  ▶ Zones [+] / Stamps / Layers |
|  ▶ History                  1  |
| CHECK & SHARE                  |
|  ▶ Validate map / Export image |
|  ▶ Map design / Help           |
+--------------------------------+
Zones section open: [🎲 Randomize & Fill][patch ====o]
                    [▶ Fill Zones][👁 Overlay] / [🗑 Clear Zones]   then the zone list
```

Letters are the tool keys (P paint, F fill, R rectangle, L line, O circle, G polygon, X eraser, A scatter, H replace,
Z zone painter, M select region, S select tile, E eyedropper, B place building, b erase building, W draw road, C connect
road, Q erase road, U bridge, T place settlement, D erase settlement).

## What moved where

| Element (selector) | Before | After |
|---|---|---|
| `.tool-btn[data-tool=paint\|fill\|rect\|eye\|select\|settlement\|erase\|zone]` | `#map-tools` (top toolbar), tooltip in a `.tooltip` span | `#shape-tools .tool-row[data-row=draw\|select\|place] .tool-row-btns`, `title` + `aria-label` |
| the 13 shape/object/road tool buttons (`line` … `bridge`) | `#shape-tools` (one flat wrap) | same `#shape-tools`, in the Draw / Select / Place rows, `aria-label` added |
| Duplicates between toolbar and palette | none (checked by `data-tool`: the top `erase` is Erase Settlement, the palette `eraser` is the terrain eraser) | every `data-tool` exists once; `#toolbar [data-tool]` is empty |
| `#brush-panel`, `#brush-sizes`, `.brush-btn`, `#brush-size-range`, `#brush-size-label` | `#right-panel` | `#tool-options` (left palette); `#brush-size-label` sits next to `#symmetry-row` in `.opt-row-2` |
| `#symmetry-row` / `#symmetry-select` | palette, own row with inline style | `#tool-options .opt-row-2`, `data-relevant`, `aria-label` |
| `#selection-row`, `#paste-tools`, `#scatter-row` | palette under the tools | `#tool-options` (same ids, same show/hide code) |
| Randomize & Fill button | `#map-tools`, no id | `#zone-panel .zone-actions`, new id `#btn-zone-randomize`, same `onclick` |
| `#rnd-zone-scale` | `#map-tools` | `#zone-panel .zone-actions` (+ `aria-label`) |
| Fill Zones / Clear Zones buttons | `#map-tools`, no id | `#zone-panel`, new ids `#btn-zone-fill` / `#btn-zone-clear`, same `onclick` |
| `#btn-zone-overlay` | `#map-tools` | `#zone-panel`, same id and handler (Layers sync untouched) |
| `#btn-zones`, `#ring-interval`, `#block-nav-input`, `#btn-toggle-rulers`, `#btn-toggle-coastline` | `#map-tools` | `#map-tools` = View group (`.tb-group[data-tb-group=view]`); inline styles of the two inputs became `.tb-input` |
| Open / Save | `#map-io` | `#map-io` = File group (`.tb-group[data-tb-group=file]`), `title` added |
| `#pkg-filter-terrain` | first row of `#palette-tiles` | inside `.tiles-head` with the `.pal-caption` "Tiles"; compact segmented chips with `title` and `aria-pressed` |
| accordion sections | flat list: zones, goto, minimap, bookmarks, stamps, layers, validator, export, history, design, help | `.pal-acc-group[data-group=view\|edit\|check]` with `.pal-acc-group-h` headings: minimap, goto, bookmarks / zones, stamps, layers, history / validator, export, design, help |
| `#right-active-terrain`, `#right-terrain-img/-name/-id` | right panel (written by `UI.selectTerrain`) | removed (the compact `#palette-selected` row is the only one; the writer was removed) |
| `#tile-inspector`, `#zone-config-panel` | right panel | right panel (contextual, hidden by default) |

New structure hooks: `#palette-tools`, `#tool-options`, `[data-pal-group=tools\|options\|tiles\|sections]` (role=group with
aria-label Tools / Tool options / Tiles / Panels), `.tool-row`, `.tool-row-label`, `.tool-row-btns`, `.opt-row`,
`.tiles-head`, `.pal-caption`, `.pal-acc-group`, `.pal-acc-group-h`, `.tb-group`, `.tb-label`, `.tb-sep`, `.tb-input`.

Behaviour added: tool options are dimmed (opacity 0.45, `data-relevant="false"`, tooltip "Brush size: not used by Fill
(it applies to …)") for tools that do not use them; never disabled. Brush: Paint, Eraser, Scatter, Line, Circle, Zone
Painter. Symmetry: Paint, Rectangle, Line, Circle, Polygon, Eraser, Scatter. Palette buttons keep Enter/Space to
themselves (not Space-pan / Enter-lift) and a pointer click blurs them (Space pans and letters stay tool keys), like the
accordion headers. One 2 px accent focus ring on every palette, toolbar and right-panel control; thin dark scrollbars.

Classic layout contract: the toolbar row used to be 1931.3125 px wide at 1400x900 (canvas 1491x808). With the tools gone it
would shrink, so `body.layout-classic #map-tools { min-width: 1155.421875px }` keeps the row at exactly 1931.3125 px
(measured, asserted in `ui-structure.spec.ts`; the right panel still starts at x = 1711.3).

## Measured sizes (default auto layout, from the DOM)

| | 1400x900 | 1100x700 | 1920x1080 |
|---|---|---|---|
| menu / toolbar rows | 28 / 40 px | 28 / 40 px | 28 / 40 px |
| palette height | 808 | 608 | 988 |
| tools group (`#palette-tools`: 5 button lines of 24 px) | 142 px (rows 132) | 142 | 142 |
| tool options strip (`#tool-options`) | 63 px | 63 | 63 |
| tile region (`#palette-tiles`) | **324 px** (was 415) | **320 px** (minimum, was 320) | 504 |
| picker scroll box | 267 px (was 354) | 263 (was 259) | 447 |
| accordion block (3 group headings of 16 px, 11 headers of 20 px) | 279 px (was 253: 11 x 22 px) | 279 | 279 |
| palette overflow, all collapsed | 0 | 196 px (was 105) | 0 |
| map toolbar View group | 381 px | 381 | 381 |
| toolbar overflow (scrolls inside itself) | 0 | about 92 px | 0 |
| classic: toolbar row / canvas | 1931.3125 px / 1491x808 | | |

The picker lost 91 px at 1400x900 because all 21 tools and the brush now live in the palette; it still shows the whole default
category (6 tiles) and 4 category headers, at least 8 tiles with WATER expanded, and all collapsed fits without a palette
scroll (palette-accordion.spec.ts thresholds unchanged).

Screenshots (not committed) were taken after every step at 1400x900, 1100x700 and 1920x1080 (collapsed, Zones open, right
drawer open, Layers and Map design open, a non-brush tool active) and checked for hierarchy, alignment and clipping.

## Tests

New `tests/ui-structure.spec.ts` (15 tests; 12 RED on c1258cf before any change, the two fit tests and the classic test
passed there as positive controls): the four palette groups in order with labels; the Draw / Select / Place rows, equal 24 px
buttons with title and accessible name, shortcut text kept in the moved tooltips; no duplicated tool button and none in the
toolbar; the View / Edit / Check & share headings and single-open; brush size in the tool-options strip with presets, slider,
`[` and `]`; dimming per tool (17 tools) without disabling; zone actions in the Zones section with their handlers, the
Overlay/Layers sync, Randomize & Fill with Terrain and Settlements locked (zones only) and Fill Zones refused while locked;
toolbar has only File and View groups and their controls work; classic 1491x808 and the 1931.3125 px row; right panel holds
minimap and settlements only (inspectors hidden by default); no horizontal overflow, no overlap, no unexplained clipping and
the no-scroll fit at both viewports; focus-visible ring on seven kinds of controls, Enter/Space activate a focused tool, a
pointer click does not keep focus; keyboard reachability of every tool, brush and toolbar control.

| Spec | Before | After |
|---|---|---|
| `tests/helpers.ts` | `PALETTE_SECTIONS` in the old flat order | document order of the three groups |
| `palette-accordion.spec.ts` | SECTIONS in the old order; ArrowUp x2 from Layers lands on Bookmarks; 57 toolbar controls | new order; ArrowUp x3 (Zones sits between); 44 controls (8 tools + 5 zone controls moved), comment explains |
| `layout-narrow.spec.ts` | right-panel reachability of `#brush-panel` and `#right-active-terrain`; hit test on `#right-active-terrain` | `#settlement-count` and `#slot-panel`; the brush preset click still runs with the drawer open |
| `layers.spec.ts` | clicks `#btn-zone-overlay` in the toolbar | opens the Zones section first |
| `final-wave-b-editor.spec.ts` | toolbar overflow > 100 px at 1100 px | > 40 px (about 92 px now); the scroll-closes-dropdown and tooltip-follows checks unchanged |

No assertion weakened otherwise; every tile-region threshold of palette-accordion.spec.ts holds at both viewports.

## Full suite

`npx playwright test` once at 1ac4606: 1628 passed, 1 failed, 5 skipped, 9.7 min, startup retries 0, no machine sleep
(load average 3.9 at the start, 11.2 at the end). The failure was real and caused by this task:
`startup-sync.spec.ts:114` clicks `getByRole('button', { name: 'Replace', exact: true })` in a dialog, and the new
`aria-label="Replace"` of the Replace tool button matched it too. The label is now "Replace tile" (the tool's status-bar
name); `startup-sync`, `ui-structure` and `selection` specs then passed (243/243). Focused runs during the work: 1001/1001
(26 specs: ui-structure, palette-accordion, layout-narrow, perf-minimap, perf-culling, stamps, layers, nav-*, validator-ui,
history-panel, paint-tools, shortcuts, shortcut-layouts, packages-palette, packages-toolbar, phase4-auto-layout, help-menu,
docs-lint, city, placement, export-png, final-wave-b-editor, selection, object-tools) and the perf canvas specs
(perf-lod, perf-overlays, perf-zoom-floor, perf-equivalence) green.

## Notes for the owner

- The picker is 324 px at 1400x900 (was 415): the price of having all 21 tools and the brush in the palette. Every
  threshold holds; if more picker height is wanted, the next lever would be moving Help into the Help menu only.
- Zone Painter (not named in the brief) is in the Draw row. The Selected Tile and Zone Config inspectors stay in the
  right panel as contextual blocks.
- At 1100x700 the palette scrolls 196 px when everything is collapsed (was 105 px); the tiles are still fully on screen
  without scrolling.
