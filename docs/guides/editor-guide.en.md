# Map Editor Pro: user guide

[Українською](editor-guide.uk.md)

This guide describes what the editor does today. It replaces the older HTML guides in `docs/` (written for v0.4.6) for everything on the MAP tab; those files are kept for the HEX DB, BUILDINGS and SETTLEMENTS forms, which this guide only mentions.

## 1. Getting started

Open `MapEditorPro.html` from a web server (for example `npx serve .` or the published site). Opening the file straight from disk works for painting, but GitHub features and content packages need a server origin. Use a current Chrome, Edge, Firefox or Safari. The folder autosave (File > Set Autosave Folder) needs the File System Access API (Chrome or Edge).

The editor is a single page. The row of tabs under the menu bar switches the section: MAP, HEX DB, BUILDINGS, SETTLEMENTS, KEYS, PACKAGES and MORE (Actions, Upgrades, Monsters, Quests, Common, Dev tools). `Tab` (when no text field is focused and no dialog is open) goes to the next section.

Everything you need while editing a map is in the **left palette**; the minimap and the settlements are in the **right panel**. The toolbar row of the MAP tab has two groups only: **File** (Open, Save) and **View** (the `◎` distance-rings button with its ring interval, the Block address box, Rulers and Coastline). The right panel can be collapsed with the `»` button at its top. On windows narrower than 1920 px it starts collapsed as a thin rail and opens over the map as a drawer; the choice is remembered in this browser.

The left palette is four groups, top to bottom:

- **Tools**, in three labelled rows. **Draw**: Paint, Fill, Rectangle, Line, Circle, Polygon, Eraser, Scatter, Replace and Zone Painter. **Select**: Select Region, Select Tile and Eyedropper. **Place**: Place Building, Erase Building, Draw Road, Connect Road, Erase Road, Place Bridge, Place Settlement and Erase Settlement. Hover a button for its name and key; the active tool is outlined.
- **Tool options**: the brush size (the four size buttons, the radius slider and the radius text) and the Symmetry selector. An option the active tool does not use stays where it is but is dimmed, and its tooltip says which tools use it. The Scatter density and seed, the selection buttons and the paste rotate/mirror buttons appear here while they apply.
- **Tiles**: the package filter (one button per package; click to hide or show its tiles), the terrain and building picker, which takes all the remaining height and scrolls by itself, and the selected tile in one compact row under it.
- **Panels**, in three groups. **View**: Minimap, Go to, Bookmarks. **Edit**: Zones, Stamps, Layers, History. **Check & share**: Validate map, Export image, Map design, Help. All of them start closed. Click a section header (or focus it and press Enter or Space) to open it; opening one closes the one that was open, and a long section scrolls inside itself so the picker keeps its room. The arrow keys move between the headers. The open section is remembered in this browser. A header shows a short summary while it is closed: Layers says how many layers are hidden or locked, Bookmarks and Stamps show how many you have, Validate map shows the last result (marked "(old)" after the map changed) and History the number of steps. The `+` next to Zones adds a zone even while the section is closed. On a short window the whole palette scrolls.

The Help menu opens this guide (English and Ukrainian) and the content packages guide, and lists every keyboard shortcut.

## 2. The map and the coordinates

A map is a grid of flat-top hexagons, from 20 by 20 up to 450 by 450 tiles. `File > New Map` (Ctrl+N) asks for the size. The city marker starts at the middle of the map (see "Move City" in section 9 to change it).

The status bar shows the tile under the cursor as `col,row`, its Unity coordinates `app:x,y` (measured from the middle of the map) and its distance from the city.

**Go to** (left palette) jumps the view to a place. It accepts `col,row` (for example `120,87`), Unity coordinates `app:x,y` (as the status bar shows them) or a block address such as `B:4`. Press Enter or Go. Bad input is flagged and the view stays where it is.

## 3. Moving around

