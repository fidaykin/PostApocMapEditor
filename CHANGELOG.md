# Changelog — Map Editor Pro

All notable changes to this project are documented here.
Format: `## [version] — [date]`

## Unreleased

### Publishing
- Unified **Publish Package Data** (menu bar): publishes the active package after a diff against the server that now also lists new and changed sprites; sprites whose sha256 already matches the server `manifest.json` are skipped (no or unreadable manifest uploads everything). The base package (`postapoc`) goes through the same dialog with its own confirmation and still writes the root copies for old game builds.
- **Publish Common Data**: Upgrade DB, Common settings and `localization.json` in one confirmation; only changed files are written. The menu is now Publish Package Data, Publish Common Data, Publish Map and Clean Ghost Sprites; the old per-database entries are gone from the menu (the functions remain).

### Fixes
- The map file name survives a reload: the autosave stores it (`_fileName`), so the status bar shows the name instead of `(autosave)` and Save keeps the file name (ClickUp 869fm23zy thread).
- The biome list follows the loaded databases: a biome used by a record (e.g. `Decameron`) is listed on a browser that does not know it, and the Buildings and Settlements forms keep the record's own biome instead of showing the first default (ClickUp 869fm23zy).

### Maps
- Map **Skin** (left palette, Map design section, map JSON key `skin`, absent when empty): the content package that repaints this map in the game. The game adds it as the last package of the map, so its skinSlot records replace the base look (visuals only). The map keeps its own tiles; only the art changes. The choice is saved with the map, restored by autosave and cleared by New map. This release pairs with the game change `feature/map-skin-cheat`; an older game ignores the key.
- Publish Map now also writes `updatedAt` (the full ISO time of the publish) next to `uploadedTime` (the date) in `maps/map_list.json`. The game's Maps tab compares it with the time it last applied the map, so a map republished on the same day with the same size is recognised as updated. Entries published earlier have no `updatedAt`; the game then falls back to date and size.

