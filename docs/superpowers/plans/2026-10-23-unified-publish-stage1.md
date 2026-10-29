# Unified Publish (stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `Publish` for the active package (data + only the changed sprites, with a diff, version and changelog), one `Publish Common` for the global files, `Publish Map` unchanged; the six old menu entries disappear.

**Architecture:** The editor already has the pieces: `Packages.diffAgainstServer` + `openPublishConfirm` (diff), `openPublishDialog` (version bump, changelog, preview), `_publishPackageRun` (writes, manifest, registry, `package.json` last), `GitHubSync.publishManifest` (sha256 of every file). Stage 1 closes the gaps: sprites are compared by hash and unchanged ones are skipped, the diff shows sprite changes, the base package `postapoc` goes through the same dialog (with an explicit confirmation), `Publish Common` bundles Upgrade DB, Common settings and `localization.json`, and the menu shrinks to three entries. No game change, no new game build.

**Tech Stack:** `MapEditorPro.html` (vanilla JS modules `GitHubSync`, `Packages`), Playwright tests with `FakeGitHub` (`tests/helpers.ts`), `bash deploy.sh` (owner runs it).

**Spec:** `docs/superpowers/specs/2026-10-22-unified-publish-and-package-localization.uk.html` in the Unity repo (sections 3, 6, 7 stage 1, 8, 9, questions 1, 6, 7). Localization layers (stage 2) and package upgrades (stage 3) are NOT in this plan.

## Global Constraints

- Base package `postapoc`: keep writing both `packages/postapoc/...` AND the root files (`hex_database.json`, `building_database.json`, `sprites/...`) while old game builds are in circulation.
- `package.json` stays the LAST write of a package publish (commit marker); `registry.json` write stays conditional on its sha.
- Version comes from the server (`_fetchPackageJson`), never from a cache; a retry after a failed publish yields the same version.
- Nothing is written before the user confirms; Cancel writes nothing (existing test `package-publish.spec.ts` pins it).
- Publishing base `postapoc` needs a separate explicit confirmation (spec question 7, recommendation yes).
- Old functions (`publishHexDbOnly`, `publishBuildingsDb`, `publishAllSprites`, `publishUpgradeDb`, `publishCommonDb`, `publishLoc`) stay exported and working: existing tests and the COMMON/KEYS tab buttons call them. Only the Publish menu entries go.
- Roads V1 gate (`GitHubSync.roadsGate`) and Skin slot problems still stop a publish before the first write.
- Answers to the owner in Ukrainian; the owner runs `bash deploy.sh`; push and ClickUp writes only on explicit yes.

## Review Focus

- First publish of a package (nothing on the server, no `manifest.json`): every sprite uploads, no crash on the missing manifest.
- Sprite renamed or replaced locally with the same name: the hash differs, it uploads (never skipped by name alone).
- Server `manifest.json` unreadable or corrupt: fall back to uploading everything, with a warning, never skip silently.
- Nothing changed at all: dialog says so, publishing still allowed (version `Keep`), no sprite PUTs.
- Base `postapoc` entries of other packages must not leak into the base files (existing `_isBaseEntry` rule).
- Publish Common with one file unchanged: that file is not written; with the network failing on the second file the first stays and the error names the file.

## File Structure

- Modify `MapEditorPro.html`: `Packages` module (sprite hash skip, sprite diff, base-aware diff, unified entry), `GitHubSync` module (`publishCommon`, `publish`), menu markup near line 1543, `CHANGELOG.md`.
- Create `tests/unified-publish.spec.ts` (all new tests).
- Modify tests that click the removed menu entries, if any (grep `pub-drop`).

---

### Task 1: Skip unchanged sprites by hash

**Files:**
- Modify: `MapEditorPro.html` (`publishPackageSprites`, ~line 15035)
- Test: `tests/unified-publish.spec.ts`

