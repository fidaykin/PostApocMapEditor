# Task report: left palette accordion

Branch `feature/editor-roadmap`, base 6071f69. Owner decision: accordion, everything collapsed except the tiles.

## What changed

- `#palette-tiles` (new wrapper) holds the package filter row, `#palette-scroll` and `#palette-selected`. It has
  `flex: 1 1 auto; min-height: 320px`; `#palette-scroll` is `flex: 1 1 auto; min-height: 0; overflow-y: auto` (it was
  `flex: 1 0 160px`). The active terrain preview is one compact row (22 px image, name and id on one line, 29 px high; it was 101 px).
- `#palette-acc` (new) holds 11 sections, top to bottom: zones, goto, minimap, bookmarks, stamps, layers, validator,
  export, history, design, help. Each is `section.pal-acc[data-acc]` with a header
  `button.pal-acc-btn#acc-btn-<key>[data-acc][aria-expanded][aria-controls]` (chevron `.pal-acc-chev`, label
  `.pal-acc-label`, badge `.pal-acc-badge`) and a body `.pal-acc-body[role=region][aria-labelledby][hidden]` that keeps
  the panel's old id: `zone-panel`, `goto-panel`, `minimap-panel`, `bookmarks-panel`, `stamp-panel`, `layers-panel`,
  `validator-panel`, `png-export-panel`, `history-panel`, `map-design`, `shortcuts-panel`. Every inner id and class is
  unchanged. The three `<details>` panels (validator, export image, history) and `<details id="map-design">` (it sat above the
  tiles) now use the same mechanism. The zone `+` (`#btn-add-zone`) sits in the Zones header row, so it can be reached while
  the section is collapsed, and it opens the section.
- `PaletteAccordion` module (`init, open(key, {reveal}), close, toggle, getOpen, setBadge, fit`): single-open; none
  open by default; the last open key is stored in `localStorage.paletteOpenSection` (every access in try/catch, so with
  storage blocked it lasts for the session only). The open body is capped at 45 % of the palette height
  (`--acc-body-max`, set from a ResizeObserver) and scrolls inside itself. When the tools, the headers, the 320 px picker
  and the open body do not fit, the palette itself scrolls. A header click scrolls only the palette to show the
  section (no `scrollIntoView`). Enter and Space are stopped at the header (the Space-pan and Enter-lift handlers never see them),
  ArrowUp/ArrowDown/Home/End move between headers, and a pointer click blurs the header (the `e.detail > 0` rule).
- Badges: Layers `N hidden · M locked` (from `Layers._refreshRows`, next to the unchanged `#st-layers` status-bar summary),
  Bookmarks count, Stamps count, Validate map `N issues` / `OK` with ` (old)` when stale, History step count.
  `MapValidator.showIssues` opens the validator section through `PaletteAccordion.open`.
- No toolbar controls added (57 before and after), palette width 220 px, grid unchanged, canvas 1491x808 at 1400x900
  (classic) and 1152x808 (auto). No new global shortcuts. Text is set with textContent only.

## Tests

- Helper in `tests/helpers.ts`: `PALETTE_SECTIONS` and `openSection(page, key)`. It is idempotent, opens the section through
  `PaletteAccordion.open` and waits for `aria-expanded="true"` and a visible body.
- New `tests/palette-accordion.spec.ts` (10 tests; RED at e841db1, green at 1506fba). It covers: all sections collapsed with
  correct aria wiring and no `<details>` left; the tile-region height and fully visible tiles at 1400x900 and 1100x700;
  single-open behaviour, the 45 % cap and the tile minimum for every section at both viewports, and internal scrolling;
  Enter/Space/arrows, Space not panning on a header and panning again after a pointer click; collapsed content not focusable
  (Tab outside text fields is the existing mode-cycle shortcut, so focusability is checked directly, plus native Tab and
  Shift+Tab from the go-to field); persistence across a reload; storage blocked; badges; toolbar count and canvas size.
- Specs updated to open the section before they touch its content (no assertion weakened; the stamps, layers, goto and
  bookmarks viewport checks at 1400x900 and 1100x700 now run after opening): stamps, layers, nav-goto, nav-bookmarks,
  nav-minimap, history-panel, validator-ui, validator-gate, city, placement, export-png, phase4-auto-layout,
  final-wave-b-editor, fixwave1, shortcuts. `getByRole('button', { name: 'OK' })` is now `exact: true` in dialogs,
  no-native-dialogs and validator-gate, because the visible "Bookmarks" header contains "ok".

## Measured (default auto layout, from the DOM)

| | 1400x900 | 1100x700 |
|---|---|---|
| palette height | 808 | 608 |
| tile region (`#palette-tiles`) | 415 px | 320 px (minimum) |
| picker scroll box | 354 px | 259 px |
| fully visible tiles, default categories (only PLAINS open, 6 tiles) | 6 (all) + 6 category headers | 6 (all) + 4 category headers |
| fully visible tiles with WATER expanded too | 15 | 9 |
| collapsed header height | 22 px each (11 headers, accordion block 253 px) | same |
| palette overflow, all collapsed | 0 (no palette scroll) | 105 px (the bottom headers need a palette scroll) |
| open section cap | 364 px | 274 px |
| Layers open: tile region / palette overflow | 320 / 34 px | 320 / 234 px |

Before: the picker was a 160 px box and the palette content was 1193 px tall at both sizes (0 tiles fully visible).

## Full suite

`npx playwright test` after the three commits: 1602 passed, 1 failed, 5 skipped, 10.1 min, startup retries 0, machine
sleeps 0, load average 9.7 at the start and 28.3 at the end (other processes on the machine). The one failure was
`perf-culling.spec.ts:102` (multi-tile anchors at the viewport edge), a 60 s timeout under that load. Run alone right after,
`tests/perf-culling.spec.ts` passed 4/4 in 14.6 s.