### UI
- HEX DB → Income → **Transform to** takes a concrete Hex ID only: the Parent Hex mode is removed (designer decision, ClickUp 869fmg8yx). A record that still holds `__parent__` is set to `Plains_1` when the database loads. The game did not support Parent Hex (it kept no tile under a hex) and left the tile unchanged.
- BUILDINGS form checks (ClickUp: Price, Premium Price, Min Level and Radius checks; ID lists; Available Tiles). **Min Level, Premium Price, Radius** (Additional Build Condition) and **Building Radius** accept whole numbers only: the keys `. e + - ,` are blocked, and on leaving the field the value becomes a clean integer in range (no leading zeros, no fraction, no sign; empty becomes the default: Min Level 1, the others 0; limits 1000, 1 000 000, 10 000 and 10 000). Price amounts already worked this way. Suggestion lists: Destroy **Transform to** (HexID) lists tiles and buildings, Tiles Type **HexID** lists tile ids and **Type** lists tile types, **Produce** lists tiles and buildings, **Available Tiles** and **Available Tiles for Produce** list tile ids and types. The lists hold the base package and the record's own package only. A name that is not in the list is outlined red on the tag (and a warning appears when it is added), it is still accepted. Available Tiles, Available Tiles for Produce and Produce also get a **Pick…** button: a searchable checklist of the known tile ids and types (buildings too for Produce); Apply replaces the field with the checked ones and keeps typed names the list does not know. **Tiles Type** (Additional Build Condition) gets a **Pick…** button too: one choice from the tile ids (HexID) or the tile types (Type); hidden for Parents. Parents hiding the Tile ID field and the id not getting a trailing dot after the spaces are removed were checked: both already behave as asked, now covered by tests.
- Skin slots: package tiles and buildings get an optional **Skin Slot** field (HEX DB and BUILDINGS forms, saved as `skinSlot`, absent when empty): the id of the base tile or building the record repaints. The game (this release pairs with the `feature/skin-slots` game change) then keeps the base id in the map and the active package changes only the look; prices, type and rules come from the base record. PACKAGES has a new **Skin slots** button per package: a table of every base tile and building with a select for the package record that repaints it, an **Apply N suggestion(s) by id prefix** button (`Decameroon_Plain_1` suggests `Plain_1` when the type matches), a coverage line and the list of records the game would ignore (no base record, other type, two records on one slot). Publish Package refuses while such problems exist. The table only edits the Skin Slot field; no extra file. Nothing changes for packages that leave the field empty.
- PACKAGES: new **Fix packages by id prefix** button (ClickUp 869fjygem). Records made before the id decided the package (Copy, Paste, Change ID kept the old package) sit in the wrong package with, for example, a `Medieval20_` id inside Decameroon, so Publish Decameroon warned about the missing sprites of all of them. The dialog lists the tiles and buildings that would move to the package their id prefix names and the ones that cannot (an entry of that id already exists there, or a road or bridge), and moves them only after the confirm; nothing is published. Afterwards publish the package that lost the records and the one that got them.
- The id of a BUILDINGS or HEX DB entry decides its package (ClickUp 869fjvua7). Paste now puts the copy into the **active package** (when it is not the base package): it drops the source package's id prefix, gets the active one (`Medieval20_Farm_1_copy`, numbered `_copy2` when taken) and the active package, in both databases. Typing another package's prefix into an id (`Medieval20_Building_1`) moves the entry to that package when the field is left, with a toast; nothing moves when the target package already has that id (a warning says so) or for a road or bridge, which stay in the base package. Before, Copy, Paste and Change ID left the old package in the record, so Medieval entries showed under Decameroon and were not part of the Medieval package or the build. Both forms show a read-only **Package** row, so the field that really decides it is no longer hidden.
- PACKAGES: new **Terrain sprites** button on every non-default package. Pick the folder (coastline or roads) and the PNGs: the dialog checks the file names against the list the game reads (6 coastline, 27 road and bridge names) and the 512x512 size, refuses the whole batch if one file is wrong, uploads to `packages/<id>/sprites/terrain/<folder>/`, then releases the package (manifest, registry and package.json get a new patch version, so players replace their cached sprites). The base package is refused: the game never downloads it. The package manifest of `postapoc` itself does not list its terrain folders.
- Package manifest: every png under `sprites/terrain/<folder>/` (package coastline sprites today, roads later) is now listed, with its hash and size, next to the database and referenced sprites. Before, only referenced sprites were listed, so the next package publish would have dropped the hand-added Decameroon coastline rows.
- A building painted into a map cell now remembers the tile it replaced and the game shows that tile under it: a Boat on `Water_Dirty_1` stands on dirty water, on `Fish_1` on the fish tile, instead of always `Water_1` (ClickUp 869fgny1h). The remembered tile is the cell's Under terrain (Selected Tile panel, now shown for every building cell, not only bridges) and is saved in the map's `tileExtras`. Replacing a building with another keeps it, painting a tile over the building forgets it, bridges keep their own rules. Buildings placed with the Objects tool already kept their tile. Cells painted before this change have no remembered tile and look as before until repainted or set by hand.
- HEX DB: new **Base Terrain** field. A hex that names another hex there (for example a fish sprite on `Water_Dirty_1`) is a layered tile: the map draws that hex under its sprite instead of the plain water of its type, and the game does the same (ClickUp 869fgny1h). Leave it empty for every other tile; nothing changes for them.
- Reskin+ (HEX DB and BUILDINGS) can copy from any package, not only postapoc: the picker has a Source package select (default postapoc); the prefixed copy works for every source, and the same-id override from another package adds that package to the active package's dependencies (refused on a dependency cycle). Publishing a package that holds such a copy now finds and uploads the source package's sprite into the copy's own folder (before, it was reported missing).
- The coastline preview is turned off: the 🌊 Coastline button is disabled, nothing is drawn over water/land borders and the 3 key does nothing (Unity draws its own shores).
- Roads and bridges, tools for the whole tile set (phase F of Roads/Bridges V1). HEX DB gets **Road defaults** (presets by tile type, stored in the Hex DB `common`: Plains and Rubble `road`, Rivers `bridge`, the rest nothing; applied only on request: the form's Apply type defaults, a Type change dialog, the matrix) and **Roads matrix**: tiles by road/bridge types with package, type and search filters, per-cell edit and bulk actions (Apply type defaults to filtered, Allow/Remove a type on all filtered tiles, Add X wherever Y is allowed, Copy from tile, Set X to exactly these ids), each one step of the matrix's own Undo/Redo (50 steps, `Ctrl+Z`/`Ctrl+Y` while it is open). **Backfill roads** fills the tiles without a list by today's effective rule (road for Plain_1/2 and Rubble_1..3 and for tiles with the old flag, bridge for Rivers) after a preview; it never runs by itself and does not change the Roads data mode. A same-id override whose road list differs from the base tile (or has none while the base has one) is flagged with a Take from base button and listed in the Publish Package confirm; Reskin+ and Paste carry the lists. The Place Bridge tool follows the tile's list when it has one (unlisted bridges are refused with a message; tiles without a list keep the Rivers-only rule) and the map validator warns `road-not-allowed` for a bridge or road on a tile whose list does not allow it. No map overlay in V1. Server data merge: `common` is merged by key, so published road presets reach clients that changed Gold per tap, and the server's Gold per tap still arrives next to local presets. Nothing is published by any of this; the Roads data mode stays on Legacy only until the owner changes it.
- Roads and bridges per tile (phase E of Roads/Bridges V1). HEX DB has a new ROADS / BRIDGES block instead of the single "roads can be built on this tile" checkbox: the tile lists which road and bridge buildings of the Buildings DB may be built on it (`allowedRoads`), with a master checkbox, a "Copy from tile" action, red rows for ids the Buildings DB does not know and warnings for a bridge on land or a road on water. New road or bridge types added in BUILDINGS appear there without any code change. The old `roadAllowed` flag is still written and is derived from the list (true only when a listed id is a road). In BUILDINGS, Available Tiles is locked for roads and bridges (permissions are set in HEX DB), roads and bridges stay in the base package (Reskin+ and Paste refuse in other packages, a package ZIP that contains one is rejected), and a road with leftover Available Tiles shows a Clear button. A new "Roads data" selector in the HEX DB toolbar decides what Publish writes: **Legacy only** (the default; the published files are exactly what the editor wrote before this change), **Stage** (adds `allowedRoads` next to `roadAllowed`) and **Active** (also `roadsSchema: 1`, which makes the game use the new lists; refused until every tile has a list). Nothing is published automatically and the default changes nothing on the server; Stage and Active block a publish while a tile has no list, an unknown or duplicate id, or a package contains a road. The data format is in `docs/contracts/roads-hex-db.md`.
- Packages: the Details dialog has an "Install by default (auto-unlock at game launch)" checkbox that writes `autoUnlock: true` into the package's `packages/registry.json` entry on publish (omitted when off, preserved on every republish/version bump); packages with it show an "auto" badge.
- Fix: a sprite that only the server holds in one folder is no longer shown from a stale local copy in another. Decameroon_Boat_1 showed the OLD boat in the Building Editor, the WATER BUILDINGS button and on the map, because two different files named Decameroon_SmallShip_1.png exist (sprites/hex and sprites/buildings) and the sprite picker had saved the hex one in this browser. The picker now only displays server sprites (it no longer stores them locally; uploads are still stored), a local copy is used only for its own folder (building entries use buildings, hex entries use hex), Publish package reports sprites that were overwritten with a different local copy or sent to the folder of the entry that uses them, and the package manifest lists a sprite only from the folder the game reads (with a warning when the other folder holds a different file of the same name). If a browser already holds the stale copy, delete it once: DevTools > Application > IndexedDB > MapEditorSprites > sprites > decameroon/Decameroon_SmallShip_1.
- Fix: water buildings (Boat, FishTrap, SmallShipyard) placed on the map no longer sit on black hexes. A building whose picture has no terrain of its own now gets an underlay under it: the cell's Under-terrain override, else the building's own Under terrain, else the first water tile among its Available tiles; buildings with none of these draw as before.
- Zone fills (**Fill Zones**, **Fill This Zone**, **Randomize & Fill**) now behave like the other hand tools: they place exactly the tiles of the zone's preset and no longer re-pick the river, lake and shore pieces around the written cells. Only the generator (and generate into a selection) fits river pieces by itself. Undo still restores the whole fill in one step, and locked layers are still respected.
- The minimap and the zoomed-out overview no longer show water, lakes and most other tiles as green. A tile without a fixed map colour takes the dominant colour of its sprite (read once when the sprite loads) and, until then, a colour for its type (water blue, mountains grey-brown, forest green, desert sand, rubble dark brown, lava red-orange, swamp olive, resources and special gold). Tiles that already had a fixed colour are unchanged.
- The map screen has a structured layout. The left palette is four groups: **Tools** in labelled Draw / Select / Place rows (every map tool button is here now, including Paint, Fill, Rectangle, Eyedropper, Select Tile, Place and Erase Settlement and Zone Painter, which were in the top toolbar), **Tool options** (the brush size, moved from the right panel, and Symmetry; an option the active tool does not use is dimmed with an explaining tooltip), **Tiles** (a compact package filter, the picker and the selected tile) and the collapsible sections grouped as View (Minimap, Go to, Bookmarks), Edit (Zones, Stamps, Layers, History) and Check & share (Validate map, Export image, Map design, Help). Randomize & Fill with its patch-size slider, Fill Zones, Overlay and Clear Zones moved from the toolbar into the Zones section. The MAP toolbar row has only a File group (Open, Save) and a View group (distance rings and their interval, Block, Rulers, Coastline). The right panel holds the minimap and the settlements; the large duplicate of the selected tile is gone. Section controls are a uniform 24 px, keyboard focus shows one accent ring everywhere, and the scroll bars are thin. Shortcuts are unchanged.
- The left palette is usable again: the terrain and building picker takes all the remaining height (at least 320 px) and scrolls by itself, and the selected tile is one compact row under it instead of a large preview. Every other left-palette panel (Zones, Go to, Minimap, Bookmarks, Stamps, Layers, Validate map, Export image, History, Map design, Help) is a collapsible section with a button header, closed by default; one section is open at a time, a long section scrolls inside itself, and the open section is remembered in this browser. Closed headers show a short summary: hidden/locked layers, the number of bookmarks and stamps, the last validation result (marked "(old)" after a change) and the number of history steps. Enter or Space toggles a focused header and the arrow keys move between headers. The canvas size and the toolbar are unchanged.
- Fix: in HEX DB the WATER EXITS block follows the Type field: it is hidden when the type is not Rivers (the old exits are cleared) and shown again when the type is changed back to Rivers. Before, the block stayed after the type changed and its exits could not be removed.
- The PACKAGES tab notice (and the guides) no longer claims that the game does not load non-default packages: the game loads them once they are unlocked, which today only the debug panel of development builds does; a normal release build still shows only postapoc content.

### Building DB: Destroy Cost
- New field `destroyCost` (resources the player pays to destroy a building; working name, replaced by Source/Actions later). Default empty; older records get `[]` on load. Charged whenever it is not empty (the game applies it to roads and bridges for now). Destroy Income stays the reward.

### Building Editor fixes (QA 869e52z74, 869e52qdp, 869e52qrn, 869fcn16p)
- Leaving the Id or Storage Upgrade ID field no longer downloads building_database.json; the trimmed value is stored by the normal autosave.
- A building added, pasted, deleted or edited now updates its preview, the map palette and the map sprite at once, without a reload.
- In a non-default package the sprite picker lists that package's sprites only (a postapoc-only sprite broke the preview and the map).

### Documentation
- The content packages PDF guide is not shipped: the Help menu and the PACKAGES tab no longer link to it. The PACKAGES section of the English and Ukrainian user guides covers the essentials.

### Data safety
- Fix: publishing no longer duplicates package entries. **Publish HexDB** and **Publish Buildings DB** write only the base package (`postapoc`) to `hex_database.json` / `building_database.json` (root and `packages/postapoc/`), whichever package is active; the toast says how many entries of other packages were left out (those are published with PACKAGES > Publish). Before, both buttons wrote every package's entries into the base files, and the next startup merged each package entry in twice (same package and id: red ids in HEX DB, every building twice). Startup now heals such data: entries tagged with another package inside a base file are not merged as base entries (the package's own copy wins; an entry found only in the base file is kept in its package), and copies of the same package and id already in this browser are merged into one (a locally edited copy is kept), with a toast "N duplicate entries merged". **One-time repair of the published server files:** after updating the editor, press Publish HexDB and Publish Buildings DB once; that rewrites the polluted base files with the base entries only (package files are not touched).
- Startup merges the saved content with the shipped defaults instead of replacing it, so local edits are no longer lost when defaults change.
- Publishing shows a diff of what will change and refuses unsafe publishes (guards).
- Deleting a custom package is reversible.
- Loading a map shows a warning when the file has problems, instead of loading silently.
- A map file that cannot be used is now rejected before anything changes (your current map stays), with the reason; a map saved by a newer editor still opens and says so in the same warnings dialog.
- Autosave now uses IndexedDB and keeps recovery copies you can restore from.
- Generator, Satellite apply, Clear Map, Fill Map and auto-place settlements refuse to run while a fill is in progress and show a message.
- Ctrl+S waits for a running fill to finish, then saves the finished map.
- Review fixes: the multi-tile footprint map is now self-validating (it can no longer go stale after New, Open, Expand, Fill Map, Generator, Satellite apply, undo or autosave restore), Fill Zones, Fill This Zone and Randomize & Fill wait for a running fill (and a running stroke), cancel a lifted paste/move region and re-resolve edges and drop bridges on the cells they repaint, the building picker, Replace datalist, zone list and package/localisation panels are built with DOM APIs so a hostile building id, zone name or map file cannot inject script (security), zone ids are map-local: stamps no longer store zones and a copied region pastes its zones only onto the map it was copied from (other maps get the terrain and objects plus the toast "Zones were not pasted (copied from a different map)"), Place Building revalidates its selected building on every press, and ending a paste always leaves a usable tool (Paint when the previous tool is unavailable).
- A map file carries a `version` (the editor writes it on every save). A file that cannot be used is rejected before anything changes, a file saved by a newer editor opens and says so, and the problems found on load are listed in the one "Map loaded with warnings" dialog.