**Interfaces:**
- Produces: `publishPackageSprites(id, onProgress)` result gains `skipped: number` (sprites whose bytes already match the server manifest). `Packages._publishedHashes(id): Promise<Map<string,string>|null>` (path relative to the repo root -> sha256, `null` when there is no readable manifest).
- Consumes: `GitHubSync._readRepoBytes`, `GitHubSync.sha256Hex` (both exported already, used in the same function).

- [ ] **Step 1: Failing test.** Seed `packages/hashpkg/manifest.json` in `FakeGitHub` listing `sprites/hex/Hashpkg_Same.png` with the sha256 of the local sprite bytes and `Hashpkg_Changed.png` with a different sha; register the package with two hex records using those sprites (seed the sprites locally with `seedSprites`); run `Packages.publishPackageSprites('hashpkg')`. Expect `gh.putPaths()` to contain `packages/hashpkg/sprites/hex/Hashpkg_Changed.png` and not `.../Hashpkg_Same.png`, and `result.skipped === 1`.
- [ ] **Step 2: Run** `npx playwright test tests/unified-publish.spec.ts -g "unchanged sprites"`. Expected: FAIL (both uploaded).
- [ ] **Step 3: Implement.** Add above `publishPackageSprites`:

```js
  // sha256 of every file the server manifest lists, keyed by repo path; null when there is no usable manifest
  // (first publish, or a corrupt file: then everything uploads).
  async function _publishedHashes(id) {
    try {
      const bytes = await GitHubSync._readRepoBytes(`packages/${id}/manifest.json`);
      if (!bytes) return null;
      const m = JSON.parse(new TextDecoder().decode(bytes));
      if (!m || !Array.isArray(m.files)) return null;
      return new Map(m.files.filter(f => f && f.path && f.sha256).map(f => [`packages/${id}/${f.path}`, f.sha256]));
    } catch (e) { console.warn('[Packages] server manifest unreadable, all sprites will upload:', e && e.message); return null; }
  }
```

  In `publishPackageSprites`: before the loop `const published = await _publishedHashes(id); let skipped = 0;`; after `const target = ...` and before the `differs` block, add:

```js
      if (published) {
        const sha = await GitHubSync.sha256Hex(new Uint8Array(await blob.arrayBuffer()));
        if (published.get(target) === sha) { skipped++; continue; }
      }
```

  Add `skipped` to both returns (`skipped: 0` in the empty one) and to the `_publishPackageRun` toast: `${spriteResult.pushed}/${spriteResult.total} sprites` becomes `${spriteResult.pushed} uploaded, ${spriteResult.skipped} unchanged`. Export `_publishedHashes` in the `Packages` return object.
- [ ] **Step 4: Run** the test plus `tests/package-publish.spec.ts tests/packages-publish.spec.ts tests/package-manifest.spec.ts`. Expected: PASS (update an old assertion only if it counted sprite PUTs of unchanged files).
- [ ] **Step 5: Add Review Focus tests:** no manifest (first publish) uploads all; corrupt manifest JSON uploads all and does not throw; same name with different bytes uploads.
- [ ] **Step 6: Commit** `feat(publish): skip sprites whose hash matches the server manifest`.

### Task 2: Sprite changes in the publish diff

**Files:**
- Modify: `MapEditorPro.html` (`diffAgainstServer`, `_formatDiff`)
- Test: `tests/unified-publish.spec.ts`

**Interfaces:**
- Produces: `diffAgainstServer(id)` result gains `sprites: { added: string[], changed: string[] }` (names of sprites with a LOCAL store copy that is absent from, or different from, the server manifest). `_formatDiff` prints `Sprites: N new, M changed` and one `+ sprite name` / `~ sprite name` row each.
- Consumes: `_publishedHashes`, `_packageSpriteRefs`, `SpriteStore.loadForPackage` (as in `publishPackageSprites`).

- [ ] **Step 1: Failing test.** Same seed as Task 1 plus one new local sprite not in the manifest. `Packages.openPublishConfirm('hashpkg')`: `#dialog-details` contains `+ sprite Hashpkg_New` and `~ sprite Hashpkg_Changed`, not `Hashpkg_Same`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `diffAgainstServer`, after the hex/bld diffs:

