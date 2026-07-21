# Content Package System — Design Spec

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow different art-style content packs (medieval, sci-fi, fantasy, etc.) to coexist on the same map as additive DLC — authored in the Map Editor, published to GitHub Pages, downloaded by the game at runtime, and unlocked per-player.

**Architecture:** Each package is a self-contained folder on GitHub Pages (`packages/<id>/`) with its own databases and sprites. The existing post-apocalypse content migrates to `packages/postapoc/` as the permanent default. The game loads the default package always, then downloads and merges any additional unlocked packages on top.

**Tech Stack:** HTML/JS (Map Editor), C# Unity (game), GitHub Pages (CDN), `UnityWebRequest` + `Application.persistentDataPath` (runtime sync, already in use).

---

## Global Constraints

- Existing production URL `https://fidaykin.github.io/PostApocMapEditor/MapEditorPro.html` must never break
- All existing map `.json` files must load without modification (backward compatibility via default `"packages": ["postapoc"]`)
- Dev editor lives at `.../PostApocMapEditor/dev/MapEditorPro.html` — deployed from a `dev` branch via CI; never auto-deploys to production
- Package IDs are lowercase alphanumeric + hyphens (e.g. `postapoc`, `medieval`, `sci-fi`)
- New package tile/building IDs are prefixed with the package ID in PascalCase (e.g. `Medieval_Plain_1`, `SciFi_Factory_1`) to guarantee global uniqueness by convention — no runtime deduplication needed
- `postapoc` package is always unlocked; all other packages require an explicit unlock (IAP or progression gate)
- The game must degrade gracefully when a locked or missing package is referenced in a map (show placeholder tile, no crash)

---

## Sub-Project Breakdown

This spec covers four independent deliverables in dependency order. Each must be fully shipped before the next begins.

| # | Sub-project | Depends on | First thing that proves it works |
|---|-------------|-----------|----------------------------------|
| 1 | Package format & infrastructure | — | `registry.json` and `packages/postapoc/` exist on GitHub Pages; editor reads sprites from new paths |
| 2 | Editor: package authoring | 1 | Create a `medieval` package in the editor, publish it, see it in `registry.json` |
| 3 | Game: package runtime | 1 | Game downloads and merges `postapoc` from new path; existing maps render identically |
| 4 | Map data: package references | 2, 3 | Place a `Medieval_Plain_1` tile in a map, save, reload — game renders the medieval sprite |

---

## Sub-Project 1 — Package Format & Infrastructure

### GitHub Pages folder layout

```
packages/
  registry.json
  postapoc/
    package.json
    hex_database.json
    building_database.json
    sprites/
      hex/          (all existing hex PNGs)
      buildings/    (all existing building PNGs)
      terrain/      (all existing terrain PNGs)
  medieval/         (example — not part of this sub-project)
    package.json
    hex_database.json
    building_database.json
    sprites/
      hex/
      buildings/
```

### `package.json` schema

```json
{
  "id": "medieval",
  "name": "Medieval Kingdom",
  "version": "1.0.0",
  "description": "Stone castles, thatched farms, enchanted forests.",
  "preview": "preview.png",
  "isDefault": false
}
```

`postapoc` package.json uses `"isDefault": true`. Only one package may have `isDefault: true`.

### `registry.json` schema

Single file fetched first by the game and editor. Updated by the editor whenever a package is created or published.

```json
{
  "version": 1,
  "packages": [
    { "id": "postapoc", "name": "Post-Apocalypse", "isDefault": true,  "version": "1.0.0" },
    { "id": "medieval", "name": "Medieval Kingdom", "isDefault": false, "version": "1.0.0" }
  ]
}
```

### Database schema (per package)

Same format as the current root-level files, with one added field:

```json
{
  "version": 1,
  "package": "medieval",
  "hexes": [
    {
      "id": "Medieval_Plain_1",
      "spriteName": "Medieval_Plain_1",
      "type": "Plains",
      "biome": "Summer",
      ...
    }
  ]
}
```

`building_database.json` follows the same pattern with a `"package"` field added.

### ID convention

- `postapoc` IDs stay exactly as they are: `Plain_1`, `Farm_1`, etc.
- Every new package prefixes all IDs with PascalCase package name: `Medieval_Plain_1`, `SciFi_Factory_1`.
- The prefix is a convention enforced by the editor UI, not validated at runtime.

### Map file schema v2

```json
{
  "version": 2,
  "packages": ["postapoc", "medieval"],
  "map": { ... },
  "objects": { ... }
}
```

