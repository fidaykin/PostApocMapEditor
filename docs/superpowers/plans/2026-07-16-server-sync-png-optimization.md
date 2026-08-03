# Server Sync + PNG Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google Drive runtime sync in the Unity game with direct HTTP downloads from gh-pages, compress all repo sprites with lossless PNG optimization, and auto-optimize PNGs at upload time in the map editor.

**Architecture:** gh-pages (`https://fidaykin.github.io/PostApocMapEditor`) becomes the single source of truth for game data. `RuntimeDbSyncBase.SyncCoroutine()` goes from 3 Drive API calls (folder lookup → file ID lookup → download) to 1 GET. `RuntimeDatabaseSync.DownloadToCache()` goes from 5 Drive API calls + MD5 checksums to 1 JSON GET + per-sprite GET when missing from disk. The editor lazy-loads `@jsquash/oxipng` WASM from CDN and runs lossless optimization on every uploaded PNG before saving to localStorage and pushing to Drive. The editor continues publishing to Drive; a `sync_data.sh` script exports Drive data into the repo before deploy.

**Tech Stack:** Unity C# (UnityWebRequest), bash (compress_sprites.sh, sync_data.sh), oxipng 10.1.1, `@jsquash/oxipng` 2.3.0 (WASM, ESM from jsdelivr), GitHub Pages.

## Global Constraints

- Base URL (never changes): `https://fidaykin.github.io/PostApocMapEditor`
- gh-pages URL layout: JSONs at root (`/hex_database.json`, `/building_database.json`, `/upgrade_database.json`), sprites at `/sprites/hex/{name}.png` and `/sprites/buildings/{name}.png`
- PNG compression: oxipng first (lossless), no quality degradation guaranteed — pngquant is NOT used (it reduces to 256-color palette)
- Unity cache: `Application.persistentDataPath/HexCache/` for hex sprites+DB, `BuildingCache/sprites/` for building sprites, `UpgradeCache/` for upgrade DB
- No Drive API calls in the Unity game after this plan
- Keep `CACHE_VERSION = "v3"` in RuntimeDatabaseSync — bump from `"v2"` to force all devices to re-download sprites after the URL change
- Do not break the existing `LoadScreenState` integration: `RuntimeBuildingSync.PreDownloadSpritesToDisk()` signature must not change

---

## File Map

**Map Editor repo (`/Users/sergii.tyshchenko/Post Apo Map Editor/`):**
- Create: `compress_sprites.sh` — runs oxipng on all PNG files in `sprites/`
- Create: `sync_data.sh` — downloads current DB JSONs from Drive public URLs into repo root
- Modify: `deploy.sh` — call `compress_sprites.sh` before committing
- Create: `sprites/buildings/` — building sprite PNGs (added in Task 2)
- Modify: `building_database.json` (root) — added to repo
- Modify: `MapEditorPro.html` line ~5637 `handleSpriteUpload()` — lazy-load oxipng WASM, compress before save+push (Task 7)
- Modify: `upgrade_database.json` (root) — added to repo

**Unity repo (`/Users/sergii.tyshchenko/PostApocCityBuilder/`):**
- Modify: `Assets/_Project/Scripts/Map/RuntimeDbSyncBase.cs` — replace 5 Drive constants + folder-traversal SyncCoroutine with BASE_URL + single GET
- Modify: `Assets/_Project/Scripts/Buildings/RuntimeBuildingSync.cs` — replace 3-step Drive folder traversal in `DownloadMissingSpritesToDisk` with direct URL download
- Modify: `Assets/_Project/Scripts/Map/RuntimeDatabaseSync.cs` — replace Drive constants, inspector fields, MD5 checksums, and 5-step `DownloadToCache` with URL-based downloads

---

## Task 1: PNG Compression Script

**Files:**
- Create: `/Users/sergii.tyshchenko/Post Apo Map Editor/compress_sprites.sh`
- Modify: `/Users/sergii.tyshchenko/Post Apo Map Editor/deploy.sh` (3 lines)

**Why oxipng only:** oxipng is truly lossless (re-encodes deflate stream, no pixel changes). pngquant reduces to 256-color palette — technically lossy even at Q=100 for images with >256 colors (most hex sprites have 90k–100k colors). oxipng saves ~10–14% consistently with zero risk.

**Benchmark on current sprites:**
- Hex sprites (68 files): 17.3 MB → 15.5 MB — 10% saved
- Terrain sprites (27 files): 8.3 MB → 7.1 MB — 14% saved
- hex_atlas.png: 7.0 MB → 6.8 MB — 10% saved

- [ ] **Step 1: Create compress_sprites.sh**