```js
    const sprites = { added: [], changed: [] };
    const published = await _publishedHashes(id);
    const refs = await _packageSpriteRefs(id);
    let local = [];
    try { local = [...await SpriteStore.loadForPackage('postapoc'), ...await SpriteStore.loadForPackage(id)]; } catch (e) { /* server copies only: nothing local to compare */ }
    const byName = new Map(local.map(e => [e.name, e]));
    for (const [name, category] of refs) {
      const e = byName.get(name);
      if (!e) continue;                                   // no local copy: publish takes the server copy, nothing changes
      const blob = await (await fetch(e.dataUrl)).blob();
      const sha = await GitHubSync.sha256Hex(new Uint8Array(await blob.arrayBuffer()));
      const have = published && published.get(`packages/${id}/sprites/${category}/${name}.png`);
      if (!have) sprites.added.push(name); else if (have !== sha) sprites.changed.push(name);
    }
```

  Return `sprites` in the object. In `_formatDiff` add `summary` line `Sprites: ${d.sprites.added.length} new, ${d.sprites.changed.length} changed` and rows `+ sprite <n>` / `~ sprite <n>`. In `openPublishConfirm`, include `d.sprites.added.length || d.sprites.changed.length` in the `nothing` test.
- [ ] **Step 4: Run** the new test and `tests/package-publish.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): the publish diff lists new and changed sprites`.

### Task 3: Base package through the same Publish

**Files:**
- Modify: `MapEditorPro.html` (`diffAgainstServer`, `openPublishConfirm` default branch, `openPublishDialog` default branch)
- Test: `tests/unified-publish.spec.ts`

**Interfaces:**
- Produces: `diffAgainstServer('postapoc')` works (base entries have no `package` field, so the filter becomes `(x.package || 'postapoc') === id`). `openPublishConfirm('postapoc')` shows the base diff and an extra warning line `This is the base package: every player and old build reads it.`; the Publish button label is `Publish base package`.
- Consumes: `GitHubSync.publishHexDbOnly({skipManifest:true})`, `publishBuildingsDb({skipManifest:true})`, `publishAllSprites({skipManifest:true})`, `refreshBaseManifestSafely(true)`.

- [ ] **Step 1: Failing test.** `Packages.openPublishConfirm('postapoc')` with one base hex edited locally: `#dialog-details` contains `~ hex <id>` and the base warning; Cancel writes nothing; confirming writes `packages/postapoc/hex_database.json` AND the root `hex_database.json`, then one manifest/registry bump.
- [ ] **Step 2: Run.** Expected: FAIL (`openPublishConfirm` shows a bare confirm without a diff).
- [ ] **Step 3: Implement.** In `diffAgainstServer`, replace `h.package === id` / `b.package === id` with `(h.package || 'postapoc') === id` (and the same for `localBld`); sprite refs in `_packageSpriteRefs` use the same rule. Replace the `isDefault(id)` branch of `openPublishConfirm`:

```js
    if (isDefault(id)) {
      let d;
      try { d = await diffAgainstServer(id); }
      catch (e) { return UI.toast('⚠ Could not compare the base package with the server', { detail: e.message, ms: 6000 }); }
      const ok = await UI.confirm('Publish base package',
        'This is the base package: every player and old build reads it. Publish hex_database.json, building_database.json and changed sprites?',
        _formatDiff(d) + _roadWarningsText(id), 'Publish base package');
      if (!ok) return;
      const a = await GitHubSync.publishHexDbOnly({ skipManifest: true });
      const b = await GitHubSync.publishBuildingsDb({ skipManifest: true });
      const c = await GitHubSync.publishAllSprites({ skipManifest: true });
      if (a || b || c) await GitHubSync.refreshBaseManifestSafely(true);   // one version bump for all three
      return;
    }
```

  `openPublishDialog` already hands the default package to `openPublishConfirm`; leave it. Task 1 makes `publishAllSprites` skip nothing for the base (it has no manifest compare): extend it to skip by the same hash map (`_publishedHashes('postapoc')` against `packages/postapoc/sprites/<category>/<name>.png`) so a base publish does not re-upload hundreds of PNGs; keep `pushSprite` writing both copies.
