# Content Packages — Sub-Project 1: Package Format & Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `packages/postapoc/` folder on GitHub Pages with manifests, database copies, and sprites; update the editor to load from and publish to the new paths; set up a `dev` branch with CI that deploys the dev editor to `/dev/MapEditorPro.html` without touching production.

**Architecture:** All work is in the Map Editor repo (`/Users/sergii.tyshchenko/Post Apo Map Editor/`) on the `gh-pages` branch, except Task 4 which creates the `dev` branch. File migrations happen via local `cp` + `git`, not GitHub API calls (too slow for 100+ PNGs). The editor's sprite paths change from `sprites/<category>/` to `packages/postapoc/sprites/<category>/`. Old root-level paths are kept alive for backward compatibility with game clients on the old build — they must not be deleted.

**Tech Stack:** HTML/JS single-file editor (`MapEditorPro.html`), GitHub Pages (gh-pages branch), GitHub Actions CI, GitHub Contents API (`_putText`/`_putBinary` helpers already in the file).

---

## Global Constraints

- Production URL `https://fidaykin.github.io/PostApocMapEditor/MapEditorPro.html` must never break — never push broken code to `gh-pages`
- Old paths (`sprites/hex/`, `sprites/buildings/`, root `hex_database.json`, root `building_database.json`) must remain accessible on GitHub Pages for the entire transition period
- Dev CI must only write to `dev/MapEditorPro.html` in `gh-pages`, never to the root
- `sprites/terrain/roads/` is NOT part of this migration — road sprites stay at their current path
- Package IDs are lowercase alphanumeric + hyphens; `postapoc` is the default package ID
- All database files at `packages/postapoc/` must include a top-level `"package": "postapoc"` field
- Working directory for all shell commands: `/Users/sergii.tyshchenko/Post Apo Map Editor`
- Active branch for Tasks 1–3: `gh-pages`

---

## File Structure

**Files created (Task 1):**
- `packages/registry.json` — global list of all packages
- `packages/postapoc/package.json` — postapoc package manifest
- `packages/postapoc/hex_database.json` — copy of root `hex_database.json` + `"package"` field
- `packages/postapoc/building_database.json` — copy of root `building_database.json` + `"package"` field
- `packages/postapoc/sprites/hex/` — copies of all PNGs from `sprites/hex/`
- `packages/postapoc/sprites/buildings/` — copies of all PNGs from `sprites/buildings/`
- `packages/postapoc/sprites/terrain/` — copies of all PNGs from `sprites/terrain/`

**Files modified (Tasks 2–3):**
- `MapEditorPro.html` — sprite load paths, GitHubSync fetch/publish paths

**Files created (Task 4):**
- `.github/workflows/deploy-dev.yml` — CI on `dev` branch
- `dev/.gitkeep` — placeholder so `dev/` exists on `gh-pages`

---

## Task 1: Scaffold `packages/postapoc/` and push to gh-pages

**Files:**
- Create: `packages/registry.json`
- Create: `packages/postapoc/package.json`
- Create: `packages/postapoc/hex_database.json`
- Create: `packages/postapoc/building_database.json`
- Create: `packages/postapoc/sprites/hex/` (copy)
- Create: `packages/postapoc/sprites/buildings/` (copy)
- Create: `packages/postapoc/sprites/terrain/` (copy)

**Interfaces:**
- Produces: `https://fidaykin.github.io/PostApocMapEditor/packages/registry.json` → valid JSON
- Produces: `https://fidaykin.github.io/PostApocMapEditor/packages/postapoc/hex_database.json` → valid JSON with `"package": "postapoc"` field

- [ ] **Step 1: Verify the paths do not exist yet (pre-condition check)**

```bash
curl -sf https://fidaykin.github.io/PostApocMapEditor/packages/registry.json && echo "ALREADY EXISTS - stop" || echo "OK - does not exist yet"
```

Expected output: `OK - does not exist yet`

- [ ] **Step 2: Create manifest files**

```bash
mkdir -p packages/postapoc

cat > packages/registry.json << 'EOF'
{
  "version": 1,
  "packages": [
    { "id": "postapoc", "name": "Post-Apocalypse", "isDefault": true, "version": "1.0.0" }
  ]
}
EOF

cat > packages/postapoc/package.json << 'EOF'
{
  "id": "postapoc",
  "name": "Post-Apocalypse",
  "version": "1.0.0",
  "description": "The original post-apocalyptic world — ruins, wasteland, and survival.",
  "preview": "preview.png",
  "isDefault": true
}
EOF
```