```bash
cat > "/Users/sergii.tyshchenko/Post Apo Map Editor/compress_sprites.sh" << 'EOF'
#!/usr/bin/env bash
# Lossless PNG compression using oxipng.
# Run before deploy to shrink sprites without any pixel changes.
# Requires: brew install oxipng
set -euo pipefail

SPRITES_DIR="$(dirname "$0")/sprites"

if ! command -v oxipng &>/dev/null; then
  echo "oxipng not found — install with: brew install oxipng"
  exit 1
fi

echo "Compressing PNGs in $SPRITES_DIR…"
find "$SPRITES_DIR" -name "*.png" | while read -r f; do
  before=$(stat -f%z "$f")
  oxipng -o 4 --quiet "$f"
  after=$(stat -f%z "$f")
  saved=$(( before - after ))
  if [ "$saved" -gt 0 ]; then
    pct=$(echo "scale=0; $saved * 100 / $before" | bc)
    echo "  ${pct}% — $(basename "$f")"
  fi
done

echo "Done."
EOF
chmod +x "/Users/sergii.tyshchenko/Post Apo Map Editor/compress_sprites.sh"
```

- [ ] **Step 2: Run compression on all existing sprites**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
bash compress_sprites.sh
```

Expected output: lines like `10% — Forest_frozen.png`, `14% — Forest_3.png` for each file that shrank.

- [ ] **Step 3: Verify sprites still render correctly**

Open `MapEditorPro.html` in a browser, load the map, confirm hex tiles display normally. Check the atlas: `sprites/hex_atlas.png` should show all tiles as before.

- [ ] **Step 4: Update deploy.sh to auto-compress before deploying**

In `/Users/sergii.tyshchenko/Post Apo Map Editor/deploy.sh`, add the compression call right before `git add MapEditorPro.html`:

Find this block (near line 22 in the `gh-pages` branch path, and near line 34 in the feature-branch path):
```bash
  git add MapEditorPro.html
  git commit -m "deploy: ${BUILD}" || echo "Version already up to date."
  git push origin gh-pages
```

Insert before both `git add` calls (there are two: one for the `gh-pages` branch case, one for the feature-branch case):
```bash
  bash compress_sprites.sh
  git add MapEditorPro.html
```

And in the feature-branch path:
```bash
  bash compress_sprites.sh
  git add MapEditorPro.html building_database.json upgrade_database.json sprites/
  git commit -m "deploy: ${BUILD}"
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add compress_sprites.sh deploy.sh sprites/
git commit -m "feat(deploy): add lossless PNG compression with oxipng"
```

---

## Task 2: Bootstrap Server Data (JSONs + Building Sprites)

**Files:**
- Create: `/Users/sergii.tyshchenko/Post Apo Map Editor/sync_data.sh`
- Create: `/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/buildings/` (folder with PNGs)
- Create: `/Users/sergii.tyshchenko/Post Apo Map Editor/building_database.json`
- Create: `/Users/sergii.tyshchenko/Post Apo Map Editor/upgrade_database.json`

This task gets the current content from Drive into the repo so gh-pages can serve it. The script is also used for future content updates (run it, then deploy).

- [ ] **Step 1: Export building_database.json and upgrade_database.json from the editor**

Open `https://fidaykin.github.io/PostApocMapEditor/` in a browser. In the editor:
1. Open browser DevTools → Console
2. Run: `copy(JSON.stringify(BldDB._data || JSON.parse(localStorage.getItem('buildingDb')||'{}'), null, 2))`
   - If that fails, check what key the editor uses: `Object.keys(localStorage).filter(k => k.includes('uild'))`
3. Paste the result into `/Users/sergii.tyshchenko/Post Apo Map Editor/building_database.json`
4. Repeat for upgrade DB: `copy(JSON.stringify(UpgradeDB._data || JSON.parse(localStorage.getItem('upgradeDb')||'{}'), null, 2))`
5. Paste into `/Users/sergii.tyshchenko/Post Apo Map Editor/upgrade_database.json`

Alternative — download directly from Drive (files are public, IDs visible in editor network tab):
```bash
# Find file ID from editor network tab → Drive API → copy the hex_database.json file ID
# Then:
curl -L "https://drive.google.com/uc?export=download&id=<BUILDING_DB_FILE_ID>" -o building_database.json
curl -L "https://drive.google.com/uc?export=download&id=<UPGRADE_DB_FILE_ID>" -o upgrade_database.json
```

- [ ] **Step 2: Copy building sprites from Drive cache or local files**

Building sprites live in Drive under `HEX_DATA/buildings/`. Download them into `sprites/buildings/`:

```bash
mkdir -p "/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/buildings"
```