### Performance
- Faster rendering at all zoom levels; below 25% zoom simple sprites are drawn, and below 10% a flat overview.
- The zoom-out limit is the whole map.
- Fill, Satellite import and the Generator run without freezing the page (in a worker, with a fallback to the old path).
- Undo history uses less memory.

### Editing tools
- Hand-painting tools no longer re-pick river/lake pieces, shores or rock water; place the exact tile you choose. The map generator is unchanged. (Paint, brush and symmetry, Fill, Rectangle, Line, Circle, Polygon, Scatter, Replace, Eraser, paste, move and stamps write exactly the chosen or copied tiles and change no neighbouring cell; generate into selection still fits river pieces at its border.)
- Fix: a tile made with HEX DB Copy/Paste or Reskin+ can be painted at once (its sprite loads and it appears in the palette without a reload), editing it no longer resets a package biome such as Decameron, the selected-tile preview shows package sprites, and Scatter variants of a package tile are its own family (the Decameroon rift no longer scatters lava tiles).
- Rectangle and Fill now re-resolve river and water edge tiles like Paint.
- The brush can be any radius from 0 to 12 (slider in the Brush panel, or [ and ] keys) and is a true hex disc on maps of any height, including odd-sized maps. The 3×3, 5×5 and ○7 buttons are radius 1, 2 and 3.
- Fill uses true hex adjacency (previously two diagonal directions were wrong on some map heights), so a fill may select different tiles than before.
- Rectangle and Fill drop bridges on repainted cells, like Paint.
- New Line (L), Circle (O) and Polygon (G) tools with a live preview; their buttons are at the top of the terrain palette (left panel). Line and Circle are drag shapes (thickness = brush radius; Shift on Circle fills the disc); Polygon takes clicks, then Enter or a double-click fills it (Shift = outline only) and Esc cancels; two corners draw a line and collinear corners only their outline. Each shape is one undo step and re-resolves river and water edges like Paint.
- New symmetric painting: a Symmetry selector at the top of the terrain palette (left panel; Y cycles) with mirror left/right, mirror top/bottom, both mirrors, 3-fold and 6-fold rotation about the map-centre tile. Paint, Rectangle, Line, Circle and Polygon write every copy as one undo step; the cursor and shape previews show all copies and a dashed guide marks the axis or centre. Copies outside the map are skipped (on even-height maps the mirror centre is the centre cell, so the outermost column/row copies fall off the map and are not mirrored); Fill, bridges and multi-tile terrain are not mirrored.
- New Eraser tool (X; button at the top of the terrain palette): drag to reset tiles to Plain_1 and remove the building (with the satellites it spawned), road, bridge and under-terrain on them. Brush size applies and the active symmetry mode mirrors the erase exactly like Paint; a red preview shows the cells. One undo step per stroke, Esc cancels the stroke. Zones and settlements (including the city marker) are not touched; a cell inside a multi-tile footprint is skipped unless its anchor is under the same brush stamp.
- New Scatter tool (A; button and controls at the top of the terrain palette): drag to sprinkle random variants of the selected terrain (Forest_1 gives Forest_1..3; test/placeholder, multi-tile and directional entries are never used) over the brush area. Density is the chance in percent per cell; tick or untick variants under the density field. The seed field makes a click or an identical drag reproducible (empty = new seed per stroke, the last one is shown as the hint). Directional river/lake pieces are not scattered. A cell reached by overlapping stamps in one stroke is rolled once. Symmetry mirrors the area, but each cell rolls on its own. River/coast edges re-resolve like Paint; one undo step per stroke, Esc cancels it, and a stroke that places nothing leaves no undo step.
- New Select Region tool (M; button at the top of the terrain palette): drag a rectangle of cells, Shift adds, Alt subtracts, Esc clears, Ctrl+A selects the whole map, Ctrl+D deselects. The selection is shown as a yellow outline with a size and bounds readout in the left palette; it survives tool switches and undo, and is dropped when a map is created, loaded or resized. The drag stops at the map border when the pointer goes past it (Rectangle too), Shift/Alt are read when the drag starts, and Esc that only closes a menu keeps the selection. A large selection no longer slows drawing when zoomed out.
- Copy, cut, paste and delete for the selected region: Ctrl/Cmd+C copies terrain, buildings, roads, bridges, under-terrain and zones; Ctrl/Cmd+X cuts; Ctrl/Cmd+V shows a ghost that follows the cursor (click stamps, again and again; Esc ends); Delete or Backspace clears the region like the Eraser and also clears its zones (one undo step each; nothing to clear means no step). Pastes keep the shape on any column parity, are clipped at the map edge, skip multi-tile terrain whose footprint would not fit and cells under an existing multi-tile footprint, are never mirrored by symmetry and select the pasted region. Where the copied cell has no building, road or zone, what is already on the destination cell stays under the pasted terrain; a pasted building replaces (and removes the satellites of) the building it lands on. Cut moves only whole footprints: a selection that clips a multi-tile terrain without its anchor leaves those cells alone. Spawned satellite objects that lie inside the selection are copied and pasted like any other building (paste does not respawn satellites that sit outside the selection; cut removes the satellites of a removed building). While a paste is floating, Ctrl+C, Ctrl+X and Delete are ignored (Esc ends the paste first). The clipboard lives in the editor only (not the system clipboard).
- Rotate, mirror and move: while a paste floats, `.` / `,` rotate it 60 degrees clockwise / counter-clockwise and `/` / `;` mirror it left-right / top-bottom (or use the four buttons at the top of the terrain palette, under the tool row, shown while pasting); the ghost follows live and rotation / mirrors act on what you see on screen. Enter (or the Move button next to the selection readout) lifts the selected region as a floating ghost: nothing changes until you click, which cuts and pastes it as ONE undo step and selects the moved cells; Esc cancels with nothing to restore, and undo is ignored while a region is lifted. Enter typed in a field or on a focused button never lifts. A lifted region is cancelled (nothing written) when Clear Map, Fill Map, Satellite apply or the QA tile placer run, or when the lifted cells changed in any other way before the drop (toast 'The map changed while the region was lifted — move cancelled'). A move dropped partly off the map loses the clipped cells: a toast says how many cells fell off the map or were skipped, and undo restores them. Bridge directions (the Bridge tool axes) turn with the paste, but Road_Bridge bridge buildings keep their id and orientation; every water and river cell of a rotated or mirrored paste is re-resolved so the river pieces point the right way. Multi-tile terrain keeps its own orientation (it moves with its own footprint but cannot rotate; a toast says so) and, under a rotation or mirror, the cells of its source footprint are not carried, so no stray tiles appear; the zones and roads on those source footprint cells travel to the transformed position of each cell (inside the same undo step), while objects, bridges and under-terrain on footprint cells cannot follow a fixed-orientation footprint and are dropped (a toast says how many; undo restores them). A rotation / mirror that adds up to no change (for example `/` `;` and three `.`) behaves exactly like no transform.
- New Replace tile (Edit > Replace Tile..., or the H tool in the left palette): replaces every tile of one id with another, over the whole map or only inside the current selection ("Selection only"). Ids are matched exactly (case-sensitive); the target must exist in the tile database. It is one undo step, changes terrain only (zones, buildings, roads and under-terrain stay; a bridge on a replaced river tile is removed), is not mirrored by symmetry and re-resolves river and water edges. Multi-tile terrain follows its footprint: replacing it with a single tile frees its cells. When the new tile is multi-tile, a tile is skipped (it keeps its id and its old footprint) and counted in the message if its new footprint would leave the map, land on a multi-tile tile or footprint that stays, or overlap another replaced tile's footprint (the earlier tile, top row first, wins); skips are re-checked until the result is stable, so the footprints never overlap. Ids are compared by their canonical spelling (Rubble_1 and rubble_1 are the same tile). Refused while a fill runs. The H tool replaces the id of the clicked tile with the active terrain. The letter shortcuts for the map tools (L O G X A M H) now also ignore key presses whose target is a text field, not only the focused element, and Escape in the Replace dialog no longer cancels a pending polygon or shape.
- The building tools are back in the left palette: Place Building (B) with the building picker, and Erase Building. Click or drag; one undo step per stroke (a stroke that changes nothing leaves no step), Esc cancels the stroke. Placing over another building replaces it; a cell inside a multi-tile terrain's footprint refuses a building (toast). Buildings that spawn satellites (e.g. Farm_Test_1 with Grain_1) now place without an error (spawning used to throw, so no satellite was ever created): the satellites fill the nearest free neighbouring cells within the radius, skipping cells that are occupied or under another multi-tile terrain's footprint, and are removed again with their building. Satellite removal now uses the true hex ring: it previously missed one neighbour at radius 1 and could wrongly remove a building two cells away, and the Eraser and Cut/Paste satellite cleanup get the same fix. Erase Building now has an undo step (it never had one). The picker stays inside the window (it scrolls), closes with Esc or a click outside (the tool stays; the tool button reopens it), and its cards work from the keyboard (Tab, Enter or Space). While a stroke is in progress, Delete, Cut, Paste, Clear Map, Fill Map, Auto-place settlements, the QA tile placer, Satellite apply and Generate map are refused until it ends or is cancelled with Esc.
- The road tools are back in the left palette: Draw Road (W), Connect Road (C) and Erase Road (Q). Draw Road adds one tile per click next to an existing road, the city or a settlement (a drag draws only the tile under the press). Connect Road is click, click: the first click only marks a start (highlighted, nothing is written), the second writes a shortest path between them as one undo step (shortest in the editor's older road adjacency, which on some rows differs from true hex adjacency: a road can skip a true neighbour and leave a visible gap, and a click on a true neighbour of a road can be refused; a straight line along one axis is exact), and the destination becomes the next start; Esc, switching tool or replacing the map drops the start. Connect Road does not avoid anything: the path crosses water, the city, settlements and multi-tile building footprints, and it writes roads on all of them (undo removes it in one step). Erase Road removes only the road (terrain, buildings and zones stay). Each click is one undo step (a click that changes nothing leaves none). Esc while the button is held rolls the click back.
- New Place Bridge tool (U; button in the left palette): click a river tile to build the bridge picked in the picker (the Road_Bridge_* buildings; the picker lists only those and keeps its own selection, separate from Place Building). The same bridge again removes it, another bridge replaces it (a bridge also replaces any other building already on that river tile), each click is one undo step; other terrain is refused with a message, and a bridge already standing elsewhere (pasted, stamped) is left alone and can be removed with Erase Building or the Eraser. Only river-type tiles count (the tile's hex type, as before: River tiles and Lake tiles such as Lake_1); a drag acts on the pressed tile only; Esc while the button is held rolls the click back.
- Enter on a focused building-picker card no longer also lifts the active selection, and an Esc that closes a menu, dialog or text field no longer also closes the picker.
- Review fixes (small): renaming a zone inline now takes Enter to commit and Esc to cancel at any point while typing, the Layers buttons keep fixed accessible names ("Terrain visible", "Terrain locked") with the pressed state carried by `aria-pressed`, a double-click with the Bridge tool places the bridge once instead of placing and removing it, and Line, Circle and Polygon previews with symmetry show only the shape outline (no symmetry copies; the tooltip on the map says so) once the preview would exceed 4000 cells; what is written on release is unchanged.

### Layers
- New Layers panel (left palette, below Stamps): an eye button per layer (Terrain, Buildings & bridges, Roads, Settlements, Zone overlay) hides it on the map; hidden terrain shows a flat dark tile without the grid stroke (and a flat map at the lowest zoom level), hidden Settlements also hides the city marker and the slot distance rings, and the Zone overlay switch is the same as the Zone Painter's overlay button (they stay in step in both directions). Choosing the Place/Erase Settlement tool or running Auto-place settlements switches a hidden Settlements layer back on (toast), so nothing is placed invisibly. Each row also has a lock button (see the next entry). Visibility is a view setting only: it is not an undo step, does not touch the map or autosave, works while a stroke or fill is running, and is remembered per browser (`layer_state_v1`; blocked or damaged storage falls back to everything visible). The minimap, exports and the hover coordinates are not affected by it. With every layer visible the map is drawn exactly as before.
- Layer locks now work: the editing tools and commands listed here leave a locked layer alone. Not covered: Expand Map moves locked layers along with the rest of the map; a layer that is hidden but not locked stays fully editable (and Clear Map clears it); a fill that is already running is not interrupted by a lock set afterwards. Terrain lock covers Paint (without a bridge), Fill, Rectangle, Line, Circle, Polygon, Scatter, Eraser, Replace, cut, delete, move, Fill Map, Generate Map, Satellite apply, the QA placer, the zone fills and the tile-inspector under-terrain fields; Buildings & bridges covers Place/Erase Building, Place Bridge, Paint in bridge mode and the bridge overlays; Roads, Settlements (tools, Auto-place, slot panel) and Zones (Zone Painter brush, random fill, clear and delete zone) likewise. A refused action shows one toast and leaves no undo step. Cut, delete, move, paste, stamps and the Eraser still edit the layers that are NOT locked in one undo step and leave locked buildings, roads, zones and bridges alone (a locked layer lifted by Move stays where it is and is not duplicated; Cut still copies it). Clear Map skips locked layers. A lock set in the middle of a stroke stops the next writes of that stroke. Copy and saving a stamp work on locked layers, and undo/redo are not blocked by locks. Locks are an editor setting remembered in this browser, not part of the map file.
- Clear Map now clears every layer, not just terrain and bridges: terrain (back to Plain_1) with its under-terrain data, bridges, buildings, roads, zones (the zone cells; zone definitions stay) and non-city settlements, all in ONE undo step. The city marker and the settlement slot configuration are kept, and so is the selection (a lifted Move region is cancelled). Locked layers are skipped (a layer that is only hidden is still cleared, and the confirmation marks it '(hidden)'), and the confirmation lists what will be cleared and what is kept because it is locked (bridges need both Terrain and Buildings unlocked; under-terrain data follows the Terrain lock). If every layer is locked, or nothing unlocked has anything to clear (for example Clear Map twice), it shows a toast and adds no undo step.
- Lock gaps closed: the settlement priority lists respect the Settlements lock, zone definitions (add, rename, colour, preset, sliders, save preset) respect the Zones lock, Fill Zones / Fill This Zone with Terrain locked add an undo step only when settlements are really placed, Enter on a pending polygon after Terrain was locked refuses and keeps the corners, and Randomize & Fill with Terrain and Settlements both locked randomises only the zone layer (and says so in a toast). Zone definitions (names, colours, presets) are saved map data but are not part of Undo (only the zone definitions are outside it: zone cells, terrain, buildings, roads and settlements are restored by Undo). The zone gates live in `zone-painter.js`, which dev now publishes itself (see Deploy below).

### Stamps
- Stamp store (saved stamps are managed in the Stamps panel, left palette): saved selections live in their own browser database (`MapEditorStamps`), never in the map file or the autosave, so they survive New/Load and reloads and can be exported to and imported from a JSON file (`mapeditor-stamps`, version 1; a malformed file is rejected as a whole and imports nothing; at most 10000 stamps, 250000 cells per stamp and 2,000,000 cells per imported file; zone ids must be 0 to 255 and roads and extras must not carry map-position fields). A stamp keeps every layer of the copy (terrain, buildings, roads, bridges, under-terrain, zones and multi-tile footprints). Names are trimmed, limited to 80 characters and default to 'Stamp N'. If the browser blocks or fills its storage, saving is rejected with a clear message (shown as a toast) and the editor keeps working.
- New Stamps panel (left palette, below the zones; the palette scrolls on short windows): select a region (M), type a name and press Save (or Enter) to keep it as a stamp. Click a stamp, then click the map to place it (`.` `,` rotate, `/` `;` mirror, Esc cancels); the X button deletes one after a confirmation. Export downloads all stamps as `stamps-YYYY-MM-DD.json`, Import adds the stamps of such a file (a bad file adds nothing). Stamps are kept in the browser, separate from maps; lists longer than 100 show a Show more button. A stamp whose tiles are not loaded (for example from a package you have not installed) still pastes and tells you how many cells use missing tiles.

### Navigation and layout
- A "Go to" box in the left palette jumps the view to `col,row`, Unity `app:x,y` coordinates (as the status bar shows them) or a block address such as `B:4`; bad input is flagged with a message and the view stays put.
- Bookmarks in the left palette: Add saves the middle of the view and the zoom, click jumps back, rename and delete. They are stored in this browser only (never in the map file); a bookmark outside the current map is greyed out.
- Minimap options in the left palette: Bigger (340 px minimap, remembered in this browser; off by default), and Zones / Towns switches that draw the zone overlay and the non-city settlements on the minimap. They follow the Layers visibility.
- Keyboard shortcuts: `+` / `=` zoom in, `-` zoom out, `0` fits the map, `1` / `2` / `3` toggle the distance rings, block rulers and coastline. A "Keyboard shortcuts" button in the left palette (and View menu) lists every shortcut, tool keys included; the list is generated from one registry.
- Tool letter shortcuts now follow the letter you type on Latin layouts (AZERTY, QWERTZ, Dvorak, Colemak, Workman, Turkish-F) and the physical key only where no Latin letter is typed (Ukrainian, Russian, Greek); macOS Option combinations, dead keys, IME composition and key repeat never switch tools. Road (W) and Erase Road (Q) have no shortcut on Turkish-F (it types no w or q). Where a code tool key types punctuation, the physical key still decides: on Dvorak ' is Erase Road and , is Road, on AZERTY , is Select Region. The paste transform keys `. , / ;` are physical keys (US positions): on Dvorak the key that types ',' is KeyW, so while a paste floats it does not rotate and without a float it switches to Road. Ctrl/Cmd+A/C/X/V/D still match the physical key while Undo/Redo match the typed letter (so on AZERTY Ctrl+Z is the key that types z).
- The right panel (minimap, brush, active terrain) is collapsible. Below 1920 px wide it starts collapsed to a thin rail and opens as an overlay drawer; the canvas uses the freed width, the page no longer widens, and the top toolbar scrolls sideways inside itself. The choice is remembered (`rightPanelMode`: `auto`, `collapsed`, `expanded`, or `classic` to keep the old fixed layout).
- Maps smaller than the window are now centred instead of pinned to the top-left.
- New History panel (left palette, closed by default): lists the undo steps with their names, newest first; click a step to jump to it (refused while a fill, a stroke or a lifted region is active). Undo and redo are unchanged.

- Dialogs stack in one order (the most recently opened is on top; Escape closes only the topmost), and Ctrl+Z / Ctrl+Y / Ctrl+N / Ctrl+O / Ctrl+S do nothing while any dialog is open. The export check also notices an undo or generator change made while its summary is open and cancels the export.
- Zoom and brush keys on other layouts: `+`, `=`, `-` zoom by the character you type (QWERTZ `+`, Dvorak `=`); a typed `[` or `]` sets the brush wherever it sits (Dvorak: right of `0`; QWERTZ: AltGr+8 / AltGr+9, macOS Option+5 / Option+6); the physical `[` `]` keys still set the brush unless they type `+ = -`. Help > Keyboard Shortcuts and both guides say so.

### Generation
- Generator: "Only inside the selection" with a blend-width slider regenerates just the marquee selection (terrain only, one undo step, feathered border, respects the Terrain lock). Without a selection the dialog behaves as before.
- Elevation image: in the Procedural Generator, Import elevation takes a grayscale image (bright is high, north up) as the elevation instead of the noise, with a Sea level slider. Importing only loads the image and ticks "Use imported elevation"; Generate stays the step that writes. PNG, JPEG, WebP, BMP and GIF up to 25 MB; a bad file shows a message and keeps the previous import.
- Map design section (left palette, closed by default): Move City puts the city on any cell (one undo step; distance rings, slot bands and the generator's flat area follow it; the default stays the middle of the map), Bands sets the difficulty band limits in tiles from the city (comma list, up to 10; saved in the map as the optional `distance_bands`), and Placement scatters bunkers, mega cities, artifacts and four ore cluster types over free land (seeded, one undo step, respects the Layers locks). The ids, counts and distances Placement uses are assumptions in one config object.
- The generator and the satellite import pick their tiles by class in the tile database (water, forest, ...) instead of fixed ids, so renamed or replaced tiles are used; when a class has no tile at all a message lists what is missing. The default output is unchanged.

### Validation and export
- A "Validate map" section in the left palette checks the map when you press Run (never automatically): unknown tile or building ids, no city, settlements the city cannot reach over land (water, rivers, mountains, lava and rifts block; a bridge opens a crossing), roads that connect to nothing, and tiles whose sprite failed to load. Click an issue to centre the first cell and mark its cells in red; severity filter and Clear marks included. After the map changes the list stays but is marked as outdated until you Run again.
- Save (Ctrl+S, File menu, Hex DB button), Export CSV and Publish Map now check the map first (once, after a running fill finishes; Publish checks after you name the file). Errors open a summary with Show issues, Cancel and Export anyway; warnings only show a message. The saved file is unchanged. Autosave is not gated.
- Export PNG: File > Export PNG (whole map) and an "Export image" section in the left palette save the whole map as `map-YYYY-MM-DD.png` (local date) at 5 / 10 / 20 / 50 / 100 % or the largest allowed size. One flat colour hexagon per tile plus the visible layers (zone tint, roads, buildings and bridges, settlements); layers hidden in the Layers panel are not exported (the message lists them). Size limit 8192 px per side and 36 megapixels: larger requests are scaled down and the message says so. It does not change the view or zoom, is refused while a fill runs, and has no shortcut.
- Validator: mountains are told apart from hills by the id prefix `mountain_` (Mountain_Kaiju_1 and _2 now block like Mountain_1; Hills_1 stays passable) and lava / rift tiles by their HexDB type; a shown report becomes 'outdated' after an edit in the Hex DB or Buildings DB. Known difference: the orphan-road check uses true hex adjacency while road drawing still uses the legacy neighbour tables (K1), so a road the editor drew can be reported as connecting to nothing (or the reverse) on some rows until K1 is decided.

### Packages
- Fix: water in a content package no longer turns into base tiles. Edge re-resolution (Paint, Rectangle, the shapes, Fill, Replace, Scatter, Zone fills) picks river and lake pieces only from the package of the tile a cell holds, and a cell of a content package whose neighbourhood no piece matches (for example a lake piece that ends up inside the water) becomes that package's flat water (its own id, the flat water most of its neighbours hold, or the package's first flat Water tile) instead of a random base Water_1 / Water_Dirty_1 / Water_Rock_1. Before, a Decameroon lake got base river pieces and base "rock" water inside the water mass, which also drew Coastline segments inside the lake. The base package behaves exactly as before, and the Generator's river pieces come from the package of its water tiles (the base package), so a loaded package no longer changes generated maps.
- Reskin+ makes a copy with the active package's prefix by default (`Plain_1` becomes `Medieval_Plain_1`, `package` set to the active one, base sprite kept until you upload your own). Creating an entry with the same id as the base tile (the runtime override) is now an explicit second option with a warning in the picker. An entry that already exists in the package is never duplicated: the editor says so and selects it. Applies to hex tiles and buildings.
- The PACKAGES tab explains itself (what a package is, counts of hex tiles and buildings per package, active marker, notices) and has an active-package selector in the HEX DB and BUILDINGS toolbars.
- Sprites are stored per package (the default package keeps its keys; older flat sprites are migrated safely at startup). Uploads are checked (4 MB, PNG, JPEG or WebP; JPEG and WebP are converted; SVG and unreadable files are rejected) and an existing name asks Replace, Keep both or Cancel. Reskinning a tile uses a searchable picker.
- Publish shows the diff first, then a dialog with missing sprites, a version bump (patch, minor, major) and a changelog note; it writes the databases, sprites, preview, registry and package.json in that order and stops without writing when the version is not valid. Export builds the ZIP from the local state (works offline) and warns about unpublished changes.
- Import validates the ZIP before it touches anything (size and entry limits, unsafe paths, hostile keys, sprite checks) and is all-or-nothing with rollback; an existing id asks Replace, Merge or Cancel.
- Package details: description, dependencies (`id`, `id@1.2.3`, `id@^1.2.0`; cycles are rejected, missing or out-of-range ones only warn) and a 512 by 512 preview image. They are kept in this browser, travel in export and import, and are written on publish; the map file's `packages` list includes the dependencies of the packages it uses.
- The palette groups tiles and buildings by package (collapsible, remembered) when more than one package has entries, and Scatter only uses variants from the clicked tile's package.
- Local-only mode: without a GitHub token, or when offline, packages can be created, edited, imported and exported without any request to GitHub. They are marked "local only" (the panel says so), survive reloads, and are published later with a token after the id has been checked against the server. The game does not load non-default packages yet; the panel says so.

### Format
- Map files are validated on load by the new `MapFormat` module (`map-format.js`), which mirrors what the loader already accepts, so every map in `maps/` still loads. Files the loader would turn into garbage are rejected; everything it repairs (missing rows, text sizes, unknown keys) is at most a warning.

### Tests and tooling
- `UI.showModal({ title, body, actions, onClose, id, autofocus, modal }) -> { el, close }`: stackable modals with their own overlay (id ends in `-modal`), text-only title/body/labels (a DOM node for rich bodies), focus trap and return, Escape closes only the topmost and honours `defaultPrevented`, backdrop click closes unless `modal: true`, a throwing action never leaves an overlay. Map shortcuts, the Tab mode switch and canvas input are inert while one is open. The API is documented above `showModal` in `MapEditorPro.html`.
- Deploy: `zone-painter.js` is now published to `dev/` together with `hex-utils.js`; dev serves its own zone-painter.js (with the lock gates) after the next dev deploy.
- The `Brush` module moved to its own file, `brush.js`, and `MapFormat` lives in `map-format.js`; both are published to `dev/` by the dev workflow and covered by the deploy lint. Other root scripts: `hex-utils.js`, `gen-utils.js`, `map-jobs.js`, `map-worker.js`, `zone-painter.js`.
- The Playwright suite now includes unit-style specs in `tests/unit/` (pure logic, brush, map format), a harness that keeps the Mac awake and caps editor startup, characterization tests for id prefixing, edge autotiling and legacy map migration, and tests that every Markdown link in the README and the guides points to a file.
- New user guides in English and Ukrainian (`docs/guides/editor-guide.en.md`, `editor-guide.uk.md`, rendered to HTML by `scripts/build-guides.js`) and a Help menu that opens them and the shortcut list. README rewritten.


---

## 2026.06 — 2026-06-30

### Versioning — switched to calendar versioning (year.month)
- Version label in the status bar now shows `2026.06` instead of `0.9.x` — immediately readable as a release date rather than an arbitrary semver progress marker.

### Feature — Multi-tile object footprint rosette
- New **FOOTPRINT** section in the Hex DB editor panel (collapsed by default, visible for all hex types).
- 6-direction rosette — same layout as the Water Exits picker — to select which neighbour tiles this hex occupies as an anchor.
- Saved as `occupiedOffsets: ["NE", "N"]` in the hex entry. Empty array is stripped from the entry on clear.
- DB `version` field auto-bumps to `2` when any entry carries a non-empty footprint; drops back to `1` when all footprints are cleared.
- Backward-compatible: game at schema v1 ignores the new field.

---

## v0.9.9 — 2026-06-23

### Feature — Buildings & Settlements editor improvements
- **Biome filter** added to both Buildings and Settlements left panels (dropdown: All / Summer / Winter / Desert / Radioactive)
- **Buildings — PRODUCTION section** added: Gold/hr, Food/hr, Lumber/hr, Stone/hr production rates; Storage Gold/Food/Lumber/Stone bonus fields
- **Buildings — BUILD section** extended: `Required Town Level` (Main Settlement level needed to unlock building) and `Build Time (sec)` (construction duration, 0 = instant)
- All new fields persist to `localStorage` autosave and are included in JSON export/import
- Backward-compatible: existing `building_database.json` files load without changes (new fields default to `0`)

---

## v0.9.8 — 2026-06-10

### Feature — Settlement Slot tap multiplier
- **tapMultiplier field** added to each Settlement Slot row: a second line below the main row shows `tap × [value]  (1 = no change)`.
- Accepts decimal values (e.g. 1.5 = 50 % more taps). Minimum 0.1. Defaults to 1.
- Serialized as `tapMultiplier` in `settlement_slots` JSON; existing maps without the field default to 1 on load.
- The Unity runtime applies this as a linear near→far gradient within the ring: tiles at the inner boundary keep their base tap cost, tiles at the outer boundary are scaled by the multiplier.

---

## v0.9.7 — 2026-06-05

### Refactor — HexDB as Single Source of Truth
- **Removed `Terrain.DATA`**: the 29-entry hardcoded terrain array is gone. `hex_database.json` (loaded via HexDB) is now the only terrain registry.
- **Removed `Terrain.load()`**: sprite loading is driven exclusively by `Terrain.applyHexDbOverrides()` called from HexDB.
- **Auto-load on first run**: if no autosave exists, HexDB auto-fetches `./hex_database.json` from disk so the palette populates without manual loading.
- **Removed `_seedBuiltInTiles` / `_stampBuiltInFields`**: no more syncing between two parallel systems.
- **DriveSync + sprite picker** now derive the sprite list from HexDB entries, not from the former DATA array.

---

## v0.7.2 — 2026-06-05

### Features — Google Drive Auth Status
- **Auth status indicator**: 🔴/🟢 label in the toolbar shows whether you are signed in to Google Drive at a glance.
- **Sign in to Google button**: explicit login button in the toolbar; disappears once authenticated so it stays out of the way.
- **Auto-revert**: status reverts to 🔴 automatically when the OAuth token expires (55 min).

---

## v0.7.1 — 2026-05-26

### Features — HexDB Road Permission
- **Road Allowed toggle**: new checkbox in HexDB MAIN section — controls whether roads can be placed on this custom terrain type in the Unity game. Defaults to `false` for all existing records (migration runs automatically on load).
- **hex_database.json**: `roadAllowed` field exported per hex record; Unity reads it at runtime to enforce placement rules.

---

## v0.7.0 — 2026-05-21

### Features — Settlement Slots
- **Settlement Slots panel**: collapsible "🏘️ Settlement Slots" section in right panel. Add/edit/delete slots with min distance, max distance, count, and type (settlement / outpost / trading_post / custom text).
- **Canvas ring visualization**: each slot renders as a coloured distance ring overlay when settlements are visible. Selected slot ring brightens; others dim. Labels show `type×count` at the ring's due-East tile.
- **Full undo/redo + autosave**: slots are included in History snapshots and persisted via autosave/export.
- **JSON export**: `settlement_slots` section in map export, backwards compatible (missing = empty).
- **Unity resolver**: `SettlementSlotResolver` resolves slots into random `CustomSettlementPositions` at import time using the map seed (deterministic).

---

## v0.6.8 — 2026-05-21

### Polish — Minor feedback 18.05
- **Resource icons**: emoji badge (🪙💎🌾🪵🪨⚙️🛢️💻🏺⛏️☣️⚡) appears before each resource-type selector in every resource block; icon updates live when the type changes.
- **Field tooltips**: `ⓘ` indicator on labels with non-obvious purpose — hover to read (TextId, Desc Idle/Build, Type, Biome, Filter, Base Cost Taps, Transform to, Source, Resources, Available Tiles, MinLevel, Premium Price, Placement Rule, Capacity, Get per Tap, Per Turn, Income/Spend Constant, Triggers, Bonuses, Boosters, Effects).

---

## v0.6.7 — 2026-05-21

### Features — Distance & Zones (Important feedback 18.05)
- **Dist in status bar**: hovering any tile now shows its hex distance from the city center (odd-q cube-coordinate formula matching Unity's `HexUtils.Distance`).
- **Zone colour overlay** (`◎` button or **Z** key): toggles a 22%-opacity colour tint over every tile, colour-coded by 10-unit distance band (green → yellow → orange → red → purple). 10 bands total.
- **Ring distance markers**: while zones are on, numbered badges (10, 20, 30 … 100) appear at the due-East tile of each ring so exact distances are readable on the canvas.

---

## v0.6.6 — 2026-05-21

### Fixes — Settlement Placement (Critical feedback 18.05)
- **Undo/redo covers settlements**: History snapshots now include the `settlements` array, so placing or erasing a settlement is fully undoable with Ctrl+Z.
- **Settlements autosave on change**: `_placeSettlement` and `_eraseSettlement` now call `scheduleAutoSave()`, so settlement positions survive page reload.
- **Settlements auto-show on tool activation**: switching to the 📍 Place Settlement or ✕ Erase Settlement tool automatically enables settlement visibility if it was hidden.

### Tools reminder
- **S** — Place Settlement tool
- **D** — Erase Settlement tool
- **Ctrl+S** — Save/Export map (unchanged)

---

## v0.6.5 — 2026-05-21

### Fixes
- **Save now includes custom terrain**: `saveMap()` was duplicating JSON-build logic without `customTerrainOverlay`, so exported files never contained the `custom_terrain` section. Fixed by delegating to `_buildJson()` which already handles it correctly. Also fixes settlement keys (`col`/`row` instead of `x`/`y`) in saved files.

---

## v0.6.4 — 2026-05-20

### Fixes
- **Custom tile visible on map immediately**: `_readRecord` now calls `Terrain.applyHexDbOverrides([h])` after saving a custom-type entry, loading the sprite into `customSprites` without needing a page reload. Palette and canvas refresh automatically.

---

## v0.6.3 — 2026-05-20

### Fixes
- **Custom tiles now render on canvas**: `_drawHexTile` accepts an optional sprite override; the render loop looks up `customTerrainOverlay` and passes the custom sprite so painted tiles show their HexDB sprite instead of the base terrain.
- **Custom tile size in palette fixed**: buttons now use the standard `tile-btn` class (52×52 px, hex-clipped image, tooltip) instead of the unstyled `terrain-btn`.
- **Custom tiles in correct section**: grouped under a collapsible **☢ CUSTOM** category at the bottom of the palette, matching the style of built-in categories.
- **Custom tile selection highlight**: clicking a custom tile highlights it in the palette and updates the info bar; selecting a built-in tile clears the custom highlight.
- **Eyedropper picks custom terrain**: right-click now reads `customTerrainOverlay` so picking a custom tile re-selects it (not just the underlying base terrain).

---

## v0.6.2 — 2026-05-20

### Fixes
- **Stagger direction corrected**: odd worldX columns now render higher (smaller canvas y) to match Unity's visual layout. The previous fix swapped axes but left the stagger sign inverted, causing NE tiles to appear as SE in the editor. Fix: stagger is now applied as `STAGGER − stg` (baseline + STAGGER, subtract for odd worldX) using the centered worldX value, making the formula correct for any map size.

---

## v0.6.1 — 2026-05-19

### Fixes
- **Hex render axis swap**: `hexCenterWorld` now correctly maps `row` (worldX) to the horizontal axis and `col` (worldY) to the vertical axis, matching Unity's YXZ swizzle. Previously, tiles placed as NORTH of center appeared as NE in the app (and vice versa). `screenToHex`, `clampCamera`, `fitToScreen`, `drawMinimap`, and `_minimapPan` updated to match the new coordinate formula.

---

## v0.6.0 — 2026-05-19

### Features
- **App coords in status bar**: hovering any tile now shows its Unity world coordinate (x, y) — city center = (0,0), matching the app. Eliminates guesswork when painting tiles for specific app positions.
- **HexDB overrides built-in terrain sprites**: add a HexDB entry with an Id matching a built-in terrain name (e.g. `plain_1`) — the map canvas immediately uses that entry's sprite. QA can replace default tile visuals without editing HTML.
- **Undo/Redo covers custom terrain**: History snapshots now include `customTerrainOverlay` — undoing a custom terrain stroke correctly removes it from the export.
- **New sprites**: `Barren.png`, `Desert.png`, `Swamp.png` added to `sprites/hex/`.

### Fixes
- `isCustomType` is now case-insensitive — `plain_1` correctly matches built-in `Plain_1`.

---

## v0.5.0 — 2026-05-16

### Fixes
- BldDB / SttDB: Max Levels field no longer crashes browser when values > 5 chars — capped at 9999 with `Math.min` guard and `max="9999"` on input; also clamped at write-back to prevent uncapped JSON export
- HexDB Income: removed duplicate `Income Idle` field (identical to `Income per Turn`)
- HexDB Income: `Income Constant` now uses full resource list including Energy and Pollution

### Polish
- HexDB Build / Special: disabled inputs (gated by Can Build / Bonus Drop) now rendered with 35% opacity and gray background for clear visual distinction

---

## v0.4.6 — 2026-05-11

### Features
- HexDB editor: restored Visual block at the top of the record form — shows tile sprite preview (hex-shaped), ID, and sprite path on every hex record

---

## v0.4.5 — 2026-05-11

### Fixes
- Buildings and Settlements editors: `Max Level` input widened to 9 chars (110px); removed illogical `max=8` restriction — levels above 8 now supported

---

## v0.4.4 — 2026-05-11

### Features
- HexDB Special section: `Bonus Drop` checkbox gates `Triggers` dropdown (Destroy/Reveal/Build, default Destroy) and `Bonuses` dynamic resource block (default Gold=10); `Boosters` and `Effects` kept as locked placeholder fields; removed StorageCapacity, EnergyConsumption, PollutionConstant
- Migration: old `bonusDrop` text field auto-converted to boolean on load

---

## v0.4.3 — 2026-05-11

### Features
- HexDB Income section: full restructure — `Tap Income` + `Destroyable` checkboxes gate Transform to / Capacity / Get per Tap; `Transform to` datalist picker with Parent Hex option; `Capacity` (renamed from DamageMod, default 3, min 1); `Get per Tap` dynamic resource block; `Per Turn` upgraded from single number to resource block; new `Income Idle`, `Income Constant`, `Spend Constant` resource blocks (Spend Constant includes Pollution + Energy types)
- `_resourceBlockHTML` extended with optional `resTypes` param for custom type lists
- Migration: `incomePerTurn` number auto-converted to Gold array; `damageModifier` migrated to `incomeCapacity`
- Removed: OnCapture, OccupiedPerTurn, HumanResources fields

---

## v0.4.2 — 2026-05-11

### Features
- HexDB Build section: full restructure — `Can Build` + `Need Road` checkboxes on same row gate all fields; `Available Tiles` tags input (hex IDs with datalist autocomplete); dynamic `Price` resource block (add/remove, all resource types); separate `Premium Price` field; `Placement Rule` moved to bottom
- Migration: old `buildCostGold/Gems/Event` flat fields auto-converted to new `buildPrice` array on load
- Removed: `MaxPerMap` field

---

## v0.4.1 — 2026-05-11

### Features
- HexDB Destroy section: full restructure — `Can Destroy` checkbox gates all fields; `Transform to` now uses a datalist picker (shows "Unbreakable" when disabled, defaults to Plains_1); `Source` tags input (free-text IDs with add/remove); `Can Stored` checkbox; dynamic multi-resource `Destroy Income` block (add/remove rows, supports all resource types including custom Events currencies)
- Migration: old `destroyIncomeGold`/`destroyIncomeGems` flat fields auto-converted to the new resource array on load
- Removed stale fields: Condition, Bonus, Effect, Delay, Requires Road to destroy
- New reusable helpers `_sourceTagsHTML` and `_resourceBlockHTML` (will be reused in Income and Special sections)

---

## v0.4.0 — 2026-05-11

### Features
- HexDB Main section: added `Desc Idle` and `Desc Build` text fields for
  localisation key references (position: after TextId, before Type)
- HexDB Main section: replaced BaseCost Gold/Gems/Event inputs with a single
  `Base Cost Taps` number field (9-char wide, min 0)

---

## v0.3.4 — 2026-05-11

### Features
- **File → Set Autosave Folder…** — pick any local folder; a `saved_maps/` subfolder is created inside it automatically. Autosave writes `map_session.json` there on every save event. Folder handle persists across sessions via IndexedDB (Chrome/Edge only — requires File System Access API)
- If folder permission is lost after reload, a toast prompts to re-set via File menu
- localStorage autosave is kept as fallback when no folder is configured

---

## v0.3.3 — 2026-05-11

### Fixes
- Map editor now restores the last session on page reload — autosaves to `localStorage` after every significant change (new map, load, clear, fill) and on a 2-second debounce after each paint stroke; also saves on `beforeunload` and every 30 seconds
- New-map prompt is suppressed on startup when a previous session is successfully restored

---

## v0.3.2 — 2026-05-11

### Fixes
- Hex / Buildings / Settlements editor right panel now scrolls vertically — added `grid-template-rows: 1fr` to constrain the internal grid row, and `min-height: 0` to the panel so `overflow-y: auto` activates
- Section frames (Main, Destroy, Build, Income, Special) no longer clip their content when adjacent frames are expanded — added `flex-shrink: 0` to `.hexdb-section` so sections always render at full natural height

---

## v0.3.1 — 2026-05-11

### Fixes
- Buildings editor and Settlements editor now restore data after page reload (autosave was saved but list was never rebuilt on init)
- Map Editor canvas no longer goes black after tab is inactive — `forceRedraw()` now resets canvas backing store before re-rendering

---

## v0.3.0 — 2026-05-05

### Features
- Sprite browser picker modal in Hex editor SpriteName field — browse and select sprites by thumbnail
- Save / Open map buttons added to Map toolbar
- Hex type field now stores group name instead of specific tile IDs; existing maps migrated automatically on load
- Hex type dropdown grouped by category with optgroup labels

### Fixes
- Sprite picker callback captured before modal closes (prevented missed selections)
- Migrated hex types now persisted to autosave
- Input event dispatched with `bubbles:true` in `HexDB.pickSprite`
- All terrain types included in `TYPE_GROUPS` (prevented missing entries in hex type dropdown)
- Default new Hex type set to `New` instead of `Plain_1`
- `New` added as valid hex type option in type filter dropdown

---

## v0.2.0 — 2026-04-27

### Features
- Buildings and Settlements editor modes added to MapEditorPro
- HexDB editor mode with full CRUD, filter, sort, and per-hex field editing
- Auto-save for HexDB / BldDB / SttDB data to localStorage; restored on page load
- Satellite module — RGB→HSL terrain classification with live preview
- Map size picker on startup and New Map (20×20 min, 450×450 max)
- Hex list sorted alphabetically A–Z by ID
- QA package — sample data + distributable zip (2026-04-27)

### Fixes
- Canvas forced redraw on `visibilitychange` (prevented black screen after tab inactive)
- Map statusbar hidden in non-map editor modes
- Satellite debounce on param change; `Int8Array` for classified data; renamed `waterIds` → `impassableIds`
- Error handlers added to `Satellite._loadImage` for corrupt/unreadable images
- Palette expand/collapse closure bug (block-scoped `const` per category)
- `UI.confirm()` replaced with `UI.showConfirm()` in all delete handlers

---

## v0.1.0 — 2026-04-06

### Features
- Initial Map Editor Pro HTML shell with CSS Grid layout and module stubs
- Terrain module — 29 terrain types, sprite loading, color map
- Canvas module — hex renderer, zoom/pan (25%–400%), minimap, touch support
- Brush module — 4 brush sizes (1 / 3×3 / 5×5 / ○7)
- Tools module — Paint, Erase, Fill, Eyedropper
- History module — undo/redo stack
- IO module — JSON import/export, CSV export
- Generator module — procedural map generation
- Variable map size support (10×10 to 450×450)
- Hex map matching Unity flat-top odd-q grid layout
- Map save/load from localStorage