- [ ] **Step 4: Run** the new test, `tests/package-manifest.spec.ts`, `tests/packages-sprites-store.spec.ts`, `tests/roads-golden.spec.ts`. Expected: PASS.
- [ ] **Step 5: Review Focus tests:** a package-only entry never appears in the base diff; base sprites unchanged are not uploaded.
- [ ] **Step 6: Commit** `feat(publish): the base package publishes through the same diff dialog`.

### Task 4: Publish Common

**Files:**
- Modify: `MapEditorPro.html` (`GitHubSync`: new `publishCommon`, export)
- Test: `tests/unified-publish.spec.ts`

**Interfaces:**
- Produces: `GitHubSync.publishCommon(): Promise<boolean>`. Builds the three payloads (`UpgDB.getJson()` -> `upgrade_database.json`, `CommonDB.export()` -> `common_settings.json`, `JSON.stringify(LocalizationKeys.getExportData(), null, 2)` -> `localization.json`), reads each server copy with `_readRepoBytes`, shows one confirm listing `changed` / `unchanged` per file, writes only the changed ones.
- Consumes: `_putText`, `_readRepoBytes`, `_withPublishBtn`, `UI.confirm`.

- [ ] **Step 1: Failing test.** Seed server `upgrade_database.json` equal to the local payload, leave `common_settings.json` different: `GitHubSync.publishCommon()` -> confirm lists `common_settings.json: changed`, `upgrade_database.json: unchanged`; after confirming `gh.putPaths()` equals `['common_settings.json']` plus any changed localization, never `upgrade_database.json`. Cancel writes nothing.
- [ ] **Step 2: Run.** Expected: FAIL (function missing).
- [ ] **Step 3: Implement.**

```js
  async function publishCommon() {
    return _withPublishBtn('Publish Common', async () => {
      const files = [
        { path: 'upgrade_database.json',  text: UpgDB.getJson() },
        { path: 'common_settings.json',   text: CommonDB.export() },
        { path: 'localization.json',      text: JSON.stringify(LocalizationKeys.getExportData(), null, 2) },
      ];
      const enc = new TextEncoder();
      for (const f of files) {
        const have = await _readRepoBytes(f.path);
        f.changed = !have || await sha256Hex(have) !== await sha256Hex(enc.encode(f.text));
      }
      const lines = files.map(f => `${f.path}: ${f.changed ? 'changed' : 'unchanged'}`).join('\n');
      const todo = files.filter(f => f.changed);
      const ok = await UI.confirm('Publish Common',
        todo.length ? `Publish ${todo.length} of 3 shared file(s)?` : 'Nothing differs from the server.', lines, todo.length ? 'Publish' : 'Close');
      if (!ok || !todo.length) return;
      let n = 0;
      for (const f of todo) {
        UI.progress(Math.round(100 * n / todo.length), `Writing ${f.path}…`);
        try { await _putText(f.path, f.text, `publish: ${f.path}`); n++; }
        catch (e) { throw new Error(`${f.path}: ${e.message}${n ? ` (${n} file(s) already written)` : ''}`); }
      }
      UI.progressDone(`✅ ${n} shared file(s) published`);
      UI.toast(`✅ Publish Common: ${todo.map(f => f.path).join(', ')}`);
    });
  }
```

  Export `publishCommon` next to `publishCommonDb`. `_putText` creates or updates the file (existing behaviour).
- [ ] **Step 4: Run** the new tests plus `tests/blddb-destroy-cost.spec.ts` (touches Common DB) and the full `tests/package-*.spec.ts`. Expected: PASS.
- [ ] **Step 5: Review Focus tests:** all three unchanged -> no write button (only Close) and no PUT; failing second PUT -> error text names the file and says one already written.
- [ ] **Step 6: Commit** `feat(publish): Publish Common writes only the changed shared files`.

### Task 5: One Publish entry and the three-button menu