If sprites are already cached locally from Unity (`Application.persistentDataPath/BuildingCache/sprites/`):
```bash
# Find the Unity persistent path on macOS:
UNITY_CACHE="$HOME/Library/Application Support/DefaultCompany/PostApocCityBuilder/BuildingCache/sprites"
if [ -d "$UNITY_CACHE" ]; then
  cp "$UNITY_CACHE"/*.png "/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/buildings/"
  echo "Copied $(ls "$UNITY_CACHE"/*.png | wc -l) sprites from Unity cache"
fi
```

If not cached yet, open the editor in browser, authenticate with Drive, then in DevTools:
```javascript
// List building sprite names from building_database.json
const bld = JSON.parse(localStorage.getItem('buildingDb') || '{}');
const names = (bld.buildings || []).filter(b => b.canBuild && b.spriteName).map(b => b.spriteName);
console.log(names.join('\n'));
```
Then download each from Drive manually or via `DriveSync.fetchSpriteDataUrl(name, 'buildings')`.

- [ ] **Step 3: Run oxipng on building sprites**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
find sprites/buildings -name "*.png" -exec oxipng -o 4 --quiet {} \;
echo "Building sprites compressed."
```

- [ ] **Step 4: Create sync_data.sh for future content updates**

```bash
cat > "/Users/sergii.tyshchenko/Post Apo Map Editor/sync_data.sh" << 'EOF'
#!/usr/bin/env bash
# Pull latest DB JSONs from Drive into the repo before deploying.
# The file IDs come from the editor's published URLs (check network tab after publishing).
# Usage: bash sync_data.sh
set -euo pipefail

BUILDING_DB_ID="${BUILDING_DB_FILE_ID:-}"
UPGRADE_DB_ID="${UPGRADE_DB_FILE_ID:-}"

if [ -z "$BUILDING_DB_ID" ] || [ -z "$UPGRADE_DB_ID" ]; then
  echo "Set BUILDING_DB_FILE_ID and UPGRADE_DB_FILE_ID env vars, then re-run."
  echo "Find IDs in browser DevTools → Network tab after publishing from the editor."
  exit 1
fi

curl -Ls "https://drive.google.com/uc?export=download&id=${BUILDING_DB_ID}" -o building_database.json
echo "Downloaded building_database.json"

curl -Ls "https://drive.google.com/uc?export=download&id=${UPGRADE_DB_ID}" -o upgrade_database.json
echo "Downloaded upgrade_database.json"

echo "Done — run 'bash deploy.sh' to publish."
EOF
chmod +x "/Users/sergii.tyshchenko/Post Apo Map Editor/sync_data.sh"
```

- [ ] **Step 5: Verify the JSON files are valid**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
node -e "JSON.parse(require('fs').readFileSync('building_database.json','utf8')); console.log('building_database.json OK')"
node -e "JSON.parse(require('fs').readFileSync('upgrade_database.json','utf8')); console.log('upgrade_database.json OK')"
ls -lh sprites/buildings/
```

Expected: `building_database.json OK`, `upgrade_database.json OK`, list of PNG files in buildings.

- [ ] **Step 6: Verify URLs after deploy**

Deploy to gh-pages:
```bash
bash deploy.sh
```

Then confirm the files are live:
```bash
curl -s -o /dev/null -w "%{http_code}" "https://fidaykin.github.io/PostApocMapEditor/building_database.json"
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" "https://fidaykin.github.io/PostApocMapEditor/upgrade_database.json"
# Expected: 200
```

---

## Task 3: Switch RuntimeDbSyncBase to Server Sync

**Files:**
- Modify: `Assets/_Project/Scripts/Map/RuntimeDbSyncBase.cs`

**Interfaces:**
- Produces: `protected const string BASE_URL` — used by RuntimeBuildingSync (Task 4) and available to all subclasses

This is the core change. `SyncCoroutine()` goes from 3 HTTP calls (subfolder lookup → file lookup → download) to 1 HTTP call. `RuntimeUpgradeSync` and `RuntimeBuildingSync` automatically benefit since they call `base.Start()`.

- [ ] **Step 1: Open the file and review current state**

```
Assets/_Project/Scripts/Map/RuntimeDbSyncBase.cs
```

Current constants to remove:
```csharp
protected const string DRIVE_FOLDER_ID    = "1740gOYYEbZeTMEm5BQgga4JguOC7Di1Q";
protected const string API_KEY            = "AIzaSyDH1j_eIHu58zawC21D6pPflxOupgojJac";
protected const string DRIVE_API_URL      = "https://www.googleapis.com/drive/v3/files";
protected const string DRIVE_DOWNLOAD_URL = "https://www.googleapis.com/drive/v3/files/";
protected const string HEX_DATA_SUBFOLDER = "HEX_DATA";
```

Virtual property to remove:
```csharp
protected virtual bool UseHexDataSubfolder => false;
```

Method to remove: `ParseFirstId(string json)` — only used in `SyncCoroutine`.