- [ ] **Step 3: Create database copies with `"package"` field**

```bash
python3 - << 'EOF'
import json, copy

# hex_database.json
with open('hex_database.json') as f:
    hex_db = json.load(f)
pkg_hex = copy.deepcopy(hex_db)
pkg_hex['package'] = 'postapoc'
# Insert "package" as second key (after "version") for readability
ordered = {}
for k, v in pkg_hex.items():
    ordered[k] = v
    if k == 'version':
        ordered['package'] = 'postapoc'
# rebuild without dup
final_hex = {}
for k, v in ordered.items():
    if k not in final_hex:
        final_hex[k] = v
with open('packages/postapoc/hex_database.json', 'w') as f:
    json.dump(final_hex, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"hex_database.json: {len(hex_db.get('hexes', []))} hexes copied")

# building_database.json
with open('building_database.json') as f:
    bld_db = json.load(f)
final_bld = {'version': bld_db.get('version', 1), 'package': 'postapoc'}
final_bld.update({k: v for k, v in bld_db.items() if k not in ('version', 'package')})
with open('packages/postapoc/building_database.json', 'w') as f:
    json.dump(final_bld, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"building_database.json: {len(bld_db.get('buildings', []))} buildings copied")
EOF
```

Expected output:
```
hex_database.json: 90 hexes copied
building_database.json: 14 buildings copied
```

- [ ] **Step 4: Verify database copies have the `"package"` field**

```bash
python3 -c "
import json
h = json.load(open('packages/postapoc/hex_database.json'))
b = json.load(open('packages/postapoc/building_database.json'))
assert h.get('package') == 'postapoc', f'hex missing package field, got: {h.get(\"package\")}'
assert b.get('package') == 'postapoc', f'bld missing package field, got: {b.get(\"package\")}'
print('OK: both databases have package=postapoc')
print(f'  hex_database keys: {list(h.keys())[:4]}')
print(f'  bld_database keys: {list(b.keys())[:4]}')
"
```

Expected output:
```
OK: both databases have package=postapoc
  hex_database keys: ['version', 'package', 'hexes', 'dbVersion']
  bld_database keys: ['version', 'package', 'buildings']
```

- [ ] **Step 5: Copy sprite folders**

```bash
mkdir -p packages/postapoc/sprites
cp -r sprites/hex      packages/postapoc/sprites/hex
cp -r sprites/buildings packages/postapoc/sprites/buildings
cp -r sprites/terrain   packages/postapoc/sprites/terrain
echo "Copied $(find packages/postapoc/sprites -name '*.png' | wc -l) PNG files"
```

Expected output: `Copied <N> PNG files` (will be 100+)

- [ ] **Step 6: Commit and push**

```bash
git add packages/
git commit -m "feat(packages): scaffold packages/postapoc/ with databases, sprites, and registry"
git push origin gh-pages
```

- [ ] **Step 7: Verify on GitHub Pages (wait ~60s for CDN propagation)**

```bash
sleep 60
curl -sf "https://fidaykin.github.io/PostApocMapEditor/packages/registry.json" | python3 -m json.tool
curl -sf "https://fidaykin.github.io/PostApocMapEditor/packages/postapoc/package.json" | python3 -m json.tool
curl -sf "https://fidaykin.github.io/PostApocMapEditor/packages/postapoc/hex_database.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'hexes: {len(d[\"hexes\"])}, package: {d[\"package\"]}')"
```

Expected output:
```json
{ "version": 1, "packages": [ { "id": "postapoc", ... } ] }
{ "id": "postapoc", "isDefault": true, ... }
hexes: 90, package: postapoc
```

---

## Task 2: Update sprite load paths in `MapEditorPro.html`

**Files:**
- Modify: `MapEditorPro.html` (lines ~2282, ~3807, ~5126, ~5169, ~5205, ~5212, ~5239, ~5544, ~5585, ~8160, ~8896, ~8930, ~9316, ~9717, ~10230, ~11621–11622)

**Interfaces:**
- Consumes: `packages/postapoc/sprites/hex/` and `packages/postapoc/sprites/buildings/` from Task 1
- Produces: editor palette renders tiles and buildings using the new paths

- [ ] **Step 1: Change `HEX_DIR` constant inside the `Terrain` module (line ~2282)**

