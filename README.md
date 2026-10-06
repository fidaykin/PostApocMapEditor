# Post-Apocalyptic Map Editor

A browser-based editor for the hex maps and game data of the PostApocCityBuilder Unity project. It paints and generates maps of up to 450 by 450 flat-top hex tiles (terrain, buildings, roads, bridges, settlements, zones), edits the Hex, Building, Settlement and Upgrade databases, and manages content packages that are published to the project's GitHub Pages site.

Everything runs in the browser from `MapEditorPro.html` plus a handful of plain script files at the repository root. There is no build step.

## Run

Serve the repository root with any static server and open `MapEditorPro.html`:

```sh
npm install        # once: Playwright, jszip, serve
npx serve .        # then open http://localhost:3000/MapEditorPro.html
```

Opening the HTML file straight from disk also works for painting, but the GitHub features and content packages need a server origin. The published editor is at the project's GitHub Pages site (`MapEditorPro.html`; the development build is at `dev/MapEditorPro.html`).

## Documentation

- User guide: [English](docs/guides/editor-guide.en.md) | [Українською](docs/guides/editor-guide.uk.md). They are also opened from the editor's Help menu as `docs/guides/editor-guide.en.html` and `editor-guide.uk.html`. After editing a `.md` guide run `node scripts/build-guides.js`; a test fails when the `.html` is out of date.
- [Content packages guide (PDF)](docs/guides/content-packages-editor-guide.pdf).
- [CHANGELOG.md](CHANGELOG.md): user-visible changes, newest first.
- [tests/README.md](tests/README.md): the test harness and the standing rules for tests.
- `docs/superpowers/`: design plans and decision records. The older `docs/guide_*.html` guides describe v0.4.6.

## Files

Application (repository root):

| File | Purpose |
|---|---|
| `MapEditorPro.html` | The editor: markup, styles and the inline modules (Canvas, Tools, History, IO, Generator, Packages, GitHubSync, Shortcuts, MapValidator, the database editors, ...). |
| `hex-utils.js` | Pure hex-grid geometry: cube coordinates, neighbours, lines, discs, polygons, rotate and mirror, edge distances. |
| `map-format.js` | `MapFormat`: version number and validation of the map JSON file, mirroring the loader's leniency. |
| `brush.js` | The `Brush` module (radius 0 to 12 hex disc), the first module split out of the HTML. |
| `zone-painter.js` | Zone Painter: zones (biomes), zone noise fills and their layer-lock gates. |
| `gen-utils.js` | Pure helpers for generation: heightmap import, placement sampling, tile-class role table. |
| `map-jobs.js` | Heavy DOM-free jobs (generator, satellite import, fill) as plain functions. |
| `map-worker.js` | Web Worker that runs `map-jobs.js` off the main thread; the page falls back to the main thread if it cannot start. |
| `index.html` | Redirects to `MapEditorPro.html`. |
| `SatelliteColorGuide.html` | Reference page for the satellite import colour classes. |
| `serve.json`, `favicon.png` | Static server settings, icon. |

Data (served as files, edited through the editor):

| Path | Purpose |
|---|---|
| `hex_database.json`, `building_database.json`, `upgrade_database.json`, `localization.json` | Game databases and text keys (the default `postapoc` content also lives in `packages/postapoc/`). |
| `packages/` | Content packages: `registry.json` and `packages/<id>/` (databases, sprites, `package.json`). |
| `maps/` | Published maps and `map_list.json`. |
| `sprites/` | Sprites (`terrain/`, `hex/`, `buildings/`, atlas files). The editor still writes compatibility copies here. |

Tooling and project files:

| Path | Purpose |
|---|---|
| `deploy.sh` | Production deploy (see below). |
| `.github/workflows/deploy-dev.yml` | Development preview deploy. |
| `tests/`, `playwright.config.ts`, `package.json` | Playwright test suite. |
| `scripts/build-guides.js` | Renders the Markdown guides to HTML. |
| `build_atlas.py`, `compress_sprites.sh`, `migrate_*.py` | One-off sprite and data utilities. |

Load order in the page: `hex-utils.js`, `gen-utils.js`, `map-format.js`, `brush.js`, `zone-painter.js`, `map-jobs.js`, then the inline script. Each script tag carries a `?v=` cache-buster that must be bumped with every change to the file; `map-jobs.js`, `map-worker.js` and `MapJobs.VERSION` must agree.

## Tests

```sh
npx playwright test                              # full suite (a few minutes, up to 3 workers)
npx playwright test tests/layers.spec.ts         # one spec while iterating
npx playwright test --list
```

The tests use the system Chrome (`channel: 'chrome'`), start their own static server on a per-checkout port and mock GitHub and the CDN, so they need no network. Unit-style specs live in `tests/unit/`; the performance and pixel-hash specs (`tests/perf-*.spec.ts`) guard rendering output against `tests/perf-baseline.json`, which must never be edited by hand. Read [tests/README.md](tests/README.md) before writing tests: it lists the environment switches, how startup failures are reported and the rules every test follows (real failing test first, no vacuous assertions, no wall-clock thresholds).

## Deploy

- **Production**: `bash deploy.sh` from a clean branch (normally `dev`). It merges the branch into `gh-pages`, stamps `VERSION`, `COMMIT` and the page title in `MapEditorPro.html` with the date and short commit, and pushes `gh-pages`. Because it merges the whole branch, everything in the repository is published: the editor and all root scripts, `docs/`, `maps/`, `packages/`, `sprites/` and the databases.
- **Development preview**: a push to `dev` that touches `MapEditorPro.html` or one of the root scripts runs `.github/workflows/deploy-dev.yml`. It injects `<base href="../">` so data, sprites and docs resolve from the site root, rewrites the root script tags and the worker URL to point into `dev/`, and copies only `MapEditorPro.html` and the root scripts into `dev/` on `gh-pages`. Docs, databases and sprites are not copied: the dev page reads the production copies, so a new guide appears on both pages only after the next production deploy.
- A new root script must be added to the workflow (trigger paths, rewrite, `?v=` check, copy) and to the deploy lint in `tests/perf-workers.spec.ts` in the same commit.

## Data safety

- Startup merges the saved content with the shipped defaults instead of replacing it, and publishing shows a diff and refuses unsafe writes.
- Autosave goes to IndexedDB and keeps recovery copies (File > Recover autosave copies...); an unreadable autosave is left untouched until you start or open a map.
- A map file is validated before anything is replaced: an unusable file is rejected and the current map stays, smaller problems are listed in one warnings dialog, and saved files carry a `version`.
- Deleting a package is reversible, package imports are validated and roll back on failure, and without a GitHub token or network the editor works locally and writes nothing to the server.
- Layer locks, the validator that runs before Save, CSV export and Publish Map, and one undo step per gesture protect maps while editing.

Local editor state (layer locks and visibility, bookmarks, stamps, panel layout, package details) lives in this browser only and is not part of the map file.