- Mouse wheel: zoom around the cursor. Zoom goes from the whole map (the minimum depends on the map size) up to 200 %. Below 25 % simple sprites are drawn and below 10 % a flat overview, so a 450 by 450 map stays smooth.
- Pan: hold the right or middle mouse button, or hold `Space` and drag with the left button. On a touch screen use one finger to pan and two to zoom.
- `+` / `=` zoom in, `-` zoom out, `0` fits the whole map on the screen.
- Overlays: `1` distance rings (the `◎` toolbar button does the same), `2` block rulers, `3` coastline preview.
- **Minimap** (right panel): click or drag to move the view. In the left palette, **Bigger** enlarges it (340 px; remembered), and **Zones** and **Towns** draw the zone colours and the settlements on it. They follow the Layers visibility (section 7).
- **Bookmarks** (left palette): Add saves the middle of the current view and the zoom, with an optional name. Click a bookmark to jump back; rename and delete are on its row. Bookmarks are stored in this browser only, never in the map file. A bookmark outside the current map is greyed out.

Maps smaller than the window are centred.

## 4. Painting

Pick terrain in the palette, then pick a tool with its button or its key (the tools are listed in section 12).

| Tool | Key | What it does |
|---|---|---|
| Paint | `P` | Click or drag to paint the active terrain. |
| Fill | `F` | Flood-fills the connected area of the same terrain. |
| Rectangle | `R` | Drag a rectangle and fill it. |
| Eyedropper | `E` | Click a tile to make its terrain the active terrain. |
| Select Tile | `S` | Click a tile to inspect it in the right panel. |
| Line | `L` | Drag a line; thickness is the brush radius. |
| Circle | `O` | Drag from the centre; Shift fills the disc. |
| Polygon | `G` | Click corners, then Enter or a double-click fills it (Shift: outline only); Esc cancels. |
| Eraser | `X` | Drag to reset tiles to Plain_1 and remove the building, road, bridge and under-terrain on them. Zones and settlements stay. |
| Scatter | `A` | Drag to sprinkle random variants of the selected terrain. |
| Replace | `H` | Click a tile to replace every tile of that id with the active terrain. |

Details worth knowing:

- **Brush size** (left palette, Tool options): any radius from 0 to 12, with the slider or the `[` and `]` keys. The 3x3, 5x5 and 7 buttons are radius 1, 2 and 3. The brush is a true hex disc.
- Every drag or click is **one undo step**. `Esc` while the button is held cancels the stroke and leaves no step. The hand tools (Paint, Rectangle, Fill, shapes, Scatter, Replace, the Eraser, paste, move and stamps) place exactly the tile you choose and never change neighbouring cells: river and lake pieces, shores and rock water are not re-picked automatically. To shape a river or a shore, pick the piece you want from the palette and paint it. Only the generator (including generate into a selection) fits river pieces by itself.
- **Scatter**: Density is the chance in percent per cell; tick or untick the variants under it. A seed makes a click or an identical drag reproducible; leave it empty for a new seed each stroke (the last one is shown as a hint). Directional river pieces, multi-tile and test tiles are never scattered, and variants always come from the same package as the clicked tile.
- **Symmetry** (selector at the top of the palette; `Y` cycles): mirror left/right, mirror top/bottom, both, 3-fold or 6-fold rotation about the middle tile of the map. Paint, Rectangle, Line, Circle, Polygon, the Eraser and Scatter write every copy as one undo step; a dashed guide shows the axis. Copies that fall outside the map are skipped. Fill and bridges are not mirrored.
- **Replace** (also Edit > Replace Tile...): replaces one tile id by another on the whole map, or only inside the selection when "Selection only" is ticked. Ids match exactly; the new tile must exist in the tile database. It changes terrain only (zones, buildings and roads stay) and is one undo step.
- Writing tools and commands are refused (with a message) while a fill or a generation is running, and while a stroke is in progress.