Find:
```javascript
  const HEX_DIR = 'sprites/hex/';
```

Replace with:
```javascript
  const HEX_DIR = 'packages/postapoc/sprites/hex/';
```

- [ ] **Step 2: Update building sprite paths in the building picker card renderer (line ~3807)**

Find:
```javascript
        ? (Terrain.getUploadedUrl ? (Terrain.getUploadedUrl(b.spriteName) || `sprites/buildings/${b.spriteName}.png`) : `sprites/buildings/${b.spriteName}.png`)
```

Replace with:
```javascript
        ? (Terrain.getUploadedUrl ? (Terrain.getUploadedUrl(b.spriteName) || `packages/postapoc/sprites/buildings/${b.spriteName}.png`) : `packages/postapoc/sprites/buildings/${b.spriteName}.png`)
```

- [ ] **Step 3: Update hex sprite fallbacks in the UI palette (lines ~5126, 5169, 5205, 5212, 5239)**

Find and replace all of these (4 separate edits):

`sprites/hex/${h.spriteName}.png` → `packages/postapoc/sprites/hex/${h.spriteName}.png`

`sprites/hex/${entry.spriteName}.png` → `packages/postapoc/sprites/hex/${entry.spriteName}.png`

Both occurrences of `` else if (t.spriteName) selImg.src = `sprites/hex/${t.spriteName}.png` `` and the `rtImg.src` variant → same replacement pattern.

`` selImg.src = `sprites/hex/River_bridge_${axis + 1}.png` `` → `` selImg.src = `packages/postapoc/sprites/hex/River_bridge_${axis + 1}.png` ``

- [ ] **Step 4: Update sprite picker default folder (line ~5544)**

Find:
```javascript
    const folder    = opts.folder || 'sprites/hex';
```

Replace with:
```javascript
    const folder    = opts.folder || 'packages/postapoc/sprites/hex';
```

- [ ] **Step 5: Update sprite picker GitHub thumbnail URL (line ~5585)**

Find:
```javascript
          const thumb = _makeThumb(name, `${GitHubSync.BASE_URL}/sprites/${category}/${name}.png`, false, null);
```

Replace with:
```javascript
          const thumb = _makeThumb(name, `${GitHubSync.BASE_URL}/packages/postapoc/sprites/${category}/${name}.png`, false, null);
```

- [ ] **Step 6: Update HexDB panel sprite preview (line ~8160)**

Find:
```javascript
      ? (Terrain.getUploadedUrl(hex.spriteName) || `sprites/hex/${_esc(hex.spriteName)}.png`)
```

Replace with:
```javascript
      ? (Terrain.getUploadedUrl(hex.spriteName) || `packages/postapoc/sprites/hex/${_esc(hex.spriteName)}.png`)
```

- [ ] **Step 7: Update migration helper sprite URLs (lines ~8896, ~8930)**

Find:
```javascript
              const hexUrl = `${GitHubSync.BASE_URL}/sprites/hex/${newBld.spriteName}.png`;
```

Replace with:
```javascript
              const hexUrl = `${GitHubSync.BASE_URL}/packages/postapoc/sprites/hex/${newBld.spriteName}.png`;
```

Find:
```javascript
        const _migrateDir = newBld.buildingCategory === 'Bridge' ? 'sprites/hex/' : 'sprites/buildings/';
```

Replace with:
```javascript
        const _migrateDir = newBld.buildingCategory === 'Bridge' ? 'packages/postapoc/sprites/hex/' : 'packages/postapoc/sprites/buildings/';
```

- [ ] **Step 8: Update BldDB panel sprite previews (lines ~9316, ~9717)**

Find (both occurrences):
```javascript
      const spriteSrc = bld.spriteName ? (Terrain.getUploadedUrl(bld.spriteName) || `sprites/buildings/${_esc(bld.spriteName)}.png`) : '';
```

Replace with:
```javascript
      const spriteSrc = bld.spriteName ? (Terrain.getUploadedUrl(bld.spriteName) || `packages/postapoc/sprites/buildings/${_esc(bld.spriteName)}.png`) : '';
```

- [ ] **Step 9: Update sprite picker folder option for buildings (line ~10230)**

Find:
```javascript
      folder: 'sprites/buildings',
```

Replace with:
```javascript
      folder: 'packages/postapoc/sprites/buildings',
```

- [ ] **Step 10: Update `applyHexDbOverrides` calls at startup (lines ~11621–11622)**