- [ ] **Step 2: Replace the Drive constants and SyncCoroutine**

Replace the entire constants block + `SyncCoroutine()` + `ParseFirstId()` with:

```csharp
protected const string BASE_URL = "https://fidaykin.github.io/PostApocMapEditor";

// ── Server sync ───────────────────────────────────────────
private IEnumerator SyncCoroutine()
{
    using var req = UnityWebRequest.Get($"{BASE_URL}/{FileName}");
    req.timeout = 30;
    yield return req.SendWebRequest();

    if (req.result != UnityWebRequest.Result.Success)
    { Debug.LogWarning($"[{GetType().Name}] Download failed: {req.error}"); yield break; }

    string json = req.downloadHandler.text;
    if (string.IsNullOrEmpty(json) || !json.TrimStart().StartsWith("{"))
    { Debug.LogWarning($"[{GetType().Name}] Non-JSON response — skipped."); yield break; }

    CachedJson = json;
    SaveToCache(json);
    Apply(json);
    OnAfterSync();
    Debug.Log($"[{GetType().Name}] Synced {FileName} from server.");
}
```

- [ ] **Step 3: Clean up the Start() log message**

Change:
```csharp
Debug.Log($"[{GetType().Name}] Start — syncing from Drive...");
```
To:
```csharp
Debug.Log($"[{GetType().Name}] Start — syncing from server...");
```

- [ ] **Step 4: Confirm the file compiles**

Open Unity. Check the Console window — no compile errors expected. If `UseHexDataSubfolder` is referenced anywhere, search the project:

```bash
grep -rn "UseHexDataSubfolder" /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/
```

Expected: 0 results (it was only defined and used internally).

- [ ] **Step 5: Play-test building + upgrade sync**

Enter Play mode in Unity. In the Console, after ~2 seconds you should see:
```
[RuntimeBuildingSync] Synced building_database.json from server.
[RuntimeUpgradeSync] Synced upgrade_database.json from server.
```

Not:
```
[RuntimeBuildingSync] Subfolder list failed
```

- [ ] **Step 6: Commit**

```bash
cd /Users/sergii.tyshchenko/PostApocCityBuilder
git add Assets/_Project/Scripts/Map/RuntimeDbSyncBase.cs
git commit -m "feat(sync): replace Drive folder traversal with direct server GET in RuntimeDbSyncBase"
```

---

## Task 4: Switch RuntimeBuildingSync Sprite Download to Server

**Files:**
- Modify: `Assets/_Project/Scripts/Buildings/RuntimeBuildingSync.cs`

**Interfaces:**
- Consumes: `BASE_URL` from RuntimeDbSyncBase (Task 3)
- Produces: `DownloadMissingSpritesToDisk(List<string>)` — same private signature, same behavior

`DownloadMissingSpritesToDisk()` currently does: find HEX_DATA subfolder → find buildings subfolder → list all PNGs → download by file ID. After: for each missing sprite, GET `{BASE_URL}/sprites/buildings/{name}.png` directly.

- [ ] **Step 1: Locate methods to remove**

In `Assets/_Project/Scripts/Buildings/RuntimeBuildingSync.cs`, identify:

```csharp
private const string BUILDINGS_SUBFOLDER = "buildings";   // REMOVE

private IEnumerator DownloadMissingSpritesToDisk(List<string> spriteNames)
{ ... 60 lines of Drive traversal ... }                   // REPLACE

private static Dictionary<string, string> ParseFileIdsByName(string json)
{ ... }                                                    // REMOVE
```

- [ ] **Step 2: Replace DownloadMissingSpritesToDisk**

Delete the old implementation and `BUILDINGS_SUBFOLDER` constant and `ParseFileIdsByName()`. Write:

```csharp
private IEnumerator DownloadMissingSpritesToDisk(List<string> spriteNames)
{
    if (!Directory.Exists(SpriteCacheDir))
        Directory.CreateDirectory(SpriteCacheDir);

    int downloaded = 0;
    foreach (var spriteName in spriteNames)
    {
        if (string.IsNullOrEmpty(spriteName)) continue;
        string cachePath = SpriteCacheDir + "/" + spriteName + ".png";
        if (File.Exists(cachePath)) continue;

        using var req = UnityWebRequest.Get($"{BASE_URL}/sprites/buildings/{spriteName}.png");
        req.timeout = 30;
        yield return req.SendWebRequest();

        if (req.result != UnityWebRequest.Result.Success)
        { Debug.LogWarning($"[RuntimeBuildingSync] Sprite download failed ({spriteName}): {req.error}"); continue; }

        try { File.WriteAllBytes(cachePath, req.downloadHandler.data); downloaded++; }
        catch (Exception e) { Debug.LogWarning($"[RuntimeBuildingSync] Cache write failed: {e.Message}"); }
    }

    if (downloaded > 0)
        Debug.Log($"[RuntimeBuildingSync] Downloaded {downloaded} building sprites from server.");
}
```

