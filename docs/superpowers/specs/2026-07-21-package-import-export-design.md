# Package Import/Export Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to export any published package as a ZIP bundle (data + sprites), edit it externally, and import it back as a new package with a different ID.

**Architecture:** The feature lives entirely inside the existing `Packages` IIFE in `MapEditorPro.html`. JSZip is loaded lazily on first use via dynamic `import()` from jsdelivr CDN (same pattern as the existing oxipng loader). Export fetches live files from GitHub Pages; import publishes files via the existing `GitHubSync._putText` / `GitHubSync._putBinary` API.

**Tech Stack:** JSZip 3.10.1 (jsdelivr CDN, lazy-loaded), existing `GitHubSync._listFolder`, `_putText`, `_putBinary`, `UI.progress`, `UI.progressDone`, `UI.showConfirm`, `UI.toast`.

## Global Constraints

- Single-file HTML app — all changes inline in `MapEditorPro.html`, no external files
- JSZip loaded lazily: `const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')` — only on first export or import trigger
- Export requires the package to be published on gh-pages (sprites fetched from live URL); if not published, show toast and abort
- Import modal uses same dark-theme inline styles as the existing `#pkg-new-modal` (`#1e1e2e`, `#313244`, `#45475a`, `#cdd6f4`)
- `GitHubSync._listFolder`, `_putText`, `_putBinary` are accessed via the `GitHubSync` object (not bare calls)
- `Packages.idPrefix(id)` converts a package ID to a PascalCase prefix with trailing underscore: `'postapoc'` → `'Postapoc_'`, `'medieval'` → `'Medieval_'`, `'sci-fi'` → `'SciFi_'`
- All new functions declared inside the `Packages` IIFE and exported via `return {}`
- BASE_URL inside `Packages` IIFE: `'https://fidaykin.github.io/PostApocMapEditor'`

---

## ZIP Bundle Format

```
<id>-<version>.zip
├── package.json            ← { id, name, version, description, isDefault }
├── hex_database.json       ← { version, package, hexes: [...] }
├── building_database.json  ← { version, package, buildings: [...] }
└── sprites/
    ├── hex/
    │   ├── Forest.png
    │   └── ...
    └── buildings/
        ├── Barracks.png
        └── ...
```

- `package.json` preserves the original `id` and `name` so the import modal can pre-fill them
- Sprite filenames are unchanged — only paths change when re-published under the new ID
- Entry `id` fields are rewritten on import (see ID Rewriting below)

---

## Export Flow

Triggered by an "Export" button added to each row in the Packages panel Actions column.

1. Show progress: `UI.progress(0, 'Preparing export…')`
2. Load JSZip lazily (cache the module after first load)
3. Fetch `packages/<id>/package.json` → verify it exists; if 404, abort with toast: `"Package must be published before exporting"`
4. Fetch `packages/<id>/hex_database.json` and `packages/<id>/building_database.json`
5. List sprites: `GitHubSync._listFolder('packages/<id>/sprites/hex')` and `GitHubSync._listFolder('packages/<id>/sprites/buildings')`
6. For each sprite file, fetch binary from `${BASE_URL}/packages/<id>/sprites/<category>/<filename>`
7. Bundle into JSZip at paths matching the ZIP structure above
8. Generate blob and download as `<id>-<version>.zip`
9. `UI.progressDone('✅ Export complete')`

Progress increments: 0% fetch JSONs → 20% list sprites → 20–90% fetch sprites (proportional) → 100% done.

---

## Import Flow

Triggered by an "Import Package" button at the top of the Packages panel (next to "New Package").

A hidden `<input type="file" id="pkg-import-input" accept=".zip" style="display:none">` is placed in the HTML. Clicking the button triggers `.click()` on it.

### Import Modal

After the user picks a `.zip` file:
1. Load JSZip lazily
2. Read the ZIP and extract `package.json`
3. Open `#pkg-import-modal` pre-filled with:
   - **Display Name** — from ZIP's `package.json.name` (editable)
   - **Package ID** — from ZIP's `package.json.id` (editable, same slug validation: `^[a-z0-9][a-z0-9-]*$`)
   - **Original ID** (hidden field, preserved for ID rewriting)
   - Error div (inline, shown on validation failure)

### On Confirm