Find:
```javascript
    await Terrain.applyHexDbOverrides(_allBlds.filter(b => b.buildingCategory !== 'Bridge'), 'sprites/buildings/');
    await Terrain.applyHexDbOverrides(_allBlds.filter(b => b.buildingCategory === 'Bridge'), 'sprites/hex/');
```

Replace with:
```javascript
    await Terrain.applyHexDbOverrides(_allBlds.filter(b => b.buildingCategory !== 'Bridge'), 'packages/postapoc/sprites/buildings/');
    await Terrain.applyHexDbOverrides(_allBlds.filter(b => b.buildingCategory === 'Bridge'), 'packages/postapoc/sprites/hex/');
```

- [ ] **Step 11: Sanity-check — no remaining old sprite paths (except road sprites which stay at old path)**

```bash
grep -n "'sprites/hex\|'sprites/buildings\|\"sprites/hex\|\"sprites/buildings" MapEditorPro.html | grep -v "terrain/roads\|help text\|Resources/Hex\|Resources/Buildings\|//\s"
```

Expected output: empty (or only cosmetic help-text strings inside `<small>` tags, which are fine to leave).

- [ ] **Step 12: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(packages): update sprite load paths to packages/postapoc/sprites/"
git push origin gh-pages
```

- [ ] **Step 13: Verify in browser**

Open `https://fidaykin.github.io/PostApocMapEditor/MapEditorPro.html` (wait ~60s for CDN). Check:
- Terrain palette shows tile thumbnails (not broken images)
- Buildings panel shows building sprites
- Open DevTools → Network tab, reload, filter by `packages/postapoc/sprites/` — see sprite requests succeeding (200)
- No requests to old `sprites/hex/` or `sprites/buildings/` paths (except road sprites at `sprites/terrain/roads/`)

---

## Task 3: Update GitHubSync fetch and publish paths

**Files:**
- Modify: `MapEditorPro.html` (lines ~4627–4690, ~4729–4746, ~4807–4827)

**Interfaces:**
- Consumes: Task 1 (new paths exist on GitHub Pages)
- Produces: editor fetches databases from `packages/postapoc/`; publish writes to `packages/postapoc/` AND to root (backward compat)

- [ ] **Step 1: Update `loadHexDbIntoEditor` fetch URL (line ~4808)**

Find:
```javascript
    const res = await fetch(`${BASE_URL}/hex_database.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`hex_database.json not found (${res.status})`);
```

Replace with:
```javascript
    const res = await fetch(`${BASE_URL}/packages/postapoc/hex_database.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`packages/postapoc/hex_database.json not found (${res.status})`);
```

- [ ] **Step 2: Update `loadBuildingDbFromServer` fetch URL (line ~4822)**

Find:
```javascript
    const res = await fetch(`${BASE_URL}/building_database.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`building_database.json not found (${res.status})`);