- [ ] **Step 3: Check using statements — remove unneeded ones**

After the change, check if these are still used anywhere else in the file:
- `using UnityEngine.Networking;` — still needed (UnityWebRequest is used in `DownloadMissingSpritesToDisk`)
- Keep all others

- [ ] **Step 4: Compile check**

Open Unity. No compile errors expected. If any error references `ParseFileIdsByName` or `BUILDINGS_SUBFOLDER`, that means there's a stray call — remove it.

- [ ] **Step 5: Play-test building sprite loading**

1. Delete Unity's building sprite cache to force a fresh download:
   ```
   macOS: ~/Library/Application Support/DefaultCompany/PostApocCityBuilder/BuildingCache/sprites/
   ```
   Delete all `.png` files in that folder.

2. Enter Play mode. During the loading screen, Console should show:
   ```
   [RuntimeBuildingSync] Downloaded N building sprites from server.
   [RuntimeBuildingSync] PreDownloadSpritesToDisk complete.
   ```

3. After loading screen, buildings on the map should display their icons immediately with no pop-in.

- [ ] **Step 6: Commit**

```bash
cd /Users/sergii.tyshchenko/PostApocCityBuilder
git add Assets/_Project/Scripts/Buildings/RuntimeBuildingSync.cs
git commit -m "feat(sync): replace Drive sprite traversal with direct URL download in RuntimeBuildingSync"
```

---

## Task 5: Switch RuntimeDatabaseSync to Server Sync

**Files:**
- Modify: `Assets/_Project/Scripts/Map/RuntimeDatabaseSync.cs` (777 lines → ~450 lines)

**Interfaces:**
- `public static IEnumerator DownloadToCache(Action<float, string> onProgress, Action<bool, string> onComplete)` — signature unchanged (called by `LoadScreenState`)
- Consumes: `BASE_URL` from RuntimeDbSyncBase (Task 3) — note: `RuntimeDatabaseSync` does NOT inherit `RuntimeDbSyncBase`, so copy the constant here

This is the biggest change. The current `DownloadToCache` does 5 HTTP calls: find HEX_DATA subfolder → list HEX_DATA root → find hex subfolder → list hex subfolder → download each file by ID. After: 1 GET for JSON, then 1 GET per missing sprite PNG.

MD5 checksum change-detection is removed. Sprites are cached by filename: if the file exists on disk, skip. To force a full re-download when sprites change on the server, bump `CACHE_VERSION` from `"v2"` to `"v3"` — this changes the cache directory path, causing all sprites to be re-fetched.

- [ ] **Step 1: Remove Drive-specific constants and inspector fields**

Find and delete:
```csharp
[Header("Google Drive Configuration")]
[Tooltip("Same folder ID used by GoogleDriveMapLoader for map JSONs")]
[SerializeField] private string _driveFolderId = "1740gOYYEbZeTMEm5BQgga4JguOC7Di1Q";

[Tooltip("Google Drive API key (read-only public folder)")]
[SerializeField] private string _apiKey = "AIzaSyDH1j_eIHu58zawC21D6pPflxOupgojJac";
```

And:
```csharp
private const string DRIVE_API_URL      = "https://www.googleapis.com/drive/v3/files";
private const string DRIVE_DOWNLOAD_URL = "https://drive.google.com/uc?export=download&id=";
private const string HEX_DATA_SUBFOLDER = "HEX_DATA";
private const string CHECKSUMS_FILE      = "checksums.json";
```

And:
```csharp
// Cached at Awake so DownloadToCache can run as a static coroutine from LoadingScene.
private static string s_folderId = "1740gOYYEbZeTMEm5BQgga4JguOC7Di1Q";
private static string s_apiKey   = "AIzaSyDH1j_eIHu58zawC21D6pPflxOupgojJac";
```

Add instead:
```csharp
private const string BASE_URL    = "https://fidaykin.github.io/PostApocMapEditor";
private const string CACHE_VERSION = "v3";  // bump from v2 to force re-download after URL change
```

- [ ] **Step 2: Update Awake() — remove Drive field caching**

Find:
```csharp
protected override void Awake()
{
    base.Awake();
    s_folderId = _driveFolderId;
    s_apiKey   = _apiKey;
    LoadFromCache();
}
```

Replace with:
```csharp
protected override void Awake()
{
    base.Awake();
    LoadFromCache();
}
```

- [ ] **Step 3: Update CacheDir to include CACHE_VERSION**

Find:
```csharp
private static string CacheDir => Application.persistentDataPath + CACHE_SUBDIR;
```