Maps without a `"packages"` field (all existing maps) are treated as `["postapoc"]`. The editor adds this field on first save after the migration.

### Migration (one-time, before any code changes)

1. Create `packages/postapoc/` on GitHub Pages.
2. Copy (not move — keep old paths alive) `hex_database.json` → `packages/postapoc/hex_database.json`.
3. Copy `building_database.json` → `packages/postapoc/building_database.json`.
4. Copy `sprites/hex/` → `packages/postapoc/sprites/hex/`.
5. Copy `sprites/buildings/` → `packages/postapoc/sprites/buildings/`.
6. Create `packages/postapoc/package.json`.
7. Create `packages/registry.json`.
8. Update editor sprite load paths to `packages/postapoc/sprites/...` (editor sub-project below).
9. Keep old root-level paths alive until all game clients on new build — remove after two release cycles.

### Dev deployment

A `dev` branch in the Map Editor repo receives all in-progress work. A GitHub Actions workflow (`.github/workflows/deploy-dev.yml`) triggers on push to `dev` and deploys only `MapEditorPro.html` into the `dev/` subfolder of `gh-pages`:

```yaml
- name: Deploy to dev/
  run: |
    git checkout gh-pages
    cp MapEditorPro.html dev/MapEditorPro.html
    git add dev/MapEditorPro.html
    git commit -m "deploy(dev): update dev editor"
    git push
```

The dev HTML uses `../` relative paths for all assets (`../packages/postapoc/sprites/...`), so it reads production data while running dev code. Production `gh-pages` is never touched by the `dev` branch CI.

---

## Sub-Project 2 — Editor: Package Authoring

### Packages panel

New top-level panel tab "Packages" in `MapEditorPro.html`, alongside Buildings and HexDB tabs.

**Panel contents:**
- Table of all known packages: ID, name, tile count, building count, version, last published timestamp
- **"New Package"** button — modal asking for display name and ID (auto-slugged, validated for uniqueness against registry)
- **"Active Package"** dropdown at panel top — persisted in `localStorage`; determines which package new entries are authored into
- **"Publish Package"** button — triggers the publish flow for the selected package
- **"Delete Package"** button — only enabled for packages with zero map references; removes from registry

### Active package context

When the active package is set to `medieval`:
- HexDB panel and Buildings panel show a `[Medieval]` badge in their header
- All new hex entries created in HexDB are saved into `packages/medieval/hex_database.json`
- All new building entries created in Buildings are saved into `packages/medieval/building_database.json`
- New entry IDs are auto-prefixed: typing `Plain_1` produces `Medieval_Plain_1`
- The palette shows tiles from **all loaded packages**, visually grouped with a colored package badge per tile

### Palette package filter

A row of package toggle-chips above the terrain and building palettes:
- Default: all packages visible
- Clicking a chip hides/shows that package's tiles in the palette
- Filter state is per-session (not persisted)

### Map dependency tracking

- When a tile from package `medieval` is placed on the map, `"medieval"` is automatically added to the map's `packages` array if not already present.
- Removing the last tile of a package from the map removes that package from the array.
- The map file's `packages` array is always written on save.

### Publish flow

1. Editor collects all hex entries tagged `"package": "medieval"` and all building entries tagged the same.
2. Writes `packages/medieval/hex_database.json` and `packages/medieval/building_database.json` to GitHub via the existing GitHub API write path.
3. Uploads any new sprites to `packages/medieval/sprites/hex/` and `packages/medieval/sprites/buildings/`.
4. Reads `packages/registry.json`, upserts the `medieval` entry (bumping version), writes it back.
5. Creates or updates `packages/medieval/package.json`.
6. Shows a publish summary toast.

Publishing `postapoc` is identical but targets `packages/postapoc/` — it replaces the current root-level publish flow.

### Sprite load path update

All sprite loads in `MapEditorPro.html` change from:
```
sprites/hex/<name>.png
sprites/buildings/<name>.png
```
to:
```
packages/<packageId>/sprites/hex/<name>.png
packages/<packageId>/sprites/buildings/<name>.png
```

`packageId` is resolved by looking up the entry's `"package"` field (defaults to `"postapoc"` for entries without that field — backward compat).

---

## Sub-Project 3 — Game: Package Runtime

### PackageManager

New `PackageManager` MonoBehaviour, singleton, auto-created via `[RuntimeInitializeOnLoadMethod]` (same pattern as existing sync classes).