```

Replace with:
```javascript
    const res = await fetch(`${BASE_URL}/packages/postapoc/building_database.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`packages/postapoc/building_database.json not found (${res.status})`);
```

- [ ] **Step 3: Dual-write in `publishHexDbOnly` (line ~4627)**

Find:
```javascript
  async function publishHexDbOnly() {
    await _withPublishBtn('Publish HexDB', async () => {
      UI.progress(20, 'Publishing hex_database.json…');
      const json = JSON.stringify(HexDB.getData(), null, 2);
      await _putText('hex_database.json', json, 'publish: hex_database.json');
      UI.progressDone('✅ HexDB published');
      UI.toast('✅ hex_database.json published');
    });
  }
```

Replace with:
```javascript
  async function publishHexDbOnly() {
    await _withPublishBtn('Publish HexDB', async () => {
      UI.progress(10, 'Publishing hex_database.json…');
      const data = HexDB.getData();
      const pkgData = Object.assign({ version: data.version, package: 'postapoc' },
        Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'version')));
      const json    = JSON.stringify(data, null, 2);
      const pkgJson = JSON.stringify(pkgData, null, 2);
      UI.progress(30, 'Writing packages/postapoc/hex_database.json…');
      await _putText('packages/postapoc/hex_database.json', pkgJson, 'publish: hex_database.json');
      UI.progress(70, 'Writing root hex_database.json (compat)…');
      await _putText('hex_database.json', json, 'publish: hex_database.json');
      UI.progressDone('✅ HexDB published');
      UI.toast('✅ hex_database.json published');
    });
  }
```

- [ ] **Step 4: Dual-write in `publishBuildingsDb` (line ~4683)**

Find:
```javascript
  async function publishBuildingsDb() {
    await _withPublishBtn('Publish Buildings DB', async () => {
      UI.progress(30, 'Publishing building_database.json…');
      await _putText('building_database.json', BldDB.getJson(), 'publish: building_database.json');
      UI.progressDone('✅ Buildings DB published');
      UI.toast('✅ building_database.json published');
    });
  }
```

Replace with:
```javascript
  async function publishBuildingsDb() {
    await _withPublishBtn('Publish Buildings DB', async () => {
      UI.progress(10, 'Publishing building_database.json…');
      const rawData = JSON.parse(BldDB.getJson());
      const pkgData = { version: rawData.version ?? 1, package: 'postapoc',
        ...Object.fromEntries(Object.entries(rawData).filter(([k]) => !['version','package'].includes(k))) };
      UI.progress(30, 'Writing packages/postapoc/building_database.json…');
      await _putText('packages/postapoc/building_database.json', JSON.stringify(pkgData, null, 2), 'publish: building_database.json');
      UI.progress(70, 'Writing root building_database.json (compat)…');
      await _putText('building_database.json', BldDB.getJson(), 'publish: building_database.json');
      UI.progressDone('✅ Buildings DB published');
      UI.toast('✅ building_database.json published');
    });
  }
```

- [ ] **Step 5: Dual-write in `pushSprite` (line ~4729)**

Find:
```javascript
  async function pushSprite(name, blob, category = 'hex') {
    if (!isPATConfigured()) return;
    try {
      const fname = name.endsWith('.png') ? name : `${name}.png`;
      await _putBinary(`sprites/${category}/${fname}`, blob, `sprite: ${fname}`);
    } catch(e) {
      console.warn('[GitHubSync] pushSprite failed:', e.message);
    }
  }
```

Replace with:
```javascript
  async function pushSprite(name, blob, category = 'hex') {
    if (!isPATConfigured()) return;
    try {
      const fname = name.endsWith('.png') ? name : `${name}.png`;
      await _putBinary(`packages/postapoc/sprites/${category}/${fname}`, blob, `sprite: ${fname}`);
      await _putBinary(`sprites/${category}/${fname}`, blob, `sprite: ${fname} (compat)`);
    } catch(e) {
      console.warn('[GitHubSync] pushSprite failed:', e.message);
    }
  }
```

- [ ] **Step 6: Update `listSpriteFiles` to use new path (line ~4739)**

Find:
```javascript
  async function listSpriteFiles(category) {
    try {
      const items = await _listFolder(`sprites/${category}`);
```

Replace with:
```javascript
  async function listSpriteFiles(category) {
    try {
      const items = await _listFolder(`packages/postapoc/sprites/${category}`);
```

- [ ] **Step 7: Update `cleanGhostSprites` folder references (lines ~4659–4660)**

Find:
```javascript
        listSpriteFiles('hex'),
        listSpriteFiles('buildings'),
      ]);
      const onGitHub = new Set([
        ...hexFiles.map(f => `hex/${f.name}`),
        ...bldFiles.map(f => `buildings/${f.name}`),
      ]);
```

Replace with:
```javascript
        listSpriteFiles('hex'),
        listSpriteFiles('buildings'),
      ]);
      const onGitHub = new Set([
        ...hexFiles.map(f => `hex/${f.name}`),
        ...bldFiles.map(f => `buildings/${f.name}`),
      ]);
```

(No change needed here — `listSpriteFiles` already returns `{ name, url }` objects and the Set keys are category-relative names. The change in Step 6 is sufficient.)

- [ ] **Step 8: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(packages): update GitHubSync to fetch/publish via packages/postapoc/ paths"
git push origin gh-pages
```

- [ ] **Step 9: Verify fetch paths in browser**

Open `https://fidaykin.github.io/PostApocMapEditor/MapEditorPro.html`, open DevTools → Network. Reload. Filter by `hex_database` and `building_database`. Confirm requests go to:
- `packages/postapoc/hex_database.json` ✓
- `packages/postapoc/building_database.json` ✓

NOT to root-level `hex_database.json`.

- [ ] **Step 10: Verify publish dual-write (requires PAT configured)**

If a GitHub PAT is configured in the editor:
1. Make a trivial change to any hex entry in HexDB panel
2. Click Publish HexDB
3. Verify both files updated:

```bash
sleep 30
curl -sf "https://fidaykin.github.io/PostApocMapEditor/packages/postapoc/hex_database.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('pkg hex count:', len(d['hexes']))"
curl -sf "https://fidaykin.github.io/PostApocMapEditor/hex_database.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('root hex count:', len(d['hexes']))"
```

Both should report the same count.

---

## Task 4: Create `dev` branch and CI deploy workflow

**Files:**
- Create (on `dev` branch): `.github/workflows/deploy-dev.yml`
- Create (on `gh-pages`): `dev/.gitkeep`

**Interfaces:**
- Produces: pushing `MapEditorPro.html` to `dev` branch → `dev/MapEditorPro.html` appears/updates on `gh-pages` within ~2 minutes

- [ ] **Step 1: Create `dev/.gitkeep` placeholder on `gh-pages`**

```bash
# Still on gh-pages branch
mkdir -p dev
touch dev/.gitkeep
git add dev/.gitkeep
git commit -m "chore: add dev/ placeholder for dev editor deployment"
git push origin gh-pages
```

- [ ] **Step 2: Create `dev` branch from current `gh-pages`**

```bash
git checkout -b dev
```

- [ ] **Step 3: Create the CI workflow file**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/deploy-dev.yml` with this exact content:

```yaml
name: Deploy Dev Editor

on:
  push:
    branches: [dev]
    paths: ['MapEditorPro.html']

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout dev branch
        uses: actions/checkout@v4
        with:
          ref: dev
          fetch-depth: 0

      - name: Build dev HTML (inject <base href="../"> so relative paths resolve from repo root)
        run: |
          sed 's|</head>|<base href="../">\n</head>|' MapEditorPro.html > /tmp/MapEditorPro_dev.html

      - name: Deploy to gh-pages dev/ folder
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout gh-pages
          cp /tmp/MapEditorPro_dev.html dev/MapEditorPro.html
          git add dev/MapEditorPro.html
          if git diff --cached --quiet; then
            echo "No changes to deploy"
          else
            git commit -m "deploy(dev): update from $(git rev-parse dev | head -c 7)"
            git push origin gh-pages
          fi
```

- [ ] **Step 4: Commit workflow to `dev` branch**

```bash
git add .github/workflows/deploy-dev.yml
git commit -m "ci: add deploy-dev workflow — pushes editor to dev/ on gh-pages"
git push -u origin dev
```

- [ ] **Step 5: Verify CI triggered**

Go to `https://github.com/fidaykin/PostApocMapEditor/actions` and confirm:
- Workflow "Deploy Dev Editor" is running or completed
- No errors

- [ ] **Step 6: Verify dev editor is live**

```bash
sleep 120
curl -sf "https://fidaykin.github.io/PostApocMapEditor/dev/MapEditorPro.html" | grep '<base href' && echo "OK: base href found"
```

Expected output: `<base href="../">` line present, followed by `OK: base href found`.

- [ ] **Step 7: Open dev editor in browser and verify tiles render**

Open `https://fidaykin.github.io/PostApocMapEditor/dev/MapEditorPro.html`.
- Terrain palette shows tiles ✓
- Buildings panel shows building sprites ✓
- No 404s in DevTools Network tab for sprite PNGs

- [ ] **Step 8: Switch back to gh-pages for future production work**

```bash
git checkout gh-pages
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `packages/postapoc/` folder with databases and sprites on GitHub Pages | Task 1 |
| `registry.json` and `package.json` manifests created | Task 1 |
| `"package": "postapoc"` field in database files | Task 1 Steps 3–4 |
| Editor sprite load paths updated to `packages/postapoc/sprites/` | Task 2 |
| Editor fetches databases from `packages/postapoc/` | Task 3 Steps 1–2 |
| Publish writes to `packages/postapoc/` (primary) AND root (compat) | Task 3 Steps 3–6 |
| Sprite uploads go to `packages/postapoc/sprites/` AND root | Task 3 Step 5 |
| Old root paths remain accessible (kept alive) | Tasks 3 Steps 3–6 (dual-write) |
| Dev CI: `dev` branch → `dev/MapEditorPro.html` on gh-pages | Task 4 |
| Dev HTML uses `<base href="../">` to resolve paths correctly | Task 4 Step 3 |
| Production URL never breaks | Tasks 1–4 (never remove root files) |
| `sprites/terrain/roads/` NOT migrated | Task 2 Step 11 (excluded from changes) |