## 5. Selection, copy and paste, stamps

- **Select Region** (`M`): drag a rectangle of cells. Shift adds, Alt subtracts, `Esc` clears, `Ctrl+A` selects the whole map and `Ctrl+D` deselects. The selection is outlined in yellow with its size in the palette. It survives tool switches and undo, and is dropped when a map is created, loaded or resized.
- **Copy, cut, paste**: `Ctrl+C`, `Ctrl+X`, `Ctrl+V` (Cmd on macOS). They move terrain, buildings, roads, bridges, under-terrain and zones. After `Ctrl+V` a ghost follows the cursor; click to stamp (again and again), `Esc` ends. `Delete` or `Backspace` clears the selected region. The clipboard lives in the editor, not the system clipboard.
- **Rotate and mirror while the ghost floats**: `.` and `,` rotate by 60 degrees clockwise and counter-clockwise, `/` and `;` mirror left/right and top/bottom. The four buttons under the tool row do the same.
- **Move**: `Enter` (or the Move button next to the selection readout) lifts the selected region as a ghost; click to drop it. It is one undo step; `Esc` cancels with nothing changed. A lifted region is cancelled if the map changes in the meantime.
- Zones are stored per map: a copy pastes its zones only onto the map it came from.
- Multi-tile terrain moves with its own footprint but cannot be rotated; a message tells you.
- **Stamps** (left palette): select a region, type a name and press Save (or Enter). Click a stamp, then the map to place it (rotate and mirror keys work, `Esc` cancels). The X button deletes a stamp after a confirmation. Export downloads all stamps as `stamps-YYYY-MM-DD.json`; Import adds the stamps of such a file (a bad file adds nothing). Stamps are stored in the browser, separate from maps, and survive New, Open and reloads. A stamp that uses tiles you have not installed still pastes and tells you how many cells use missing tiles.

## 6. Buildings, roads, bridges, settlements and zones

All these tools have buttons in the left palette.

- **Place Building** (`B`): pick a building in the picker, then click or drag. Placing over another building replaces it; a cell inside a multi-tile terrain footprint refuses a building. Buildings that spawn satellite objects (for example a farm with its fields) fill the nearest free neighbouring cells, and the satellites go away with their building. **Erase Building** removes buildings and their satellites. The picker closes with `Esc` or a click outside.
- **Roads**: **Draw Road** (`W`) adds a road tile next to an existing road, the city or a settlement. **Connect Road** (`C`) is click, click: the first click marks a start, the second writes a shortest path as one undo step and becomes the next start (`Esc` or switching tool drops the start). It does not avoid water, the city or buildings. **Erase Road** (`Q`) removes only the road.
- **Place Bridge** (`U`): click a river tile to build the bridge chosen in the picker; the same bridge again removes it, another bridge replaces it.
- **Settlements**: Place Settlement (`T`) and Erase Settlement (`D`). The settlement slot panel and distance rings configure where the game should place settlements. If the Settlements layer is hidden, choosing these tools or running Auto-place turns it back on.
- **Zone Painter** (`Z`): paint zones (biomes) on the map. The **Zones** section of the left palette has the zone list and the zone actions: **Randomize & Fill** (the slider next to it sets the patch size), **Fill Zones**, **Overlay** (the same switch as the Zone overlay layer) and **Clear Zones**.
- Auto-place settlements and the QA tile placer (Dev menu) are bulk writers: they are refused while a fill or stroke is running.

## 7. Layers and locks

The **Layers** section (left palette; while it is closed its header shows how many layers are hidden or locked, and the status bar names them) lists Terrain, Buildings and bridges, Roads, Settlements and Zone overlay.