Replace with:
```csharp
private static string CacheDir => Application.persistentDataPath + CACHE_SUBDIR + "/" + CACHE_VERSION;
```

- [ ] **Step 4: Replace DownloadToCache**

Delete the entire existing `DownloadToCache` method body (from `onProgress?.Invoke(0f, …)` to the closing `}` of the method — approximately lines 180–347). Replace with:

```csharp
public static IEnumerator DownloadToCache(
    Action<float, string> onProgress,
    Action<bool, string>  onComplete)
{
    onProgress?.Invoke(0f, "Connecting to server…");

    // Step 1: download hex_database.json
    string hexJson;
    using (var req = UnityWebRequest.Get($"{BASE_URL}/hex_database.json"))
    {
        req.timeout = 30;
        yield return req.SendWebRequest();
        if (req.result != UnityWebRequest.Result.Success)
        { onComplete?.Invoke(false, $"Download hex_database.json failed: {req.error}"); yield break; }
        hexJson = req.downloadHandler.text;
    }

    HexDatabase hexDb;
    try   { hexDb = JsonUtility.FromJson<HexDatabase>(hexJson); }
    catch (Exception e) { onComplete?.Invoke(false, $"Parse hex_database.json: {e.Message}"); yield break; }
    if (hexDb?.hexes == null || hexDb.hexes.Length == 0)
    { onComplete?.Invoke(false, "hex_database.json has no entries."); yield break; }

    onProgress?.Invoke(0.20f, "Checking sprites…");

    // Step 2: ensure cache dir exists
    if (!System.IO.Directory.Exists(CacheDir))
        System.IO.Directory.CreateDirectory(CacheDir);

    // Step 3: download missing sprites
    int downloaded = 0, reused = 0, total = hexDb.hexes.Length;
    for (int i = 0; i < total; i++)
    {
        var record = hexDb.hexes[i];
        float t = 0.20f + 0.70f * ((i + 1f) / total);

        if (string.IsNullOrEmpty(record.id) || string.IsNullOrEmpty(record.spriteName))
        { onProgress?.Invoke(t, "Checking sprites…"); continue; }

        string cachePath = CacheDir + "/" + record.spriteName + ".png";
        if (System.IO.File.Exists(cachePath))
        { reused++; onProgress?.Invoke(t, "Checking sprites…"); continue; }

        onProgress?.Invoke(t, $"Downloading {record.spriteName}.png…");
        using (var req = UnityWebRequest.Get($"{BASE_URL}/sprites/hex/{record.spriteName}.png"))
        {
            req.timeout = 30;
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[RuntimeDatabaseSync] Failed: {record.spriteName} — {req.error}");
                continue;
            }
            try
            {
                System.IO.File.WriteAllBytes(cachePath, req.downloadHandler.data);
                downloaded++;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[RuntimeDatabaseSync] Cache write: {e.Message}");
            }
        }
    }

    onProgress?.Invoke(0.92f, "Saving to cache…");

    // Step 4: save hex_database.json to cache
    SaveToCache(hexJson, new Dictionary<string, byte[]>());

    string resultMsg = downloaded > 0
        ? $"{downloaded} sprites downloaded, {reused} cached"
        : $"All {reused} sprites up to date";

    SyncCompletedThisSession = true;
    onProgress?.Invoke(1f, resultMsg);
    onComplete?.Invoke(true, resultMsg);
}
```

- [ ] **Step 5: Remove checksum methods**

Find and delete these methods (no longer needed):
```csharp
private static Dictionary<string, string> LoadChecksums() { ... }
private static void SaveChecksums(Dictionary<string, string> checksums) { ... }
private static List<(string id, string name, string md5)> ParseFileList(string json) { ... }
```

Also remove `SaveToCache(string json, Dictionary<string, byte[]> newPngCache)` overload if it only existed to handle the Drive PNG batch — verify the simpler `SaveToCache(hexJson, new Dictionary<string, byte[]>())` call still compiles.

- [ ] **Step 6: Remove unused using statements**

After all changes, check these — remove if no longer referenced:
```csharp
// Remove if no longer used:
// using System.Collections.Generic;   — still needed for Dictionary in LoadFromCache
// Keep all others
```

Run a compile check in Unity.

- [ ] **Step 7: Play-test hex sync end-to-end**

1. Delete the Unity hex cache to force a fresh download:
   ```
   ~/Library/Application Support/DefaultCompany/PostApocCityBuilder/HexCache/
   ```
   Delete the `v2/` subfolder (old cache). The `v3/` folder does not exist yet.

2. Enter Play mode. During the loading screen, Console should show:
   ```
   [RuntimeDatabaseSync] Downloaded N sprites downloaded, 0 cached
   ```
   And the loading bar should progress smoothly.

3. After the loading screen, the hex map should display all tiles as before.