**Startup sequence:**

```
1. Apply postapoc from disk cache (always present, instant)
2. Fetch packages/registry.json from GitHub Pages
3. For each entry in registry:
   a. If unlocked → check version vs cached version
   b. If newer or missing → download hex_database.json, building_database.json, sprites
   c. Apply to active databases
4. Emit PackagesReady event
5. Map load begins
```

**Unlock storage:**
```csharp
// Lock/unlock
PlayerPrefs.SetInt($"pkg_unlocked_{id}", value ? 1 : 0);

// Check
bool IsUnlocked(string id) =>
    id == "postapoc" || PlayerPrefs.GetInt($"pkg_unlocked_{id}", 0) == 1;
```

IAP completion callback calls `PackageManager.Unlock("medieval")` which triggers immediate download and apply without restart.

### RuntimePackageSync

Subclass of `RuntimeDbSyncBase` (one instance per non-default package):

```csharp
public class RuntimePackageSync : RuntimeDbSyncBase
{
    public string PackageId { get; set; }          // set by PackageManager

    protected override string FileName    => "hex_database.json";
    protected override string CacheSubDir => $"packages/{PackageId}";

    // BASE_URL becomes BASE_URL/packages/{PackageId}/
}
```

Sprite download uses `packages/<id>/sprites/buildings/<name>.png` as the URL template.

### Existing sync class updates

- `RuntimeBuildingSync`: sprite URL changes from `sprites/buildings/<name>.png` → `packages/postapoc/sprites/buildings/<name>.png`
- `RuntimeBuildingSync`: extract URL template to a virtual property so `RuntimePackageSync` can override it
- `RuntimeDbSyncBase.BASE_URL` remains the same host; only the path suffix changes

### Database merge

After all packages are applied:
- `BuildingManager._definitionLookup` contains entries from all active packages (keyed by ID)
- `TerrainTypeRegistry` is rebuilt from the merged list
- ID collisions cannot occur if the prefix convention is followed; if they do occur, last-applied package wins (logged as warning)

### Missing package handling

When a map declares `"packages": ["postapoc", "medieval"]` but `medieval` is locked or download failed:
- Tiles with `Medieval_` prefix render as a grey placeholder tile (a single fallback `TileBase` asset)
- A non-blocking toast: "Some map content requires the Medieval Kingdom package"
- Map is otherwise fully playable

---

## Sub-Project 4 — Map Data: Package References

### Map file version bump

Editor writes `"version": 2` on all saves after sub-project 2 ships. The game reads both v1 (no `packages` field → treat as `["postapoc"]`) and v2.

### Map load guard

Before rendering, `MapLoader` checks:
```csharp
foreach (var pkgId in map.packages)
{
    if (!PackageManager.IsDownloaded(pkgId))
        await PackageManager.EnsureDownloaded(pkgId);
}
```

If a package cannot be downloaded and the map contains tiles from it, those tiles render as placeholders (see sub-project 3 missing package handling).

### Map export / share

When a map is exported or shared (JSON file), the `packages` array is included. Recipients who open the map in the editor will see a warning if they don't have a listed package installed: "This map uses the Medieval Kingdom package. Install it to see all tiles."

### Backward compatibility test matrix

| Map file | Game version | Expected result |
|----------|-------------|-----------------|
| v1 (no packages field) | new | Treated as `["postapoc"]`, renders identically |
| v2, packages=["postapoc"] | new | Normal render |
| v2, packages=["postapoc","medieval"] | new, medieval unlocked | Full render |
| v2, packages=["postapoc","medieval"] | new, medieval locked | Placeholders for medieval tiles, toast |
| v1 | old (pre-migration) | Unchanged — old clients still read old root paths (kept alive during transition) |

---

## Open Questions (not blocking spec)

- **Versioning conflict**: if `postapoc` package bumps a tile definition that existing maps depend on, is there a rollback mechanism? (Suggested: keep last 2 versions of each package on GitHub Pages.)
- **Package preview image**: `preview.png` in manifest — 512×512 PNG. Shown in a future in-game package store UI (out of scope for this spec). Editor uploads it alongside other package assets during publish.
- **Localization per package**: medieval buildings will need their own `textId` keys. Does each package ship its own `localization.json` delta, or does the editor merge into the main one? (Suggested: per-package `localization.json` delta, merged at runtime same as databases.)
- **Package store UI in game**: out of scope for this spec — IAP flow and store screen are a separate design.