- The eye button hides a layer on the map. Hidden terrain shows a flat dark tile. Hiding is a view setting only: it is not an undo step and does not change the map. The Zone overlay switch is the same as the zone overlay button of the Zone Painter.
- The lock button protects a layer. A locked layer is left alone by every tool and command that would write to it: a refused action shows one message and leaves no undo step. Cut, delete, move, paste and the Eraser still edit the layers that are not locked.
- Visibility and locks are remembered in this browser (they are not part of the map file). Undo and redo are not blocked by locks.
- **Edit > Clear Map** clears every unlocked layer in one undo step (terrain back to Plain_1, bridges, buildings, roads, zone cells and non-city settlements). The city, the settlement slot configuration and the zone definitions stay, and the confirmation says what will be cleared and what is kept because it is locked. A layer that is only hidden is still cleared (the dialog marks it).

## 8. Undo, history, saving and recovery

- `Ctrl+Z` undo, `Ctrl+Y` or `Ctrl+Shift+Z` redo. The **History** panel (left palette, closed by default) lists the steps, newest first; click a step to jump to it. Jumping is refused while a fill, a stroke or a lifted region is active.
- **Save** (`Ctrl+S`) downloads the map as JSON. `Ctrl+S` waits for a running fill to finish. **Open** (`Ctrl+O`) loads a map file.
- **File > Export CSV** saves the terrain grid only.
- A map file that cannot be used is rejected before anything changes, with the reason; your current map stays. A file with smaller problems opens and shows a "Map loaded with warnings" dialog. A map saved by a newer editor still opens and says so. The editor writes a `version` into every file it saves.
- **Autosave** keeps your work in the browser (IndexedDB) shortly after changes and when you leave the page. If the previous autosave cannot be read it is left untouched and your new changes are kept as recovery copies instead. **File > Recover autosave copies...** lists the copies so you can restore or discard each one.
- **File > Set Autosave Folder...** (Chrome or Edge) also writes the session to a folder you choose.
- **Edit > Expand Map...** adds up to 100 tiles on every side, filled with ground or water.

## 9. Generating and designing maps

Open **Generate > Procedural Generator...** The preview updates as you change values; **Generate** writes the map as one undo step.

- **Seed**, five **presets** (Wasteland, Jungle, Desert, Arctic, Volcanic), noise scales, mountain, hill and water levels, coastline, rivers, and gold and oil deposits.
- **Only inside the selection**: regenerates just the selected region (terrain only), with a **Blend width** slider that feathers the border. Without a selection the dialog works on the whole map.
- **Elevation image**: Import elevation takes a grayscale image (bright is high; north is up, west is left) and uses it instead of the noise, with a **Sea level** slider. Importing only loads the image and ticks "Use imported elevation"; nothing is overwritten until you press Generate. PNG, JPEG, WebP, BMP and GIF up to 25 MB are accepted. The clear button forgets the image.
- Generation runs in a background worker, so the page does not freeze. It respects the Terrain lock and is refused while another fill runs.
- The generator picks its tiles by their class in the tile database (water, forest, ...), so renamed or replaced tiles are used; if a class has no tile, a message lists what is missing.

**Satellite Import...** (Generate menu) turns a satellite picture into terrain (classification by colour with a live preview).

The **Map design** section (left palette, closed by default):

- **Move City**: click the map to put the city there (one undo step). The distance rings, the slot bands and the generator's flat area around the city follow it. The default is the middle of the map.
- **Bands**: difficulty band limits in tiles from the city, as a comma list (up to 10 whole numbers, for example `10,20,35,60`). Empty means a band every N tiles (the interval box in the toolbar). Saved in the map as `distance_bands`.
- **Placement**: seed, number of bunkers, mega cities, artifacts and four ore cluster counts, then **Place**. It scatters them over free land away from the city as one undo step. Ore clusters are written as terrain, artifacts as buildings, bunkers and mega cities as settlements. The ids and distances are assumptions that the game team should confirm.

## 10. Checking and exporting