4. Play again without deleting cache — Console should show:
   ```
   All N sprites up to date
   ```
   And loading should be faster (no downloads).

- [ ] **Step 8: Check Inspector — remove stale Drive field references**

If `RuntimeDatabaseSync` was added to a scene GameObject with the inspector fields set, Unity will warn about missing serialized fields. Search the project's scene files:

```bash
grep -rn "driveFolderId\|_apiKey" /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/ --include="*.unity" --include="*.prefab"
```

If found, open the scene, select the GameObject with `RuntimeDatabaseSync`, and the removed fields will show as "(Missing)" — Unity clears them automatically on save. Save the scene.

- [ ] **Step 9: Commit**

```bash
cd /Users/sergii.tyshchenko/PostApocCityBuilder
git add Assets/_Project/Scripts/Map/RuntimeDatabaseSync.cs
git commit -m "feat(sync): replace Drive API with server GET in RuntimeDatabaseSync, remove checksums"
```

---

## Task 6: Final Deploy + Smoke Test

**Goal:** Verify all three sync systems work end-to-end from gh-pages.

- [ ] **Step 1: Deploy the map editor repo with all new assets**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
bash deploy.sh
```

Expected: deploys `building_database.json`, `upgrade_database.json`, `sprites/buildings/`, compressed `sprites/hex/`, compressed `sprites/terrain/` to gh-pages.

- [ ] **Step 2: Confirm all URLs return 200**

```bash
BASE="https://fidaykin.github.io/PostApocMapEditor"
for path in \
  "hex_database.json" \
  "building_database.json" \
  "upgrade_database.json" \
  "sprites/hex/Forest_1.png" \
  "sprites/buildings/City.png"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/$path")
  echo "$status  $path"
done
```

Expected: all `200`.

- [ ] **Step 3: Full clean-slate play test in Unity**

Delete the entire Unity game cache:
```
~/Library/Application Support/DefaultCompany/PostApocCityBuilder/
```
Delete: `HexCache/`, `BuildingCache/`, `UpgradeCache/` folders.

Enter Play mode. Verify:
1. Loading screen appears and progresses
2. Console shows server sync messages (not Drive messages)
3. No `Drive list failed` or `subfolder not found` errors
4. Loading screen hides; game scene loads
5. Hex tiles display correctly
6. Buildings display correctly (icons visible, not grey boxes)
7. Upgrade system works (no errors in Console related to upgrade DB)

- [ ] **Step 4: Commit Unity branch and push**

```bash
cd /Users/sergii.tyshchenko/PostApocCityBuilder
git status   # verify only the 3 sync files changed
git push origin feature/runtime-db-sync-buildings-upgrades
```

---

---

## Task 7: Editor — Auto-Optimize PNG on Upload

**Files:**
- Modify: `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html` — `handleSpriteUpload()` at line ~5637

**Interfaces:**
- Consumes: `@jsquash/oxipng` ESM from `https://cdn.jsdelivr.net/npm/@jsquash/oxipng@2.3.0/+esm`
- No interface change to callers — `handleSpriteUpload(files)` signature unchanged

The current upload flow (line 5637–5656):
1. Read file as DataURL via FileReader
2. `SpriteStore.save(name, dataUrl, uploadCategory)`
3. `DriveSync.pushSprite(name, file, uploadCategory)`

After this task: between step 0 and step 1, compress the PNG bytes with oxipng WASM. The optimized `File` object replaces the original for both SpriteStore and Drive. oxipng is lazy-loaded from CDN on first upload so it doesn't block initial page load.

- [ ] **Step 1: Check the exact @jsquash/oxipng ESM API**

Open in browser console:
```javascript
const mod = await import('https://cdn.jsdelivr.net/npm/@jsquash/oxipng@2.3.0/+esm');
console.log(Object.keys(mod));
```

Expected output: `["default"]` or `["optimise"]`. The default export or named `optimise` takes a `BufferSource` and returns `Promise<ArrayBuffer>`.

If the default export is the function:
```javascript
const oxipng = mod.default;
const result = await oxipng(arrayBuffer, { level: 4 }); // returns ArrayBuffer
```

If the named export is `optimise`:
```javascript
const { optimise } = mod;
const result = await optimise(arrayBuffer, { level: 4 }); // returns ArrayBuffer
```

Note which form works — the plan below uses `mod.optimise ?? mod.default` to handle both.

- [ ] **Step 2: Replace handleSpriteUpload in MapEditorPro.html**