Validation: same as New Package — ID must match slug pattern, must not already exist in `_registry`.

Publish sequence with progress bar:

| Step | Progress | Action |
|------|----------|--------|
| 1 | 5% | Write `packages/<newId>/package.json` |
| 2 | 15% | Rewrite + write `packages/<newId>/hex_database.json` |
| 3 | 25% | Rewrite + write `packages/<newId>/building_database.json` |
| 4 | 25–95% | Upload each sprite to `packages/<newId>/sprites/<category>/<filename>` |
| 5 | 100% | Update `packages/registry.json` |

After success: update `_registry` + localStorage, call `renderPanel()` + `renderActiveDropdowns()`, show toast `"✅ Package '<name>' imported"`.

---

## ID Rewriting

Applied to every entry in `hex_database.json` and `building_database.json` during import.

```
originalPrefix = idPrefix(originalId)   // e.g. 'Postapoc_' for 'postapoc'
newPrefix      = idPrefix(newId)        // e.g. 'Medieval_' for 'medieval'

newEntryId = entry.id.startsWith(originalPrefix)
             ? newPrefix + entry.id.slice(originalPrefix.length)
             : newPrefix + entry.id
```

Examples (importing postapoc ZIP as `medieval`):
- `Forest_1` → `Medieval_Forest_1` (postapoc entries have no prefix by default)
- `Postapoc_Forest_1` → `Medieval_Forest_1`

Importing the same ZIP twice with a different target ID works correctly: `Forest_1` → `OtherPkg_Forest_1`. Importing with the same target ID as already exists is blocked by the duplicate ID validation before any rewriting occurs.

Every entry also gets `package: newId` set.

The `hex_database.json` and `building_database.json` written to the ZIP contain `"package": originalId`; the import rewrites this to `newId` in the published output.

---

## UI Changes

### Packages Panel (`renderPanel`)

**Top toolbar** — add two buttons before the table:
```html
<button onclick="Packages.openImportModal()">Import Package</button>
<button onclick="Packages.openNewModal()">+ New Package</button>
```

**Actions column** — add Export button per row (disabled for unpublished packages is not tracked — just show it and let the flow error gracefully):
```html
<button onclick="Packages.exportPackage('${p.id}')">Export</button>
<button onclick="Packages.openPublishConfirm('${p.id}')">Publish</button>
<button onclick="Packages.confirmDelete('${p.id}')" ${isDefault(p.id) ? 'disabled' : ''}>Delete</button>
```

### New HTML Elements

`#pkg-import-modal` — same structure as `#pkg-new-modal` but with:
- Name field (`#pkg-import-name`)
- ID field (`#pkg-import-id`, editable, pre-filled)
- Hidden original-ID field (`#pkg-import-original-id`)
- Error div (`#pkg-import-error`)
- Cancel / Import buttons

`#pkg-import-input` — hidden file input, `accept=".zip"`, triggers `Packages._onImportFilePicked()`

---

## New Functions in `Packages` IIFE

| Function | Description |
|----------|-------------|
| `exportPackage(id)` | Full export flow — fetches, bundles, downloads ZIP |
| `openImportModal()` | Triggers hidden file input |
| `_onImportFilePicked(file)` | Reads ZIP, extracts package.json, opens modal |
| `_showImportModal(originalId, name, id)` | Populates and shows `#pkg-import-modal` |
| `closeImportModal()` | Hides `#pkg-import-modal` |
| `confirmImport()` | Validates, runs publish sequence |
| `_rewriteEntries(entries, originalId, newId)` | Pure function: rewrites id + package fields |
| `_loadJSZip()` | Lazy loader, caches module in closure variable `let _jszip = null` declared at top of Packages IIFE |

All exported via the `return {}` statement.

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Export: package not published (404 on package.json) | Toast: "Package must be published before exporting" |
| Export: sprite fetch fails | Log warning, skip sprite, continue — partial exports are better than none |
| Import: not a valid ZIP | Toast: "Invalid ZIP file" |
| Import: missing hex_database.json or building_database.json | Import modal shows warning but allows proceeding — partial import |
| Import: ID already exists | Inline error in modal |
| Import: publish step fails | `UI.progressDone('')` + toast with error message |
| JSZip CDN unavailable | Toast: "Could not load ZIP library. Check your connection." |