- **Validate map** (left palette, closed by default): press Run to check the map; it never runs by itself. It reports unknown tile or building ids, no city, settlements the city cannot reach over land (water, rivers, mountains, lava and rifts block; a bridge opens a crossing), roads that connect to nothing, and tiles whose sprite failed to load. Click an issue to centre its first cell and mark the cells in red. Filter by severity, or Clear marks. After the map changes the list is marked as outdated.
- **Save, Export CSV and Publish Map check the map first.** Errors open a summary with Show issues, Cancel and Export anyway; warnings only show a message. The saved file is not changed by the check.
- **Export image** (left palette, and File > Export PNG): saves the whole map as `map-YYYY-MM-DD.png` at 5, 10, 20, 50 or 100 percent or the largest allowed size. One flat-colour hexagon per tile plus the visible layers; hidden layers are not exported. The size limit is 8192 px per side and 36 megapixels (larger requests are scaled down and the message says so). It does not change your view.

## 11. Content packages

The PACKAGES tab manages content packages: bundles of hex tiles, buildings and sprites that can be published separately from the base game (`postapoc`). The essentials:

- The panel lists each package with its entry counts and an `active` marker. Set active makes a package the target for new entries; the selector also appears in the HEX DB and BUILDINGS toolbars. The palette groups tiles and buildings by package when more than one package has entries.
- **New Package** creates an empty package. **Details** edits its description, dependencies (`id`, `id@1.2.3` or `id@^1.2.0`) and a 512 by 512 preview image. **Export** downloads a ZIP of the local version (works offline). **Import Package** validates the ZIP first, and if it fails it rolls back. When the id already exists you choose Replace, Merge or Cancel. **Publish** shows what will change, lets you bump the version and add a changelog note, and warns about missing sprites. **Delete** is reversible from "Recently deleted".
- Sprites are stored per package. Uploads are checked (4 MB limit, PNG, JPEG or WebP only; JPEG and WebP are converted to PNG) and asking to replace an existing sprite shows a choice.
- **Reskin+** (HEX DB and BUILDINGS, while a non-default package is active) opens a searchable picker of the base entries and makes a copy of the one you choose. Two modes: **Copy with package prefix** (the default) gives the copy the package prefix, so `Plain_1` becomes `Medieval_Plain_1` in package `medieval` (`sci-fi` gives `SciFi_`); the prefix is not added twice. **Override the same id (runtime reskin)** creates an entry with the same id as the base tile; the game will use it instead of the base tile when this package is active, and the list shows both. Either way the copy keeps the base sprite name until you upload its own sprite, and an entry that already exists in the package is never duplicated (the editor says so and selects it).
- **Without a GitHub token, or when you are offline, the editor works in local-only mode:** you can create, edit, import and export packages, and they stay in this browser, marked "local only", until you publish them with a token. Export a ZIP to keep a copy.
- The game does not load non-default packages yet; only `postapoc` content appears in the game today. The panel says so.
- **Publish HexDB** and **Publish Buildings DB** (menu bar, Publish) publish the base package (`postapoc`) only, whichever package is active; a package's tiles and buildings are published with **Publish** in the PACKAGES tab. So the order of the three publishes does not matter.
- Publishing needs a GitHub token (the GitHub button in the menu bar). On startup the saved content is merged with the shipped defaults instead of replacing it, so local edits are not lost when the defaults change.

## 12. Keyboard shortcuts

The list below follows the editor's own shortcut list (Help > Keyboard Shortcuts shows the same). Tool, brush, zoom and overlay keys work on the MAP tab only. Ctrl+Z, Ctrl+Y, Ctrl+N, Ctrl+O and Ctrl+S work on every tab. All of them are ignored while you type in a text field and while any dialog is open.

**Tools** (typed letter, no Ctrl or Alt):