Find the function at line ~5637:
```javascript
  async function handleSpriteUpload(files) {
    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, ''); // strip extension
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const uploadCategory = (_spritePickerOpts.folder || '').includes('buildings') ? 'buildings' : 'hex';
      await SpriteStore.save(name, dataUrl, uploadCategory);
      toast(`Uploaded "${name}"`);
      // Push to Drive immediately if already authenticated
      DriveSync.pushSprite(name, file, uploadCategory);
    }
    // Refresh grid if picker is open
    if (document.getElementById('sprite-picker-modal').classList.contains('open')) {
      showSpritePicker(_spritePickerCallback, _spritePickerOpts);
    }
  }
```

Replace with:

```javascript
  // Lazy-load oxipng WASM from CDN — null after first failed attempt, function after success.
  let _oxipngFn = undefined;
  async function _loadOxipng() {
    if (_oxipngFn !== undefined) return _oxipngFn;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@jsquash/oxipng@2.3.0/+esm');
      _oxipngFn = mod.optimise ?? mod.default ?? null;
      if (!_oxipngFn) throw new Error('no optimise export found');
    } catch(e) {
      console.warn('[SpriteUpload] oxipng unavailable, uploading uncompressed:', e.message);
      _oxipngFn = null;
    }
    return _oxipngFn;
  }

  async function _optimizePng(file) {
    const fn = await _loadOxipng();
    if (!fn || file.type !== 'image/png') return file;
    try {
      const buffer = await file.arrayBuffer();
      const optimized = await fn(buffer, { level: 4 });
      const savedPct = Math.round((1 - optimized.byteLength / buffer.byteLength) * 100);
      if (savedPct > 0) {
        const name = file.name.replace(/\.[^.]+$/, '');
        toast(`"${name}" compressed ${savedPct}%`);
        return new File([optimized], file.name, { type: 'image/png', lastModified: file.lastModified });
      }
    } catch(e) {
      console.warn('[SpriteUpload] oxipng failed, using original:', e.message);
    }
    return file;
  }

  async function handleSpriteUpload(files) {
    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, ''); // strip extension
      const optimizedFile = await _optimizePng(file);
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(optimizedFile);
      });
      const uploadCategory = (_spritePickerOpts.folder || '').includes('buildings') ? 'buildings' : 'hex';
      await SpriteStore.save(name, dataUrl, uploadCategory);
      toast(`Uploaded "${name}"`);
      DriveSync.pushSprite(name, optimizedFile, uploadCategory);
    }
    if (document.getElementById('sprite-picker-modal').classList.contains('open')) {
      showSpritePicker(_spritePickerCallback, _spritePickerOpts);
    }
  }
```

- [ ] **Step 3: Test in browser**

Open `MapEditorPro.html` (local file or gh-pages). Open the sprite picker and upload a PNG. Verify:

1. After upload, a toast appears: `"SpriteName" compressed N%` (if the PNG was compressible), then `Uploaded "SpriteName"`
2. If the PNG is already optimal (0% savings), only `Uploaded "SpriteName"` appears — no compression toast
3. Open DevTools → Network: the CDN import of `@jsquash/oxipng` appears once on first upload, not on subsequent uploads (lazy-loaded)
4. Check the file pushed to Drive is smaller than the original (open editor network tab, find the upload request)

**Edge case — WebP/JPEG uploads:** these bypass oxipng (only `image/png` is optimized). Upload a JPEG to verify it uploads normally with no compression attempt.

- [ ] **Step 4: Verify sprite renders correctly after optimization**

After uploading an optimized PNG:
1. Check the sprite appears in the sprite picker grid (thumbnail visible)
2. If it's a hex sprite, assign it to a hex tile and verify it renders on the map canvas
3. Confirm the DataURL stored in SpriteStore shows the correct image

- [ ] **Step 5: Commit and deploy**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(editor): auto-optimize PNG uploads with oxipng WASM"
bash deploy.sh
```

---

## Self-Review

**Spec coverage:**
- ✅ Remove Drive API from Unity game — Tasks 3, 4, 5
- ✅ BASE_URL = gh-pages — Task 3
- ✅ hex_database.json, building_database.json, upgrade_database.json served from gh-pages — Task 2
- ✅ sprites/hex/*.png and sprites/buildings/*.png served from gh-pages — Tasks 1 & 2
- ✅ PNG compression for repo sprites (lossless oxipng) — Task 1
- ✅ PNG compression at upload time in editor (oxipng WASM) — Task 7
- ✅ LoadScreenState integration untouched — `PreDownloadSpritesToDisk()` signature unchanged
- ✅ Cache version bumped to force re-download after URL change — Task 5
- ✅ Deploy workflow updated — Tasks 1 & 2

**No placeholders found.**

**Type consistency:** `DownloadToCache(Action<float,string>, Action<bool,string>)` — same in Tasks 5 and in `LoadScreenState` (unchanged). `BASE_URL` constant defined in RuntimeDbSyncBase (Task 3) and copied to RuntimeDatabaseSync (Task 5) since it doesn't inherit the base class.