**Files:**
- Modify: `MapEditorPro.html` (menu markup ~1543, `GitHubSync.publish`, export)
- Test: `tests/unified-publish.spec.ts`, any test using the removed menu items

**Interfaces:**
- Produces: `GitHubSync.publish()` = `Packages.openPublishConfirm(Packages.getActive())` behind `_withPublishBtn`-style PAT check (toast when no token). Menu: `☁ Publish` (-> `GitHubSync.publish()`), `☁ Publish Common`, separator, `☁ Publish Map`, separator, `🧹 Clean Ghost Sprites`.
- Consumes: `Packages.getActive`, `Packages.openPublishConfirm`, `publishCommon`.

- [ ] **Step 1: Failing test.** Open the `☁ Publish ▾` menu: the buttons are exactly `Publish`, `Publish Common`, `Publish Map`, `Clean Ghost Sprites` (no HexDB / Buildings DB / Sprites / Upgrade DB). Clicking `Publish` with package `difpkg` active opens the diff dialog titled `Publish Package`; with `postapoc` active it opens `Publish base package`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the menu buttons:

```html
        <button onclick="GitHubSync.publish()" title="Publish the active package: data and changed sprites">☁ Publish</button>
        <button onclick="GitHubSync.publishCommon()" title="Upgrades, Common settings and localization.json">☁ Publish Common</button>
        <div class="pub-drop-sep"></div>
        <button onclick="GitHubSync.publishMap()">☁ Publish Map</button>
        <div class="pub-drop-sep"></div>
        <button onclick="GitHubSync.cleanGhostSprites()">🧹 Clean Ghost Sprites</button>
```

  In `GitHubSync`:

```js
  async function publish() {
    if (!isPATConfigured()) { UI.toast('⚠ Open your access link first (or use ⚙ GitHub to enter token)'); return; }
    _closeDropdown();
    await Packages.openPublishConfirm(Packages.getActive());
  }
```

  Export `publish`. Run the lint `tests/dead-code.spec.ts` and `tests/docs-lint.spec.ts` (they check exports and docs); fix any reference they flag.
- [ ] **Step 4: Run** the new tests and `grep -n "pub-drop" tests/*.ts`; update any test that clicked a removed entry to call the function directly (`GitHubSync.publishHexDbOnly()`), since the functions stay exported.
- [ ] **Step 5: Commit** `feat(publish): Publish menu is Publish, Publish Common, Publish Map`.

### Task 6: Documentation, full run, hand-off

**Files:**
- Modify: `CHANGELOG.md`, the editor guides that name the old buttons (`grep -rn "Publish HexDB" docs/guides`)
- Test: full suite

- [ ] **Step 1: Docs.** CHANGELOG entry (date, `Publish`, `Publish Common`, sprite hash skip, base confirm). Replace the old button names in `docs/guides/*` (UA and EN guides and the QA guide) with the new three and regenerate the guide PDFs if they are tracked (`docs/guides/content-packages-editor-guide.pdf` is untracked now: leave it).
- [ ] **Step 2: Full run** `npx playwright test --reporter=list > /tmp/pw.log` (about 14 min). Expected: only the three known machine-dependent perf-hash failures (`perf-equivalence` zoom 25, `perf-lod` zoom 25%, `perf-overlays`), which also fail on the unmodified code.
- [ ] **Step 3: Commit** `docs: Publish / Publish Common / Publish Map in the editor guides`.
- [ ] **Step 4: Hand-off.** Tell the owner: push `dev`, then `bash deploy.sh`. QA text: change one building price in Decameroon -> Publish -> dialog shows `~ bld <id>`, `Sprites: 0 new, 0 changed` -> publish -> only the DB, `manifest.json`, `registry.json`, `package.json` change on the server (check the GitHub commit list: no sprite commits).

## Not in this plan

- Package localization layers and the `Layer` column in KEYS (stage 2, needs a new game build).
- Package upgrades `replaces` and any change to Upgrade/Settlement/Common settings ownership (stage 3, depends on spec question 8).
- Settlement DB publish (spec question 5: ask how it is published today before stage 3).