| Key | Tool |
|---|---|
| `P` | Paint |
| `F` | Fill |
| `R` | Rectangle |
| `E` | Eyedropper |
| `S` | Select Tile |
| `T` | Place Settlement |
| `D` | Erase Settlement |
| `Z` | Zone Painter |
| `Y` | Cycle symmetry mode |
| `L` | Line |
| `O` | Circle |
| `G` | Polygon |
| `X` | Eraser |
| `A` | Scatter |
| `M` | Select Region |
| `H` | Replace Tile |
| `B` | Place Building |
| `W` | Draw Road |
| `C` | Connect Road |
| `Q` | Erase Road |
| `U` | Place Bridge |

**Edit and file:**

| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select the whole map |
| `Ctrl+D` | Clear the selection |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy, cut, paste |
| `Delete` / `Backspace` | Erase the selection |
| `Enter` | Lift the selection to move it |
| `Esc` | Cancel the current action, then clear the selection |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | New, open, save |
| `Ctrl+Shift+S` | Save the map; on the HEX DB tab it saves the Hex DB instead (Data menu) |

**Brush and view:**

| Key | Action |
|---|---|
| `[` / `]` | Smaller or larger brush |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Fit the whole map |
| `1` / `2` / `3` | Distance rings, block rulers, coastline preview |
| `Space` + drag | Pan (also right or middle mouse button) |
| `Tab` | Next editor section |

**While a pasted or lifted region floats:**

| Key | Action |
|---|---|
| `.` / `,` | Rotate clockwise / counter-clockwise |
| `/` / `;` | Flip left-right / top-bottom |

Keyboard layouts and the typed-letter rule: tool keys follow the letter you actually type on Latin layouts (AZERTY, QWERTZ, Dvorak, Colemak, Workman, Turkish-F), so `P` is the key that types p. On layouts with no Latin letters (Ukrainian, Russian, Greek) the physical key position is used, so the tool keys work without switching layout. Option combinations on macOS, dead keys, IME composition and key repeat never switch tools. Known caveats:

- On the Turkish-F layout there is no `W` or `Q` key, so Draw Road and Erase Road have no shortcut; use the buttons.
- The rotate and mirror keys `. , / ;` are physical keys (US positions). On Dvorak the key that types a comma is the `W` key, so while a region floats it does not rotate, and without one it switches to Draw Road.
- Where a tool key is punctuation on your layout the physical key decides (for example on Dvorak `'` is Erase Road).
- Zoom and brush keys follow the character you type, with the physical bracket keys as the fallback. `+`, `=` and `-` zoom wherever they sit: on QWERTZ `+` is the key right of `ü`, on Dvorak `=` is the key right of `/`, on AZERTY `-` is the `6` key. A typed `[` or `]` changes the brush wherever it sits: on Dvorak the two keys right of `0`, on QWERTZ AltGr+8 / AltGr+9 (Windows) or Option+5 / Option+6 (macOS). The two physical keys at the `[` `]` positions of the US layout change the brush on every layout unless they type `+`, `=` or `-`; so on QWERTZ `ü` is the smaller brush and the larger brush is AltGr+9 or Option+6 (the `+` key zooms in), and on Dvorak the `/` key is the smaller brush (the `=` key zooms in). On Turkish-F the keys that type `q` and `w` are those two brush keys.
- `Ctrl` or Cmd with `A`, `C`, `X`, `V`, `D` use the physical key; Undo and Redo use the typed letter.
- The AZERTY digit row needs `Shift` for `1`, `2`, `3`; the numpad digits also work.

## 13. Limits and things to know

- Place Building refuses a cell inside a multi-tile terrain footprint, with a message; Replace skips tiles whose new multi-tile footprint would not fit and says how many.
- Locks, layer visibility, bookmarks, stamps and the right panel mode are browser settings, not part of the map file.
- The legacy road adjacency of the Connect Road tool differs from true hex adjacency on some rows: a path can leave a visible gap. A straight line along one axis is exact.
- Zone definitions (names, colours, presets) are saved with the map but are not part of Undo.
- When a map operation is refused, a message explains why; nothing is written and no undo step is added.
