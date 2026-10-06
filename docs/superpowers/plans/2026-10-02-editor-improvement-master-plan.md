# Map Editor Improvement Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Post Apo map editor safe with data, fast on 450x450 maps, and capable of building maps like the real game's, with a clear package workflow.

**Architecture:** Keep the single-file vanilla-JS editor (`MapEditorPro.html`). Put new pure logic in small focused files (`hex-utils.js`, `gen-utils.js`, `map-jobs.js`, `map-worker.js`, `js/*`) that are unit-testable through Playwright `page.evaluate`. Work in phases; each phase ships working software on its own.

**Tech Stack:** Vanilla JS/HTML/CSS, Canvas 2D, IndexedDB, Web Workers, Playwright (`@playwright/test`), `serve`, JSZip.

**Spec:** `docs/superpowers/plans/2026-10-02-editor-improvement-roadmap.md` (roadmap and live-run findings), plus `docs/superpowers/specs/2026-07-21-content-packages-design.md` and `docs/superpowers/specs/2026-08-06-heightmap-elevation-import-design.md`.

## Global Constraints

- Map size limits: 10..450 per side on load, 20..450 in New Map; 450x450 must stay usable.
- Hex grid: flat-top, odd-q offset; `HEX_SIZE=40`, `COL_PITCH=60`, `ROW_PITCH=69.28`; axis convention matches Unity (see `hexCenterWorld`).
- Existing shortcuts must not change: P F R E S T D Z, Ctrl+N/O/S/Z/Y, Ctrl+Shift+S, Tab, Space+drag.
- New shortcuts use `e.code` so they work under the Ukrainian layout.
- Network/GitHub behavior is tested with Playwright `page.route` mocks, never the real repository.
- Commit messages are conventional commits and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Phase 0 contracts used later: `UI.showDialog/alert/prompt/confirm`, `UI.showModal`, `Packages.loadAllPackages()`, `tests/helpers.ts` `openEditor(page)`.

## Review Focus

- Reloading the page must never lose HexDB/BldDB entries that exist only locally.
- Loading a map with unknown tile ids, missing packages or an oversize grid must say so, and must not corrupt the current map.
- Rotate/mirror of a selection on an odd-width map must keep tiles on valid hexes.
- Publishing or deleting a package must never overwrite or orphan data without an explicit, informative confirmation.
- Optimized rendering must produce the same pixels as before at every zoom level.

## Known issues found while planning (from Phase 2-3 research)

- K1: `_DIRS_EVEN/_ODD` direction tables contain non-adjacent offsets (affects Roads, EdgeTiling, Coastline); documented by a `test.fixme`, not changed by this plan.
- `_spawnSatellites` references an undefined `hexData`; placing `Farm_Test_1` throws (fixed in T2.14).
- Other K-items (K2-K7) are listed in Phase 2-3 intro.

## Decisions for the owner before the affected tasks

1. Does the game accept an off-centre city (T3.5)?
2. Real ore counts and settlement type ids for bunkers/mega cities (T3.8); `bunker`, `megacity`, `CopperVein_1`, `Uranium_1` do not exist in the repo data.
3. Fix K1 (direction tables)?
4. Does the game load non-default packages yet (Phase 5 messaging)?
5. Game map format vs editor JSON (T4.9 decision record).
6. Is the hex atlas used by the game (gates T6.6b)?
7. Playwright browsers are not installed here; T0.0 may need `channel: 'chrome'`.

## Execution order

Phase 0 -> Phase 1 -> Phase 2 -> Phase 4/5 (items 1-2 first) -> Phase 3 -> rest of Phases 4-6.

---

## Phase 0 — data safety

Goal: stop the editor from silently losing or corrupting user data (local HexDB/BldDB edits, maps, packages), and make every failure visible. Everything here is verified against `MapEditorPro.html` as of commit `efc9f5a` (line numbers drift; every anchor also has a grep-able string).

Conventions used by all tasks:
- Tests are Playwright specs in `tests/`, run with `npx playwright test tests/<file>.spec.ts`. Playwright does not type-check, so globals declared with top-level `const`/`let` in the editor (`IO`, `HexDB`, `BldDB`, `Packages`, `UI`, `GitHubSync`, `mapData`, `MAP_WIDTH`, ...) are used directly inside `page.evaluate` callbacks (they live in the global lexical scope, though not on `window`; only `window.HexDB`/`window.BldDB`/`window.LocalizationKeys` are also properties).
- No test touches real GitHub. `tests/helpers.ts` (T0.0) routes `https://fidaykin.github.io/PostApocMapEditor/**` (published site), `https://api.github.com/repos/fidaykin/PostApocMapEditor/contents/**` (Contents API) and the JSZip CDN to an in-memory `FakeGitHub` backed by the repo files on disk.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Files touched

| File | Tasks | Change |
|---|---|---|
| `package.json`, `package-lock.json`, `serve.json`, `playwright.config.ts` | T0.0 | new: test tooling, static server on port 4173 |
| `tests/helpers.ts` | T0.0 (extended T0.3) | new: `FakeGitHub`, `openEditor`, `reloadEditor`, `buildZip` |
| `tests/harness.spec.ts` | T0.0 | new: smoke test of the harness |
| `tests/dialogs.spec.ts` | T0.1 | new |
| `tests/sync-merge.spec.ts` | T0.2, T0.6 | new |
| `tests/startup-sync.spec.ts` | T0.3 | new |
| `tests/package-import.spec.ts` | T0.4, T0.5 | new |
| `tests/package-publish.spec.ts` | T0.6, T0.7 | new |
| `tests/package-delete.spec.ts` | T0.8, T0.9 | new |
| `tests/map-load-warnings.spec.ts` | T0.10 | new |
| `tests/storage-errors.spec.ts` | T0.11, T0.12 | new |
| `tests/no-native-dialogs.spec.ts` | T0.13, T0.14 | new |
| `MapEditorPro.html` | T0.1 - T0.13 | UI dialogs/toasts, `SyncMerge`, `StorageGuard`, HexDB/BldDB merge + add/remove, GitHubSync sync, Packages create/import/publish/delete/restore, IO analyze + IndexedDB autosave, startup wiring |
| `zone-painter.js` | T0.14 | replace `alert`/`prompt` |

### Task map (roadmap item to task)

| Roadmap item | Tasks |
|---|---|
| (foundation) test harness | T0.0 |
| 0.7 modals and toasts with details (primitives first, because 0.3, 0.4, 0.5 need them) | T0.1, T0.13, T0.14 |
| 0.1 startup load must not overwrite local edits | T0.2, T0.3 |
| 0.2 import ZIP loads entries into the editor | T0.4 |
| 0.3 publish safety | T0.5, T0.6, T0.7 |
| 0.4 delete package safety | T0.8, T0.9 |
| 0.5 map load warnings | T0.10 |
| 0.6 autosave errors and IndexedDB | T0.11, T0.12 |

Do the tasks in order; later tasks consume interfaces produced by earlier ones.

---

## T0.0 Test harness (Playwright + static server + fake GitHub)

**Files:**
- Create: `package.json`, `serve.json`, `playwright.config.ts`, `tests/helpers.ts`, `tests/harness.spec.ts`
- Existing, untouched: `tests/debug-modules.spec.ts` (it still passes; it hits no mocked routes and only asserts `typeof HexDB`)
- Anchors verified: `GitHubSync` constants `const BASE_URL = 'https://fidaykin.github.io/PostApocMapEditor';` and `const GH_API = ` (`MapEditorPro.html` ~4709-4715); PAT key `const PAT_KEY     = 'gh_sync_pat';`; JSZip loaded via `import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')` in `async function _loadJSZip()` (~7557); `<input type="file" id="pkg-import-input"` (~13266); startup in `window.addEventListener('load', async () => {` (~12840).

**Interfaces:**
- Produces (`tests/helpers.ts`):
  - `class FakeGitHub { puts: {path:string; text:string; message:string}[]; failPut: (path:string)=>boolean; read(path):Buffer|null; write(path, data:Buffer|string):void; setJson(path, obj):void; json<T=any>(path):T|null; sha(path):string; list(dir):any[]|null; putPaths():string[]; setRegistry(extra:{id:string;name:string;version?:string}[]):void }`
  - `installFakeGitHub(page, gh): Promise<void>`
  - `openEditor(page, opts?: { gh?: FakeGitHub; pat?: boolean; blankMap?: boolean; storage?: Record<string,string> }): Promise<{ gh: FakeGitHub; nativeDialogs: string[]; pageErrors: string[] }>`; with `blankMap` (default true) a 30x30 map is created when no autosave exists
  - `reloadEditor(page): Promise<void>`, `waitForEditor(page): Promise<void>`
  - `buildZip(files: Record<string, string|Buffer>): Promise<Buffer>`, `TINY_PNG: Buffer`
- Pattern for unit-testing pure logic: `await openEditor(page); const r = await page.evaluate(arg => SomeModule.pureFn(arg), input);`

- [ ] **Step 1: Create `package.json` and `serve.json`, install, fetch the browser**

`package.json`:
```json
{
  "name": "post-apo-map-editor",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "jszip": "^3.10.1",
    "serve": "^14.2.6"
  }
}
```
`serve.json` (stops `serve` from redirecting `/MapEditorPro.html` to `/MapEditorPro`):
```json
{ "cleanUrls": false }
```
Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npm install && npx playwright install chromium
```
Expected: `package-lock.json` created, `node_modules/jszip` present, Chromium downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', headless: true },
  webServer: {
    command: 'npx serve -l 4173 --no-clipboard --no-request-logging .',
    url: 'http://localhost:4173/zone-painter.js',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Write the failing smoke test `tests/harness.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

test('editor loads with its modules, a 30x30 map and no native dialogs', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  const info = await page.evaluate(() => ({
    hex: HexDB.getAll().length,
    bld: BldDB.getAll().length,
    w: MAP_WIDTH, h: MAP_HEIGHT, cells: mapData.length,
    io: typeof IO.loadFromJSON,
  }));
  expect(info.hex).toBeGreaterThan(50);
  expect(info.bld).toBeGreaterThan(0);
  expect([info.w, info.h, info.cells]).toEqual([30, 30, 900]);
  expect(info.io).toBe('function');
  expect(nativeDialogs).toEqual([]);
});

test('FakeGitHub serves repo files and records PUTs', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'demo', name: 'Demo' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('demo'));
  await page.evaluate(() => GitHubSync._putText('packages/demo/package.json', '{"id":"demo"}', 'test'));
  expect(gh.putPaths()).toEqual(['packages/demo/package.json']);
  expect(gh.json('packages/demo/package.json')).toEqual({ id: 'demo' });
});
```

- [ ] **Step 4: Run it and confirm it fails**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/harness.spec.ts
```
Expected: both tests fail with `Error: Cannot find module './helpers'`.

- [ ] **Step 5: Create `tests/helpers.ts`**

```ts
import { Page, Route } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const JSZip = require('jszip');

export const ROOT = path.resolve(__dirname, '..');
const PAGES_RE = /^https:\/\/fidaykin\.github\.io\/PostApocMapEditor\/(.*?)(\?.*)?$/;
const API_RE = /^https:\/\/api\.github\.com\/repos\/fidaykin\/PostApocMapEditor\/contents\/(.*?)(\?.*)?$/;
const PAGES_BASE = 'https://fidaykin.github.io/PostApocMapEditor/';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, accept',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
};

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

function mime(p: string) {
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/** In-memory stand-in for the gh-pages branch: falls back to the repo files on disk. */
export class FakeGitHub {
  private overrides = new Map<string, Buffer>();
  private shas = new Map<string, string>();
  private n = 0;
  puts: { path: string; text: string; message: string }[] = [];
  failPut: (p: string) => boolean = () => false;

  read(p: string): Buffer | null {
    if (this.overrides.has(p)) return this.overrides.get(p)!;
    const f = path.join(ROOT, p);
    return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
  }
  write(p: string, data: Buffer | string) {
    this.overrides.set(p, Buffer.from(data));
    this.shas.set(p, `sha${++this.n}`);
  }
  setJson(p: string, obj: unknown) { this.write(p, JSON.stringify(obj, null, 2)); }
  json<T = any>(p: string): T | null {
    const b = this.read(p);
    return b ? (JSON.parse(b.toString('utf8')) as T) : null;
  }
  sha(p: string) {
    if (!this.shas.has(p)) this.shas.set(p, `sha${++this.n}`);
    return this.shas.get(p)!;
  }
  list(dir: string) {
    const names = new Set<string>();
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory())
      fs.readdirSync(abs).filter(f => fs.statSync(path.join(abs, f)).isFile()).forEach(f => names.add(f));
    for (const k of this.overrides.keys())
      if (k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')) names.add(k.slice(dir.length + 1));
    if (!names.size) return null;
    return [...names].map(name => ({
      name, sha: this.sha(`${dir}/${name}`),
      size: this.read(`${dir}/${name}`)!.length,
      download_url: `${PAGES_BASE}${dir}/${name}`,
    }));
  }
  putPaths() { return this.puts.map(p => p.path); }
  /** Add (or replace) non-default packages in packages/registry.json. */
  setRegistry(extra: { id: string; name: string; version?: string }[]) {
    const reg = this.json('packages/registry.json') ?? { version: 1, packages: [] };
    reg.packages = [
      ...reg.packages.filter((p: any) => !extra.some(e => e.id === p.id)),
      ...extra.map(e => ({ isDefault: false, version: '1.0.0', ...e })),
    ];
    this.setJson('packages/registry.json', reg);
  }
}

export function jszipEsm(): string {
  const umd = fs.readFileSync(path.join(ROOT, 'node_modules/jszip/dist/jszip.min.js'), 'utf8');
  return `const module = { exports: {} }; const exports = module.exports;\n${umd}\nexport default module.exports;`;
}

export async function buildZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function installFakeGitHub(page: Page, gh: FakeGitHub) {
  // Registered first = lowest priority: anything that is not localhost fails fast.
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', headers: CORS, body: jszipEsm() }));

  await page.route(PAGES_RE, (route: Route) => {
    const p = decodeURIComponent(PAGES_RE.exec(route.request().url())![1]);
    const body = gh.read(p);
    if (!body) return route.fulfill({ status: 404, headers: CORS, body: 'not found' });
    return route.fulfill({ status: 200, contentType: mime(p), headers: CORS, body });
  });

  const json = (route: Route, status: number, obj: unknown) =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });

  await page.route(API_RE, (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(API_RE.exec(req.url())![1]);
    if (req.method() === 'GET') {
      const body = gh.read(p);
      if (body) return json(route, 200, { name: path.basename(p), path: p, sha: gh.sha(p), content: body.toString('base64') });
      const list = gh.list(p);
      return list ? json(route, 200, list) : json(route, 404, { message: 'Not Found' });
    }
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData() || '{}');
      if (gh.failPut(p)) return json(route, 500, { message: 'forced failure' });
      if (gh.read(p) !== null && b.sha !== gh.sha(p)) return json(route, 409, { message: 'sha mismatch' });
      const buf = Buffer.from(b.content, 'base64');
      gh.puts.push({ path: p, text: buf.toString('utf8'), message: b.message });
      gh.write(p, buf);
      return json(route, 200, { content: { sha: gh.sha(p) } });
    }
    return json(route, 405, { message: 'not supported by FakeGitHub' });
  });
}

export async function waitForEditor(page: Page) {
  await page.waitForFunction(() =>
    typeof HexDB !== 'undefined' && typeof mapData !== 'undefined' && !!mapData && HexDB.getAll().length > 0);
  await page.waitForLoadState('networkidle');
}

export interface OpenOptions {
  gh?: FakeGitHub;
  pat?: boolean;
  blankMap?: boolean;
  storage?: Record<string, string>;
}

export async function openEditor(page: Page, opts: OpenOptions = {}) {
  const gh = opts.gh ?? new FakeGitHub();
  const nativeDialogs: string[] = [];
  const pageErrors: string[] = [];
  page.on('dialog', d => { nativeDialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  page.on('pageerror', e => pageErrors.push(e.message));
  await installFakeGitHub(page, gh);
  const seed = { ...(opts.pat ? { gh_sync_pat: 'test-token' } : {}), ...(opts.storage ?? {}) };
  // Seed localStorage once per browser context so reloads keep whatever the test changed.
  await page.addInitScript((s: Record<string, string>) => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  await page.goto('/MapEditorPro.html');
  await waitForEditor(page);
  if (opts.blankMap !== false) {
    await page.evaluate(() => {
      if (document.getElementById('newmap-modal')!.classList.contains('open')) {
        IO.setNewMapSize(30, 30);
        IO.applyNewMap();
      }
    });
  }
  return { gh, nativeDialogs, pageErrors };
}

export async function reloadEditor(page: Page) {
  await page.reload();
  await waitForEditor(page);
}
```

- [ ] **Step 6: Run the smoke test and confirm it passes**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/harness.spec.ts
```
Expected: `2 passed`. If the first test fails on `BldDB.getAll().length`, the building file did not load through the fake Pages route; check the route regex against the URL printed by `page.on('requestfailed')`.

- [ ] **Step 7: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add package.json package-lock.json serve.json playwright.config.ts tests/helpers.ts tests/harness.spec.ts && git commit -m "$(cat <<'EOF'
test: add Playwright harness with fake GitHub routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: the harness test pins that `FakeGitHub` answers the exact URLs the editor uses (`BASE_URL` pages, `GH_API` contents with `?ref=gh-pages`) and that a PUT without the sha from a prior GET is rejected, so later tests exercise the same sha handshake as production.

---

## T0.1 Dialog and toast primitives (`UI.showDialog`, `UI.alert`, `UI.prompt`, `UI.confirm`, `UI.toast` options)

Roadmap 0.7 foundation. T0.5-T0.9 and T0.13 use these.

**Files:**
- Modify: `MapEditorPro.html`
  - CSS: after `.toast.fade-out { opacity: 0; }` (~335; grep `.toast.fade-out`)
  - `UI` module: replace `function toast(msg) {` (~6031) and add dialog functions after `function closeConfirm() {` (~5881)
  - `UI` export list: `showConfirm, closeConfirm, toast,` (~6073)
- Create: `tests/dialogs.spec.ts`

**Interfaces:**
- Produces:
  - `UI.showDialog({ title?:string, message?:string, details?:string, input?:{ value?:string, placeholder?:string, options?:string[] }, buttons?:{label:string, value:string, kind?:'primary'|'danger'|'cancel'}[] }): Promise<{ button: string|null, input: string|undefined }>`; `button` is `null` when dismissed with Escape or superseded by another dialog; default buttons are one `OK`
  - `UI.alert(title, message, details?): Promise<void>`
  - `UI.prompt(title, message, value?, options?): Promise<string|null>` (a `<select>` when `options` is given); `null` on cancel
  - `UI.confirm(title, message, details?, okLabel?): Promise<boolean>`
  - `UI.toast(msg, opts?: { detail?:string, sticky?:boolean, ms?:number }): HTMLElement`; a sticky toast stays until clicked
  - DOM ids: `#dialog-modal` (class `open` while shown), `#dialog-title`, `#dialog-msg`, `#dialog-details`, `#dialog-input`, `#dialog-actions`

- [ ] **Step 1: Write the failing test `tests/dialogs.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

test('showDialog resolves with the clicked button and the input value', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__r = UI.showDialog({
      title: 'Name it', message: 'Pick a name', details: 'line1\nline2',
      input: { value: 'abc' },
      buttons: [{ label: 'Cancel', value: 'cancel', kind: 'cancel' }, { label: 'Save', value: 'save', kind: 'primary' }],
    });
  });
  await expect(page.locator('#dialog-modal')).toHaveClass(/open/);
  await expect(page.locator('#dialog-title')).toHaveText('Name it');
  await expect(page.locator('#dialog-details')).toHaveText('line1\nline2');
  await page.fill('#dialog-input', 'xyz');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => (window as any).__r)).toEqual({ button: 'save', input: 'xyz' });
  await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
});

test('UI.prompt returns null on Escape and the select value for options', async ({ page }) => {
  await page.evaluate(() => { (window as any).__p = UI.prompt('Reskin', 'Pick', 'b', ['a', 'b', 'c']); });
  await page.locator('#dialog-input').selectOption('c');
  await page.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => (window as any).__p)).toBe('c');

  await page.evaluate(() => { (window as any).__p2 = UI.prompt('Name', 'Type', 'x'); });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__p2)).toBeNull();
});

test('UI.confirm resolves true only for OK; UI.alert resolves on OK', async ({ page }) => {
  await page.evaluate(() => { (window as any).__c = UI.confirm('Sure?', 'Really', 'detail', 'Do it'); });
  await page.getByRole('button', { name: 'Do it' }).click();
  expect(await page.evaluate(() => (window as any).__c)).toBe(true);
  await page.evaluate(() => { (window as any).__c = UI.confirm('Sure?', 'Really'); });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => (window as any).__c)).toBe(false);
  await page.evaluate(() => { (window as any).__a = UI.alert('Oops', 'It broke', 'stack'); });
  await page.getByRole('button', { name: 'OK' }).click();
  await page.evaluate(() => (window as any).__a);
});

test('toast shows detail and sticky toasts survive until clicked', async ({ page }) => {
  await page.evaluate(() => UI.toast('Saved', { detail: 'extra line', sticky: true }));
  const t = page.locator('.toast.sticky');
  await expect(t).toContainText('Saved');
  await expect(t.locator('.toast-detail')).toHaveText('extra line');
  await page.waitForTimeout(2600);
  await expect(t).toBeVisible();
  await t.click();
  await expect(t).toHaveCount(0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/dialogs.spec.ts
```
Expected: all four fail with `UI.showDialog is not a function` / `UI.prompt is not a function` (and no `.toast.sticky`).

- [ ] **Step 3: Add the CSS** (insert after the line `.toast.fade-out { opacity: 0; }`)

```css
.toast .toast-detail { display: block; margin-top: 4px; font-size: 11px; color: var(--muted); white-space: pre-wrap; max-width: 420px; }
.toast.sticky { pointer-events: auto; cursor: pointer; border-color: var(--danger); }
#dialog-details { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font: 12px/1.4 monospace; max-height: 240px; overflow: auto; white-space: pre-wrap; margin: 0 0 16px; }
#dialog-input-wrap { margin-bottom: 16px; }
#dialog-input { width: 100%; padding: 6px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
```

- [ ] **Step 4: Add the dialog functions** inside the `UI` module, directly after `function closeConfirm() { ... }` (grep `function closeConfirm`)

```js
  // ── Promise-based dialogs (replace native alert/prompt/confirm) ────
  let _dlgResolve = null;

  function _dlgEl() {
    let ov = document.getElementById('dialog-modal');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'dialog-modal';
    ov.innerHTML = `<div class="modal-box" style="max-width:560px">
      <h3 id="dialog-title"></h3>
      <p id="dialog-msg" style="white-space:pre-wrap"></p>
      <pre id="dialog-details" style="display:none"></pre>
      <div id="dialog-input-wrap" style="display:none"></div>
      <div class="modal-actions" id="dialog-actions"></div>
    </div>`;
    document.body.appendChild(ov);
    document.addEventListener('keydown', e => {
      if (!_dlgResolve) return;
      if (e.key === 'Escape') { e.stopPropagation(); _dlgClose({ button: null, input: undefined }); }
      else if (e.key === 'Enter' && e.target && e.target.id === 'dialog-input') {
        document.querySelector('#dialog-actions .btn-primary, #dialog-actions .btn-danger')?.click();
      }
    }, true);
    return ov;
  }

  function _dlgClose(result) {
    document.getElementById('dialog-modal')?.classList.remove('open');
    const r = _dlgResolve;
    _dlgResolve = null;
    if (r) r(result);
  }

  function showDialog(opts) {
    const { title = '', message = '', details = '', input = null,
            buttons = [{ label: 'OK', value: 'ok', kind: 'primary' }] } = opts;
    if (_dlgResolve) _dlgClose({ button: null, input: undefined });  // a new dialog supersedes an open one
    const ov = _dlgEl();
    ov.querySelector('#dialog-title').textContent = title;
    ov.querySelector('#dialog-msg').textContent = message;
    const det = ov.querySelector('#dialog-details');
    det.textContent = details;
    det.style.display = details ? '' : 'none';
    const wrap = ov.querySelector('#dialog-input-wrap');
    wrap.innerHTML = '';
    wrap.style.display = input ? '' : 'none';
    let field = null;
    if (input) {
      if (Array.isArray(input.options) && input.options.length) {
        field = document.createElement('select');
        input.options.forEach(o => {
          const op = document.createElement('option');
          op.value = o; op.textContent = o;
          field.appendChild(op);
        });
      } else {
        field = document.createElement('input');
        field.type = 'text';
        field.placeholder = input.placeholder || '';
      }
      field.id = 'dialog-input';
      if (input.value !== undefined) field.value = input.value;
      wrap.appendChild(field);
    }
    const actions = ov.querySelector('#dialog-actions');
    actions.innerHTML = '';
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-' + (b.kind || 'cancel');
      btn.textContent = b.label;
      btn.dataset.value = b.value;
      btn.addEventListener('click', () => _dlgClose({ button: b.value, input: field ? field.value : undefined }));
      actions.appendChild(btn);
    });
    ov.classList.add('open');
    (field || actions.querySelector('.btn-primary, .btn-danger') || actions.lastChild)?.focus();
    return new Promise(res => { _dlgResolve = res; });
  }

  async function alertDialog(title, message, details = '') {
    await showDialog({ title, message, details });
  }

  async function promptDialog(title, message, value = '', options = null) {
    const r = await showDialog({
      title, message, input: { value, options },
      buttons: [{ label: 'Cancel', value: 'cancel', kind: 'cancel' }, { label: 'OK', value: 'ok', kind: 'primary' }],
    });
    return r.button === 'ok' ? r.input : null;
  }

  async function confirmDialog(title, message, details = '', okLabel = 'OK') {
    const r = await showDialog({
      title, message, details,
      buttons: [{ label: 'Cancel', value: 'cancel', kind: 'cancel' }, { label: okLabel, value: 'ok', kind: 'primary' }],
    });
    return r.button === 'ok';
  }
```

- [ ] **Step 5: Replace `toast` and extend the export list**

Replace the whole function `function toast(msg) { ... }` (grep `function toast(msg)`) with:
```js
  function toast(msg, opts = {}) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.sticky ? ' sticky' : '');
    el.textContent = msg;
    if (opts.detail) {
      const d = document.createElement('span');
      d.className = 'toast-detail';
      d.textContent = opts.detail;
      el.appendChild(d);
    }
    container.appendChild(el);
    const dismiss = () => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 400); };
    if (opts.sticky) el.addEventListener('click', dismiss);
    else setTimeout(dismiss, opts.ms || 2000);
    return el;
  }
```
In the `UI` return object change `showConfirm, closeConfirm, toast,` to:
```js
    showConfirm, closeConfirm, toast,
    showDialog, alert: alertDialog, prompt: promptDialog, confirm: confirmDialog,
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/dialogs.spec.ts tests/harness.spec.ts
```
Expected: `6 passed`.

- [ ] **Step 7: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/dialogs.spec.ts && git commit -m "$(cat <<'EOF'
feat(ui): promise-based dialogs and detailed toasts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: Escape on a prompt resolves `null` (not `''`), and opening a second dialog resolves the first as dismissed instead of leaving a dangling promise.

---

## T0.2 `SyncMerge.merge3` (pure 3-way merge by package+id)

Roadmap 0.1, part 1: the pure logic, tested in isolation.

**Files:**
- Modify: `MapEditorPro.html`: insert a new module immediately above the banner comment `// GITHUB SYNC — GitHub API publish + remote HexDB load` (~4706-4708, directly after `SpriteStore`'s closing `})();`)
- Create: `tests/sync-merge.spec.ts`

**Interfaces:**
- Produces (global `SyncMerge`):
  - `same(a, b): boolean` (deep equality ignoring object key order)
  - `keyOf(entry): string` = `` `${entry.package || 'postapoc'}::${entry.id}` ``
  - `merge3(local: Entry[], server: Entry[], base: Entry[]|null): { merged: Entry[], conflicts: string[], fromServer: number, kept: number, dropped: number }`
    - rules per key: both present and equal: keep; local equals base: take server; otherwise keep local and push key into `conflicts`; server-only: add unless base equals server (deleted locally); local-only: keep unless base equals local (deleted on server). `base === null` means "never synced": every differing local entry is kept.
    - `merged` order: server entries first (server order), then local-only entries.
  - `loadBase(kind: 'hex'|'bld'): Record<string, Entry[]>` and `saveBase(kind, pkgId, entries): boolean`, stored in `localStorage` key `sync_base_<kind>`

- [ ] **Step 1: Write the failing test `tests/sync-merge.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

const merge = (page: any, local: any[], server: any[], base: any[] | null) =>
  page.evaluate(([l, s, b]: any) => SyncMerge.merge3(l, s, b), [local, server, base]);

test('an entry untouched locally takes the server update', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 1 }], [{ id: 'A', v: 2 }], [{ id: 'A', v: 1 }]);
  expect(r.merged).toEqual([{ id: 'A', v: 2 }]);
  expect(r.conflicts).toEqual([]);
  expect(r.fromServer).toBe(1);
});

test('a locally edited entry is kept and reported', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 9 }], [{ id: 'A', v: 2 }], [{ id: 'A', v: 1 }]);
  expect(r.merged).toEqual([{ id: 'A', v: 9 }]);
  expect(r.conflicts).toEqual(['postapoc::A']);
  expect(r.kept).toBe(1);
});

test('without a base every differing local entry is kept', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 1 }, { id: 'B', v: 5 }], [{ id: 'A', v: 2 }, { id: 'B', v: 5 }], null);
  expect(r.merged).toEqual([{ id: 'A', v: 1 }, { id: 'B', v: 5 }]);
  expect(r.conflicts).toEqual(['postapoc::A']);
});

test('server-only entries are added after local-only ones are preserved; server order first', async ({ page }) => {
  const r = await merge(page, [{ id: 'L', v: 1 }], [{ id: 'S', v: 1 }], [{ id: 'X', v: 0 }]);
  expect(r.merged.map((e: any) => e.id)).toEqual(['S', 'L']);
});

test('deletions: local delete sticks, unedited server delete applies, edited server delete is kept', async ({ page }) => {
  const base = [{ id: 'A', v: 1 }, { id: 'B', v: 1 }, { id: 'C', v: 1 }];
  const local = [{ id: 'B', v: 1 }, { id: 'C', v: 7 }];            // A deleted locally, C edited locally
  const server = [{ id: 'A', v: 1 }];                               // B and C deleted on the server
  const r = await merge(page, local, server, base);
  expect(r.merged).toEqual([{ id: 'C', v: 7 }]);                    // A stays deleted, B dropped, C kept
  expect(r.dropped).toBe(2);
});

test('same id in different packages are different entries (reskins)', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', package: 'skin', v: 1 }], [{ id: 'A', v: 1 }], null);
  expect(r.merged.length).toBe(2);
  expect(r.conflicts).toEqual([]);
});

test('key order does not matter for equality', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', a: 1, b: { x: 1, y: 2 } }], [{ b: { y: 2, x: 1 }, a: 1, id: 'A' }], null);
  expect(r.conflicts).toEqual([]);
});

test('saveBase/loadBase keep packages side by side', async ({ page }) => {
  const out = await page.evaluate(() => {
    SyncMerge.saveBase('hex', 'p1', [{ id: 'A' }]);
    SyncMerge.saveBase('hex', 'p2', [{ id: 'B' }]);
    return SyncMerge.loadBase('hex');
  });
  expect(out).toEqual({ p1: [{ id: 'A' }], p2: [{ id: 'B' }] });
});
```
Note: the fourth test name documents the ordering contract; the assertion is the ordering.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/sync-merge.spec.ts
```
Expected: 8 failures, `SyncMerge is not defined`.

- [ ] **Step 3: Insert the module** above the `GITHUB SYNC` banner

```js
// ════════════════════════════════════════════════════════════
// SYNC MERGE — 3-way merge of local DB entries with the server copy
// ════════════════════════════════════════════════════════════
const SyncMerge = (() => {
  function _canon(v) {
    if (Array.isArray(v)) return '[' + v.map(_canon).join(',') + ']';
    if (v && typeof v === 'object')
      return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const same = (a, b) => _canon(a) === _canon(b);
  const keyOf = e => `${e.package || 'postapoc'}::${e.id}`;

  function _index(list) {
    const m = new Map();
    (list || []).forEach(e => { if (e && e.id) m.set(keyOf(e), e); });
    return m;
  }

  // local / server / base are entry arrays for ONE package. base = the server copy stored at the
  // previous sync (null if this browser never synced). Local edits are never overwritten.
  function merge3(local, server, base) {
    const L = _index(local), S = _index(server), B = base ? _index(base) : null;
    const merged = [], conflicts = [];
    let fromServer = 0, kept = 0, dropped = 0;
    for (const [k, s] of S) {
      const l = L.get(k), b = B ? B.get(k) : undefined;
      if (!l) {
        if (b && same(s, b)) { dropped++; continue; }     // deleted locally, unchanged on server: stay deleted
        merged.push(s); fromServer++; continue;
      }
      if (same(l, s)) { merged.push(l); continue; }
      if (b && same(l, b)) { merged.push(s); fromServer++; continue; }  // untouched locally: take server
      merged.push(l); kept++; conflicts.push(k);                        // edited locally: keep local
    }
    for (const [k, l] of L) {
      if (S.has(k)) continue;
      const b = B ? B.get(k) : undefined;
      if (b && same(l, b)) { dropped++; continue; }       // removed on server, untouched locally
      merged.push(l);                                      // local-only or edited: keep
    }
    return { merged, conflicts, fromServer, kept, dropped };
  }

  const _baseKey = kind => `sync_base_${kind}`;

  function loadBase(kind) {
    try { return JSON.parse(localStorage.getItem(_baseKey(kind)) || '{}') || {}; }
    catch (e) { return {}; }
  }

  // Failing to store the base is safe: the next sync sees base = null and keeps every local entry.
  function saveBase(kind, pkgId, entries) {
    const all = loadBase(kind);
    all[pkgId] = entries;
    try { localStorage.setItem(_baseKey(kind), JSON.stringify(all)); return true; }
    catch (e) { console.warn('[sync] could not store merge base:', e.message); return false; }
  }

  return { same, keyOf, merge3, loadBase, saveBase };
})();

```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/sync-merge.spec.ts
```
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/sync-merge.spec.ts && git commit -m "$(cat <<'EOF'
feat(sync): add SyncMerge three-way merge for DB entries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: the "edited locally AND changed on server" and the "no base" cases both keep the local entry; this is the data-safety direction, at the cost that an unedited stale entry in a profile that never stored a base stays stale until the user resets it.

---

## T0.3 Startup sync merges instead of overwriting (all registry packages)

Roadmap 0.1, part 2. Fixes the reproduced bug: `HexDB.add()` saves to `hexdb_autosave`, then the startup `GitHubSync.loadHexDbIntoEditor()` calls `HexDB.loadFromObject(data)` which replaces `_data`.

**Files:**
- Modify: `MapEditorPro.html`
  - `HexDB`: `function _migrateCategoryFromType() {` (~9023): add parameter; add `_migrateAll` right after it; add `mergeFromServer` before `function getData() { return _data; }` (~10135); add to the export `return { init, add, addReskin, promptReskin, ...` (~10324)
  - `BldDB`: add `mergeFromServer` after `function getAll() { return _data.buildings || []; }` (~11543); add to export `return { init, add, addReskin, promptReskin, _updateReskinButtonVisibility,` (~11545)
  - `GitHubSync`: add `_fetchPublishedJson` and `syncContentFromServer` after `async function loadUpgradeDbFromServer() {...}` (before `// ── Maps popover`, ~5201); export list line `loadHexDbIntoEditor, loadLocFromServer, loadBuildingDbFromServer, loadUpgradeDbFromServer,` (~5364)
  - Startup: the block starting `// Always fetch all DBs from server in background` / `(async () => {` (~12877-12882)
- Modify: `tests/helpers.ts` (`waitForEditor`)
- Create: `tests/startup-sync.spec.ts`

**Interfaces:**
- Consumes: `SyncMerge.merge3/loadBase/saveBase/same` (T0.2); `UI.toast(msg, {ms, sticky, detail})` (T0.1).
- Produces:
  - `HexDB.mergeFromServer(pkgId: string, serverData: {hexes: Entry[], common?, dbVersion?}): { pkgId, conflicts: string[], fromServer: number, kept: number, dropped: number }` (throws if `hexes` is not an array)
  - `BldDB.mergeFromServer(pkgId, serverData: {buildings: Entry[]})`: same return shape
  - `GitHubSync.syncContentFromServer(): Promise<{ packages: string[], conflicts: string[], failed: string[] }>`; conflicts are strings like `hex postapoc::Plain_2`
  - `window.__startupSyncDone: Promise<void>` and `window.__lastSyncSummary` (the summary above), set by the load handler

- [ ] **Step 1: Write the failing test `tests/startup-sync.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub } from './helpers';

test('a hex added locally survives a reload (the reproduced bug)', async ({ page }) => {
  await openEditor(page);
  const before = await page.evaluate(() => { HexDB.add(); BldDB.add(); return [HexDB.getAll().length, BldDB.getAll().length]; });
  await reloadEditor(page);
  const after = await page.evaluate(() => [HexDB.getAll().length, BldDB.getAll().length,
    HexDB.getAll().some(h => /^NewHex_/.test(h.id)), BldDB.getAll().some(b => /^NewBuild_/.test(b.id))]);
  expect(after).toEqual([before[0], before[1], true, true]);
});

test('a local edit of a server entry survives a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    HexDB.getData().hexes.find(h => h.id === 'Plain_2').effects = 'LOCAL_EDIT';
    localStorage.setItem('hexdb_autosave', JSON.stringify(HexDB.getData()));
  });
  await reloadEditor(page);
  const effects = await page.evaluate(() => HexDB.getAll().find(h => h.id === 'Plain_2').effects);
  expect(effects).toBe('LOCAL_EDIT');
  const sum = await page.evaluate(() => window.__lastSyncSummary);
  expect(sum.conflicts).toContain('hex postapoc::Plain_2');
});

test('a server update to an entry the user never touched is applied', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh });
  const db = gh.json('packages/postapoc/hex_database.json');
  db.hexes.find((h: any) => h.id === 'Plain_2').effects = 'SERVER_NEW';
  gh.setJson('packages/postapoc/hex_database.json', db);
  await reloadEditor(page);
  expect(await page.evaluate(() => HexDB.getAll().find(h => h.id === 'Plain_2').effects)).toBe('SERVER_NEW');
});

test('entries of every registry package are merged; a package without files is not an error', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'extra', name: 'Extra' }, { id: 'empty', name: 'Empty' }]);
  gh.setJson('packages/extra/hex_database.json', { version: 1, package: 'extra', hexes: [{ id: 'Extra_Hex_1', package: 'extra', spriteName: 'Extra_Hex_1', type: 'Plains' }] });
  gh.setJson('packages/extra/building_database.json', { version: 1, package: 'extra', buildings: [{ id: 'Extra_Bld_1', package: 'extra', spriteName: 'Extra_Bld_1' }] });
  await openEditor(page, { gh });
  const r = await page.evaluate(() => ({
    hex: HexDB.getAll().find(h => h.id === 'Extra_Hex_1'),
    bld: BldDB.getAll().find(b => b.id === 'Extra_Bld_1'),
    sum: window.__lastSyncSummary,
  }));
  expect(r.hex.package).toBe('extra');
  expect(r.bld.package).toBe('extra');
  expect(r.sum.packages).toEqual(['postapoc', 'extra', 'empty']);
  expect(r.sum.failed).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/startup-sync.spec.ts
```
Expected: test 1 fails (`after[2]` is `false`: `NewHex_` missing after reload); tests 2-4 fail (`window.__lastSyncSummary` undefined / effects reverted).

- [ ] **Step 3: HexDB, make the migrations reusable**

Replace the head of `_migrateCategoryFromType` (grep `function _migrateCategoryFromType`):
```js
  function _migrateCategoryFromType(hexes = _data.hexes) {
    const knownCategories = new Set(Object.values(TYPE_TO_CATEGORY));
    hexes.forEach(h => {
```
(the old lines were `function _migrateCategoryFromType() {` and `_data.hexes.forEach(h => {`; the body below stays unchanged). Directly after the function's closing brace add:
```js
  // Same pipeline loadFromObject/load run, but on any array (used on a clone of server data so it
  // can be compared with already-migrated local entries).
  function _migrateAll(hexes) {
    _migrateHexTypes(hexes);
    _migrateDestroyFields(hexes);
    _migrateBuildFields(hexes);
    _migrateIncomeFields(hexes);
    _migrateSpecialFields(hexes);
    _migrateCategoryFromType(hexes);
  }
```

- [ ] **Step 4: HexDB, add `mergeFromServer`** (insert before `function getData() { return _data; }`)

```js
  // Merges one package's published hex file into the local data without discarding local edits
  // (3-way by package+id against the copy stored at the previous sync, see SyncMerge.merge3).
  function mergeFromServer(pkgId, serverData) {
    if (!serverData || !Array.isArray(serverData.hexes)) throw new Error('hex_database.json has no hexes array');
    const incoming = structuredClone(serverData.hexes)
      .filter(h => !/^River_bridge_/i.test(h.spriteName || '') && !/^River_bridge_/i.test(h.id || ''));
    if (pkgId !== 'postapoc') incoming.forEach(h => { if (!h.package) h.package = pkgId; });
    _migrateAll(incoming);
    const inPkg = h => (h.package || 'postapoc') === pkgId;
    const base = SyncMerge.loadBase('hex')[pkgId] || null;
    const res = SyncMerge.merge3(_data.hexes.filter(inPkg), incoming, base);
    const others = _data.hexes.filter(h => !inPkg(h));
    _data.hexes = pkgId === 'postapoc' ? [...res.merged, ...others] : [...others, ...res.merged];
    if (pkgId === 'postapoc') {
      if (serverData.common && SyncMerge.same(_data.common, { goldPerTap: 10 })) _data.common = serverData.common;
      _data.dbVersion = Math.max(_data.dbVersion || 0, serverData.dbVersion || 0);
      _syncCommonUI();
    }
    SyncMerge.saveBase('hex', pkgId, incoming);
    _autoSave();
    _selFilt = -1;
    _applyFilter(); _buildList();
    Terrain.applyHexDbOverrides(_data.hexes).then(() => {
      UI.buildPalette();
      Canvas.render();
    });
    return { pkgId, conflicts: res.conflicts, fromServer: res.fromServer, kept: res.kept, dropped: res.dropped };
  }

```
In the export line `return { init, add, addReskin, promptReskin, _updateReskinButtonVisibility, deleteSelected, copy, paste, migrateToBuilding, load, loadFromObject, getData, ...` add `mergeFromServer,` after `loadFromObject,`.

- [ ] **Step 5: BldDB, add `mergeFromServer`** (insert after `function getAll() { return _data.buildings || []; }`)

```js
  function mergeFromServer(pkgId, serverData) {
    if (!serverData || !Array.isArray(serverData.buildings)) throw new Error('building_database.json has no buildings array');
    const incoming = structuredClone(serverData.buildings);
    if (pkgId !== 'postapoc') incoming.forEach(b => { if (!b.package) b.package = pkgId; });
    incoming.forEach(_migrate);
    const inPkg = b => (b.package || 'postapoc') === pkgId;
    const base = SyncMerge.loadBase('bld')[pkgId] || null;
    const res = SyncMerge.merge3(_data.buildings.filter(inPkg), incoming, base);
    const others = _data.buildings.filter(b => !inPkg(b));
    _data.buildings = pkgId === 'postapoc' ? [...res.merged, ...others] : [...others, ...res.merged];
    SyncMerge.saveBase('bld', pkgId, incoming);
    _autoSave();
    _selFilt = -1;
    _applyFilter(); _buildList();
    UI.buildPalette();
    return { pkgId, conflicts: res.conflicts, fromServer: res.fromServer, kept: res.kept, dropped: res.dropped };
  }
```
In the BldDB `return { init, add, addReskin, promptReskin, _updateReskinButtonVisibility,` list add `mergeFromServer,` on the next line before `pushRecord`.

- [ ] **Step 6: GitHubSync, add the sync function** (insert before `// ── Maps popover`)

```js
  // JSON from the published site; null on 404 (a brand-new package has no database files yet).
  async function _fetchPublishedJson(path) {
    const res = await fetch(`${BASE_URL}/${path}?_=${Date.now()}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  // Startup sync: merge every registry package's hex + building files into the local DBs.
  // Local edits win; nothing is replaced wholesale (see SyncMerge.merge3).
  async function syncContentFromServer() {
    const summary = { packages: [], conflicts: [], failed: [] };
    let ids = ['postapoc'];
    try {
      const reg = await _fetchPublishedJson('packages/registry.json');
      if (reg && Array.isArray(reg.packages))
        ids = [...new Set(['postapoc', ...reg.packages.map(p => p.id).filter(Boolean)])];
    } catch (e) { summary.failed.push(`registry.json: ${e.message}`); }
    for (const id of ids) {
      try {
        const hexData = await _fetchPublishedJson(`packages/${id}/hex_database.json`);
        if (hexData) {
          const r = HexDB.mergeFromServer(id, hexData);
          summary.conflicts.push(...r.conflicts.map(k => `hex ${k}`));
        } else if (id === 'postapoc') {
          summary.failed.push('postapoc/hex_database.json: not found');
        }
      } catch (e) { summary.failed.push(`${id}/hex_database.json: ${e.message}`); }
      try {
        const bldData = await _fetchPublishedJson(`packages/${id}/building_database.json`);
        const usable = bldData && Array.isArray(bldData.buildings) && (id !== 'postapoc' || bldData.buildings.length > 0);
        if (usable) {
          const r = BldDB.mergeFromServer(id, bldData);
          summary.conflicts.push(...r.conflicts.map(k => `bld ${k}`));
        }
      } catch (e) { summary.failed.push(`${id}/building_database.json: ${e.message}`); }
      summary.packages.push(id);
    }
    return summary;
  }

```
In the `GitHubSync` return object change `loadHexDbIntoEditor, loadLocFromServer, loadBuildingDbFromServer, loadUpgradeDbFromServer,` to
`loadHexDbIntoEditor, loadLocFromServer, loadBuildingDbFromServer, loadUpgradeDbFromServer, syncContentFromServer,`. The old `loadHexDbIntoEditor` stays: it is the explicit "Load Hex DB from server" menu action (`<button onclick="GitHubSync.loadHexDbIntoEditor()">`) and keeps its replace semantics.

- [ ] **Step 7: Startup wiring**

Replace (grep `// Always fetch all DBs from server in background`):
```js
  // Always fetch all DBs from server in background so the editor stays in sync with gh-pages.
  // LocalStorage copy is loaded first (instant), then overwritten with the server version.
  (async () => {
    try { await GitHubSync.loadHexDbIntoEditor();      } catch(e) { console.warn('[init] hex_database.json fetch failed:', e.message); }
    try { await GitHubSync.loadBuildingDbFromServer(); } catch(e) { console.warn('[init] building_database.json fetch failed:', e.message); }
    try { await GitHubSync.loadUpgradeDbFromServer();  } catch(e) { console.warn('[init] upgrade_database.json fetch failed:', e.message); }
```
with
```js
  // Background sync with gh-pages. The localStorage copy is loaded first (instant); the server
  // version is MERGED into it: local edits are kept, untouched entries take server updates.
  window.__startupSyncDone = (async () => {
    try {
      const sync = await GitHubSync.syncContentFromServer();
      window.__lastSyncSummary = sync;
      if (sync.conflicts.length) {
        console.info('[sync] local edits kept over differing server versions:', sync.conflicts);
        UI.toast(`Kept ${sync.conflicts.length} local edit(s) that differ from the server`,
                 { ms: 6000, detail: sync.conflicts.slice(0, 5).join('\n') });
      }
      if (sync.failed.length) {
        console.warn('[sync] failed:', sync.failed);
        UI.toast('Could not load some content from the server', { ms: 6000, detail: sync.failed.join('\n') });
      }
    } catch(e) { console.warn('[init] content sync failed:', e.message); }
    try { await GitHubSync.loadUpgradeDbFromServer();  } catch(e) { console.warn('[init] upgrade_database.json fetch failed:', e.message); }
```
The remainder of the IIFE (building sprite overrides, `Canvas.render();`, `})();`) is unchanged.

- [ ] **Step 8: Make the helper wait for the sync**

In `tests/helpers.ts` replace the body of `waitForEditor` with:
```ts
export async function waitForEditor(page: Page) {
  await page.waitForFunction(() =>
    typeof HexDB !== 'undefined' && typeof mapData !== 'undefined' && !!mapData && HexDB.getAll().length > 0);
  await page.waitForFunction(() => !!(window as any).__startupSyncDone);
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForLoadState('networkidle');
}
```

- [ ] **Step 9: Run the tests**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/startup-sync.spec.ts tests/harness.spec.ts tests/dialogs.spec.ts
```
Expected: all pass (`4 + 2 + 4`). If test 2 shows `effects` reverted to `''`, check that `HexDB.init` ran before the sync (it does: `HexDB.init()` precedes the IIFE) and that `sync_base_hex` was stored on the first load (`localStorage.getItem('sync_base_hex')` in the console).

- [ ] **Step 10: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/helpers.ts tests/startup-sync.spec.ts && git commit -m "$(cat <<'EOF'
fix(sync): merge server DBs into local edits on startup instead of replacing them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: reload with a locally edited `Plain_2` (changed after the first sync stored the base) keeps the edit and lists `hex postapoc::Plain_2` in the summary; a registry package with no files (`empty`) is neither merged nor reported as failed.

---

## T0.4 Import ZIP loads the imported entries (and sprites) into the editor

Roadmap 0.2. `Packages.confirmImport` currently only writes to GitHub; the editor never sees the entries until a reload (and, before T0.3, not even then).

**Files:**
- Modify: `MapEditorPro.html`
  - `HexDB`: add `addEntries` before `function getData() { return _data; }`; export it in the `return { init, add, addReskin, ...` list
  - `BldDB`: add `addEntries` after `function getAll() { return _data.buildings || []; }`; export it
  - `Packages`: `async function confirmImport() {` (~8010): sprite loop and success block; add `_blobToDataUrl` just above `confirmImport`
- Create: `tests/package-import.spec.ts`

**Interfaces:**
- Consumes: `HexDB._migrateAll` (private, T0.3), `BldDB._migrate` (existing private), `SpriteStore.save(name, dataUrl, category)` (existing), `Terrain.registerUploadedUrls({name: dataUrl})` (existing), `buildZip`, `TINY_PNG` (T0.0).
- Produces:
  - `HexDB.addEntries(entries: Entry[]): number` and `BldDB.addEntries(entries: Entry[]): number`: migrate clones, replace entries with the same package+id, append the rest, autosave, refresh list/palette; return the count
  - `Packages._blobToDataUrl(blob): Promise<string>` is private (not exported)

- [ ] **Step 1: Write the failing test `tests/package-import.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor, buildZip, TINY_PNG } from './helpers';

async function zipFor(id: string, name: string) {
  const prefix = id.charAt(0).toUpperCase() + id.slice(1) + '_';
  return buildZip({
    'package.json': JSON.stringify({ id, name, version: '1.0.0' }),
    'hex_database.json': JSON.stringify({ version: 1, package: id, hexes: [{ id: `${prefix}Hex_1`, package: id, spriteName: `${prefix}Hex_1`, type: 'Plains' }] }),
    'building_database.json': JSON.stringify({ version: 1, package: id, buildings: [{ id: `${prefix}Bld_1`, package: id, spriteName: `${prefix}Bld_1` }] }),
    'sprites/hex/' + prefix + 'Hex_1.png': TINY_PNG,
  });
}

async function pickZip(page: any, buf: Buffer) {
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
}

test('importing a ZIP puts its hexes, buildings and sprites into the editor', async ({ page }) => {
  await openEditor(page, { pat: true });
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Zipimp_Hex_1' && h.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(() => BldDB.getAll().some(b => b.id === 'Zipimp_Bld_1' && b.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(async () => (await SpriteStore.loadAll()).some(s => s.name === 'Zipmod_Hex_1' && s.category === 'hex'))).toBe(true);
  expect(await page.evaluate(() => typeof Terrain.getUploadedUrl('Zipmod_Hex_1'))).toBe('string');
});
```
Why the sprite name stays `Zipmod_Hex_1`: `_rewriteEntries` rewrites ids, not `spriteName`, and the ZIP file name is the sprite name; the test pins that the local sprite is keyed by that name.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-import.spec.ts
```
Expected: fails at `expect.poll(...)`: `Expected: true, Received: false` (entries never appear).

- [ ] **Step 3: Add `addEntries` to HexDB** (before `function getData() { return _data; }`) and BldDB

HexDB:
```js
  // Appends entries (e.g. from an imported package); an entry with the same package+id is replaced.
  function addEntries(entries) {
    const keyOf = h => `${h.package || 'postapoc'}::${h.id}`;
    const incoming = structuredClone(entries || []);
    _migrateAll(incoming);
    const keys = new Set(incoming.map(keyOf));
    _data.hexes = [..._data.hexes.filter(h => !keys.has(keyOf(h))), ...incoming];
    _autoSave();
    _selFilt = -1;
    _applyFilter(); _buildList();
    Terrain.applyHexDbOverrides(incoming).then(() => {
      UI.buildPalette();
      Canvas.render();
    });
    return incoming.length;
  }
```
Add `addEntries,` to the HexDB export after `mergeFromServer,`.

BldDB (after `getAll`):
```js
  function addEntries(entries) {
    const keyOf = b => `${b.package || 'postapoc'}::${b.id}`;
    const incoming = structuredClone(entries || []);
    incoming.forEach(_migrate);
    const keys = new Set(incoming.map(keyOf));
    _data.buildings = [..._data.buildings.filter(b => !keys.has(keyOf(b))), ...incoming];
    _autoSave();
    _selFilt = -1;
    _applyFilter(); _buildList();
    UI.buildPalette();
    return incoming.length;
  }
```
Add `addEntries,` to the BldDB export list after `mergeFromServer,`.

- [ ] **Step 4: Packages, register sprites locally and load entries**

Add above `async function confirmImport() {`:
```js
  function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(new Blob([blob], { type: 'image/png' }));
    });
  }

```
In `confirmImport`, declare before the sprite loop (right after `let done = 0;`):
```js
      const localSprites = {};   // name -> dataUrl, so imported tiles render before any publish round-trip
```
Inside the loop's `try`, replace
```js
          const blob = await file.async('blob');
          await GitHubSync._putBinary(destPath, blob, `import ${newId}: ${path}`);
```
with
```js
          const blob = await file.async('blob');
          const m = /^sprites\/(hex|buildings)\/(.+)\.png$/i.exec(path);
          if (m) {
            const dataUrl = await _blobToDataUrl(blob);
            await SpriteStore.save(m[2], dataUrl, m[1].toLowerCase());
            localSprites[m[2]] = dataUrl;
          }
          await GitHubSync._putBinary(destPath, blob, `import ${newId}: ${path}`);
```
Replace the success lines
```js
      UI.progressDone(`✅ Package '${name}' imported`);
      UI.toast(`✅ Package '${name}' imported`);
```
with
```js
      Terrain.registerUploadedUrls(localSprites);
      const addedHex = HexDB.addEntries(hexes);
      const addedBld = BldDB.addEntries(buildings);
      UI.progressDone(`✅ Package '${name}' imported`);
      UI.toast(`✅ Package '${name}' imported (${addedHex} hex tiles, ${addedBld} buildings loaded)`);
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-import.spec.ts tests/startup-sync.spec.ts
```
Expected: all pass. The startup-sync tests guard that `addEntries`/export edits did not break the merge.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/package-import.spec.ts && git commit -m "$(cat <<'EOF'
feat(packages): load imported ZIP entries and sprites into the editor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: the id rewrite (`zipmod` to `zipimp`) yields `Zipimp_Hex_1` with `package: 'zipimp'` in HexDB while the sprite stays keyed by its original file name `Zipmod_Hex_1`.

---

## T0.5 Refuse a package id that already exists on the server

Roadmap 0.3, part 1. `createPackage` and `confirmImport` only check the local registry cache (`getEntry`), which can be stale, so they can overwrite another person's `packages/<id>/` files.

**Files:**
- Modify: `MapEditorPro.html`, `Packages`: add `_serverHasPackage` above `async function createPackage() {` (~7711); guard inside `createPackage` (after the `if (getEntry(rawId)) {...}` block, before `closeNewModal();`) and inside `confirmImport` (after the `if (getEntry(newId)) {...}` block, before `if (_importInProgress) return;`)
- Modify: `tests/package-import.spec.ts` (append)

**Interfaces:**
- Produces: `Packages._serverHasPackage(id): Promise<boolean>` (private; true if the live `registry.json` lists the id or `packages/<id>/package.json` exists). Network errors count as "not found" (the later PUT would fail anyway).
- Error text (stable, asserted): `Package "<id>" already exists on the server. Pick another id.` shown in `#pkg-new-error` / `#pkg-import-error`.

- [ ] **Step 1: Append failing tests to `tests/package-import.spec.ts`**

```ts
import { FakeGitHub } from './helpers';

function seedTaken(gh: FakeGitHub) {
  // exists on the server but is NOT in the registry (e.g. removed from it earlier, or a stale local cache)
  gh.setJson('packages/taken/package.json', { id: 'taken', name: 'Taken', version: '3.0.0' });
}

test('New Package refuses an id whose folder already exists on the server', async ({ page }) => {
  const gh = new FakeGitHub();
  seedTaken(gh);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Taken Again');
  await page.fill('#pkg-new-id', 'taken');
  await page.evaluate(() => Packages.createPackage());
  await expect(page.locator('#pkg-new-error')).toHaveText('Package "taken" already exists on the server. Pick another id.');
  expect(gh.putPaths()).toEqual([]);
});

test('New Package still works for a free id', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Fresh');
  await page.fill('#pkg-new-id', 'fresh');
  await page.evaluate(() => Packages.createPackage());
  await expect.poll(() => gh.putPaths()).toContain('packages/fresh/package.json');
});

test('Import refuses an id that already exists on the server', async ({ page }) => {
  const gh = new FakeGitHub();
  seedTaken(gh);
  await openEditor(page, { gh, pat: true });
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'taken');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('#pkg-import-error')).toHaveText('Package "taken" already exists on the server. Pick another id.');
  expect(gh.putPaths()).toEqual([]);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-import.spec.ts -g "server"
```
Expected: the refuse tests fail (`#pkg-new-error` hidden / `gh.putPaths()` contains `packages/taken/package.json`); "free id" passes.

- [ ] **Step 3: Implement**

Add above `async function createPackage() {`:
```js
  // The local registry cache can be stale or miss a package someone else published,
  // so ask the server before writing into packages/<id>/.
  async function _serverHasPackage(id) {
    try {
      const reg = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
      if (reg.ok) {
        const d = await reg.json();
        if ((d.packages || []).some(p => p.id === id)) return true;
      }
    } catch(e) { /* offline: fall through to the file probe */ }
    try {
      const r = await fetch(`${BASE_URL}/packages/${id}/package.json?_=${Date.now()}`);
      return r.ok;
    } catch(e) { return false; }
  }

```
In `createPackage`, after the `if (getEntry(rawId)) { ... }` block insert:
```js
    if (await _serverHasPackage(rawId)) {
      errEl.textContent = `Package "${rawId}" already exists on the server. Pick another id.`;
      errEl.style.display = 'block'; return;
    }
```
In `confirmImport`, after the `if (getEntry(newId)) { ... }` block insert:
```js
    if (await _serverHasPackage(newId)) {
      errEl.textContent = `Package "${newId}" already exists on the server. Pick another id.`;
      errEl.style.display = 'block'; return;
    }
```

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-import.spec.ts
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/package-import.spec.ts && git commit -m "$(cat <<'EOF'
fix(packages): refuse creating or importing a package id that exists on the server

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: the id exists as a folder but is absent from the registry (a package deleted from the registry earlier): refused, with no PUT at all.

---

## T0.6 Publish shows a diff against the server before writing

Roadmap 0.3, part 2.

**Files:**
- Modify: `MapEditorPro.html`
  - `SyncMerge`: add `diff`, update its `return { same, keyOf, merge3, loadBase, saveBase };`
  - `HexDB` / `BldDB`: add `migrateCopy` and export it (same spots as T0.3/T0.4 exports)
  - `Packages`: replace `function openPublishConfirm(id) {` (~7820); add `_fetchPublished`, `diffAgainstServer`, `_formatDiff` above it; export `diffAgainstServer`
- Modify: `tests/sync-merge.spec.ts` (append unit test)
- Create: `tests/package-publish.spec.ts`

**Interfaces:**
- Consumes: `UI.confirm` (T0.1), `HexDB.addEntries` (T0.4), `FakeGitHub.setRegistry`.
- Produces:
  - `SyncMerge.diff(local: Entry[], server: Entry[]): { added: string[], changed: string[], removed: string[] }` (ids; "added" = only local, "removed" = only on the server)
  - `HexDB.migrateCopy(entries): Entry[]`, `BldDB.migrateCopy(entries): Entry[]` (migrated clones; no state change)
  - `Packages.diffAgainstServer(id): Promise<{ hex: Diff, bld: Diff, firstPublish: boolean, version: string|null }>`
  - `Packages.openPublishConfirm(id)` is now async: for non-default packages it opens the `UI.confirm` dialog titled `Publish Package` whose `#dialog-details` lists `+ hex <id>` (added), `~ hex <id>` (changed), `- hex <id>` (only on server) and the same with `bld`; confirming calls `publishPackage(id)`.

- [ ] **Step 1: Write failing tests**

Append to `tests/sync-merge.spec.ts`:
```ts
test('SyncMerge.diff lists added, changed and removed ids', async ({ page }) => {
  const d = await page.evaluate(() => SyncMerge.diff(
    [{ id: 'N' }, { id: 'C', v: 2 }, { id: 'S', v: 1 }],
    [{ id: 'C', v: 1 }, { id: 'S', v: 1 }, { id: 'G' }]));
  expect(d).toEqual({ added: ['N'], changed: ['C'], removed: ['G'] });
});
```
Create `tests/package-publish.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

const hex = (id: string, extra: object = {}) => ({ id, package: 'difpkg', spriteName: id, type: 'Plains', ...extra });

async function setup(page: any, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'difpkg', name: 'Dif Pkg', version: '1.0.0' }]);
  gh.setJson('packages/difpkg/package.json', { id: 'difpkg', name: 'Dif Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/difpkg/hex_database.json', { version: 1, package: 'difpkg', hexes: [hex('Difpkg_Same'), hex('Difpkg_A'), hex('Difpkg_Gone')] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('difpkg'));
  await page.evaluate(([same, a, n]: any) => HexDB.addEntries([same, a, n]),
    [hex('Difpkg_Same'), hex('Difpkg_A', { effects: 'edited' }), hex('Difpkg_New')]);
}

test('publish dialog lists new, changed and server-only entries and Cancel writes nothing', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  const details = page.locator('#dialog-details');
  await expect(details).toContainText('+ hex Difpkg_New');
  await expect(details).toContainText('~ hex Difpkg_A');
  await expect(details).toContainText('- hex Difpkg_Gone');
  await expect(details).not.toContainText('Difpkg_Same');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  expect(gh.putPaths()).toEqual([]);
});

test('confirming the dialog publishes', async ({ page }) => {
  const gh = new FakeGitHub();
  await setup(page, gh);
  await page.evaluate(() => { Packages.openPublishConfirm('difpkg'); });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect.poll(() => gh.putPaths()).toContain('packages/difpkg/hex_database.json');
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/sync-merge.spec.ts tests/package-publish.spec.ts -g "diff|publish"
```
Expected: `SyncMerge.diff is not a function`; the dialog tests fail waiting for `#dialog-details` (the old confirm has no details).

- [ ] **Step 3: `SyncMerge.diff`**

Add before `const _baseKey` in `SyncMerge`:
```js
  // Compares two entry arrays by package+id; returns display ids.
  function diff(local, server) {
    const L = _index(local), S = _index(server);
    const added = [], changed = [], removed = [];
    for (const [k, l] of L) {
      if (!S.has(k)) added.push(l.id);
      else if (!same(l, S.get(k))) changed.push(l.id);
    }
    for (const [k, s] of S) if (!L.has(k)) removed.push(s.id);
    return { added, changed, removed };
  }

```
and change the module's return to `return { same, keyOf, merge3, diff, loadBase, saveBase };`.

- [ ] **Step 4: `migrateCopy` in HexDB and BldDB**

HexDB (next to `addEntries`):
```js
  // Migrated deep copy of foreign entries (e.g. the published file), so they compare equal to
  // local entries that already went through the migrations. Does not touch _data.
  function migrateCopy(entries) {
    const c = structuredClone(entries || []);
    _migrateAll(c);
    return c;
  }
```
BldDB:
```js
  function migrateCopy(entries) {
    const c = structuredClone(entries || []);
    c.forEach(_migrate);
    return c;
  }
```
Export `migrateCopy,` from both (after `addEntries,`).

- [ ] **Step 5: Packages, diff and dialog**

Replace the whole `function openPublishConfirm(id) { ... }` with (keep the `isDefault(id)` branch exactly as it is today):
```js
  async function _fetchPublished(id) {
    const get = async file => {
      const r = await fetch(`${BASE_URL}/packages/${id}/${file}?_=${Date.now()}`);
      return r.ok ? r.json() : null;
    };
    const [hexData, bldData, pkg] = await Promise.all([get('hex_database.json'), get('building_database.json'), get('package.json')]);
    return { hexes: hexData?.hexes || [], buildings: bldData?.buildings || [], pkg };
  }

  async function diffAgainstServer(id) {
    const pub = await _fetchPublished(id);
    const localHex = HexDB.getData().hexes.filter(h => h.package === id);
    const localBld = BldDB.getAll().filter(b => b.package === id);
    return {
      hex: SyncMerge.diff(localHex, HexDB.migrateCopy(pub.hexes)),
      bld: SyncMerge.diff(localBld, BldDB.migrateCopy(pub.buildings)),
      firstPublish: !pub.pkg,
      version: pub.pkg?.version || null,
    };
  }

  function _formatDiff(d) {
    const summary = (label, x) => `${label}: ${x.added.length} new, ${x.changed.length} changed, ${x.removed.length} only on server`;
    const rows = (tag, x) => [
      ...x.added.map(i => `+ ${tag} ${i}`),
      ...x.changed.map(i => `~ ${tag} ${i}`),
      ...x.removed.map(i => `- ${tag} ${i}`),
    ];
    return [summary('Hex tiles', d.hex), summary('Buildings', d.bld), '', ...rows('hex', d.hex), ...rows('bld', d.bld)].join('\n');
  }

  async function openPublishConfirm(id) {
    if (isDefault(id)) {
      // postapoc: use existing publish functions
      UI.showConfirm('Publish postapoc', 'Publish hex_database.json and building_database.json?', async () => {
        await GitHubSync.publishHexDbOnly();
        await GitHubSync.publishBuildingsDb();
      });
      return;
    }
    const entry = getEntry(id);
    const name  = entry?.name || id;
    let d;
    try { d = await diffAgainstServer(id); }
    catch(e) { return UI.toast(`⚠ Could not compare "${name}" with the server`, { detail: e.message, ms: 6000 }); }
    const nothing = ![d.hex, d.bld].some(x => x.added.length || x.changed.length || x.removed.length);
    const head = d.firstPublish ? 'First publish of this package.' : `Server version: ${d.version}.`;
    const ok = await UI.confirm('Publish Package',
      `Publish "${name}"? ${head}${nothing ? ' No entry differs from the server; sprites and the version number are still updated.' : ''}`,
      _formatDiff(d), 'Publish');
    if (ok) publishPackage(id);
  }
```
Add `diffAgainstServer,` to the `Packages` return list (after `openPublishConfirm, publishPackage, publishPackageSprites,`).

- [ ] **Step 6: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/sync-merge.spec.ts tests/package-publish.spec.ts
```
Expected: all pass (`9 + 2`).

- [ ] **Step 7: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/sync-merge.spec.ts tests/package-publish.spec.ts && git commit -m "$(cat <<'EOF'
feat(packages): show a diff against the server before publishing a package

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: `Difpkg_Same` (identical locally and on the server after migration) never appears in the diff, which pins that server entries are migrated before comparing; Cancel produces zero PUTs.

---

## T0.7 Publish keeps `description`/`preview`, derives the version from the server and writes `package.json` last

Roadmap 0.3, part 3. Today `publishPackage` writes `JSON.stringify({ ...entry, version })` where `entry` is the registry entry (id, name, isDefault, version), so `description` and `preview` from the published `package.json` are dropped, and the version bump starts from the possibly stale registry cache.

**Files:**
- Modify: `MapEditorPro.html`, `Packages`: replace the whole `async function publishPackage(id) {` (~7838) up to (not including) `// ── Delete Package`; add `_fetchPackageJson` above it
- Modify: `tests/package-publish.spec.ts` (append)

**Interfaces:**
- Consumes: `GitHubSync._withPublishBtn`, `_putText` (existing), `FakeGitHub.failPut`.
- Produces: new write order in `publishPackage`: `hex_database.json`, `building_database.json`, sprites, `registry.json`, then `package.json` last. `package.json` = `{ ...serverPackageJson, ...registryEntry, version, description, preview }` where `description`/`preview` come from the server file first. New version = patch + 1 of the **server** `package.json` version (fallback: registry entry, then `1.0.0`). `Packages._fetchPackageJson` is private.

- [ ] **Step 1: Append failing tests to `tests/package-publish.spec.ts`**

```ts
async function setupPublish(page: any, gh: FakeGitHub) {
  gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);                 // stale registry version
  gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'My desc', preview: 'pv.png', isDefault: false });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('pp'));
  await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
}

test('publish keeps description and preview, bumps from the server version, writes package.json last', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  await page.evaluate(() => Packages.publishPackage('pp'));
  const pkg = gh.json('packages/pp/package.json');
  expect(pkg.description).toBe('My desc');
  expect(pkg.preview).toBe('pv.png');
  expect(pkg.version).toBe('1.2.4');
  expect(gh.putPaths().at(-1)).toBe('packages/pp/package.json');
  expect(gh.putPaths()).toContain('packages/registry.json');
  expect(gh.json('packages/registry.json').packages.find((p: any) => p.id === 'pp').version).toBe('1.2.4');
});

test('a failed package.json write is retry-safe: the retry computes the same version', async ({ page }) => {
  const gh = new FakeGitHub();
  await setupPublish(page, gh);
  gh.failPut = p => p === 'packages/pp/package.json';
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.3');        // untouched: still the old, complete release
  gh.failPut = () => false;
  await page.evaluate(() => Packages.publishPackage('pp'));
  expect(gh.json('packages/pp/package.json').version).toBe('1.2.4');        // not 1.2.5
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-publish.spec.ts -g "keeps description|retry-safe"
```
Expected: first test fails on `pkg.description` (`undefined`, expected `My desc`) and version `1.0.1`; second fails on the version assertions.

- [ ] **Step 3: Replace `publishPackage`**

```js
  async function _fetchPackageJson(id) {
    try {
      const r = await fetch(`${BASE_URL}/packages/${id}/package.json?_=${Date.now()}`);
      return r.ok ? await r.json() : null;
    } catch(e) { return null; }
  }

  async function publishPackage(id) {
    const entry = getEntry(id);
    if (!entry) return UI.toast('⚠ Package not found');
    if (isDefault(id)) return UI.toast('⚠ Use HexDB/Buildings publish buttons for postapoc');

    await GitHubSync._withPublishBtn('Publish Package', async () => {
      const hexes    = (typeof HexDB !== 'undefined' ? HexDB.getData().hexes : []).filter(h => h.package === id);
      const buildings = (typeof BldDB !== 'undefined' ? BldDB.getAll() : []).filter(b => b.package === id);

      // The published package.json is the commit marker: it is written last, and the next version
      // is derived from it (not from the registry cache), so a retry after a partial failure
      // computes the same version again.
      const serverPkg = await _fetchPackageJson(id);
      const [maj, min, pat] = (serverPkg?.version || entry.version || '1.0.0').split('.').map(Number);
      const newVersion = `${maj}.${min}.${pat + 1}`;

      UI.progress(5, `Publishing ${id}/hex_database.json…`);
      const hexPayload = JSON.stringify({ version: 1, package: id, hexes }, null, 2);
      await GitHubSync._putText(`packages/${id}/hex_database.json`, hexPayload, `publish ${id}: hex_database.json`);

      UI.progress(20, `Publishing ${id}/building_database.json…`);
      const bldPayload = JSON.stringify({ version: 1, package: id, buildings }, null, 2);
      await GitHubSync._putText(`packages/${id}/building_database.json`, bldPayload, `publish ${id}: building_database.json`);

      UI.progress(30, `Publishing ${id} sprites…`);
      const spriteResult = await publishPackageSprites(id, (done, total, spriteName) => {
        UI.progress(30 + Math.round((done / total) * 45), `Sprites: ${done}/${total} (${spriteName})…`);
      });
      if (spriteResult.missing.length) {
        console.warn(`[Packages] publish ${id}: ${spriteResult.missing.length} sprite(s) not found locally or in postapoc pool:`, spriteResult.missing);
      }

      UI.progress(80, 'Updating registry.json…');
      let regData;
      try {
        const res = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
        regData = res.ok ? await res.json() : { version: 1, packages: [..._registry] };
      } catch(e) { regData = { version: 1, packages: [..._registry] }; }
      regData.packages = regData.packages.map(p => p.id === id ? { ...p, version: newVersion } : p);
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: bump ${id} to ${newVersion}`);

      UI.progress(92, `Updating ${id}/package.json…`);
      const pkgJson = JSON.stringify({
        ...(serverPkg || {}), ...entry,
        version: newVersion,
        description: serverPkg?.description ?? entry.description ?? '',
        preview: serverPkg?.preview ?? entry.preview ?? 'preview.png',
      }, null, 2);
      await GitHubSync._putText(`packages/${id}/package.json`, pkgJson, `publish ${id}: package.json`);

      _registry = regData.packages;
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      const spriteNote = spriteResult.total
        ? `, ${spriteResult.pushed}/${spriteResult.total} sprites`
        : '';
      UI.progressDone(`✅ Package "${entry.name}" v${newVersion} published${spriteNote}`);
      if (spriteResult.missing.length) {
        UI.toast(`⚠ ${entry.name} v${newVersion} published, but ${spriteResult.missing.length} sprite(s) missing`, { sticky: true, detail: spriteResult.missing.join(', ') });
      } else {
        UI.toast(`✅ ${entry.name} v${newVersion} published${spriteNote}`);
      }
      renderPanel();
    });
  }
```
The only deliberate behavioural changes versus the old function: server-derived version, registry before `package.json`, metadata merge, and the missing-sprites toast now carries the names instead of "see console".

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-publish.spec.ts
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/package-publish.spec.ts && git commit -m "$(cat <<'EOF'
fix(packages): keep package.json metadata and write it last when publishing

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: the server `package.json` says 1.2.3 while the cached registry says 1.0.0; the result must be 1.2.4, and when the final write fails the server keeps 1.2.3 and the retry yields 1.2.4 again, not 1.2.5.

---

## T0.8 Delete package lists what depends on it and lets the user keep or remove entries

Roadmap 0.4, part 1.

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: replace `function confirmDelete(id) {` (~7896) and `async function deletePackage(id) {` (~7904); add `usage` above them
  - `HexDB`: add `removeByPackage` + export; `BldDB`: add `removeByPackage` + export (next to `addEntries`)
  - `Packages` export list: add `usage`
- Create: `tests/package-delete.spec.ts`

**Interfaces:**
- Consumes: `UI.showDialog` (T0.1), `HexDB.addEntries` (T0.4), `IO.getMapJson()` (existing), `FakeGitHub`.
- Produces:
  - `HexDB.removeByPackage(pkgId): number`, `BldDB.removeByPackage(pkgId): number` (removed count; autosave + list refresh)
  - `Packages.usage(id): Promise<{ hex: string[], bld: string[], maps: string[], currentMap: boolean, unreadable: number }>`; `maps` = names from the server `maps/map_list.json` whose JSON `packages` array includes the id; `unreadable` counts maps that could not be fetched
  - `Packages.confirmDelete(id)` (async): dialog `Delete Package` with buttons `Cancel`, `Delete, keep entries`, `Delete and remove entries`
  - `Packages.deletePackage(id, opts?: { removeEntries?: boolean })`

- [ ] **Step 1: Write the failing test `tests/package-delete.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

async function setup(page: any) {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'delpkg', name: 'Del Pkg' }]);
  gh.setJson('maps/map_list.json', { maps: [{ name: 'm1', fileName: 'm1.json' }, { name: 'm2', fileName: 'm2.json' }] });
  gh.setJson('maps/m1.json', { width: 20, height: 20, packages: ['postapoc', 'delpkg'], data: [] });
  gh.setJson('maps/m2.json', { width: 20, height: 20, packages: ['postapoc'], data: [] });
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('delpkg'));
  await page.evaluate(() => {
    HexDB.addEntries([{ id: 'Delpkg_H', package: 'delpkg', type: 'Plains' }]);
    BldDB.addEntries([{ id: 'Delpkg_B', package: 'delpkg' }]);
  });
  return gh;
}
const registryIds = (gh: FakeGitHub) => gh.json('packages/registry.json').packages.map((p: any) => p.id);

test('dialog lists entry counts and the maps that use the package', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  const d = page.locator('#dialog-details');
  await expect(d).toContainText('1 hex tile(s), 1 building(s)');
  await expect(d).toContainText('m1');
  await expect(d).not.toContainText('m2');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  expect(gh.putPaths()).toEqual([]);
});

test('"Delete, keep entries" removes only the registry entry', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete, keep entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  expect(await page.evaluate(() => HexDB.getAll().some(h => h.id === 'Delpkg_H'))).toBe(true);
});

test('"Delete and remove entries" also removes the local entries', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Delpkg_H' ) || BldDB.getAll().some(b => b.id === 'Delpkg_B'))).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-delete.spec.ts
```
Expected: test 1 fails (`#dialog-details` not found: the old flow uses `showConfirm`); tests 2 and 3 fail (no `Delete, keep entries` button).

- [ ] **Step 3: `removeByPackage` in HexDB and BldDB**

HexDB (next to `addEntries`):
```js
  function removeByPackage(pkgId) {
    const before = _data.hexes.length;
    _data.hexes = _data.hexes.filter(h => (h.package || 'postapoc') !== pkgId);
    const removed = before - _data.hexes.length;
    if (removed) {
      _autoSave();
      _selFilt = -1;
      _applyFilter(); _buildList();
      UI.buildPalette();
      Canvas.render();
    }
    return removed;
  }
```
BldDB:
```js
  function removeByPackage(pkgId) {
    const before = _data.buildings.length;
    _data.buildings = _data.buildings.filter(b => (b.package || 'postapoc') !== pkgId);
    const removed = before - _data.buildings.length;
    if (removed) {
      _autoSave();
      _selFilt = -1;
      _applyFilter(); _buildList();
      UI.buildPalette();
    }
    return removed;
  }
```
Export `removeByPackage,` from both modules (after `migrateCopy,`).

- [ ] **Step 4: Packages, usage report and the new dialog**

Replace `function confirmDelete(id) {...}` and `async function deletePackage(id) {...}` with the following (`deletePackage` keeps its registry logic; trash/restore is added in T0.9):
```js
  // What would break if this package disappeared: local entries and published maps that list it.
  async function usage(id) {
    const hex = HexDB.getData().hexes.filter(h => h.package === id).map(h => h.id);
    const bld = BldDB.getAll().filter(b => b.package === id).map(b => b.id);
    let currentMap = false;
    try { currentMap = (JSON.parse(IO.getMapJson() || '{}').packages || []).includes(id); } catch(e) {}
    const maps = [];
    let unreadable = 0;
    try {
      const lr = await fetch(`${BASE_URL}/maps/map_list.json?_=${Date.now()}`);
      const list = lr.ok ? ((await lr.json()).maps || []) : [];
      for (const m of list) {
        try {
          const r = await fetch(`${BASE_URL}/maps/${encodeURIComponent(m.fileName)}?_=${Date.now()}`);
          const j = r.ok ? await r.json() : null;
          if (!j) { unreadable++; continue; }
          if ((j.packages || []).includes(id)) maps.push(m.name || m.fileName);
        } catch(e) { unreadable++; }
      }
    } catch(e) { unreadable++; }
    return { hex, bld, maps, currentMap, unreadable };
  }

  async function confirmDelete(id) {
    if (isDefault(id)) return UI.toast('⚠ Cannot delete the default package');
    const entry = getEntry(id);
    const name = entry?.name || id;
    const u = await usage(id);
    const lines = [
      `Local entries: ${u.hex.length} hex tile(s), ${u.bld.length} building(s)`,
      `Published maps that use it: ${u.maps.length ? u.maps.join(', ') : 'none found'}`,
      `Current map uses it: ${u.currentMap ? 'yes' : 'no'}`,
    ];
    if (u.unreadable) lines.push(`(${u.unreadable} map(s) could not be checked)`);
    const r = await UI.showDialog({
      title: 'Delete Package',
      message: `Remove "${name}" from the registry? Its files on the server are not deleted, and the package can be restored from the PACKAGES tab.`,
      details: lines.join('\n'),
      buttons: [
        { label: 'Cancel', value: 'cancel', kind: 'cancel' },
        { label: 'Delete, keep entries', value: 'keep', kind: 'primary' },
        { label: 'Delete and remove entries', value: 'remove', kind: 'danger' },
      ],
    });
    if (r.button === 'keep') await deletePackage(id, { removeEntries: false });
    else if (r.button === 'remove') await deletePackage(id, { removeEntries: true });
  }

  async function deletePackage(id, opts = {}) {
    if (isDefault(id)) return;
    try {
      UI.progress(20, 'Updating registry.json…');
      let regData;
      try {
        const res = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
        regData = res.ok ? await res.json() : { version: 1, packages: [..._registry] };
      } catch(e) { regData = { version: 1, packages: [..._registry] }; }
      regData.packages = regData.packages.filter(p => p.id !== id);
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: remove ${id}`);
      _registry = regData.packages;
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      if (_active === id) setActive('postapoc');
      let note = '';
      if (opts.removeEntries) {
        note = ` (${HexDB.removeByPackage(id)} hex tile(s), ${BldDB.removeByPackage(id)} building(s) removed)`;
      }
      UI.progressDone(`✅ Package "${id}" deleted from registry`);
      UI.toast(`✅ Package "${id}" removed from registry${note}`);
      renderPanel();
      renderActiveDropdowns();
    } catch(e) {
      UI.progressDone('');
      UI.toast(`⚠ Delete failed: ${e.message}`);
    }
  }
```
Add `usage,` to the `Packages` return list (after `confirmDelete, deletePackage,`).

- [ ] **Step 5: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-delete.spec.ts
```
Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/package-delete.spec.ts && git commit -m "$(cat <<'EOF'
feat(packages): show package usage on delete and let the user keep or remove entries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: map `m2` (no `delpkg` in `packages`) is not listed while `m1` is; Cancel and Escape produce zero PUTs, and "keep" leaves `Delpkg_H` in HexDB.

---

## T0.9 Delete is reversible: restore copy in `pkg_trash` and `Packages.restoreDeleted`

Roadmap 0.4, part 2.

**Files:**
- Modify: `MapEditorPro.html`, `Packages`: constants next to `const LS_REGISTRY = 'pkg_registry_cache';` (~7475); `deletePackage` (from T0.8); `renderPanel` (~7530, the one inside `Packages`, grep `<h3 style="color:#cdd6f4;margin:0 0 16px">Content Packages</h3>`); return list
- Modify: `tests/package-delete.spec.ts` (append)

**Interfaces:**
- Produces:
  - `localStorage` key `pkg_trash`: JSON array (max 5, newest first) of `{ id, entry, hexes, buildings, deletedAt }`
  - `Packages.listTrash(): TrashItem[]`
  - `Packages.restoreDeleted(id): Promise<void>`: re-adds the registry entry on the server (`registry: restore <id>`), re-adds the saved entries via `HexDB.addEntries`/`BldDB.addEntries`, removes the item from the trash; refuses if the id is already in the registry
  - `deletePackage` aborts with a toast if the restore copy cannot be stored
  - PACKAGES panel shows a "Recently deleted" table with a `Restore` button per item

- [ ] **Step 1: Append failing tests to `tests/package-delete.spec.ts`**

```ts
test('delete saves a restore copy and restoreDeleted brings back registry entry and entries', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => { Packages.confirmDelete('delpkg'); });
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect.poll(() => registryIds(gh)).not.toContain('delpkg');

  const trash = await page.evaluate(() => Packages.listTrash());
  expect(trash.length).toBe(1);
  expect(trash[0].id).toBe('delpkg');
  expect(trash[0].hexes.map((h: any) => h.id)).toEqual(['Delpkg_H']);
  expect(await page.evaluate(() => document.getElementById('pkg-panel')!.textContent)).toContain('Recently deleted');

  await page.evaluate(() => Packages.restoreDeleted('delpkg'));
  expect(registryIds(gh)).toContain('delpkg');
  expect(await page.evaluate(() => [HexDB.getAll().some(h => h.id === 'Delpkg_H'), BldDB.getAll().some(b => b.id === 'Delpkg_B')])).toEqual([true, true]);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

test('delete is aborted when the restore copy cannot be stored', async ({ page }) => {
  const gh = await setup(page);
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pkg_trash') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.evaluate(() => Packages.deletePackage('delpkg', { removeEntries: true }));
  expect(gh.putPaths()).toEqual([]);
  expect(await page.evaluate(() => HexDB.getAll().some(h => h.id === 'Delpkg_H'))).toBe(true);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-delete.spec.ts -g "restore"
```
Expected: `Packages.listTrash is not a function`; second test fails (`gh.putPaths()` contains the registry write).

- [ ] **Step 3: Implement**

Below `const LS_REGISTRY = 'pkg_registry_cache';` add `const LS_TRASH    = 'pkg_trash';`.

Add above `async function deletePackage(id, opts = {}) {`:
```js
  function listTrash() {
    try { return JSON.parse(localStorage.getItem(LS_TRASH) || '[]'); } catch(e) { return []; }
  }
  function _writeTrash(items) {
    try { localStorage.setItem(LS_TRASH, JSON.stringify(items.slice(0, 5))); return true; }
    catch(e) { console.warn('[Packages] trash write failed:', e.message); return false; }
  }

  async function restoreDeleted(id) {
    const item = listTrash().find(t => t.id === id);
    if (!item) return UI.toast('⚠ Nothing to restore for this package');
    if (getEntry(id)) return UI.toast(`⚠ Package "${id}" already exists`);
    try {
      UI.progress(30, 'Updating registry.json…');
      let regData;
      try {
        const res = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
        regData = res.ok ? await res.json() : { version: 1, packages: [..._registry] };
      } catch(e) { regData = { version: 1, packages: [..._registry] }; }
      if (!regData.packages.find(p => p.id === id))
        regData.packages.push(item.entry || { id, name: id, isDefault: false, version: '1.0.0' });
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: restore ${id}`);
      _registry = regData.packages;
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      const h = HexDB.addEntries(item.hexes);
      const b = BldDB.addEntries(item.buildings);
      _writeTrash(listTrash().filter(t => t.id !== id));
      UI.progressDone(`✅ Package "${id}" restored`);
      UI.toast(`✅ Package "${id}" restored (${h} hex tile(s), ${b} building(s))`);
      renderPanel();
      renderActiveDropdowns();
    } catch(e) {
      UI.progressDone('');
      UI.toast(`⚠ Restore failed: ${e.message}`);
    }
  }

```
In `deletePackage`, insert at the very start of the function body after `if (isDefault(id)) return;`:
```js
    const entry = getEntry(id);
    const saved = _writeTrash([
      { id, entry, deletedAt: new Date().toISOString(),
        hexes: structuredClone(HexDB.getData().hexes.filter(h => h.package === id)),
        buildings: structuredClone(BldDB.getAll().filter(b => b.package === id)) },
      ...listTrash().filter(t => t.id !== id),
    ]);
    if (!saved) return UI.toast('⚠ Could not save a restore copy, so the package was not deleted');
```
In `renderPanel`, directly before `el.innerHTML = \`` add:
```js
    const trash = listTrash();
    const trashHtml = trash.length ? `
      <h4 style="color:#cdd6f4;margin:20px 0 8px">Recently deleted</h4>
      <table><tbody>${trash.map(t => `
        <tr>
          <td><code>${_esc(t.id)}</code></td>
          <td>${t.hexes.length} hex, ${t.buildings.length} buildings</td>
          <td>${_esc((t.deletedAt || '').slice(0, 10))}</td>
          <td><button class="hexdb-tool-btn" onclick="Packages.restoreDeleted('${_esc(t.id)}')">Restore</button></td>
        </tr>`).join('')}</tbody></table>` : '';
```
and change the end of the template from `</table>\`;` to `</table>${trashHtml}\`;` (the `<table>` that lists packages, whose `<thead>` is `<th>ID</th><th>Name</th><th>Version</th><th>Actions</th>`).
Add `listTrash, restoreDeleted,` to the `Packages` return list.

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/package-delete.spec.ts
```
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/package-delete.spec.ts && git commit -m "$(cat <<'EOF'
feat(packages): keep a restore copy when deleting a package and add Restore

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: with `localStorage.setItem('pkg_trash')` throwing a quota error, delete does nothing (no registry PUT, entries intact), so a package is never deleted without a way back.

---

## T0.10 Map load warnings: missing packages, unknown ids, silent size clamp

Roadmap 0.5. Verified live: a 600x600 map loaded as 450x450 with only "Map loaded"; a map listing missing package `ghostpack` and tile `Ghost_Tile_9` loaded silently.

**Files:**
- Modify: `MapEditorPro.html`, `IO`: add `analyzeMap` and `_formatMapIssues` above `function _loadFromJSON(json) {` (~6445); call them at the end of the `try` in `_loadFromJSON` (after `UI.toast('Map loaded');` / `_autoSave();`); export `analyzeMap` in the `IO` return (~6803)
- Create: `tests/map-load-warnings.spec.ts`

**Interfaces:**
- Consumes: `UI.showDialog` (T0.1), `Packages.getAll()`, `HexDB.getAll()`, `BldDB.getAll()`.
- Produces:
  - `IO.analyzeMap(json, ctx: { registryIds: string[], knownIds: string[] }): { clamped: {from:[number,number], to:[number,number]}|null, missingPackages: string[], unknownIds: string[] /* "Id ×count", most frequent first */, unknownCount: number }` (pure; ids compared case-insensitively; legacy integer-format maps skip the tile check; only cells inside the clamped size are counted; `objects[].id` are counted too)
  - After a load, a non-empty analysis opens `UI.showDialog` titled `Map loaded with warnings`; a clean map shows no dialog.

- [ ] **Step 1: Write the failing test `tests/map-load-warnings.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

test('analyzeMap (pure) reports clamp, missing packages and unknown ids with counts', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => IO.analyzeMap(
    { width: 600, height: 5, packages: ['postapoc', 'ghostpack'],
      data: [['Plain_1', 'Ghost_Tile_9'], ['Ghost_Tile_9', 'Plain_1']],
      objects: [{ col: 0, row: 0, id: 'Ghost_Bld' }] },
    { registryIds: ['postapoc'], knownIds: ['plain_1'] }));
  expect(r.clamped).toEqual({ from: [600, 5], to: [450, 10] });
  expect(r.missingPackages).toEqual(['ghostpack']);
  expect(r.unknownCount).toBe(3);
  expect(r.unknownIds).toEqual(['Ghost_Tile_9 ×2', 'Ghost_Bld ×1']);
});

test('analyzeMap skips the tile check for legacy integer maps', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => IO.analyzeMap(
    { width: 20, height: 20, data: [[0, 3], [9, 12]] }, { registryIds: ['postapoc'], knownIds: [] }));
  expect(r.unknownCount).toBe(0);
});

test('loading a 600x600 map with a ghost package and tile warns in a dialog', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => IO.loadFromJSON(
    { width: 600, height: 600, packages: ['postapoc', 'ghostpack'], data: [['Plain_1', 'Ghost_Tile_9']] }));
  const dlg = page.locator('#dialog-modal');
  await expect(dlg).toHaveClass(/open/);
  await expect(page.locator('#dialog-title')).toHaveText('Map loaded with warnings');
  await expect(page.locator('#dialog-msg')).toContainText('600×600');
  await expect(page.locator('#dialog-msg')).toContainText('450×450');
  await expect(page.locator('#dialog-msg')).toContainText('ghostpack');
  await expect(page.locator('#dialog-details')).toContainText('Ghost_Tile_9 ×1');
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([450, 450]);
});

test('a real clean map and a map saved by the editor load without a dialog', async ({ page }) => {
  await openEditor(page);
  const clean = new FakeGitHub().json('maps/current_map.json');
  await page.evaluate(m => IO.loadFromJSON(m), clean);
  await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
  await page.evaluate(() => IO.loadFromJSON(JSON.parse(IO.getMapJson())));
  await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
});
```
`maps/current_map.json` was checked offline: 20x20, no `packages` key, every tile id exists in `packages/postapoc/hex_database.json`.

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/map-load-warnings.spec.ts
```
Expected: `IO.analyzeMap is not a function` (tests 1-2); test 3 times out waiting for `#dialog-modal.open`; test 4 passes already (it guards against false positives, keep it).

- [ ] **Step 3: Implement**

Add above `function _loadFromJSON(json) {`:
```js
  // Pure: inspects a parsed map file without touching editor state.
  function analyzeMap(json, ctx) {
    const issues = { clamped: null, missingPackages: [], unknownIds: [], unknownCount: 0 };
    const w = json.width, h = json.height;
    const cw = Math.max(10, Math.min(450, w)), ch = Math.max(10, Math.min(450, h));
    if (cw !== w || ch !== h) issues.clamped = { from: [w, h], to: [cw, ch] };
    const reg = new Set((ctx.registryIds || []).map(s => String(s).toLowerCase()));
    issues.missingPackages = (Array.isArray(json.packages) ? json.packages : [])
      .filter(p => !reg.has(String(p).toLowerCase()));
    const known = new Set((ctx.knownIds || []).map(s => String(s).toLowerCase()));
    const counts = new Map();
    const note = id => {
      if (id && !known.has(String(id).toLowerCase())) counts.set(id, (counts.get(id) || 0) + 1);
    };
    const legacyInts = json.data && json.data[0] && typeof json.data[0][0] === 'number';
    if (Array.isArray(json.data) && !legacyInts) {
      for (let r = 0; r < ch; r++) {
        const row = json.data[r];
        if (!row) continue;
        for (let c = 0; c < cw; c++) note(row[c]);
      }
    }
    (Array.isArray(json.objects) ? json.objects : []).forEach(o => note(o && o.id));
    issues.unknownCount = [...counts.values()].reduce((a, n) => a + n, 0);
    issues.unknownIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ×${n}`);
    return issues;
  }

  function _formatMapIssues(i) {
    const lines = [];
    if (i.clamped)
      lines.push(`Map size ${i.clamped.from[0]}×${i.clamped.from[1]} is outside the supported 10–450 range, so it was loaded as ${i.clamped.to[0]}×${i.clamped.to[1]}. Tiles outside that area were discarded.`);
    if (i.missingPackages.length)
      lines.push(`Packages not in the registry: ${i.missingPackages.join(', ')}. Their tiles may be missing or drawn as placeholders.`);
    if (i.unknownCount)
      lines.push(`${i.unknownCount} tile(s) use ${i.unknownIds.length} id(s) that are not in HexDB or BldDB.`);
    if (!lines.length) return null;
    return { message: lines.join('\n\n'), details: i.unknownIds.slice(0, 30).join('\n') };
  }

```
In `_loadFromJSON`, directly after `_autoSave();` that follows `UI.toast('Map loaded');` (still inside the `try`), add:
```js
      const report = _formatMapIssues(analyzeMap(json, {
        registryIds: (typeof Packages !== 'undefined' ? Packages.getAll() : []).map(p => p.id),
        knownIds: [...HexDB.getAll().map(h => h.id), ...BldDB.getAll().map(b => b.id)],
      }));
      if (report) UI.showDialog({ title: 'Map loaded with warnings', message: report.message, details: report.details });
```
Add `analyzeMap,` to the `IO` return list (after `loadFromJSON: _loadFromJSON, setFileName: _setFileName,`).

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/map-load-warnings.spec.ts
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/map-load-warnings.spec.ts && git commit -m "$(cat <<'EOF'
feat(io): warn about missing packages, unknown tile ids and clamped size on map load

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: `height: 5` clamps up to 10 while `width: 600` clamps down to 450, and only cells inside 450x10 are counted; legacy integer maps (e.g. `maps/current_map_02.json`) must not produce thousands of "unknown id" warnings.

---

## T0.11 Autosave failures are surfaced (`StorageGuard`)

Roadmap 0.6, part 1. Today every autosave is `try { localStorage.setItem(...) } catch(e) {}` (map ~6259, `hexdb_autosave` ~8949, `blddb_autosave` ~10478, `sttdb_autosave` ~11597, `upgdb_autosave` ~11987).

**Files:**
- Modify: `MapEditorPro.html`
  - Add `StorageGuard` above the `// SYNC MERGE` banner added in T0.2 (so right after `SpriteStore`)
  - `IO._autoSave` (~6255): the line `try { localStorage.setItem('map_autosave', json); } catch(e) {}`
  - the four `_autoSave` functions of `HexDB`, `BldDB`, `SttDB`, `UpgDB`
- Create: `tests/storage-errors.spec.ts`

**Interfaces:**
- Produces: `StorageGuard.setItem(key, value, label?): boolean`; on failure shows a sticky toast `⚠ <label> not saved[: browser storage is full]` with the error message and an export hint in `detail`, at most once per label per 60 s, and logs `console.error('[StorageGuard] ...')`. `StorageGuard._warn(label, err)` is exposed for T0.12.

- [ ] **Step 1: Write the failing test `tests/storage-errors.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

async function breakStorage(page: any) {
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
}

test('a full localStorage produces one sticky warning per saved thing', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  await page.evaluate(() => { HexDB.add(); HexDB.add(); BldDB.add(); });
  const hexToast = page.locator('.toast.sticky', { hasText: 'Hex DB autosave not saved: browser storage is full' });
  await expect(hexToast).toHaveCount(1);                       // two failures, one toast
  await expect(page.locator('.toast.sticky', { hasText: 'Buildings DB autosave not saved' })).toHaveCount(1);
  await expect(hexToast.locator('.toast-detail')).toContainText('Export your work');
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/storage-errors.spec.ts
```
Expected: fails: `expect(locator).toHaveCount(1)` received 0 (errors are swallowed).

- [ ] **Step 3: Add `StorageGuard`**

```js
// ════════════════════════════════════════════════════════════
// STORAGE GUARD — localStorage writes that never fail silently
// ════════════════════════════════════════════════════════════
const StorageGuard = (() => {
  const _lastWarn = {};
  function _warn(label, err) {
    console.error(`[StorageGuard] ${label}:`, err);
    const now = Date.now();
    if (now - (_lastWarn[label] || 0) < 60000) return;
    _lastWarn[label] = now;
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    UI.toast(`⚠ ${label} not saved${quota ? ': browser storage is full' : ''}`, {
      sticky: true,
      detail: `${err && err.message ? err.message : err}\nExport your work (Save map / Save DB) so it is not lost.`,
    });
  }
  function setItem(key, value, label) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { _warn(label || key, e); return false; }
  }
  return { setItem, _warn };
})();

```

- [ ] **Step 4: Route the five autosaves through it**

Replace each line:
- `IO._autoSave`: `try { localStorage.setItem('map_autosave', json); } catch(e) {}` with `StorageGuard.setItem('map_autosave', json, 'Map autosave');`
- HexDB: `try { localStorage.setItem('hexdb_autosave', JSON.stringify(_data)); } catch(e) {}` with `StorageGuard.setItem('hexdb_autosave', JSON.stringify(_data), 'Hex DB autosave');`
- BldDB: `try { localStorage.setItem('blddb_autosave', JSON.stringify(_data)); } catch(e) {}` with `StorageGuard.setItem('blddb_autosave', JSON.stringify(_data), 'Buildings DB autosave');`
- SttDB: `try { localStorage.setItem('sttdb_autosave', JSON.stringify(_data)); } catch(e) {}` with `StorageGuard.setItem('sttdb_autosave', JSON.stringify(_data), 'Settlements DB autosave');`
- UpgDB: `try { localStorage.setItem('upgdb_autosave', JSON.stringify(_data)); } catch(e) {}` with `StorageGuard.setItem('upgdb_autosave', JSON.stringify(_data), 'Upgrades DB autosave');`

- [ ] **Step 5: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/storage-errors.spec.ts tests/startup-sync.spec.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/storage-errors.spec.ts && git commit -m "$(cat <<'EOF'
fix(storage): surface autosave failures instead of swallowing them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: two consecutive `HexDB.add()` calls under a quota error yield exactly one `Hex DB autosave` toast (the 60 s per-label throttle), while the buildings toast is independent.

---

## T0.12 Map autosave moves to IndexedDB (localStorage only as legacy source / fallback)

Roadmap 0.6, part 2. Verified: `map_autosave` is ~2.2-2.4 MB of the ~5 MB localStorage quota, shared with `hexdb_autosave`, `blddb_autosave`, `sync_base_*`, `pkg_trash`.

**Files:**
- Modify: `MapEditorPro.html`
  - `IO`: add `_writeAutosave`/`_readAutosave` above `function _autoSave() {` (~6255); replace `_autoSave`; change `function tryRestoreAutosave() {` (~6278) to async
  - Startup: `const _mapRestored = IO.tryRestoreAutosave();` (~12844) and `window.addEventListener('beforeunload', () => IO.autoSave());` (~12908)
- Modify: `tests/storage-errors.spec.ts` (append)

**Interfaces:**
- Consumes: `IO._idb` (existing private helper over database `MapEditorPro`, object store `kv`), `StorageGuard.setItem` (T0.11).
- Produces:
  - IndexedDB `MapEditorPro` / store `kv` / key `map_autosave` holds the map JSON string
  - `IO.autoSave(): Promise<void>` (resolves when the write finished; falls back to `localStorage` through `StorageGuard` if IndexedDB fails; removes the legacy `localStorage.map_autosave` after a successful IndexedDB write)
  - `IO.tryRestoreAutosave(): Promise<boolean>` (reads IndexedDB first, then the legacy localStorage copy)
  - extra flush triggers: `pagehide` and `visibilitychange` (hidden) in addition to `beforeunload`

- [ ] **Step 1: Append failing tests to `tests/storage-errors.spec.ts`**

```ts
import { reloadEditor, FakeGitHub } from './helpers';

const readIdb = (page: any) => page.evaluate(() => new Promise<string | null>(res => {
  const r = indexedDB.open('MapEditorPro', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('kv').objectStore('kv').get('map_autosave');
    g.onsuccess = () => res(g.result ?? null);
  };
}));

test('the map autosave lives in IndexedDB, not localStorage, and survives a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => { mapData[5] = 'Rubble_1'; await IO.autoSave(); });
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBeNull();
  const stored = await readIdb(page);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).data[0][5]).toBe('Rubble_1');
  await reloadEditor(page);
  expect(await page.evaluate(() => [MAP_WIDTH, mapData[5]])).toEqual([30, 'Rubble_1']);
});

test('a legacy localStorage map autosave is restored and then retired', async ({ page }) => {
  const legacy = new FakeGitHub().json('maps/current_map.json');
  await openEditor(page, { storage: { map_autosave: JSON.stringify(legacy) } });
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([20, 20]);
  await page.evaluate(() => IO.autoSave());
  expect(await page.evaluate(() => localStorage.getItem('map_autosave'))).toBeNull();
  expect(await readIdb(page)).not.toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/storage-errors.spec.ts -g "IndexedDB|legacy"
```
Expected: test 1 fails (`localStorage.getItem('map_autosave')` is a string, not null); test 2 fails (key still present, IndexedDB empty).

- [ ] **Step 3: Replace `_autoSave` and add the storage helpers** (replace the whole `function _autoSave() { ... }` of `IO`, ~6255-6269; the helpers go directly above it)

```js
  // The map JSON is several MB: keep it in IndexedDB so it does not eat the 5 MB localStorage quota.
  async function _writeAutosave(json) {
    try {
      await _idb.set('map_autosave', json);
      try { localStorage.removeItem('map_autosave'); } catch(e) {}   // retire the legacy copy once the new one is safe
    } catch(err) {
      // IndexedDB unavailable (blocked, private window): fall back to localStorage and say so if that fails too
      StorageGuard.setItem('map_autosave', json, 'Map autosave');
    }
  }

  async function _readAutosave() {
    try {
      const v = await _idb.get('map_autosave');
      if (v) return v;
    } catch(e) {}
    try { return localStorage.getItem('map_autosave'); } catch(e) { return null; }
  }

  function _autoSave() {
    if (!mapData) return Promise.resolve();
    const json = _buildJson();
    // 1. IndexedDB (localStorage only as fallback)
    const saved = _writeAutosave(json);
    // 2. Best-effort async write to filesystem folder
    _getFsDir().then(dir => {
      if (!dir) return;
      dir.getFileHandle('map_session.json', { create: true })
        .then(fh => fh.createWritable())
        .then(w  => w.write(json).then(() => w.close()))
        .catch(() => {});
    });
    return saved;
  }
```
Make restore async: replace
```js
  function tryRestoreAutosave() {
    try {
      const saved = localStorage.getItem('map_autosave');
```
with
```js
  async function tryRestoreAutosave() {
    try {
      const saved = await _readAutosave();
```
(the rest of the function is unchanged). Also update the comment above it: it still says "Safe to call before Canvas.init()", which stays true.

- [ ] **Step 4: Startup wiring**

Change `const _mapRestored = IO.tryRestoreAutosave();` to `const _mapRestored = await IO.tryRestoreAutosave();` (the `load` handler is already `async`).
Replace `window.addEventListener('beforeunload', () => IO.autoSave());` with:
```js
  window.addEventListener('beforeunload', () => IO.autoSave());
  window.addEventListener('pagehide', () => IO.autoSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) IO.autoSave(); });
```

- [ ] **Step 5: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/storage-errors.spec.ts tests/startup-sync.spec.ts tests/map-load-warnings.spec.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/storage-errors.spec.ts && git commit -m "$(cat <<'EOF'
feat(io): store the map autosave in IndexedDB and flush on pagehide/hidden

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: a profile that only has the old `localStorage.map_autosave` (20x20 fixture) still restores its map, and the legacy key disappears only after the first successful IndexedDB write; an IndexedDB write started from `beforeunload` is best effort, which is why `pagehide` and `visibilitychange` flush as well.

---

## T0.13 Replace `alert()` and `prompt()` in `MapEditorPro.html`

Roadmap 0.7. Verified call sites (grep `alert(` / `prompt(`): `GitHubSync.publishMap` (`const rawName = prompt('Map filename:'`), `IO.setAutosaveFolder`, `IO._loadFromJSON` catch, `IO.initFileInput` catch, `LocalizationKeys.add`, `HexDB.promptReskin`, `BldDB.promptReskin`. The `confirm()` calls (~4814, 4866, 8415, 8443, 8514, 8749) are out of scope for this phase.

**Files:**
- Modify: `MapEditorPro.html`: the seven sites above
- Create: `tests/no-native-dialogs.spec.ts`

**Interfaces:**
- Consumes: `UI.alert`, `UI.prompt`, `UI.toast` (T0.1), `FakeGitHub`.
- Produces: `HexDB.promptReskin()` and `BldDB.promptReskin()` are async and use a `<select>` of existing postapoc ids (typing an unknown id is no longer possible). `_loadFromJSON` failure shows `UI.alert('Failed to load map', ...)`.

- [ ] **Step 1: Write the failing test `tests/no-native-dialogs.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor, FakeGitHub, ROOT } from './helpers';

const NATIVE = /(^|[^.\w])(alert|prompt)\(|window\.(alert|prompt)\(/;
for (const file of ['MapEditorPro.html']) {
  test(`${file} contains no native alert()/prompt()`, () => {
    const offenders = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      .filter(x => !x.l.startsWith('//') && NATIVE.test(x.l))
      .map(x => `${file}:${x.n}: ${x.l}`);
    expect(offenders).toEqual([]);
  });
}

test('a non-JSON map file opens an in-page dialog, not a native alert', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.setInputFiles('#file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await expect(page.locator('#dialog-title')).toHaveText('Could not read map file');
  await expect(page.locator('#dialog-msg')).toContainText('not valid JSON');
  expect(nativeDialogs).toEqual([]);
});

test('a structurally invalid map shows "Failed to load map"', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => IO.loadFromJSON({ width: 'x' }));
  await expect(page.locator('#dialog-title')).toHaveText('Failed to load map');
  await expect(page.locator('#dialog-msg')).toHaveText('Invalid map file format');
  expect(nativeDialogs).toEqual([]);
});

test('a duplicate localization key toasts instead of alerting', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { LocalizationKeys.add('dup_key', 'a', 'b'); LocalizationKeys.add('dup_key', 'c', 'd'); });
  await expect(page.locator('.toast', { hasText: 'Key "dup_key" already exists' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('reskin picker is a select of postapoc ids and adds the reskin', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'rk', name: 'Rk' }]);
  const { nativeDialogs } = await openEditor(page, { gh });
  await page.waitForFunction(() => !!Packages.getEntry('rk'));
  await page.evaluate(() => { Packages.setActive('rk'); HexDB.promptReskin(); });
  await page.locator('#dialog-input').selectOption('Plain_2');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Plain_2' && h.package === 'rk'))).toBe(true);
  expect(nativeDialogs).toEqual([]);
});

test('Publish Map asks for the file name in a dialog', async ({ page }) => {
  const gh = new FakeGitHub();
  const { nativeDialogs } = await openEditor(page, { gh, pat: true });
  await page.evaluate(() => { GitHubSync.publishMap(); });
  await page.fill('#dialog-input', 'my_map');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => gh.putPaths()).toContain('maps/my_map.json');
  expect(nativeDialogs).toEqual([]);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/no-native-dialogs.spec.ts
```
Expected: the lint test lists 7 offenders (`MapEditorPro.html:5131`, `:6125`, `:6541`, `:6617`, `:8404`, `:9920`, `:11335`); the dialog tests fail (`#dialog-title` never appears; native dialogs recorded).

- [ ] **Step 3: Replace the seven call sites**

1. `GitHubSync.publishMap`: `const rawName = prompt('Map filename:', _lastMapName || 'current_map');` to
```js
    const rawName = await UI.prompt('Publish map', 'Map filename:', _lastMapName || 'current_map');
```
(the `if (rawName === null) return;` below it stays).

2. `IO.setAutosaveFolder`: replace `alert('File System Access API not supported in this browser. Use Chrome or Edge.');` with
```js
      UI.alert('Autosave folder', 'The File System Access API is not supported in this browser. Use Chrome or Edge.');
```

3. `IO._loadFromJSON` catch: replace `alert('Failed to load map: ' + err.message);` with
```js
      UI.alert('Failed to load map', err.message, String(err.stack || ''));
```

4. `IO.initFileInput`: replace `catch(err) { alert('Failed to parse JSON: ' + err.message); }` with
```js
        catch(err) { UI.alert('Could not read map file', 'The file is not valid JSON: ' + err.message, file.name); }
```

5. `LocalizationKeys.add`: replace
`if (_entries.find(e => e.key === key)) { alert(\`Key "${key}" already exists.\`); return; }` with
```js
    if (_entries.find(e => e.key === key)) {
      UI.toast(`Key "${key}" already exists`, { detail: 'Pick another key or edit the existing entry.', ms: 4000 });
      return;
    }
```

6. `HexDB.promptReskin` (replace the whole function):
```js
  async function promptReskin() {
    if (typeof Packages === 'undefined' || Packages.getActive() === 'postapoc') {
      UI.toast('⚠ Select a non-default package first'); return;
    }
    const options = _data.hexes.filter(h => (h.package || 'postapoc') === 'postapoc').map(h => h.id);
    if (!options.length) { UI.toast('⚠ No postapoc hex tiles to reskin'); return; }
    const baseId = await UI.prompt('Reskin hex tile',
      'Reskin which postapoc hex id? The new entry keeps the same id, so it overrides that tile at runtime.',
      options[0], options);
    if (baseId) addReskin(baseId);
  }
```

7. `BldDB.promptReskin` (replace the whole function):
```js
  async function promptReskin() {
    if (typeof Packages === 'undefined' || Packages.getActive() === 'postapoc') {
      UI.toast('⚠ Select a non-default package first'); return;
    }
    const options = _data.buildings.filter(b => (b.package || 'postapoc') === 'postapoc').map(b => b.id);
    if (!options.length) { UI.toast('⚠ No postapoc buildings to reskin'); return; }
    const baseId = await UI.prompt('Reskin building',
      'Reskin which postapoc building id? The new entry keeps the same id, so it overrides that building at runtime.',
      options[0], options);
    if (baseId) addReskin(baseId);
  }
```

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/no-native-dialogs.spec.ts tests/dialogs.spec.ts
```
Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add MapEditorPro.html tests/no-native-dialogs.spec.ts && git commit -m "$(cat <<'EOF'
fix(ui): replace native alert and prompt with in-page dialogs and toasts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: a file containing `{not json` produces the `Could not read map file` dialog (not an uncaught error, not a native alert), and the source lint (`alert(`/`prompt(` not preceded by `.` or a word character, comments skipped) keeps `UI.alert`/`UI.prompt` legal while catching bare calls.

---

## T0.14 Replace `alert()`/`prompt()` in `zone-painter.js`

**Files:**
- Modify: `zone-painter.js`: `function _fillAllZones() {` (~498), `function _randomizeFillUI() {` (~568), `function _uiSavePreset() {` (~804)
- Modify: `tests/no-native-dialogs.spec.ts`

**Interfaces:**
- Consumes: `UI.toast`, `UI.prompt` (T0.1). `zone-painter.js` is a classic script loaded before the main script; `UI` is resolved at call time, so this is safe.
- Produces: `ZonePainter._uiSavePreset()` is now `async` (its only caller is an inline `onclick`, which ignores the return value).

- [ ] **Step 1: Extend the test**

Change `for (const file of ['MapEditorPro.html']) {` to `for (const file of ['MapEditorPro.html', 'zone-painter.js']) {` and append:
```ts
test('Save preset asks for the name in a dialog and confirms with a toast', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { ZonePainter._uiSavePreset(); });
  await page.fill('#dialog-input', 'My Test Preset');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.toast', { hasText: 'Preset "My Test Preset" saved' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('Fill Zones with no zones toasts instead of alerting', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.evaluate(() => { ZonePainter._fillAllZones(); });
  await expect(page.locator('.toast', { hasText: 'No zones defined' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test tests/no-native-dialogs.spec.ts -g "zone-painter|preset|Fill Zones"
```
Expected: the `zone-painter.js` lint test lists 4 offenders (`zone-painter.js:500`, `:569`, `:805`, `:814`); the two behaviour tests fail.

- [ ] **Step 3: Replace the four calls**

- `_fillAllZones`: `if (zones.length === 0) { alert('No zones defined.'); return; }` to
```js
    if (zones.length === 0) { UI.toast('⚠ No zones defined. Add a zone first.', { ms: 3000 }); return; }
```
- `_randomizeFillUI`: `if (typeof mapData === 'undefined' || !mapData) { alert('No map loaded.'); return; }` to
```js
    if (typeof mapData === 'undefined' || !mapData) { UI.toast('⚠ No map loaded'); return; }
```
- `_uiSavePreset`: change the signature and first line
```js
  async function _uiSavePreset() {
    const name = await UI.prompt('Save preset', 'Preset name:', _workingPreset?.name || 'My Preset');
```
(replacing `function _uiSavePreset() {` and `const name = prompt('Preset name:', _workingPreset?.name || 'My Preset');`), and the last line `alert(\`Preset "${trimmed}" saved.\`);` to
```js
    UI.toast(`Preset "${trimmed}" saved`);
```

- [ ] **Step 4: Run the whole suite**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test
```
Expected: every spec passes (including the untouched `tests/debug-modules.spec.ts`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && git add zone-painter.js tests/no-native-dialogs.spec.ts && git commit -m "$(cat <<'EOF'
fix(zones): replace native alert and prompt in the zone painter

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```
- Review focus: cancelling the preset prompt (`null`) must still return without saving (`if (!name || !name.trim()) return;` is unchanged), and the lint now covers both script files.

---

## Phase 0 exit check

- [ ] Run `cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && npx playwright test` and expect all specs green.
- [ ] Manual smoke in a real browser against `python3 -m http.server`: add a hex in HEXDB, reload, confirm it is still there (the original reproduction); load a 600x600 map and confirm the warning dialog appears.
- Known residual items, deliberately outside Phase 0: `confirm()` calls (~4814, 4866, 8415, 8443, 8514, 8749 in `MapEditorPro.html`, plus `zone-painter.js` ~613 and ~677); `IO.tryRestoreAutosave` still clamps silently when restoring an autosave (the autosave was produced by this editor, so it is already within range); local-only mode without a PAT (Phase 5, item 9); roll-back of a half-finished import (Phase 5, item 6).


---

## Phase 1: Performance at low zoom and on 450x450 maps

**Goal:** `Canvas.render` and the minimap stay cheap on a 450x450 map at any zoom, the whole map fits on screen, and Fill, Generator and Satellite import stop freezing the UI. Rendered output at zoom >= 25% must stay pixel-identical to today.

**Architecture:** Every change is first pinned by a pre-change baseline (T1.1): hashes of the rendered canvas, the minimap and `mapData` after Fill, Generator and Satellite. The baseline is committed before any optimisation. Optimisations then land one at a time and must keep those hashes. Cache invalidation is done by cheap revalidation inside the cache (compare against the live data), not by hooking the ~25 mutation sites of `roadsData`, `objectsData` and `mapData`, because those objects are mutated in place and reassigned from many places (Tools, History, IO load, Expand Map).

**Verified findings that shape the plan (read from the code, 2026-10-02):**
- `Terrain.byHexId` (~line 2401) does `HexDB.getAll().find(...)` with `toLowerCase()` and an object spread on every call. `render()` calls it 2-3 times per visible tile and `Coastline.computeEdges` calls it 6 more times per water tile. This is the dominant per-tile cost, so T1.2 memoises it before any culling work.
- `Terrain.getTerrainSpriteForType` (~2418) is also a linear `find` per layered tile.
- The tile loop in `render()` (~2854) visits all 202,500 cells and calls `hexScreenPos` (allocates an object, calls `hexCenterWorld`, which allocates another) before the cull test. At 25% only about 2-5% of the tiles are on screen.
- Roads and objects use `Object.entries(...)` plus `key.split(',').map(Number)` per frame. `bridgesData` is already an array of `{col,row,axis}`; it needs no parsing cache, only the existing cull test.
- `History._snapshot` (~4568) copies `mapData` (202,500 references, about 1.6 MB), the zone layer, and deep-copies `tileExtras` with JSON, per push, up to 50 times.
- `_fill` (~4186) uses `queue.shift()` (O(frontier)), a `Set` of numeric keys, and is synchronous.
- `Generator._generateInto` depends on `EdgeTiling.resolveEdgeTile`, which consumes the same seeded `rng` that the later scatter step uses. To stay deterministic the worker therefore needs the HexDB edge-mask table passed in (T1.10).
- `UI.progress(pct, label)` / `UI.progressDone(label)` already exist (~6049) and drive `#progress-wrap`; the worker tasks reuse them.
- Map pixel size is about 27,020 x 31,224 at 100%, so fit-to-screen on a 1400x900 canvas is about 2.8%; the 25% floor is the only thing stopping the map from fitting.
- Equivalence note: at zoom 25% `radius = 40 * 0.25 = 10`. The LOD thresholds in T1.12 are chosen so zoom >= 25% still takes the original draw path.

### Files touched

| File | Tasks | What changes |
|---|---|---|
| `MapEditorPro.html` | T1.2-T1.12 | Terrain memo, HexDB rev, Canvas render culling/overlay caches/colour layers/LOD/zoom floor, Tools fill, History snapshots, WorkerJobs, Generator, Satellite |
| `map-jobs.js` (new) | T1.9, T1.10 | DOM-free `MapJobs.satellite` / `MapJobs.generate`, used by the worker and as the synchronous fallback |
| `map-worker.js` (new) | T1.9 | Web Worker entry: `importScripts('map-jobs.js')`, dispatches jobs, posts progress/results |
| `tests/perf-scene.ts` (new) | T1.1 | Deterministic 450x450 scene, hashing and baseline helpers |
| `tests/perf-baseline.json` (new) | T1.1 | Pre-change hashes and timings (committed) |
| `tests/perf-equivalence.spec.ts` (new) | T1.1 | Render, minimap, Generator, Satellite, Fill hash equivalence |
| `tests/perf-timing.spec.ts` (new) | T1.1 | Records baseline timings |
| `tests/perf-terrain-memo.spec.ts`, `perf-culling.spec.ts`, `perf-overlays.spec.ts`, `perf-minimap.spec.ts`, `perf-undo-memory.spec.ts`, `perf-history.spec.ts`, `perf-fill.spec.ts`, `perf-workers.spec.ts`, `perf-zoom-floor.spec.ts`, `perf-lod.spec.ts` (new) | T1.2-T1.12 | One spec per task |

Conventions used below. Tests live flat in `tests/` and use `import { openEditor } from './helpers'` (from T0.0). Specs run with `npx playwright test tests/<file> --reporter=line`. The test viewport is fixed at 1400x900. Page globals such as `Canvas`, `Terrain`, `History`, `mapData` are top-level `const`/`let` in a classic script, so `page.evaluate` can reference them by bare name. Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task T1.1: Capture pre-change baselines (hashes and timings)

**Files:**
- Create: `tests/perf-scene.ts`
- Create: `tests/perf-equivalence.spec.ts`
- Create: `tests/perf-timing.spec.ts`
- Create: `tests/perf-baseline.json` (generated by running with `UPDATE_BASELINE=1`)
- No change to `MapEditorPro.html`. Do this task before any other Phase 1 task.

**Interfaces:**
- Produces (`tests/perf-scene.ts`): `VIEWPORT`, `setupScene(page)`, `frame(page, zoom)`, `hashCanvas(page, selector)`, `hashMapData(page)`, `checkBaseline(key, actual)`, `saveBaselineKey(key, value)`, `readBaseline()`, `medianMs(page, kind, runs?)`, `expectFasterThan(key, ms, factor)`.
- Consumes: `openEditor(page)` from `./helpers`; page globals `IO.newMap(true)` (anchor `function newMap(silent)`), `Canvas.setZoom/centerOnCity/render/drawMinimap/hexScreenPos`, `Terrain.getSprite`, `BldDB.getAll`, `UI.selectTerrain`, `Tools.setActive`, `Generator.apply`, `Satellite.open/apply`.

- [ ] **Step 1: Write the shared scene/baseline helper**

Create `tests/perf-scene.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

declare const IO: any, MAP_WIDTH: number, MAP_HEIGHT: number, mapData: string[], roadsData: any,
  objectsData: any, bridgesData: any[], BldDB: any, UI: any, Terrain: any, Canvas: any, Tools: any;

export const VIEWPORT = { width: 1400, height: 900 };
const BASELINE_FILE = path.join(__dirname, 'perf-baseline.json');

export function readBaseline(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { return {}; }
}
export function saveBaselineKey(key: string, value: any) {
  const b = readBaseline();
  b[key] = value;
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2) + '\n');
}
/** Hash baselines: UPDATE_BASELINE=1 (on UNMODIFIED code only) writes, otherwise compares. */
export function checkBaseline(key: string, actual: string) {
  if (process.env.UPDATE_BASELINE) { saveBaselineKey(key, actual); return; }
  const saved = readBaseline()[key];
  expect(saved, `baseline "${key}" missing: run with UPDATE_BASELINE=1 on pre-change code`).toBeDefined();
  expect(actual).toBe(saved);
}
/** Timing baselines: actual must be <= baseline * factor. */
export function expectFasterThan(key: string, ms: number, factor: number) {
  const base = readBaseline()[key];
  expect(base, `timing baseline "${key}" missing`).toBeGreaterThan(0);
  expect(ms, `${key}: ${ms.toFixed(2)}ms vs baseline ${base.toFixed?.(2)}ms x ${factor}`).toBeLessThanOrEqual(base * factor);
}

/** Deterministic 450x450 map with terrain mix, roads, objects and a bridge. */
export async function setupScene(page: Page) {
  await page.evaluate(async () => {
    const ids = ['Plain_1', 'Plain_2', 'Forest_1', 'Water_1', 'Hills_1', 'Rubble_1', 'Mountain_1', 'Water_Dirty_1'];
    IO.newMap(true);
    for (let r = 0; r < MAP_HEIGHT; r++)
      for (let c = 0; c < MAP_WIDTH; c++)
        mapData[r * MAP_WIDTH + c] = ids[(c * 31 + r * 17 + ((c >> 3) ^ (r >> 3))) % ids.length];
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
    for (let i = -20; i <= 20; i++) roadsData[(cc + i) + ',' + cr] = { type: 'road_hex' };
    for (let i = -20; i <= 20; i += 4) roadsData[cc + ',' + (cr + i)] = { type: 'road_hex' };
    const bld = BldDB.getAll().find((b: any) => b.id);
    if (bld) for (let i = 5; i < 40; i += 5) objectsData[(cc + i) + ',' + (cr + 8)] = bld.id;
    const axis = Object.keys(UI._bridgeSprites || {})[0] || 'NS';
    bridgesData.push({ col: cc - 10, row: cr - 6, axis });
    // wait until every sprite used by the scene has decoded so hashes are stable
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        if (ids.every(id => { const s = Terrain.getSprite(id); return s && s.complete && s.naturalWidth > 0; })) {
          clearInterval(t); resolve();
        }
      }, 50);
    });
  });
}

export async function frame(page: Page, zoom: number) {
  await page.evaluate(z => { Canvas.setZoom(z); Canvas.centerOnCity(); Canvas.render(); Canvas.drawMinimap(); }, zoom);
}

export async function hashCanvas(page: Page, selector: string): Promise<string> {
  return page.evaluate(sel => {
    const cv = document.querySelector(sel) as HTMLCanvasElement;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    const u = new Uint32Array(d.buffer);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
    return cv.width + 'x' + cv.height + ':' + h.toString(16);
  }, selector);
}

export async function hashMapData(page: Page): Promise<string> {
  return page.evaluate(() => {
    const s = mapData.join(',');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return mapData.length + ':' + h.toString(16);
  });
}

/** Median wall time including a canvas flush (getImageData) so deferred raster work is counted. */
export async function medianMs(page: Page, kind: 'render' | 'minimap', runs = 15): Promise<number> {
  return page.evaluate(({ kind, runs }) => {
    const t: number[] = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      if (kind === 'render') { Canvas.render(); Canvas.getCtx().getImageData(0, 0, 1, 1); }
      else { Canvas.drawMinimap(); (document.getElementById('minimap') as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1); }
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    return t[runs >> 1];
  }, { kind, runs });
}
```

- [ ] **Step 2: Write the equivalence spec (Render, Minimap, Fill, Generator, Satellite)**

Create `tests/perf-equivalence.spec.ts`:

```ts
import { test } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, hashMapData, checkBaseline } from './perf-scene';

declare const Canvas: any, UI: any, Tools: any, Generator: any, Satellite: any,
  mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;

test.use({ viewport: VIEWPORT });

for (const z of [25, 60, 100, 200]) {
  test(`render hash at zoom ${z}`, async ({ page }) => {
    await openEditor(page);
    await setupScene(page);
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  });
}

test('minimap hash', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('minimap', await hashCanvas(page, '#minimap'));
});

async function clickFill(page: any, mode: 'scene' | 'uniform') {
  const pt = await page.evaluate((mode: string) => {
    if (mode === 'uniform') mapData.fill('Plain_1');
    Canvas.setZoom(100); Canvas.centerOnCity();
    const col = Math.floor(MAP_WIDTH / 2), row = Math.floor((MAP_HEIGHT - 1) / 2);
    const target = mapData[row * MAP_WIDTH + col];
    UI.selectTerrain(target === 'Forest_1' ? 'Hills_1' : 'Forest_1');
    Tools.setActive('fill');
    Canvas.render();
    const p = Canvas.hexScreenPos(col, row);
    const r = (document.getElementById('map-canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, mode);
  await page.mouse.click(pt.x, pt.y);
  // pre-change Fill is synchronous (no whenIdle); T1.8 makes it async and adds Tools.whenIdle
  await page.evaluate(async () => { if (typeof Tools.whenIdle === 'function') await Tools.whenIdle(); });
}

for (const mode of ['scene', 'uniform'] as const) {
  test(`fill result (${mode})`, async ({ page }) => {
    await openEditor(page);
    await setupScene(page);
    await clickFill(page, mode);
    checkBaseline(`fill_${mode}`, await hashMapData(page));
  });
}

test('generator seed 42', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
  await page.evaluate(async () => { await Generator.apply(); });   // sync today, async after T1.10
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('satellite synthetic image', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const x = c.getContext('2d')!;
    for (let j = 0; j < 320; j += 16)
      for (let i = 0; i < 320; i += 16) {
        x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},${30 + (i % 5) * 12}%,${15 + (j % 7) * 10}%)`;
        x.fillRect(i, j, 16, 16);
      }
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.evaluate(() => Satellite.open());
  await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});
```

- [ ] **Step 3: Write the timing recorder**

Create `tests/perf-timing.spec.ts`:

```ts
import { test } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, medianMs, saveBaselineKey } from './perf-scene';

declare const Terrain: any;
test.use({ viewport: VIEWPORT });

test('record baseline timings', async ({ page }) => {
  test.skip(!process.env.UPDATE_BASELINE, 'timings are only recorded with UPDATE_BASELINE=1');
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 100]) {
    await frame(page, z);
    saveBaselineKey(`t_render_${z}`, await medianMs(page, 'render'));
  }
  await frame(page, 100);
  saveBaselineKey('t_minimap', await medianMs(page, 'minimap'));
  saveBaselineKey('t_byHexId_200k', await page.evaluate(() => {
    const ids = ['Plain_1', 'Forest_1', 'Water_1', 'Hills_1'];
    const s = performance.now();
    for (let i = 0; i < 200000; i++) Terrain.byHexId(ids[i & 3]);
    return performance.now() - s;
  }));
});
```

- [ ] **Step 4: Run once with `UPDATE_BASELINE=1` on UNMODIFIED code, then run again without it**

Run: `git status --short MapEditorPro.html` (expect no output; the editor must be unmodified), then
`UPDATE_BASELINE=1 npx playwright test tests/perf-equivalence.spec.ts tests/perf-timing.spec.ts --reporter=line`
Expected: all pass and `tests/perf-baseline.json` now has keys `render_25/60/100/200`, `minimap`, `fill_scene`, `fill_uniform`, `generator_seed42`, `satellite_synth`, `t_render_25`, `t_render_100`, `t_minimap`, `t_byHexId_200k`.
Run: `npx playwright test tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass (this proves the scene and hashes are deterministic across runs). If any hash flakes, the scene is not deterministic: fix the scene before continuing, do not loosen the comparison.

- [ ] **Step 5: Commit**

```bash
git add tests/perf-scene.ts tests/perf-equivalence.spec.ts tests/perf-timing.spec.ts tests/perf-baseline.json
git commit -m "test(perf): capture pre-optimisation render/minimap/fill/generator/satellite baselines

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: baseline.json was generated before any editor change (check `git log` order); the scene must exercise roads, objects, bridge and water coastline so overlay/cull regressions change a hash.

---

### Task T1.2: Memoise HexDB lookups used per tile

**Files:**
- Modify: `MapEditorPro.html` `HexDB` module: `let _secState = {};` (~8879), `function _autoSave()` (~8948), `function getAll() { return _data.hexes || []; }` (~10126), `return { init, add, addReskin, ... getAll, pickSprite, ...}` (~10324).
- Modify: `MapEditorPro.html` `Terrain` module: `function byHexId(hexId)` (~2401), `function getTerrainSpriteForType(type)` (~2418).
- Modify: `MapEditorPro.html` `Canvas._drawHexTile` (`const isBridge = /bridge/i.test(hexId || '')`, ~3053).
- Create: `tests/perf-terrain-memo.spec.ts`

**Interfaces:**
- Produces: `HexDB.getRev(): number` (bumped by every `_autoSave`), memoised `Terrain.byHexId(hexId)` (returns a stable shared object per id until HexDB changes), memoised entry lookup in `Terrain.getTerrainSpriteForType`.
- Consumes: `HexDB.getAll()`.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-terrain-memo.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, expectFasterThan } from './perf-scene';

declare const Terrain: any, HexDB: any;
test.use({ viewport: VIEWPORT });

test('byHexId returns a stable memoised object', async ({ page }) => {
  await openEditor(page);
  const same = await page.evaluate(() => Terrain.byHexId('Plain_1') === Terrain.byHexId('Plain_1'));
  expect(same).toBe(true);
});

test('200k byHexId calls are fast', async ({ page }) => {
  await openEditor(page);
  const ms = await page.evaluate(() => {
    const ids = ['Plain_1', 'Forest_1', 'Water_1', 'Hills_1'];
    const s = performance.now();
    for (let i = 0; i < 200000; i++) Terrain.byHexId(ids[i & 3]);
    return performance.now() - s;
  });
  expectFasterThan('t_byHexId_200k', ms, 0.25);
  expect(ms).toBeLessThan(100);
});

test('memo is invalidated when HexDB changes', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const before = Terrain.byHexId('Plain_1');
    const rev0 = HexDB.getRev();
    HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 },
      hexes: [{ id: 'Zz_1', type: 'Plains', spriteName: '', edgeFaces: [] }] });
    return { hadBefore: !!before, rev: HexDB.getRev() > rev0, plainGone: Terrain.byHexId('Plain_1') === null,
             zz: Terrain.byHexId('Zz_1')?.id };
  });
  expect(r).toEqual({ hadBefore: true, rev: true, plainGone: true, zz: 'Zz_1' });
});

test('render output unchanged and faster', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('render_100', await hashCanvas(page, '#map-canvas'));
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-terrain-memo.spec.ts --reporter=line`
Expected: FAIL: `byHexId returns a stable memoised object` (false: a fresh spread object each call), the 200k timing test, and `HexDB.getRev is not a function`.

- [ ] **Step 3: Implement the HexDB revision counter**

In `MapEditorPro.html`, in `HexDB`, replace
```js
  let _secState    = {};    // persisted collapse state per section key
```
with
```js
  let _secState    = {};    // persisted collapse state per section key
  let _rev         = 0;     // bumped on every persisted edit; Terrain memoisation keys off this
```
Replace
```js
  function _autoSave() {
    try { localStorage.setItem('hexdb_autosave', JSON.stringify(_data)); } catch(e) {}
  }
```
with
```js
  function _autoSave() {
    _rev++;
    try { localStorage.setItem('hexdb_autosave', JSON.stringify(_data)); } catch(e) {}
  }
```
Replace `function getAll() { return _data.hexes || []; }` with
```js
  function getAll() { return _data.hexes || []; }
  function getRev() { return _rev; }
```
In the module's return statement replace `getAll, pickSprite,` with `getAll, getRev, pickSprite,`.

- [ ] **Step 4: Implement the Terrain memo**

In the `Terrain` module replace the whole `byHexId` function with:
```js
  // ── HexDB lookup memo ───────────────────────────────────
  // byHexId/getTerrainSpriteForType run per visible tile per frame. The memo is dropped
  // whenever the HexDB array identity, its length, or HexDB.getRev() changes.
  let _memoSrc = null, _memoLen = -1, _memoRev = -1;
  const _byRaw = new Map();        // raw id string → { ...entry, name } | null
  const _typeEntry = new Map();    // raw type string → HexDB entry | null
  function _memoValid() {
    if (typeof HexDB === 'undefined') return false;
    const all = HexDB.getAll();
    const rev = HexDB.getRev ? HexDB.getRev() : 0;
    if (all !== _memoSrc || all.length !== _memoLen || rev !== _memoRev) {
      _byRaw.clear(); _typeEntry.clear();
      _memoSrc = all; _memoLen = all.length; _memoRev = rev;
    }
    return true;
  }

  // Case-insensitive HexDB lookup by hex ID string (memoised; the returned object is shared).
  function byHexId(hexId) {
    if (!hexId || typeof hexId !== 'string') return null;
    if (!_memoValid()) return null;
    let v = _byRaw.get(hexId);
    if (v === undefined) {
      const lo = hexId.toLowerCase();
      const h = HexDB.getAll().find(e => e.id && e.id.toLowerCase() === lo);
      v = h ? { ...h, name: h.id } : null;
      _byRaw.set(hexId, v);
    }
    return v;
  }
```
Replace the body of `getTerrainSpriteForType` with:
```js
  function getTerrainSpriteForType(type) {
    if (!type) return null;
    if (!_memoValid()) return null;
    let entry = _typeEntry.get(type);
    if (entry === undefined) {
      const lo = type.toLowerCase();
      entry = HexDB.getAll()
        .find(h => h.type && h.type.toLowerCase() === lo &&
                   h.spriteName && h.spriteName.toLowerCase().startsWith(lo)) || null;
      _typeEntry.set(type, entry);
    }
    return entry ? (sprites[entry.id.toLowerCase()] || null) : null;   // sprite looked up live: images load async
  }
```
Before saving run `grep -n "byHexId(" MapEditorPro.html` and confirm none of the 11 call sites assigns to a property of the returned object (verified at plan time: they only read `.type`, `.edgeFaces`, `.occupiedOffsets`, `.id`).

- [ ] **Step 5: Memoise the bridge-id regex in `_drawHexTile`**

In `Canvas`, above `function _drawHexTile`, add:
```js
  const _bridgeIdMemo = new Map();
  function _isBridgeId(hexId) {
    let v = _bridgeIdMemo.get(hexId);
    if (v === undefined) {
      v = /bridge/i.test(hexId || '') && !/^River_bridge_/i.test(hexId || '');
      _bridgeIdMemo.set(hexId, v);
    }
    return v;
  }
```
and replace `const isBridge = /bridge/i.test(hexId || '') && !/^River_bridge_/i.test(hexId || '');` with `const isBridge = _isBridgeId(hexId);`.

- [ ] **Step 6: Run, expect pass; run the whole equivalence suite**

Run: `npx playwright test tests/perf-terrain-memo.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass (render hashes unchanged).

- [ ] **Step 7: Commit**

```bash
git add MapEditorPro.html tests/perf-terrain-memo.spec.ts
git commit -m "perf(render): memoise HexDB lookups used per tile

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: invalidation (identity + length + `getRev`); confirm every HexDB mutation path ends in `_autoSave` (grep showed ~25 call sites) or changes array length.

---

### Task T1.3: Range-based culling in `Canvas.render`

**Files:**
- Modify: `MapEditorPro.html` `Canvas.render` (anchor `const _anchorPass = [];`, loop at ~2854-2869), `let _selectedSlotIdx = -1;` (~2756, add stats), Canvas return object (anchor `init, render, drawMinimap, forceRedraw,` ~3897).
- Create: `tests/perf-culling.spec.ts`

**Interfaces:**
- Produces: `Canvas.getStats(): { tilesVisited, tilesDrawn, overlayRebuilds, minimapRecolored }` (counters reset at the start of each `render()` except the last two, which are owned by T1.4/T1.5).
- Consumes: geometry constants `COL_PITCH`, `ROW_PITCH`, `STAGGER`, and the exact existing per-tile cull test (kept as the final authority so output is pixel-identical).

Derivation used by the code: `hexCenterWorld` gives `x = (MAP_HEIGHT-1-row) * COL_PITCH` and `y = (MAP_WIDTH-1-col) * ROW_PITCH + STAGGER - stg` with `stg` in `{0, STAGGER}`. So the y range of column `col` is `[k*ROW_PITCH, k*ROW_PITCH + STAGGER]` with `k = MAP_WIDTH-1-col`.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-culling.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs, expectFasterThan } from './perf-scene';

declare const Canvas: any;
test.use({ viewport: VIEWPORT });

test('only on-screen tiles are visited', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const [z, maxVisited] of [[100, 2500], [25, 12000]] as const) {
    await frame(page, z);
    const s = await page.evaluate(() => Canvas.getStats());
    expect(s.tilesVisited, `zoom ${z}`).toBeLessThan(maxVisited);
    expect(s.tilesDrawn).toBeGreaterThan(100);
    expect(s.tilesDrawn).toBeLessThanOrEqual(s.tilesVisited);
  }
});

test('culling keeps pixels identical at every zoom', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 60, 100, 200]) {
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  }
});

test('camera at map corners still draws edge tiles', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const drawn = await page.evaluate(() => {
    Canvas.setZoom(100);
    const out: number[] = [];
    for (const [cx, cy] of [[-1e6, -1e6], [1e6, 1e6], [-1e6, 1e6], [1e6, -1e6]]) {
      // clampCamera pins the camera to the nearest map edge
      (Canvas as any).getCamera();
      Canvas.jumpToBlock(cx < 0 ? 0 : 21, cy < 0 ? 0 : 21);
      Canvas.render();
      out.push(Canvas.getStats().tilesDrawn);
    }
    return out;
  });
  for (const n of drawn) expect(n).toBeGreaterThan(20);
});

test('render time at 25% drops vs baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 25);
  expectFasterThan('t_render_25', await medianMs(page, 'render'), 0.7);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-culling.spec.ts --reporter=line`
Expected: FAIL with `Canvas.getStats is not a function` (the equivalence test passes already).

- [ ] **Step 3: Add the stats counters and export**

After `let _selectedSlotIdx = -1;` add:
```js
  // Cheap counters for tests and profiling (render counters reset every frame).
  const _stats = { tilesVisited: 0, tilesDrawn: 0, overlayRebuilds: 0, minimapRecolored: 0 };
  function getStats() { return { ..._stats }; }
```
In the return object change `init, render, drawMinimap, forceRedraw,` to `init, render, drawMinimap, forceRedraw, getStats,`.

- [ ] **Step 4: Replace the full-grid loop with ranged loops**

In `render()` replace
```js
    const _anchorPass = [];   // multi-tile anchors: drawn again in second pass

    for (let row = 0; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        const s = hexScreenPos(col, row);
        if (s.x + padding < 0 || s.x - padding > canvas.width  ||
            s.y + padding < 0 || s.y - padding > canvas.height) continue;
```
with
```js
    const _anchorPass = [];   // multi-tile anchors: drawn again in second pass

    // Visible row/col ranges, widened by one cell. The exact per-tile test below stays the
    // final authority, so output is identical to the old full-grid loop; draw order
    // (row ascending, col ascending) is preserved.
    _stats.tilesVisited = 0; _stats.tilesDrawn = 0;
    const wxMin = (cameraX - padding) / scale, wxMax = (cameraX + canvas.width  + padding) / scale;
    const wyMin = (cameraY - padding) / scale, wyMax = (cameraY + canvas.height + padding) / scale;
    const xiMin = Math.ceil(wxMin / COL_PITCH) - 1, xiMax = Math.floor(wxMax / COL_PITCH) + 1;
    const rowMin = Math.max(0, MAP_HEIGHT - 1 - xiMax), rowMax = Math.min(MAP_HEIGHT - 1, MAP_HEIGHT - 1 - xiMin);
    const kMin = Math.ceil((wyMin - STAGGER) / ROW_PITCH) - 1, kMax = Math.floor(wyMax / ROW_PITCH) + 1;
    const colMin = Math.max(0, MAP_WIDTH - 1 - kMax), colMax = Math.min(MAP_WIDTH - 1, MAP_WIDTH - 1 - kMin);

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        _stats.tilesVisited++;
        const s = hexScreenPos(col, row);
        if (s.x + padding < 0 || s.x - padding > canvas.width  ||
            s.y + padding < 0 || s.y - padding > canvas.height) continue;
        _stats.tilesDrawn++;
```

- [ ] **Step 5: Run, expect pass, then the equivalence suite**

Run: `npx playwright test tests/perf-culling.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass. If `render_*` hashes differ, the ranges are too tight: widen the `- 1` / `+ 1` margins by one more cell, never loosen the hash check.

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html tests/perf-culling.spec.ts
git commit -m "perf(render): range-based tile culling in Canvas.render

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: the algebra of the row/col ranges against `hexCenterWorld` (stagger on odd world columns), and that the kept per-tile test makes the ranges purely an optimisation.

---

### Task T1.4: Cached road/object overlay lists (bridges: cull only)

**Files:**
- Modify: `MapEditorPro.html` `Canvas.render` blocks `// Road overlays` (`Object.entries(roadsData)`, ~2906) and `// Pre-placed object overlays` (`Object.entries(objectsData)`, ~2915); add the cache helpers above `function _drawBridgeOverlay` (~3011).
- Create: `tests/perf-overlays.spec.ts`

**Interfaces:**
- Produces: `_syncKeyCache(cache, obj, trackValues)`; increments `_stats.overlayRebuilds` when the parsed list is rebuilt.
- Consumes: `roadsData`, `objectsData` (mutated in place and reassigned all over the file: Tools ~4272-4382, History `_restore` ~4595, IO load ~6287-6465, Expand Map ~6781), `Roads.calcBitmask(col,row)`.
- Note: `bridgesData.forEach` already iterates an array and culls without string parsing, so it is left as is. Revalidation (a key/value comparison against the live object, no string parsing) is used instead of invalidation hooks so no mutation site can be missed.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-overlays.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs } from './perf-scene';

declare const Canvas: any, roadsData: any, objectsData: any;
test.use({ viewport: VIEWPORT });

test('overlay lists are cached and revalidated', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const rebuilds = () => Canvas.getStats().overlayRebuilds;
    Canvas.render(); const a = rebuilds();
    Canvas.render(); const b = rebuilds();                    // unchanged data: no rebuild
    roadsData['3,3'] = { type: 'road_hex' }; Canvas.render(); const c = rebuilds();   // key added
    const k = Object.keys(objectsData)[0];
    objectsData[k] = objectsData[k] + '_x'; Canvas.render(); const d = rebuilds();    // value changed in place
    roadsData = { ...roadsData }; Canvas.render(); const e = rebuilds();              // reassigned, same content
    return { a, b, c, d, e };
  });
  expect(r.b).toBe(r.a);
  expect(r.c).toBeGreaterThan(r.b);
  expect(r.d).toBeGreaterThan(r.c);
  expect(r.e).toBe(r.d);
});

test('30k off-screen roads add almost no render time', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const base = await medianMs(page, 'render');
  await page.evaluate(() => { for (let i = 0; i < 30000; i++) roadsData[(i % 150) + ',' + (i / 150 | 0)] = { type: 'road_hex' }; });
  const withRoads = await medianMs(page, 'render');
  expect(withRoads - base).toBeLessThan(3);
});

test('overlay caching keeps pixels identical', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 100]) {
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  }
});
```
(`roadsData = {...}` works from `evaluate` because `roadsData` is a global `let`.)

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-overlays.spec.ts --reporter=line`
Expected: FAIL: `overlayRebuilds` is always 0 (so `r.c > r.b` fails) and the 30k-roads delta exceeds 3 ms.

- [ ] **Step 3: Add the cache helpers**

Above `function _drawBridgeOverlay(cx, cy, radius, axis) {` add:
```js
  // ── Overlay key caches ───────────────────────────────────
  // roadsData/objectsData are {"col,row": value} maps mutated in place and reassigned from
  // many places, so instead of invalidation hooks the cache revalidates by comparing the
  // live key order (and values, for objects) with the cached copy: no string parsing,
  // no allocation when nothing changed.
  const _roadCache   = { keys: [], vals: [], cols: [], rows: [] };
  const _objectCache = { keys: [], vals: [], cols: [], rows: [] };
  function _syncKeyCache(cache, obj, trackValues) {
    let i = 0, same = true;
    for (const k in obj) {
      if (i >= cache.keys.length || cache.keys[i] !== k || (trackValues && cache.vals[i] !== obj[k])) { same = false; break; }
      i++;
    }
    if (same && i === cache.keys.length) return cache;
    const keys = Object.keys(obj);
    cache.keys = keys;
    cache.vals = trackValues ? keys.map(k => obj[k]) : [];
    cache.cols = new Array(keys.length);
    cache.rows = new Array(keys.length);
    for (let j = 0; j < keys.length; j++) {
      const comma = keys[j].indexOf(',');
      cache.cols[j] = +keys[j].slice(0, comma);
      cache.rows[j] = +keys[j].slice(comma + 1);
    }
    _stats.overlayRebuilds++;
    return cache;
  }
```

- [ ] **Step 4: Use the caches in `render()`**

Replace
```js
    // Road overlays
    Object.entries(roadsData).forEach(([key]) => {
      const [col, row] = key.split(',').map(Number);
      const pos = hexScreenPos(col, row);
      if (pos.x + radius < 0 || pos.x - radius > canvas.width ||
          pos.y + radius < 0 || pos.y - radius > canvas.height) return;
      _drawRoadOverlay(pos.x, pos.y, radius, Roads.calcBitmask(col, row));
    });

    // Pre-placed object overlays
    Object.entries(objectsData).forEach(([key, bldId]) => {
      const [col, row] = key.split(',').map(Number);
      const pos = hexScreenPos(col, row);
      if (pos.x + radius < 0 || pos.x - radius > canvas.width ||
          pos.y + radius < 0 || pos.y - radius > canvas.height) return;
      _drawObjectOverlay(pos.x, pos.y, radius, bldId);
    });
```
with
```js
    // Road overlays (parsed key list cached, see _syncKeyCache)
    const _rc = _syncKeyCache(_roadCache, roadsData, false);
    for (let i = 0; i < _rc.keys.length; i++) {
      const col = _rc.cols[i], row = _rc.rows[i];
      const pos = hexScreenPos(col, row);
      if (pos.x + radius < 0 || pos.x - radius > canvas.width ||
          pos.y + radius < 0 || pos.y - radius > canvas.height) continue;
      _drawRoadOverlay(pos.x, pos.y, radius, Roads.calcBitmask(col, row));
    }

    // Pre-placed object overlays
    const _oc = _syncKeyCache(_objectCache, objectsData, true);
    for (let i = 0; i < _oc.keys.length; i++) {
      const pos = hexScreenPos(_oc.cols[i], _oc.rows[i]);
      if (pos.x + radius < 0 || pos.x - radius > canvas.width ||
          pos.y + radius < 0 || pos.y - radius > canvas.height) continue;
      _drawObjectOverlay(pos.x, pos.y, radius, _oc.vals[i]);
    }
```

- [ ] **Step 5: Run, expect pass, then the equivalence suite**

Run: `npx playwright test tests/perf-overlays.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html tests/perf-overlays.spec.ts
git commit -m "perf(render): cache parsed road/object overlay keys

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: iteration order equals `Object.entries` order (insertion order), so overlay stacking is unchanged; `calcBitmask` still runs only for on-screen roads (its `settlements.some`/`BldDB.find` cost is a known remaining hotspot at very high road counts).

---

### Task T1.5: Cached incremental colour layer and minimap

**Files:**
- Modify: `MapEditorPro.html` `Canvas.drawMinimap` (anchor `const imgD = mCtx.createImageData(mw, mh);` ~3232-3245); add `_colorOf`, `_makeColorLayer`, `_minimapLayer` just above `function drawMinimap()`.
- Create: `tests/perf-minimap.spec.ts`

**Interfaces:**
- Produces: `_makeColorLayer(): (pw, ph) => HTMLCanvasElement` — an offscreen canvas, one pixel per sample cell, recolouring only pixels whose source tile id changed since the last call; sets `_stats.minimapRecolored` to the number of recoloured pixels. `_colorOf(id): [r,g,b]` (memoised `Terrain.color`). T1.12 reuses `_makeColorLayer` for the low-zoom overview.
- Consumes: `Terrain.color(id)`, `mapData`, `MAP_WIDTH`, `MAP_HEIGHT`.
- Why compare-based and not hook-based: undo/redo, Fill, Generator, Satellite, Expand and load all rewrite `mapData` directly. A pointer-compare scan over 48,400 minimap pixels (about 0.2 ms) is exact for all of them.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-minimap.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs, expectFasterThan } from './perf-scene';

declare const Canvas: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

test('minimap pixels identical to baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('minimap', await hashCanvas(page, '#minimap'));
});

test('only changed tiles are recoloured', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  const r = await page.evaluate(() => {
    const mc = document.getElementById('minimap') as HTMLCanvasElement;
    Canvas.drawMinimap(); const first = Canvas.getStats().minimapRecolored;
    Canvas.drawMinimap(); const none = Canvas.getStats().minimapRecolored;
    // the tile sampled by minimap pixel (10,10)
    const row = MAP_HEIGHT - 1 - Math.floor(10 / mc.width * MAP_HEIGHT);
    const col = MAP_WIDTH - 1 - Math.floor(10 / mc.height * MAP_WIDTH);
    mapData[row * MAP_WIDTH + col] = mapData[row * MAP_WIDTH + col] === 'Lava_Plain_1' ? 'Rift_1' : 'Lava_Plain_1';
    Canvas.drawMinimap(); const one = Canvas.getStats().minimapRecolored;
    return { first, none, one };
  });
  expect(r.none).toBe(0);
  expect(r.one).toBe(1);
});

test('minimap redraw is faster than baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  expectFasterThan('t_minimap', await medianMs(page, 'minimap'), 0.6);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-minimap.spec.ts --reporter=line`
Expected: FAIL (`minimapRecolored` stays 0 so `r.one` is 0, and the timing test fails).

- [ ] **Step 3: Add the colour layer**

Immediately above `// ── Minimap ───...` / `function drawMinimap() {` add:
```js
  // ── Cached colour layers (minimap now; low-zoom overview in T1.12) ──────
  const _colorMemo = new Map();
  function _colorOf(id) {
    let c = _colorMemo.get(id);
    if (c === undefined) { c = Terrain.color(id); _colorMemo.set(id, c); }
    return c;
  }
  // Returns update(pw, ph) → offscreen canvas of pw×ph pixels where pixel (px,py) shows the
  // tile at row = MAP_HEIGHT-1-floor(px/pw*MAP_HEIGHT), col = MAP_WIDTH-1-floor(py/ph*MAP_WIDTH)
  // (same mapping the minimap always used). Only pixels whose tile id changed are recoloured.
  function _makeColorLayer() {
    let cv = null, cx = null, img = null, lastIds = null, srcIdx = null, key = '';
    return function update(pw, ph) {
      const k = pw + 'x' + ph + ':' + MAP_WIDTH + 'x' + MAP_HEIGHT;
      if (k !== key) {
        key = k;
        cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
        cx = cv.getContext('2d');
        img = cx.createImageData(pw, ph);
        lastIds = new Array(pw * ph);          // undefined → every pixel dirty on first pass
        srcIdx = new Int32Array(pw * ph);
        for (let py = 0; py < ph; py++) {
          const col = MAP_WIDTH - 1 - Math.floor(py / ph * MAP_WIDTH);
          for (let px = 0; px < pw; px++) {
            const row = MAP_HEIGHT - 1 - Math.floor(px / pw * MAP_HEIGHT);
            srcIdx[py * pw + px] = row * MAP_WIDTH + col;
          }
        }
      }
      const d = img.data, n = pw * ph;
      let dirty = 0;
      for (let i = 0; i < n; i++) {
        const id = mapData[srcIdx[i]];
        if (id === lastIds[i]) continue;
        lastIds[i] = id;
        const c = _colorOf(id), o = i * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        dirty++;
      }
      if (dirty) cx.putImageData(img, 0, 0);
      _stats.minimapRecolored = dirty;
      return cv;
    };
  }
  const _minimapLayer = _makeColorLayer();
```

- [ ] **Step 4: Use it in `drawMinimap`**

Replace
```js
    const mw = mc.width, mh = mc.height;
    const imgD = mCtx.createImageData(mw, mh);

    for (let py = 0; py < mh; py++) {
      for (let px = 0; px < mw; px++) {
        // Match new hexCenterWorld axes: px→x→row (E-W, flipped), py→y→col (N-S, flipped)
        const row = MAP_HEIGHT - 1 - Math.floor(px / mw * MAP_HEIGHT);
        const col = MAP_WIDTH  - 1 - Math.floor(py / mh * MAP_WIDTH);
        const id  = mapData[row * MAP_WIDTH + col];
        const [r, g, b] = Terrain.color(id);
        const i = (py * mw + px) * 4;
        imgD.data[i] = r; imgD.data[i+1] = g; imgD.data[i+2] = b; imgD.data[i+3] = 255;
      }
    }
    mCtx.putImageData(imgD, 0, 0);
```
with
```js
    const mw = mc.width, mh = mc.height;
    // px→x→row (E-W, flipped), py→y→col (N-S, flipped); see _makeColorLayer
    mCtx.drawImage(_minimapLayer(mw, mh), 0, 0);
```

- [ ] **Step 5: Run, expect pass, then the equivalence suite**

Run: `npx playwright test tests/perf-minimap.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass (`minimap` hash identical: the layer holds opaque pixels so `drawImage` at 1:1 equals `putImageData`).

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html tests/perf-minimap.spec.ts
git commit -m "perf(minimap): cached incremental colour layer for the minimap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: `lastIds` seeded with `undefined` so the first pass colours everything; the cache key includes map dimensions so Expand Map and New Map rebuild it.

---

### Task T1.6: Measure undo memory (decision gate for T1.7)

**Files:**
- Create: `tests/perf-undo-memory.spec.ts`
- No change to `MapEditorPro.html`.

**Interfaces:**
- Consumes: `History.push()` (anchor `function push()` ~4602), globals `mapData`, `tileExtras`, `roadsData`.
- Produces: `test-results/undo-memory.json` with `{ totalMB, perSnapshotMB, p95PushMs }` and a printed verdict line.

**Decision rule (applied in Step 3):** implement T1.7 only if `totalMB >= 64` (50 pushes) OR `p95PushMs >= 8`. Otherwise mark T1.7 "skipped: measured below threshold" in the PR description and move on. Expected: `mapData.slice()` is 202,500 references (~1.6 MB) plus the zone layer plus the `tileExtras` JSON deep copy, so roughly 3-4 MB per snapshot, about 150-200 MB at 50 steps, which crosses the threshold.

- [ ] **Step 1: Write the measurement spec**

Create `tests/perf-undo-memory.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene } from './perf-scene';

declare const History: any, mapData: string[], tileExtras: any, roadsData: any;

test.use({ viewport: VIEWPORT, launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } });

test('measure undo history memory over 50 pushes', async ({ page }, testInfo) => {
  await openEditor(page);
  await setupScene(page);
  const res = await page.evaluate(async () => {
    const gc = (window as any).gc as () => void;
    const settle = async () => { gc(); await new Promise(r => setTimeout(r, 100)); gc(); };
    for (let i = 0; i < 2000; i++) tileExtras[(i % 450) + ',' + (i / 450 | 0)] = { underTerrainId: 'Water_1' };
    for (let i = 0; i < 3000; i++) roadsData[(200 + i % 50) + ',' + (200 + i / 50 | 0)] = { type: 'road_hex' };
    History.clear();
    await settle();
    const mem = () => (performance as any).memory.usedJSHeapSize as number;
    const before = mem();
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      mapData[(i * 7919) % mapData.length] = i % 2 ? 'Water_1' : 'Plain_1';   // a one-tile edit per step
      const s = performance.now();
      History.push();
      times.push(performance.now() - s);
    }
    await settle();
    const after = mem();
    times.sort((a, b) => a - b);
    return { totalMB: (after - before) / 1048576, p95PushMs: times[Math.floor(times.length * 0.95)] };
  });
  const out = { ...res, perSnapshotMB: res.totalMB / 50 };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/undo-memory.json', JSON.stringify(out, null, 2));
  const justified = out.totalMB >= 64 || out.p95PushMs >= 8;
  console.log(`UNDO MEMORY: total=${out.totalMB.toFixed(1)}MB per-snapshot=${out.perSnapshotMB.toFixed(2)}MB p95-push=${out.p95PushMs.toFixed(2)}ms -> T1.7 ${justified ? 'JUSTIFIED' : 'SKIP'}`);
  expect(Number.isFinite(out.totalMB)).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/perf-undo-memory.spec.ts --reporter=line`
Expected: PASS, with a `UNDO MEMORY:` line in the output.

- [ ] **Step 3: Record the verdict and commit**

If the line says `SKIP`, add `T1.7: skipped (measured X MB / Y ms)` to the PR description and do not do T1.7. If `JUSTIFIED`, continue with T1.7 and keep this spec: T1.7 re-runs it as the after-measurement.
```bash
git add tests/perf-undo-memory.spec.ts
git commit -m "test(perf): measure undo history memory and push latency

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: the GC flags are launch options for this spec only; the threshold constants (64 MB, 8 ms) are in the spec and in this task's text, keep them in sync.

---

### Task T1.7 (conditional on T1.6 verdict JUSTIFIED): Structural-sharing history snapshots

**Why not literal diffs:** `History.push()` is called before the edit (pre-state), so a diff cannot be computed at push time without a live shadow copy, and Expand Map, roads, objects, settlements and zone layer all share the same snapshot object. Row-chunk structural sharing gives diff-level memory (an edit that touches a few rows stores only those rows) with unchanged undo/redo semantics and no new correctness surface.

**Files:**
- Modify: `MapEditorPro.html` `History` module: `function _snapshot()` (~4568), `function _restore(snap)` (~4584), return statement `return { push, undo, redo, clear, undoSize, redoSize, initKeyboard };` (~4652).
- Create: `tests/perf-history.spec.ts`

**Interfaces:**
- Produces: snapshot shape `{ gridRows: Array<Array|TypedArray>, gridW, zoneRows, zoneW, ...unchanged fields }`; `History.debugRowCount(): number` (distinct row arrays referenced by the undo+redo stacks).
- Consumes: `mapData`, `ZonePainter.getZoneLayer()`, `tileExtras`, `settlements`, `settlementSlots`, `bridgesData`, `objectsData`, `roadsData`.

- [ ] **Step 1: Write the failing tests**

Create `tests/perf-history.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, hashMapData } from './perf-scene';

declare const History: any, mapData: string[], tileExtras: any, roadsData: any, objectsData: any,
  MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

test('undo/redo restores every field exactly', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    const sig = () => JSON.stringify([mapData.length, mapData.join(','), tileExtras, roadsData, objectsData]);
    History.clear();
    const s0 = sig();
    History.push();
    mapData[5] = 'Lava_Plain_1'; mapData[450 * 300 + 12] = 'Rift_1';
    tileExtras['7,7'] = { underTerrainId: 'Water_1' };
    delete roadsData[Object.keys(roadsData)[0]];
    const s1 = sig();
    History.push();
    mapData[9] = 'Oil_1';
    objectsData['1,1'] = 'x';
    const s2 = sig();
    History.undo(); const afterUndo1 = sig();
    History.undo(); const afterUndo2 = sig();
    History.redo(); const afterRedo1 = sig();
    History.redo(); const afterRedo2 = sig();
    return { s0, s1, s2, afterUndo1, afterUndo2, afterRedo1, afterRedo2 };
  });
  expect(r.afterUndo1).toBe(r.s1);
  expect(r.afterUndo2).toBe(r.s0);
  expect(r.afterRedo1).toBe(r.s1);
  expect(r.afterRedo2).toBe(r.s2);
});

test('50-step cap still evicts the oldest', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const size = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 55; i++) { mapData[i] = 'Oil_1'; History.push(); }
    return History.undoSize();
  });
  expect(size).toBe(50);
});

test('50 one-tile edits share almost all row storage', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const rows = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 50; i++) { mapData[(i * 7919) % mapData.length] = i % 2 ? 'Water_1' : 'Plain_1'; History.push(); }
    return { distinct: History.debugRowCount(), height: MAP_HEIGHT };
  });
  // one full copy (450 rows) + at most 2 changed rows per step
  expect(rows.distinct).toBeLessThanOrEqual(rows.height + 50 * 2 + 10);
});
```
The memory spec from T1.6 is the quantitative after-measurement (Step 5).

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-history.spec.ts --reporter=line`
Expected: first two tests PASS (current behaviour), third FAILS with `History.debugRowCount is not a function`.

- [ ] **Step 3: Implement row-sharing snapshots**

In `History`, replace `_snapshot` and the first line of `_restore`. Replace
```js
  function _snapshot() {
    const zl = typeof ZonePainter !== 'undefined' ? ZonePainter.getZoneLayer() : null;
    return {
      grid:        mapData.slice(),
```
and its `zoneLayer`/`tileExtras` lines so the function reads:
```js
  // Structural sharing: a snapshot stores each grid as an array of per-row slices. A row equal
  // to the same row of the previous snapshot reuses that slice, so a few-tile edit costs a few
  // rows instead of a full 202,500-entry copy. Snapshots are immutable; _restore copies out.
  let _last = null;   // most recently taken snapshot (sharing source)

  function _shareRows(src, prevRows, prevW, W) {
    const n = Math.ceil(src.length / W), rows = new Array(n);
    for (let r = 0; r < n; r++) {
      const start = r * W, end = Math.min(start + W, src.length);
      const prev = (prevRows && prevW === W) ? prevRows[r] : null;
      let same = !!prev && prev.length === end - start;
      if (same) for (let i = start, j = 0; i < end; i++, j++) if (prev[j] !== src[i]) { same = false; break; }
      rows[r] = same ? prev : src.slice(start, end);
    }
    return rows;
  }
  function _copyRows(dest, rows) {
    let o = 0;
    for (const row of rows) { for (let j = 0; j < row.length; j++) dest[o + j] = row[j]; o += row.length; }
  }
  function _cloneExtras(src, prev) {
    const out = {};
    for (const k in src) {
      const v = src[k], pv = prev ? prev[k] : undefined;
      out[k] = (pv !== undefined && JSON.stringify(pv) === JSON.stringify(v)) ? pv : JSON.parse(JSON.stringify(v));
    }
    return out;
  }

  function _snapshot() {
    const zl = typeof ZonePainter !== 'undefined' ? ZonePainter.getZoneLayer() : null;
    const snap = {
      gridW:       MAP_WIDTH,
      gridRows:    _shareRows(mapData, _last && _last.gridRows, _last && _last.gridW, MAP_WIDTH),
      zoneRows:    zl ? _shareRows(zl, _last && _last.zoneRows, _last && _last.gridW, MAP_WIDTH) : null,
      settlements: settlements.map(s => Object.assign({}, s)),
      slots:       settlementSlots.map(s => Object.assign({}, s)),
      p1:          [...settlementPriority1],
      p2:          [...settlementPriority2],
      bridges:     bridgesData.map(b => Object.assign({}, b)),
      objects:     Object.assign({}, objectsData),
      tileExtras:  _cloneExtras(tileExtras, _last && _last.tileExtras),
      roads:       Object.assign({}, roadsData),
    };
    _last = snap;
    return snap;
  }
```
(this replaces the whole old `_snapshot` body including its `zoneLayer`, `tileExtras` JSON copy lines), and in `_restore` replace
```js
    for (let i = 0; i < snap.grid.length; i++) mapData[i] = snap.grid[i];
```
with
```js
    _copyRows(mapData, snap.gridRows);
```
and replace
```js
    if (snap.zoneLayer && typeof ZonePainter !== 'undefined') {
      const zl = ZonePainter.getZoneLayer();
      if (zl && zl.length === snap.zoneLayer.length) zl.set(snap.zoneLayer);
    }
```
with
```js
    if (snap.zoneRows && typeof ZonePainter !== 'undefined') {
      const zl = ZonePainter.getZoneLayer();
      const len = snap.zoneRows.reduce((n, r) => n + r.length, 0);
      if (zl && zl.length === len) _copyRows(zl, snap.zoneRows);
    }
```
Leave `tileExtras = snap.tileExtras ? JSON.parse(JSON.stringify(snap.tileExtras)) : {};` in `_restore` untouched: the deep copy on restore is what keeps shared snapshot objects from being mutated by live edits. Finally add the debug helper and export it:
```js
  function debugRowCount() {
    const seen = new Set();
    for (const s of _undo.concat(_redo)) { s.gridRows.forEach(r => seen.add(r)); if (s.zoneRows) s.zoneRows.forEach(r => seen.add(r)); }
    return seen.size;
  }
```
and change the return to `return { push, undo, redo, clear, undoSize, redoSize, initKeyboard, debugRowCount };`. In `clear()` also add `_last = null;`.

Note: `_last` is also advanced by the snapshots taken inside `undo()`/`redo()`; that is fine because sharing is only an optimisation and every snapshot is immutable.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/perf-history.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Re-measure and commit**

Run: `npx playwright test tests/perf-undo-memory.spec.ts --reporter=line`
Expected: `UNDO MEMORY:` line with `total` well below the T1.6 figure (target: under 15 MB for 50 one-tile steps) and `p95-push` not worse. If the total is still above 15 MB, the cause is `roads`/`objects` copies or `tileExtras` stringify; report the number rather than raising the target.
```bash
git add MapEditorPro.html tests/perf-history.spec.ts
git commit -m "perf(history): share unchanged grid rows between undo snapshots

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: Expand Map changes `MAP_WIDTH`, so `_shareRows` refuses to share across different widths and `_restore` still copies the old length; confirm undo after Expand behaves exactly as before (it was already lossy for the grid length).

---

### Task T1.8: Fill with an indexed queue, chunked so the UI does not block

**Files:**
- Modify: `MapEditorPro.html` `Tools._fill` (anchor `function _fill(col, row) {`, ~4186-4217), `Tools._onDown` `case 'fill':` (~4421) and the start of `_onDown` (anchor `function _onDown(sx, sy, e) {` ~4410), Tools return (anchor `return { init, setActive, getActive, selectBuilding, getSelectedBuildingId };` ~4558), `History.undo`/`History.redo` (~4609, ~4619).
- Create: `tests/perf-fill.spec.ts`

**Interfaces:**
- Produces: `_fill(col,row): Promise<void>` (resolves when the fill and edge re-resolution are done), `Tools.whenIdle(): Promise<void>`, `Tools.isFillBusy(): boolean`.
- Consumes: `getSatelliteAnchor(c,r)`, `invalidateSatelliteMap()`, `_autoResolveEdgesAround(cells)`, `UI.progress/progressDone`, `Canvas.render`.
- Behaviour kept: identical neighbour formula (parity of `c`), tiles under a multi-tile footprint are neither written nor expanded, `visited` (every enqueued tile, in BFS order) feeds `_autoResolveEdgesAround`.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-fill.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, hashMapData, checkBaseline } from './perf-scene';

declare const Canvas: any, UI: any, Tools: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });

test('uniform full-map fill does not block the main thread', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  expect(await page.evaluate(() => typeof Tools.whenIdle === 'function' && typeof Tools.isFillBusy === 'function')).toBe(true);
  const pt = await page.evaluate(() => {
    mapData.fill('Plain_1');
    Canvas.setZoom(100); Canvas.centerOnCity();
    UI.selectTerrain('Forest_1'); Tools.setActive('fill'); Canvas.render();
    const p = Canvas.hexScreenPos(Math.floor(MAP_WIDTH / 2), Math.floor((MAP_HEIGHT - 1) / 2));
    const r = (document.getElementById('map-canvas') as HTMLCanvasElement).getBoundingClientRect();
    (window as any).__gap = 0;
    let last = performance.now();
    const tick = () => { const n = performance.now(); (window as any).__gap = Math.max((window as any).__gap, n - last); last = n; (window as any).__ticking && requestAnimationFrame(tick); };
    (window as any).__ticking = true; requestAnimationFrame(tick);
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.evaluate(() => Tools.whenIdle());
  const { gap, forest } = await page.evaluate(() => {
    (window as any).__ticking = false;
    return { gap: (window as any).__gap as number, forest: mapData.filter(x => x === 'Forest_1').length };
  });
  expect(forest).toBeGreaterThan(200000);   // 202,500 minus tiles under a multi-tile footprint (none in this scene)
  expect(gap).toBeLessThan(120);
});

test('input is ignored while a fill is running', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const busyDuring = await page.evaluate(async () => {
    mapData.fill('Plain_1');
    UI.selectTerrain('Forest_1'); Tools.setActive('fill');
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    Canvas.setZoom(100); Canvas.centerOnCity();
    const p = Canvas.hexScreenPos(Math.floor(MAP_WIDTH / 2), Math.floor((MAP_HEIGHT - 1) / 2));
    const r = canvas.getBoundingClientRect();
    const ev = (t: string) => new MouseEvent(t, { clientX: r.left + p.x, clientY: r.top + p.y, button: 0, bubbles: true });
    canvas.dispatchEvent(ev('mousedown'));
    const busy = Tools.isFillBusy();
    canvas.dispatchEvent(ev('mouseup'));
    await Tools.whenIdle();
    return busy;
  });
  expect(busyDuring).toBe(true);
});

test('fill results identical to baseline', async ({ page }) => {
  for (const mode of ['scene', 'uniform'] as const) {
    await openEditor(page);
    await setupScene(page);
    const pt = await page.evaluate((mode: string) => {
      if (mode === 'uniform') mapData.fill('Plain_1');
      Canvas.setZoom(100); Canvas.centerOnCity();
      const col = Math.floor(MAP_WIDTH / 2), row = Math.floor((MAP_HEIGHT - 1) / 2);
      UI.selectTerrain(mapData[row * MAP_WIDTH + col] === 'Forest_1' ? 'Hills_1' : 'Forest_1');
      Tools.setActive('fill'); Canvas.render();
      const p = Canvas.hexScreenPos(col, row);
      const r = (document.getElementById('map-canvas') as HTMLCanvasElement).getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, mode);
    await page.mouse.click(pt.x, pt.y);
    await page.evaluate(() => Tools.whenIdle());
    checkBaseline(`fill_${mode}`, await hashMapData(page));
  }
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-fill.spec.ts --reporter=line`
Expected: FAIL: `Tools.whenIdle`/`Tools.isFillBusy` are not functions.

- [ ] **Step 3: Replace `_fill` with an indexed, time-sliced version**

Replace the whole `function _fill(col, row) { ... }` (from `// ── Fill (hex flood fill) ──` to its closing brace before `// ── Rectangle ──`) with:
```js
  // ── Fill (hex flood fill) ──────────────────────────────────
  // Indexed typed-array queue + visited bitmap (no Array.shift, no Set of numeric keys),
  // processed in ~10 ms slices so the UI keeps painting. Neighbour order/parity and the
  // order of the `visited` list handed to _autoResolveEdgesAround match the old version.
  let _fillBusy = false;
  let _fillIdle = Promise.resolve();
  function isFillBusy() { return _fillBusy; }
  function whenIdle() { return _fillIdle; }

  function _fill(col, row) {
    const targetId = mapData[row * MAP_WIDTH + col];
    const fillId   = UI.getSelectedTerrain();
    if (targetId === fillId) return Promise.resolve();
    _fillBusy = true;
    _fillIdle = _fillRun(col, row, targetId, fillId).finally(() => { _fillBusy = false; });
    return _fillIdle;
  }

  async function _fillRun(col, row, targetId, fillId) {
    const W = MAP_WIDTH, H = MAP_HEIGHT, N = W * H;
    const visited = new Uint8Array(N);
    const queue   = new Int32Array(N);
    let head = 0, tail = 0, sliceStart = performance.now(), showedProgress = false;
    const start = row * W + col;
    queue[tail++] = start; visited[start] = 1;

    const enqueue = (nc, nr) => {
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) return;
      const ni = nr * W + nc;
      if (visited[ni] || mapData[ni] !== targetId) return;
      visited[ni] = 1;
      queue[tail++] = ni;
    };

    while (head < tail) {
      const idx = queue[head++];
      const c = idx % W, r = (idx - c) / W;
      if (!getSatelliteAnchor(c, r)) {          // tiles under a multi-tile footprint are skipped (and not expanded)
        mapData[idx] = fillId;
        const even = (c & 1) === 0;
        enqueue(c,     r - 1);
        enqueue(c + 1, even ? r - 1 : r);
        enqueue(c + 1, even ? r : r + 1);
        enqueue(c,     r + 1);
        enqueue(c - 1, even ? r : r + 1);
        enqueue(c - 1, even ? r - 1 : r);
      }
      if ((head & 2047) === 0 && performance.now() - sliceStart > 10) {
        showedProgress = true;
        UI.progress(Math.min(95, head / N * 100), 'Filling… ' + head + ' tiles');
        await new Promise(res => setTimeout(res, 0));
        sliceStart = performance.now();
      }
    }

    invalidateSatelliteMap();
    const cells = new Array(tail);
    for (let i = 0; i < tail; i++) { const q = queue[i], c = q % W; cells[i] = { col: c, row: (q - c) / W }; }
    _autoResolveEdgesAround(cells);
    Canvas.render();
    if (showedProgress) UI.progressDone('');
  }
```

- [ ] **Step 4: Wire the tool, guard input, export**

At the top of `_onDown` add a guard: replace
```js
  function _onDown(sx, sy, e) {
    const { col, row } = Canvas.screenToHex(sx, sy);
```
with
```js
  function _onDown(sx, sy, e) {
    if (_fillBusy) return;                      // a fill is still running
    const { col, row } = Canvas.screenToHex(sx, sy);
```
Replace the fill case
```js
      case 'fill':
        History.push();
        _fill(col, row);
        Canvas.drawMinimap();
        UI.toast('Fill applied');
        _isDown = false;
        break;
```
with
```js
      case 'fill':
        History.push();
        _fill(col, row).then(() => { Canvas.drawMinimap(); UI.toast('Fill applied'); });
        _isDown = false;
        break;
```
Change the Tools return to `return { init, setActive, getActive, selectBuilding, getSelectedBuildingId, whenIdle, isFillBusy };`.
In `History.undo` and `History.redo` add as the first line `if (typeof Tools !== 'undefined' && Tools.isFillBusy()) return;` (Tools is defined above History).

- [ ] **Step 5: Run, expect pass, plus the equivalence suite**

Run: `npx playwright test tests/perf-fill.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass (`fill_scene` and `fill_uniform` hashes equal the pre-change baseline).

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html tests/perf-fill.spec.ts
git commit -m "perf(fill): indexed typed-array queue, time-sliced so the UI stays responsive

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: History.push happens before the (now async) fill, so undo of a fill is still a single step; no other tool can run mid-fill (`_fillBusy` guard plus the History guard).

---

### Task T1.9: Worker infrastructure and Satellite classification in a worker

**Files:**
- Create: `map-jobs.js` (DOM-free job code; loaded by the page and by the worker)
- Create: `map-worker.js`
- Modify: `MapEditorPro.html`: add `<script src="map-jobs.js?v=1"></script>` next to `<script src="zone-painter.js?v=8"></script>` (~1203); add module `WorkerJobs` immediately above the line `const Generator = (() => {` (~6814); rewrite `Satellite._classify` (anchor `function _classify() {` inside `Satellite`, ~7335) and delete `_rgbToHsl`, `_sample`, `_classifyColor` from `Satellite` (moved to `map-jobs.js`).
- Create: `tests/perf-workers.spec.ts`

**Interfaces:**
- Produces: `WorkerJobs.run(type, job, onProgress?): Promise<result>` (falls back to running `MapJobs[type]` on the main thread when no Worker can be created or it errors); `WorkerJobs.usingWorker(): boolean`; `WorkerJobs.forceSync(on: boolean)` (tests); `MapJobs.satellite(job, onProgress) -> { names: string[], out: Uint8Array }`.
- Job payload (`satellite`): `{ pixels: Uint8ClampedArray, w, h, W, H, T, sampleR, sens, flipY }` where `T` is the `_getT()` table of hex-id strings. Result: `out[row*W+col]` indexes `names`.
- Consumes: `UI.progress`, `UI.progressDone`, `UI.toast`, `Satellite._getT()`.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-workers.spec.ts` (T1.10 appends the generator tests to this file):

```ts
import { test, expect, type Page } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, hashMapData, checkBaseline } from './perf-scene';

declare const Satellite: any, WorkerJobs: any, MapJobs: any, Generator: any, mapData: string[];
test.use({ viewport: VIEWPORT });

async function loadSyntheticSatellite(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const x = c.getContext('2d')!;
    for (let j = 0; j < 320; j += 16)
      for (let i = 0; i < 320; i += 16) {
        x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},${30 + (i % 5) * 12}%,${15 + (j % 7) * 10}%)`;
        x.fillRect(i, j, 16, 16);
      }
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.evaluate(() => Satellite.open());
  await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
}

test('MapJobs and WorkerJobs exist', async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => typeof MapJobs.satellite === 'function' && typeof WorkerJobs.run === 'function')).toBe(true);
});

test('satellite via worker equals baseline and used a worker', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(true);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});

test('satellite synchronous fallback equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => WorkerJobs.forceSync(true));
  await loadSyntheticSatellite(page);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});

test('progress bar is shown while classifying', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  const active = await page.evaluate(() => {
    (Satellite as any).onParamChange();          // debounced re-classify
    return new Promise<boolean>(res => setTimeout(() => res(document.getElementById('progress-wrap')!.classList.contains('active')), 200));
  });
  // The job on 450x450 may finish within 200 ms; accept either "still active" or "finished with done label"
  const label = await page.evaluate(() => document.getElementById('progress-label')!.textContent);
  expect(active || /classified/i.test(label || '')).toBe(true);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-workers.spec.ts --reporter=line`
Expected: FAIL: `MapJobs is not defined`.

- [ ] **Step 3: Create `map-jobs.js` by moving the Satellite classifier**

Run this one-off script from the repo root (it moves `_rgbToHsl`, `_sample`, `_classifyColor` verbatim out of `MapEditorPro.html` into the new file; anchors verified: `function _rgbToHsl(r, g, b) {` ~7258 and `function _classify() {` ~7335 inside `Satellite`):
```bash
python3 - <<'EOF'
import re
p = 'MapEditorPro.html'
s = open(p, encoding='utf-8').read()
a = s.index('  function _rgbToHsl(r, g, b) {')
b = s.index('  function _classify() {', a)
moved = s[a:b]
open('map-jobs.js', 'w', encoding='utf-8').write(
"""/* map-jobs.js: heavy, DOM-free map jobs.
   Loaded as a classic <script> by MapEditorPro.html (synchronous fallback) and via
   importScripts() by map-worker.js. Must not touch document/window/Terrain/HexDB. */
(function (root) {
  'use strict';
  const MapJobs = {};

// ── Satellite classification (moved verbatim from MapEditorPro.html, then parameterised) ──
""" + moved + """
  root.MapJobs = MapJobs;
})(typeof self !== 'undefined' ? self : this);
""")
s = s[:a] + s[b:]
open(p, 'w', encoding='utf-8').write(s)
EOF
```
Now parameterise the moved code in `map-jobs.js` with these exact edits.

1. `_sample` signature and body: replace
```js
  function _sample(col, row, sampleR) {
    const cx = (col / MAP_WIDTH)  * _w;
    const cy = (row / MAP_HEIGHT) * _h;
```
with
```js
  function _sample(px, _w, _h, W, H, col, row, sampleR) {
    const cx = (col / W) * _w;
    const cy = (row / H) * _h;
```
and replace `sr += _pixels.data[i]; sg += _pixels.data[i+1]; sb += _pixels.data[i+2];` with `sr += px[i]; sg += px[i+1]; sb += px[i+2];`.

2. `_classifyColor`: replace `function _classifyColor(r, g, b, sens) {` with `function _classifyColor(T, r, g, b, sens) {` and delete the line `    const T = _getT();`.

3. Append before the `root.MapJobs = MapJobs;` line:
```js
  // job: { pixels:Uint8ClampedArray RGBA, w, h, W, H, T, sampleR, sens, flipY }
  // returns { names:string[], out:Uint8Array(W*H) } where out[row*W+col] indexes names
  MapJobs.satellite = function (job, onProgress) {
    const { pixels, w, h, W, H, T, sampleR, sens, flipY } = job;
    const names = Array.from(new Set(Object.values(T)));
    const lut = new Map(names.map((n, i) => [n, i]));
    const out = new Uint8Array(W * H);
    for (let row = 0; row < H; row++) {
      if (onProgress && (row & 15) === 0) onProgress(row / H);
      const srcRow = flipY ? H - 1 - row : row;
      for (let col = 0; col < W; col++) {
        const [r, g, b] = _sample(pixels, w, h, W, H, col, srcRow, sampleR);
        out[row * W + col] = lut.get(_classifyColor(T, r, g, b, sens));
      }
    }
    if (onProgress) onProgress(1);
    return { names, out };
  };
```
Quick syntax check: `node -e "global.self=global; require('./map-jobs.js'); console.log(typeof MapJobs.satellite)"` (expected `function`).

- [ ] **Step 4: Create `map-worker.js`**

```js
/* map-worker.js: runs MapJobs off the main thread. Protocol:
   in : { id, type, job }   out: { id, kind:'progress', frac } | { id, kind:'result', result } | { id, kind:'error', message } */
importScripts('map-jobs.js?v=1');

self.onmessage = (e) => {
  const { id, type, job } = e.data;
  try {
    const fn = self.MapJobs[type];
    if (!fn) throw new Error('Unknown job type: ' + type);
    const result = fn(job, frac => self.postMessage({ id, kind: 'progress', frac }));
    const transfer = [];
    for (const k of ['out', 'grid', 'elev', 'moist']) if (result[k] && result[k].buffer) transfer.push(result[k].buffer);
    self.postMessage({ id, kind: 'result', result }, transfer);
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: String((err && err.message) || err) });
  }
};
```

- [ ] **Step 5: Add the `WorkerJobs` module and the script tag**

Next to `<script src="zone-painter.js?v=8"></script>` add `<script src="map-jobs.js?v=1"></script>`. Immediately above `const Generator = (() => {` insert:
```js
// ════════════════════════════════════════════════════════════
// WORKER JOBS — run MapJobs.* in a Web Worker, fall back to the main thread
// ════════════════════════════════════════════════════════════
const WorkerJobs = (() => {
  let _worker = null, _broken = false, _forceSync = false, _seq = 0;
  const _pending = new Map();   // id → { resolve, reject, onProgress, retry }

  function _runSync(type, job, onProgress) {
    return new Promise((resolve, reject) => setTimeout(() => {   // let the progress UI paint first
      try { resolve(MapJobs[type](job, onProgress)); } catch (e) { reject(e); }
    }, 0));
  }

  function _ensure() {
    if (_worker) return _worker;
    if (_broken || _forceSync || typeof Worker === 'undefined') return null;
    try { _worker = new Worker('map-worker.js?v=1'); } catch (e) { _broken = true; return null; }
    _worker.onmessage = ev => {
      const m = ev.data, p = _pending.get(m.id);
      if (!p) return;
      if (m.kind === 'progress') { if (p.onProgress) p.onProgress(m.frac); return; }
      _pending.delete(m.id);
      if (m.kind === 'result') p.resolve(m.result); else p.reject(new Error(m.message));
    };
    _worker.onerror = () => {                       // e.g. file:// origin or blocked script: degrade, don't fail
      _broken = true; _worker = null;
      const jobs = [..._pending.values()]; _pending.clear();
      jobs.forEach(p => p.retry());
    };
    return _worker;
  }

  function run(type, job, onProgress) {
    const w = _ensure();
    if (!w) return _runSync(type, job, onProgress);
    return new Promise((resolve, reject) => {
      const id = ++_seq;
      _pending.set(id, { resolve, reject, onProgress, retry: () => _runSync(type, job, onProgress).then(resolve, reject) });
      w.postMessage({ id, type, job });
    });
  }

  return {
    run,
    usingWorker: () => !!_worker,
    forceSync: on => { _forceSync = !!on; },
  };
})();

```

- [ ] **Step 6: Rewrite `Satellite._classify` to use the worker**

Replace the whole `function _classify() { ... }` in `Satellite` with:
```js
  let _classTok = 0;
  async function _classify() {
    if (!_pixels) return;
    const tok = ++_classTok;                       // newer request supersedes older ones
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const job = {
      pixels: _pixels.data, w: _w, h: _h, W, H, T: _getT(),
      sampleR: parseInt(document.getElementById('sat-sampleR').value, 10),
      sens:    parseInt(document.getElementById('sat-sens').value, 10) / 100,
      flipY:   document.getElementById('sat-flipY').checked,
    };
    const applyBtn = document.getElementById('sat-apply-btn');
    applyBtn.disabled = true;
    UI.progress(0, 'Classifying image…');
    let res;
    try {
      res = await WorkerJobs.run('satellite', job, f => { if (tok === _classTok) UI.progress(f * 100, 'Classifying image…'); });
    } catch (e) {
      if (tok === _classTok) { UI.progressDone(''); UI.toast('Classification failed: ' + e.message); }
      return;
    }
    if (tok !== _classTok) return;
    const cls = new Array(W * H);
    for (let i = 0; i < cls.length; i++) cls[i] = res.names[res.out[i]];
    _classified = cls;
    _renderPreview();
    UI.progressDone('Image classified');
    applyBtn.disabled = false;
  }
```
`Satellite.open()` already sets `_classified = null`; add `_classTok++;` as the first line of `open()` so a late result cannot repopulate a closed session.

- [ ] **Step 7: Run, expect pass, then the whole suite**

Run: `npx playwright test tests/perf-workers.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass. If `satellite via worker` reports `usingWorker() === false`, check the console for a 404 on `map-worker.js` (the Playwright web server must serve the repo root).

- [ ] **Step 8: Commit**

```bash
git add map-jobs.js map-worker.js MapEditorPro.html tests/perf-workers.spec.ts
git commit -m "perf(satellite): classify image in a Web Worker with progress and sync fallback

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: `map-jobs.js` must stay DOM-free; fallback path runs the same function (single implementation); stale-result token prevents an old classification overwriting a newer one.

---

### Task T1.10: Generator in the worker (apply and preview) with progress UI

**Files:**
- Modify: `MapEditorPro.html`: `EdgeTiling` return (`return { resolveEdgeTile, clearCache };` ~2649); `Generator` module: `_getGenT` stays, `_getParams` stays, `_renderPreview` (~7144) and `apply` (~7207) rewritten; `_makeNoise2D`/`_multiOctave`/`_lcg`/`_classify`/`_smoothTerrain`/`_generateInto` moved to `map-jobs.js`.
- Modify: `map-jobs.js`: add `MapJobs.generate`.
- Modify: `tests/perf-workers.spec.ts`: append generator tests.

**Interfaces:**
- Produces: `EdgeTiling.getMaskTable(familyTypes)` and `EdgeTiling.FACE_NAMES`; `MapJobs.generate(job, onProgress) -> { names, grid: Uint8Array(W*H), elev?, moist? }` with `job = { p, W, H, T, opts: { skipExpensive, debug }, edge }` and `edge = { typeByLowerId: Map<string,string>, table, dirsEven, dirsOdd, faceNames }`; `Generator.apply(): Promise<void>`.
- Consumes: `_getGenT()`, `_getParams()`, `_DIRS_EVEN`, `_DIRS_ODD`, `HexDB.getAll()`, `WorkerJobs.run`, `UI.progress`.
- Determinism: the worker reproduces `EdgeTiling.resolveEdgeTile` exactly (same neighbour order, same `rng` consumption) so the seed-42 hash must equal the pre-change baseline.

- [ ] **Step 1: Append the failing generator tests**

Append to `tests/perf-workers.spec.ts`:
```ts
test('generator via worker equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(true);
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('generator synchronous fallback equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { WorkerJobs.forceSync(true); (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
  await page.evaluate(async () => { await Generator.apply(); });
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('main thread stays responsive and progress shows during Generate', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    let last = performance.now(), gap = 0, on = true;
    const tick = () => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const p = Generator.apply();
    const progressShown = document.getElementById('progress-wrap')!.classList.contains('active');
    await p;
    on = false;
    return { gap, progressShown };
  });
  expect(r.progressShown).toBe(true);
  expect(r.gap).toBeLessThan(150);     // sync version blocks for the whole generation
});

test('preview does not block and latest request wins', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const ok = await page.evaluate(async () => {
    Generator.open();
    (document.getElementById('gen-seed') as HTMLInputElement).value = '7';
    Generator.schedule();
    (document.getElementById('gen-seed') as HTMLInputElement).value = '8';
    Generator.schedule();
    await new Promise(r => setTimeout(r, 1500));
    const cv = document.getElementById('gen-preview') as HTMLCanvasElement;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let nonBlank = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) nonBlank++;
    return nonBlank > 0;
  });
  expect(ok).toBe(true);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-workers.spec.ts -g "generator|Generate|preview" --reporter=line`
Expected: FAIL: `usingWorker()` is false / `progressShown` false (Generator is still synchronous).

- [ ] **Step 3: Export what the worker needs from `EdgeTiling`**

Replace `return { resolveEdgeTile, clearCache };` with
```js
  return { resolveEdgeTile, clearCache, getMaskTable: _buildEdgeMaskTable, FACE_NAMES };
```

- [ ] **Step 4: Move the generator core into `map-jobs.js`**

Run from the repo root. It cuts three segments out of `Generator` and appends them to `map-jobs.js` (anchors, all verified in the current file: `function _makeNoise2D(seedOff) {` ~6825 to `// Lazy terrain ID table resolved from HexDB` ~6853; `function _classify(e, m, b, mThr, hThr, wThr) {` ~6880 to `function _getParams() {` ~6929; `// Majority-filter smoothing` ~6950 to `function _updateLabels() {` ~7131):
```bash
python3 - <<'EOF'
p = 'MapEditorPro.html'
s = open(p, encoding='utf-8').read()
def cut(s, start, end):
    a = s.index(start); b = s.index(end, a)
    return s[:a] + s[b:], s[a:b]
s, seg1 = cut(s, '  function _makeNoise2D(seedOff) {', '  // Lazy terrain ID table resolved from HexDB as string hex IDs.')
s, seg2 = cut(s, '  function _classify(e, m, b, mThr, hThr, wThr) {', '  function _getParams() {')
s, seg3 = cut(s, '  // Majority-filter smoothing', '  function _updateLabels() {')
open(p, 'w', encoding='utf-8').write(s)
j = open('map-jobs.js', encoding='utf-8').read()
tail = '  root.MapJobs = MapJobs;'
j = j.replace(tail, '\n// ── Generator core (moved from MapEditorPro.html Generator, then parameterised) ──\n'
              + seg1 + seg2 + seg3 + '\n' + tail)
open('map-jobs.js', 'w', encoding='utf-8').write(j)
EOF
```
Apply these exact edits inside `map-jobs.js`:

1. `_lcg` must expose its state is NOT needed (the whole pipeline now runs in one place), so leave it as is.
2. `_classify`: replace `function _classify(e, m, b, mThr, hThr, wThr) {` with `function _classify(T, e, m, b, mThr, hThr, wThr) {` and delete the line `    const T = _getGenT();`.
3. `_generateInto`: replace `function _generateInto(dest, p, opts) {` with `function _generateInto(dest, p, opts, T, edge, onProgress) {`; replace `const W = MAP_WIDTH, H = MAP_HEIGHT;` with `const W = opts.W, H = opts.H;`.
4. Replace the call `dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);` with `dest[row * W + col] = _classify(T, e, m, b, p.mThr, p.hThr, p.wThr);` and, directly after the line `    for (let row = 0; row < H; row++) {` that starts the elevation loop (the first `for (let row = 0; row < H; row++) {` inside `_generateInto`), add `      if (onProgress && (row & 15) === 0) onProgress(0.6 * row / H);`.
5. Replace `const _riverT = _getGenT();` with `const _riverT = T;`; replace `scatter(_getGenT().GOLD,` with `scatter(T.GOLD,` and `scatter(_getGenT().OIL,` with `scatter(T.OIL,`.
6. Replace `dest[idx] = EdgeTiling.resolveEdgeTile(rcol, rrow, W, H, dest, ['Water', 'Rivers'], rng, _riverV);` with `dest[idx] = _resolveEdgeTile(rcol, rrow, W, H, dest, edge, rng, _riverV);`.
7. Before `// ── Generator core` section's first function add the worker-side edge resolver (a line-for-line port of `EdgeTiling.resolveEdgeTile` using tables passed from the page):
```js
  // Port of EdgeTiling.resolveEdgeTile; tables come from the page (HexDB is not visible here).
  function _resolveEdgeTile(col, row, W, H, dataArr, edge, rng, fallbackIds) {
    const dirs = (H - 1 - row) % 2 !== 0 ? edge.dirsEven : edge.dirsOdd;
    let mask = 0;
    edge.faceNames.forEach((name, i) => {
      const [dc, dr] = dirs[name];
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) return;
      const nId = dataArr[nr * W + nc];
      const t = (nId && typeof nId === 'string') ? edge.typeByLowerId.get(nId.toLowerCase()) : undefined;
      if (t === 'Water' || t === 'Rivers') mask |= (1 << i);
    });
    const options = edge.table[mask];
    if (options && options.length) return options[Math.floor(rng() * options.length)];
    return fallbackIds[Math.floor(rng() * fallbackIds.length)];
  }
```
8. Append before `root.MapJobs = MapJobs;`:
```js
  // job: { p, W, H, T, opts:{skipExpensive,debug}, edge }
  // returns { names, grid:Uint8Array(W*H), elev?:Float32Array, moist?:Float32Array }
  MapJobs.generate = function (job, onProgress) {
    const { p, W, H, T, edge } = job;
    const dest = new Array(W * H).fill('Plain_1');
    const debugOut = job.opts.debug ? { elev: new Float32Array(W * H), moist: new Float32Array(W * H) } : null;
    _generateInto(dest, p, { W, H, skipExpensive: !!job.opts.skipExpensive, debugOut }, T, edge, onProgress);
    if (onProgress) onProgress(0.9);
    const names = Array.from(new Set(dest));
    const lut = new Map(names.map((n, i) => [n, i]));
    const grid = new Uint8Array(W * H);
    for (let i = 0; i < grid.length; i++) grid[i] = lut.get(dest[i]);
    if (onProgress) onProgress(1);
    return { names, grid, elev: debugOut && debugOut.elev, moist: debugOut && debugOut.moist };
  };
```
Syntax check: `node -e "global.self=global; require('./map-jobs.js'); console.log(typeof MapJobs.generate)"` (expected `function`). Also `grep -n "_getGenT\|MAP_WIDTH\|MAP_HEIGHT\|Terrain\.\|EdgeTiling\|document\." map-jobs.js` must print nothing.

- [ ] **Step 5: Rewrite `_renderPreview` and `apply` in `Generator`**

Add above `function _updateLabels() {`:
```js
  // Tables the worker needs to resolve river/lake edge tiles identically to EdgeTiling.
  function _edgeContext() {
    const typeByLowerId = new Map();
    for (const h of HexDB.getAll()) {
      if (!h.id) continue;
      const lo = h.id.toLowerCase();
      if (!typeByLowerId.has(lo)) typeByLowerId.set(lo, h.type);   // first match wins, like Terrain.byHexId
    }
    return {
      typeByLowerId,
      table: EdgeTiling.getMaskTable(['Water', 'Rivers']),
      dirsEven: _DIRS_EVEN, dirsOdd: _DIRS_ODD,
      faceNames: EdgeTiling.FACE_NAMES,
    };
  }

  function _runGenerate(p, opts, onProgress) {
    return WorkerJobs.run('generate', {
      p, W: MAP_WIDTH, H: MAP_HEIGHT, T: _getGenT(),
      opts: { skipExpensive: !!opts.skipExpensive, debug: !!opts.debug },
      edge: _edgeContext(),
    }, onProgress);
  }
```
Replace the whole `_renderPreview` with:
```js
  let _previewTok = 0;
  async function _renderPreview() {
    const tok = ++_previewTok;                   // latest request wins; stale results are dropped
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const params = _getParams();
    let res;
    try { res = await _runGenerate(params, { skipExpensive: true, debug: params.debug }); }
    catch (e) { return; }
    if (tok !== _previewTok || W !== MAP_WIDTH || H !== MAP_HEIGHT) return;
    const cv = document.getElementById('gen-preview');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const pw = cv.width, ph = cv.height;
    const img = ctx.createImageData(pw, ph);
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        const col = Math.floor(px / pw * W);
        const row = Math.floor(py / ph * H);
        const idx = row * W + col;
        const i = (py * pw + px) * 4;
        if (res.elev) {
          const isLeftHalf = px < pw / 2;
          const v = isLeftHalf ? res.elev[idx] : res.moist[idx];
          const gray = Math.max(0, Math.min(255, Math.round(v * 255)));
          img.data[i] = gray; img.data[i+1] = gray; img.data[i+2] = gray; img.data[i+3] = 255;
        } else {
          const [r, g, b] = Terrain.color(res.names[res.grid[idx]]);
          img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
```
Replace the whole `apply` with:
```js
  let _applying = false;
  async function apply() {
    if (!mapData || _applying) return;
    _applying = true;
    const btn = document.querySelector('#gen-modal .btn-primary');
    if (btn) btn.disabled = true;
    UI.progress(0, 'Generating map…');
    try {
      const res = await _runGenerate(_getParams(), {}, f => UI.progress(f * 100, 'Generating map…'));
      if (!mapData || mapData.length !== res.grid.length) throw new Error('Map size changed while generating');
      History.push();                              // pre-state, taken right before we overwrite
      for (let i = 0; i < res.grid.length; i++) mapData[i] = res.names[res.grid[i]];
      const cityC = getCityCol(), cityR = getCityRow();
      settlements = settlements.filter(s => s.type !== 'city');
      settlements.unshift({ col: cityC, row: cityR, type: 'city' });
      UI.updateSettlementCount();
      close();
      Canvas.render();
      Canvas.drawMinimap();
      UI.progressDone('Map generated');
      UI.toast('Map generated');
    } catch (e) {
      UI.progressDone('');
      UI.toast('Generation failed: ' + e.message);
    } finally {
      _applying = false;
      if (btn) btn.disabled = false;
    }
  }
```
`schedule()` and `_debounce` are unchanged (they call `_renderPreview`, now async; the returned promise is intentionally ignored).

- [ ] **Step 6: Run, expect pass, then everything**

Run: `npx playwright test tests/perf-workers.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass, including `generator_seed42` equal to the pre-change baseline through BOTH the worker and the forced-sync path. If the hash differs, the likely causes are, in order: a missed `_getGenT()`/`MAP_*` replacement, `typeByLowerId` first-match semantics, or the `rng` consumption order in step 6 of the edits.

- [ ] **Step 7: Commit**

```bash
git add map-jobs.js MapEditorPro.html tests/perf-workers.spec.ts
git commit -m "perf(generator): run generation and preview in a Web Worker with progress UI

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: the hash equality against the pre-change baseline (proves identical rng stream); the generator's selected `T` table is still resolved on the main thread (HexDB access) and only strings cross the boundary.

---

### Task T1.11: Dynamic zoom floor so the whole map fits

**Files:**
- Modify: `MapEditorPro.html` `Canvas`: `let zoom = 100;  // percent; range 25–200` (~2743), `function setZoom` (~3180), `function zoomIn/zoomOut` (~3196), `function fitToScreen` (~3209), `function _onWheel` (~3489), window `resize` listener in `init` (anchor `window.addEventListener('resize', () => { _resizeCanvas(); render(); drawMinimap(); });` ~3353), Canvas return (add `minZoom`).
- Create: `tests/perf-zoom-floor.spec.ts`

**Interfaces:**
- Produces: `Canvas.minZoom(): number` = `max(1, min(25, floor(fitPct)))` where `fitPct` is the zoom at which the full map fits the canvas.
- Consumes: `canvas.width/height`, `COL_PITCH`, `ROW_PITCH`, `STAGGER`, `HEX_SIZE`.
- Maps smaller than the screen keep today's 25% floor (their `fitPct` is above 25%).

- [ ] **Step 1: Write the failing test**

Create `tests/perf-zoom-floor.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene } from './perf-scene';

declare const Canvas: any, MAP_WIDTH: number, MAP_HEIGHT: number, COL_PITCH: number, ROW_PITCH: number, STAGGER: number, HEX_SIZE: number;
test.use({ viewport: VIEWPORT });

test('fit-to-screen fits the whole 450x450 map below 25%', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    Canvas.fitToScreen();
    const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    const z = Canvas.getZoom();
    const w = ((MAP_HEIGHT - 1) * COL_PITCH + HEX_SIZE * 2) * z / 100;
    const h = ((MAP_WIDTH - 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2) * z / 100;
    return { z, w, h, cw: cv.width, ch: cv.height, label: document.getElementById('st-zoom')!.textContent, floor: Canvas.minZoom() };
  });
  expect(r.z).toBeLessThan(25);
  expect(r.z).toBeGreaterThanOrEqual(1);
  expect(r.w).toBeLessThanOrEqual(r.cw);
  expect(r.h).toBeLessThanOrEqual(r.ch);
  expect(r.label).toBe(r.z + '%');
  expect(r.z).toBe(r.floor);
});

test('setZoom clamps to the dynamic floor, not 25%', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    Canvas.setZoom(1); const low = Canvas.getZoom();
    Canvas.setZoom(10); const mid = Canvas.getZoom();
    Canvas.setZoom(500); const high = Canvas.getZoom();
    return { low, mid, high, floor: Canvas.minZoom() };
  });
  expect(r.low).toBe(r.floor);
  expect(r.mid).toBe(Math.max(10, r.floor));
  expect(r.high).toBe(200);
});

test('wheel zoom out steps proportionally at low zoom', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => Canvas.setZoom(20));
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 450);
  await page.mouse.wheel(0, 100);
  const z = await page.evaluate(() => Canvas.getZoom());
  expect(z).toBeLessThan(20);
  expect(z).toBeGreaterThanOrEqual(15);          // not the old fixed -5 jump straight to the floor
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-zoom-floor.spec.ts --reporter=line`
Expected: FAIL: `Canvas.minZoom is not a function` / zoom stuck at 25.

- [ ] **Step 3: Implement the floor and proportional steps**

Update the comment `let zoom = 100;                   // percent; range 25–200` to `// percent; range minZoom()..200`. Above `function setZoom` add:
```js
  // Zoom (percent) at which the whole map exactly fits the canvas.
  function _fitZoomPct() {
    const mapPixelW = (MAP_HEIGHT - 1) * COL_PITCH + HEX_SIZE * 2;
    const mapPixelH = (MAP_WIDTH  - 1) * ROW_PITCH + STAGGER   + HEX_SIZE * 2;
    return Math.min(canvas.width / mapPixelW * 100, canvas.height / mapPixelH * 100);
  }
  // Dynamic floor: low enough to fit the whole map, never above the legacy 25%, never below 1%.
  function minZoom() { return Math.max(1, Math.min(25, Math.floor(_fitZoomPct()))); }
  // Fixed step at normal zoom, proportional below 30% so low zooms stay controllable.
  function _step(frac, fixed) { return zoom <= 30 ? Math.max(1, Math.round(zoom * frac)) : fixed; }
```
In `setZoom` replace `zoom = Math.max(25, Math.min(200, Math.round(pct)));` with `zoom = Math.max(minZoom(), Math.min(200, Math.round(pct)));`. Replace
```js
  function zoomIn()  { setZoom(zoom + 10); }
  function zoomOut() { setZoom(zoom - 10); }
```
with
```js
  function zoomIn()  { setZoom(zoom + _step(0.3, 10)); }
  function zoomOut() { setZoom(zoom - _step(0.3, 10)); }
```
In `fitToScreen` replace the `const fit = Math.floor(Math.min(...));` statement and `zoom = Math.max(25, Math.min(200, fit));` with
```js
    const fit = Math.floor(_fitZoomPct());
    zoom = Math.max(minZoom(), Math.min(200, fit));
```
(`mapPixelW`/`mapPixelH` stay: they are used for the camera below.) In `_onWheel` replace `setZoom(zoom - Math.sign(e.deltaY) * 5, ...)` with `setZoom(zoom - Math.sign(e.deltaY) * _step(0.15, 5), e.clientX - rect.left, e.clientY - rect.top);`. In `init` replace the resize listener with
```js
    window.addEventListener('resize', () => { _resizeCanvas(); zoom = Math.max(zoom, minZoom()); render(); drawMinimap(); });
```
Add `minZoom` to the Canvas return object after `clampCamera, setZoom, zoomIn, zoomOut, centerOnCity, fitToScreen,`.

- [ ] **Step 4: Run, expect pass, then the equivalence suite**

Run: `npx playwright test tests/perf-zoom-floor.spec.ts tests/perf-equivalence.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/perf-zoom-floor.spec.ts
git commit -m "feat(canvas): dynamic zoom floor so the whole 450x450 map fits on screen

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: at the new floor the render path draws up to all 202,500 tiles, so do not ship T1.11 without T1.12 (flat overview); the resize handler re-clamps the zoom when the window shrinks.

---

### Task T1.12: Low-zoom level of detail (simple sprites, then flat overview)

**Files:**
- Modify: `MapEditorPro.html` `Canvas.render` (the tile loop edited in T1.3 and the `_anchorPass` loop), add `_drawHexTileSimple`, `_drawOverview`, `_overviewLayer`, LOD constants next to `_stats`.
- Create: `tests/perf-lod.spec.ts`

**Interfaces:**
- Produces: LOD levels chosen by `radius = HEX_SIZE * zoom/100`: level 0 (`radius >= 10`, i.e. zoom >= 25%) the original draw path (pixel-identical); level 1 (`4 <= radius < 10`, zoom 10-24%) per-tile sprite `drawImage` without save/clip/outline/coastline/anchor pass; level 2 (`radius < 4`, zoom < 10%) a single scaled `drawImage` of a cached one-pixel-per-tile colour layer (no per-tile work).
- Consumes: `_makeColorLayer()` and `_colorOf()` from T1.5, `Terrain.getSprite`, geometry constants.
- Overlays (zones, settlements, roads, objects, rulers, selection) keep drawing at every level; roads/objects remain culled and cheap.

- [ ] **Step 1: Write the failing test**

Create `tests/perf-lod.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, medianMs } from './perf-scene';

declare const Canvas: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number, Terrain: any;
test.use({ viewport: VIEWPORT });

test('zoom >= 25% stays pixel-identical (LOD 0)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const z of [25, 60, 100, 200]) {
    await frame(page, z);
    checkBaseline(`render_${z}`, await hashCanvas(page, '#map-canvas'));
  }
});

test('fit-to-screen renders the whole map quickly', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { Canvas.fitToScreen(); Canvas.render(); });
  expect(await medianMs(page, 'render')).toBeLessThan(15);
});

test('zoom 12% (simple sprites) is bounded', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 12);
  expect(await medianMs(page, 'render')).toBeLessThan(40);
});

test('overview colours match the tiles under them', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(() => {
    mapData.fill('Water_1');
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
    for (let dr = -20; dr <= 20; dr++) for (let dc = -20; dc <= 20; dc++) mapData[(cr + dr) * MAP_WIDTH + cc + dc] = 'Forest_1';
    Canvas.fitToScreen(); Canvas.render();
    const ctx = Canvas.getCtx();
    const px = (col: number, row: number) => {
      const p = Canvas.hexScreenPos(col, row);
      return Array.from(ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3));
    };
    return { zoom: Canvas.getZoom(), inside: px(cc, cr), outside: px(cc + 120, cr + 120),
             forest: Terrain.color('Forest_1'), water: Terrain.color('Water_1') };
  });
  expect(r.zoom).toBeLessThan(10);
  expect(r.inside).toEqual(r.forest);
  expect(r.outside).toEqual(r.water);
});

test('overview follows edits (cache is incremental)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const changed = await page.evaluate(() => {
    Canvas.fitToScreen(); Canvas.render();
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
    const ctx = Canvas.getCtx();
    const read = () => { const p = Canvas.hexScreenPos(cc, cr); return Array.from(ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3)).join(); };
    const before = read();
    mapData[cr * MAP_WIDTH + cc] = mapData[cr * MAP_WIDTH + cc] === 'Lava_Plain_1' ? 'Rift_1' : 'Lava_Plain_1';
    mapData[(cr + 1) * MAP_WIDTH + cc] = mapData[cr * MAP_WIDTH + cc];
    mapData[cr * MAP_WIDTH + cc + 1] = mapData[cr * MAP_WIDTH + cc];
    Canvas.render();
    return before !== read() || true;   // the city dot may cover the exact pixel; assert via stats below
  });
  expect(changed).toBe(true);
  const recolored = await page.evaluate(() => Canvas.getStats().minimapRecolored);
  expect(recolored).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/perf-lod.spec.ts --reporter=line`
Expected: FAIL: `fit-to-screen renders the whole map quickly` (all 202,500 tiles are drawn with sprites, far above 15 ms) and `overview colours...` (sprites, not flat colours).

- [ ] **Step 3: Add the LOD helpers**

Below `const _stats = ...` add:
```js
  // Level of detail by on-screen hex radius (px). zoom >= 25% → radius >= 10 → level 0 (unchanged path).
  const LOD_FULL_RADIUS = 10;   // below this: sprites without save/clip/outline
  const LOD_FLAT_RADIUS = 4;    // below this: one scaled drawImage of the cached colour layer
```
Above `function _drawBridgeOverlay` add:
```js
  const _cssColorMemo = new Map();
  function _cssColor(id) {
    let v = _cssColorMemo.get(id);
    if (v === undefined) { const c = _colorOf(id); v = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; _cssColorMemo.set(id, v); }
    return v;
  }

  // LOD 1: plain sprite blit, no clip/outline. Layered/bridge/multi-tile detail is dropped on purpose.
  function _drawHexTileSimple(cx, cy, radius, hexId) {
    const spr = Terrain.getSprite(hexId);
    if (spr && spr.complete && spr.naturalWidth > 0) {
      ctx.drawImage(spr, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = _cssColor(hexId);
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
  }

  // LOD 2: one pixel per tile (MAP_HEIGHT x MAP_WIDTH texture; px ↔ row flipped, py ↔ col flipped,
  // same mapping as the minimap) stretched over the map's world rectangle. Pixel px has its
  // tile centre at x = px*COL_PITCH; pixel py at y ≈ py*ROW_PITCH + STAGGER/2 (mean of the stagger).
  const _overviewLayer = _makeColorLayer();
  function _drawOverview(scale) {
    const tex = _overviewLayer(MAP_HEIGHT, MAP_WIDTH);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tex,
      -0.5 * COL_PITCH * scale - cameraX,
      (STAGGER / 2 - 0.5 * ROW_PITCH) * scale - cameraY,
      MAP_HEIGHT * COL_PITCH * scale, MAP_WIDTH * ROW_PITCH * scale);
    ctx.imageSmoothingEnabled = prev;
  }
```
(`_makeColorLayer` is a function declaration earlier in the same IIFE scope, so ordering is fine; `_overviewLayer` is a `const` created at module init after `_minimapLayer`, which is fine because `render()` only runs later.)

- [ ] **Step 4: Branch `render()` on the LOD level**

In `render()` after `const padding = radius * 2;` add:
```js
    const lod = radius >= LOD_FULL_RADIUS ? 0 : (radius >= LOD_FLAT_RADIUS ? 1 : 2);
    if (lod === 2) _drawOverview(scale);
```
Change the row loop header from `for (let row = rowMin; row <= rowMax; row++) {` to `for (let row = rowMin; lod < 2 && row <= rowMax; row++) {`. In the loop body, replace
```js
        const _hid = mapData[row * MAP_WIDTH + col];
        _drawHexTile(s.x, s.y, radius, _hid, col, row);
```
with
```js
        const _hid = mapData[row * MAP_WIDTH + col];
        if (lod === 1) { _drawHexTileSimple(s.x, s.y, radius, _hid); continue; }
        _drawHexTile(s.x, s.y, radius, _hid, col, row);
```
(`_stats.tilesDrawn++` from T1.3 is above this line and still counts LOD 1 tiles.) The `_anchorPass` stays empty at LOD 1/2 because `continue` precedes its push, and the whole loop is skipped at LOD 2.

- [ ] **Step 5: Run, expect pass, then the whole Phase 1 suite**

Run: `npx playwright test tests/perf-lod.spec.ts --reporter=line`
Expected: all pass. If the `outside`/`inside` colour check is off by a neighbour, the vertical offset in `_drawOverview` is the first thing to check against `hexCenterWorld` (the test block is 41x41 tiles so a one-pixel shift must not matter; a miss means the x/y mapping is wrong, not just rounding).
Run: `npx playwright test tests/perf-*.spec.ts --reporter=line`
Expected: every Phase 1 spec passes.

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html tests/perf-lod.spec.ts
git commit -m "perf(render): low-zoom level of detail (simple sprites, flat overview below 10%)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
- Review focus: LOD thresholds keep zoom >= 25% on the unchanged path (the render hashes prove it); overview visuals ignore stagger by design.

---

### Phase 1 exit checklist

- [ ] `npx playwright test tests/perf-*.spec.ts` is green; `tests/perf-baseline.json` still holds the values committed in T1.1 (`git log --follow tests/perf-baseline.json` shows a single commit).
- [ ] Re-run the timing recorder into a scratch copy and compare: `render_25` and `minimap` medians at least 30% below the T1.1 numbers; the zoomed-out full-map render under 15 ms.
- [ ] Manual check on the 450x450 default map: Fit Map shows the entire map, wheel zoom feels controllable below 25%, Fill on a large region shows the progress bar and the UI stays live, Generate and Satellite import show progress and do not freeze, undo/redo after each still works (Ctrl+Z / Ctrl+Y).
- [ ] If T1.7 was skipped, the PR description states the T1.6 numbers.


---

# Plan sections: Phase 2 (editing tools) and Phase 3 (generation and map design)

> Source roadmap: `docs/superpowers/plans/2026-10-02-editor-improvement-roadmap.md`. These two phases cover roadmap items 2.1-2.8 and 3.1-3.5.
> Every line anchor below was read from `MapEditorPro.html` at HEAD `efc9f5a` (build 2026.09.30). Line numbers drift as earlier tasks land, so every edit also carries a grep-able anchor string. Trust the anchor, not the number.

## Phase 2: editing tools

Goal: the editor gains selection-based editing (copy/cut/paste/move/rotate/mirror), a stamp library, shape and replace tools, symmetric painting, a real eraser and a layers panel, and the road/building/bridge tools return with undo. All hex maths lives in a new pure file `hex-utils.js` (loaded by a `<script>` tag next to `zone-painter.js`, line ~1203) so it can be unit-tested through `page.evaluate`.

### Phase 2 files-touched table

| File | Tasks | What changes |
|---|---|---|
| `hex-utils.js` (new) | T2.1, T2.4, T2.5, T2.7, T2.9, T2.10, T3.1 | `HexUtils`: cube conversion, distance, line, disc, ring, rotate, mirror, polygon, symmetry, scatter pick, anchor, transform, edge distances |
| `MapEditorPro.html` `Tools` module (~3983-4559) | T2.2-T2.11, T2.14-T2.16, T2.18 | shared `_applyTerrainCells`, new tools, key handlers, lazy undo push, lock gate |
| `MapEditorPro.html` `Brush` (~3921) | T2.3 | `HexUtils`-based disc, size clamp, grow/shrink |
| `MapEditorPro.html` `Canvas` (~2740) | T2.4, T2.17 | `setHighlight` overlay API, layer visibility hooks in `render()` |
| `MapEditorPro.html` new modules `Selection`, `Clipboard`, `Stamps`, `Layers` | T2.8, T2.9, T2.12, T2.13, T2.17 | selection set, layered buffer, IndexedDB stamp store and panel, layer state and panel |
| `MapEditorPro.html` `IO.clearMap` (~6577) | T2.19 | clears objects, roads, extras, zones |
| `MapEditorPro.html` toolbar / right panel / modals | T2.3-T2.17 | buttons, panels, replace modal |
| `tests/editor-globals.d.ts`, `tests/editor-helpers.ts` (new) | T2.1, T2.2 | ambient declarations, mouse helpers |
| `tests/hex-utils.spec.ts`, `tests/paint-tools.spec.ts`, `tests/selection.spec.ts`, `tests/stamps.spec.ts`, `tests/object-tools.spec.ts`, `tests/layers.spec.ts` (new) | T2.1-T2.19 | Playwright specs |

### Conventions, geometry facts and known issues (apply to Phase 2 and Phase 3)

- **Harness (T0.0, built by another agent).** Assumed to exist: `package.json`, `playwright.config.ts` (static server for the repo root, `baseURL` set) and `tests/helpers.ts` exporting `openEditor(page: Page): Promise<void>`. `openEditor` navigates to `/MapEditorPro.html` and resolves once `HexDB.getAll().length > 0` and the first `Canvas.render()` has happened. Run command used throughout: `npx playwright test <file> --reporter=line`.
- **Globals are not on `window`.** `Tools`, `Brush`, `History`, `Canvas`, `MAP_WIDTH`, `mapData` and the other top-level `const`/`let` bindings are global lexical bindings. A bare identifier works inside `page.evaluate`, but `window.Tools` and `globalThis.Tools` are `undefined`. Playwright does not type-check, but T2.1 adds `tests/editor-globals.d.ts` so editors stay quiet.
- **Assigning the size globals works in tests.** `MAP_WIDTH = 451` inside `page.evaluate` rebinds the real global. Restore the old values at the end of the test.
- **New shortcuts use `e.code`, not `e.key`.** The existing letter shortcuts use `e.key`, which breaks under the Ukrainian layout the UA guide targets. Every new shortcut uses the physical key (`KeyM`, `BracketLeft`, ...) and is guarded by `document.body.classList.contains('mode-map')` and "no INPUT/TEXTAREA/SELECT focused".
- **Shortcut map (no collisions).**

  | Key | Tool / action | Task |
  |---|---|---|
  | existing: P F R E S T D Z, Ctrl+N/O/S/Z/Y, Ctrl+Shift+S (HexDB mode only), Space (pan), Tab (mode cycle) | unchanged | - |
  | `[` / `]` | brush radius -1 / +1 | T2.3 |
  | L / O / G | line / circle / polygon | T2.4 |
  | Y | cycle symmetry mode | T2.5 |
  | X | real eraser | T2.6 |
  | A | scatter | T2.7 |
  | M, Esc, Ctrl+A | marquee select, clear selection, select all | T2.8 |
  | Ctrl+C / Ctrl+X / Ctrl+V / Delete / Enter | copy / cut / paste / clear selection / pick selection up to move it | T2.9, T2.10 |
  | `,` `.` `/` `;` (while pasting) | rotate ccw / cw, mirror left-right / top-bottom | T2.10 |
  | H | replace-by-click | T2.11 |
  | B / W / C / Q / U | building / road / connect road / erase road / bridge (B, W, C, Q restored from commit b5d924b) | T2.14-T2.16 |
  | K | move city | T3.5 |

- **Commit trailer.** Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Hex geometry facts verified in Chrome (they drive the design)

1. Screen layout (`Canvas.hexCenterWorld`, line ~2787): `x = (H-1-row) * COL_PITCH`, `y = (W-1-col) * ROW_PITCH + STAGGER - stg`, where `stg = STAGGER` when `worldX = (H-1-row) - floor(H/2)` is odd. So **`row` runs along the horizontal axis (growing toward the west) and `col` runs up the screen**. Odd `worldX` columns are shifted up. That is flat-top odd-q with the vertical axis flipped.
2. The existing helper `_hexDistBetween` (line ~12680) already uses the matching cube conversion `q = worldX`, `r = col - floor(W/2) - (q - (q&1))/2`. `HexUtils` uses exactly that conversion, so distances agree with the status bar and the rings.
3. Because the vertical axis is flipped relative to the textbook odd-q layout, the textbook "clockwise" cube rotation `(q,r,s) -> (-r,-s,-q)` is **counter-clockwise on screen** here. Screen-clockwise is `(q,r,s) -> (-s,-q,-r)`. Mirrors: left-right `(q,r,s) -> (-q,-s,-r)`, top-bottom `(q,r,s) -> (q,s,r)`. Every one of these is asserted against `Canvas.hexCenterWorld` pixels in T2.1, not against my algebra.

### Known issues found while reading (flagged, not silently fixed)

| # | Issue | Evidence | Handling |
|---|---|---|---|
| K1 | `_DIRS_EVEN` / `_DIRS_ODD` (line ~12626) each contain two offsets that are NOT adjacent. For row 224 (xi odd) `SE:[1,-1]` and `SW:[1,1]` land 120 px away (true adjacency is 69.3 px); for row 225 `NE:[-1,-1]` and `NW:[-1,1]` do. | `Canvas.hexScreenPos` deltas measured in Chrome. The comment above the tables claims "fixed 2026-07-29" but the values are still wrong. | The tables feed `Roads.calcBitmask`, `Roads.getNeighbors` (and through it `_hexPathBetween` and the road-network gate), `EdgeTiling._neighborCoords`, `Coastline.computeEdges`. **No Phase 2/3 code uses them.** All new code uses `HexUtils.neighbors`. Fixing the tables changes road, river and coastline sprites, so it needs an owner decision. T2.1 adds a `test.fixme` that documents it. |
| K2 | `Tools._fill` (line ~4186) uses `c % 2` and treats `col` as the horizontal axis, so its flood fill is not hex-contiguous. | Reading the code against fact 1. | Fixed in T2.2 with `HexUtils.neighbors`. Phase 1 item 4 rewrites the fill queue; whoever merges second must keep the `HexUtils.neighbors` call. |
| K3 | `Brush._neighbors` (line ~3927) assumes the stagger parity equals `row % 2`. That holds only when `ceil(H/2) - 1` is even (true for 450, false for 451). | Reading the code against fact 1. | Fixed in T2.3. |
| K4 | The heightmap spec says "resample to `MAP_WIDTH x MAP_HEIGHT`, stretched". Because `col` is vertical and `row` is horizontal, a naive resample would transpose and mirror the picture. | Fact 1. | T3.3 resamples with the orientation transform and tests it. |
| K7 | `_satelliteHexDist` (line ~4236) treats `col` as the q axis, so a radius-1 "disc" returns 5 true neighbours plus one cell 120 px away. This is what `_spawnSatellites` (building satellites such as Farm_Test_1 -> Grain_1) uses. | Numeric check against `hexCenterWorld` for cells (225,224) and (226,225). | Not changed (it may deliberately mirror the game's own `HexUtils.Distance`). Raised as an owner question; T2.14 only asserts satellites spawn without error. |
| K5 | `Generator._getGenT` (line ~6855) caches the id table forever, so a HexDB edit or a package reskin after the first generate is ignored. | Reading the code. | Fixed in T3.9. |
| K6 | The heightmap spec says "no automated test harness - a deliberate standing decision". Phase 6 and T0.0 supersede that. | Roadmap Phase 6. | T3.3/T3.4 add tests. |

---

### Task T2.1: `hex-utils.js` cube-coordinate core

**Files:**
- Create: `hex-utils.js`
- Create: `tests/editor-globals.d.ts`
- Create: `tests/hex-utils.spec.ts`
- Modify: `MapEditorPro.html:1203` (anchor: `<script src="zone-painter.js?v=8"></script>`) - add the new script tag on the line before it.

**Interfaces:**
- Consumes: nothing from the editor (pure). Tests consume `Canvas.hexCenterWorld(col,row)`, `ROW_PITCH`, `MAP_WIDTH`, `MAP_HEIGHT`.
- Produces (global `HexUtils`):
  - `toCube(col,row,W,H) -> {q,r,s}`, `fromCube(c,W,H) -> {col,row}`
  - `cubeDistance(a,b) -> number`, `cubeRound(f)`, `cubeLine(a,b) -> cube[]`, `cubeDisc(center,radius)`, `cubeRing(center,radius)`
  - `rotateCube(c, steps) -> cube` (screen-clockwise 60 degree steps), `mirrorCube(c, 'h'|'v') -> cube`
  - `inBounds(col,row,W,H)`, `cellsFromCubes(cubes,W,H) -> {col,row}[]` (deduplicated, clipped)
  - `neighbors(col,row,W,H)`, `discCells(col,row,radius,W,H)`, `ringCells(col,row,radius,W,H)`, `lineCells(a,b,W,H)` where `a`/`b` are `{col,row}`
  - `CUBE_DIRS` (six unit cube vectors)

- [ ] **Step 1: Write the failing tests**

Create `tests/editor-globals.d.ts`:

```ts
// Ambient declarations for the editor's global lexical bindings (not type-checked by Playwright; for editors only).
declare const HexUtils: any, GenUtils: any, Tools: any, Brush: any, History: any, Canvas: any, Terrain: any;
declare const Roads: any, EdgeTiling: any, IO: any, UI: any, Generator: any, HexDB: any, BldDB: any, SttDB: any;
declare const ZonePainter: any, Selection: any, Clipboard: any, Stamps: any, Layers: any, Placement: any, DistanceBands: any;
declare let MAP_WIDTH: number, MAP_HEIGHT: number;
declare let mapData: string[];
declare let objectsData: Record<string, string>, roadsData: Record<string, any>, tileExtras: Record<string, any>;
declare let bridgesData: any[], settlements: any[];
declare const ROW_PITCH: number, COL_PITCH: number, DEFAULT_TILE_ID: string;
declare function getCityCol(): number;
declare function getCityRow(): number;
declare function cityDistance(col: number, row: number): number;
```

Create `tests/hex-utils.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.describe('HexUtils geometry', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('toCube/fromCube round-trip on even, odd and non-square maps', async ({ page }) => {
    const bad = await page.evaluate(() => {
      let bad = 0;
      for (const [W, H] of [[450, 450], [11, 11], [12, 10], [13, 12], [9, 9]]) {
        for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
          const f = HexUtils.fromCube(HexUtils.toCube(c, r, W, H), W, H);
          if (f.col !== c || f.row !== r) bad++;
        }
      }
      return bad;
    });
    expect(bad).toBe(0);
  });

  test('neighbours, rotation and mirrors agree with Canvas.hexCenterWorld pixels', async ({ page }) => {
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const save = [MAP_WIDTH, MAP_HEIGHT];
      for (const [W, H] of [[450, 450], [451, 451], [12, 10]]) {
        MAP_WIDTH = W; MAP_HEIGHT = H;
        const c0 = Math.floor(W / 2), r0 = Math.floor(H / 2);
        const a = HexUtils.toCube(c0, r0, W, H);
        const pa = Canvas.hexCenterWorld(c0, r0);
        const rel = (c: any) => {
          const p = HexUtils.fromCube(c, W, H);
          const w = Canvas.hexCenterWorld(p.col, p.row);
          return { x: w.x - pa.x, y: w.y - pa.y };
        };
        const add = (d: any) => ({ q: a.q + d.q, r: a.r + d.r, s: a.s + d.s });
        const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
        for (const d of HexUtils.CUBE_DIRS) {
          const p = rel(add(d));
          if (Math.abs(Math.hypot(p.x, p.y) - ROW_PITCH) > 1e-6) out.push(`pitch ${W}x${H}`);
          const rp = rel(add(HexUtils.rotateCube(d, 1)));   // screen y points down, so this matrix is clockwise
          if (Math.hypot(rp.x - (p.x * cs - p.y * sn), rp.y - (p.x * sn + p.y * cs)) > 1e-6) out.push(`rotate ${W}x${H}`);
          const mh = rel(add(HexUtils.mirrorCube(d, 'h')));
          if (Math.hypot(mh.x + p.x, mh.y - p.y) > 1e-6) out.push(`mirrorH ${W}x${H}`);
          const mv = rel(add(HexUtils.mirrorCube(d, 'v')));
          if (Math.hypot(mv.x - p.x, mv.y + p.y) > 1e-6) out.push(`mirrorV ${W}x${H}`);
        }
      }
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('line, disc, ring sizes and clipping at the map corner', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = 450, H = 450;
      const a = { col: 200, row: 200 }, b = { col: 212, row: 190 };
      const line = HexUtils.lineCells(a, b, W, H);
      const ca = HexUtils.toCube(a.col, a.row, W, H), cb = HexUtils.toCube(b.col, b.row, W, H);
      let gaps = 0;
      for (let i = 1; i < line.length; i++) {
        const d = HexUtils.cubeDistance(HexUtils.toCube(line[i - 1].col, line[i - 1].row, W, H), HexUtils.toCube(line[i].col, line[i].row, W, H));
        if (d !== 1) gaps++;
      }
      return {
        lineLen: line.length, want: HexUtils.cubeDistance(ca, cb) + 1, gaps,
        first: line[0], last: line[line.length - 1],
        disc: [0, 1, 2, 3].map(n => HexUtils.discCells(200, 200, n, W, H).length),
        ring: [0, 1, 2, 5].map(n => HexUtils.ringCells(200, 200, n, W, H).length),
        corner: HexUtils.discCells(0, 0, 2, W, H).length,
        nb: HexUtils.neighbors(200, 200, W, H).length,
      };
    });
    expect(r.lineLen).toBe(r.want);
    expect(r.gaps).toBe(0);
    expect(r.first).toEqual({ col: 200, row: 200 });
    expect(r.last).toEqual({ col: 212, row: 190 });
    expect(r.disc).toEqual([1, 7, 19, 37]);
    expect(r.ring).toEqual([1, 6, 12, 30]);
    expect(r.corner).toBeLessThan(19);
    expect(r.nb).toBe(6);
  });

  // Known issue K1: the legacy direction tables contain two non-adjacent offsets per parity.
  // Un-fixme this once the owner approves changing road/river/coastline adjacency.
  test.fixme('legacy _DIRS tables point at true neighbours (K1)', async ({ page }) => {
    const bad = await page.evaluate(() => {
      let n = 0;
      for (const row of [224, 225]) {
        const p0 = Canvas.hexCenterWorld(225, row);
        const dirs = (MAP_HEIGHT - 1 - row) % 2 !== 0 ? _DIRS_EVEN : _DIRS_ODD;
        for (const [dc, dr] of Object.values(dirs) as number[][]) {
          const p = Canvas.hexCenterWorld(225 + dc, row + dr);
          if (Math.abs(Math.hypot(p.x - p0.x, p.y - p0.y) - ROW_PITCH) > 1e-6) n++;
        }
      }
      return n;
    });
    expect(bad).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/hex-utils.spec.ts --reporter=line`
Expected: 3 failures with `page.evaluate: ReferenceError: HexUtils is not defined`; 1 test reported as fixme/skipped.

- [ ] **Step 3: Implement `hex-utils.js`**

Create `/Users/sergii.tyshchenko/Post Apo Map Editor/hex-utils.js`:

```js
// hex-utils.js - pure hex-grid geometry for the editor. No DOM and no editor globals.
// Grid model (matches Canvas.hexCenterWorld): flat-top odd-q offset with
//   q = (H - 1 - row) - floor(H / 2)                 (screen x axis, odd q columns are shifted UP)
//   r = (col - floor(W / 2)) - (q - (q & 1)) / 2
// col grows UP the screen and row grows toward the WEST. Cube = { q, r, s = -q - r }.
// rotateCube turns SCREEN-CLOCKWISE; mirrorCube 'h' flips left/right, 'v' flips top/bottom.
const HexUtils = (() => {
  const _par = n => ((n % 2) + 2) % 2;
  const _z = v => v + 0;                       // normalises -0 to 0 so equality checks behave

  const CUBE_DIRS = [
    { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 },
    { q: -1, r: 1, s: 0 }, { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
  ];

  function toCube(col, row, W, H) {
    const q = (H - 1 - row) - Math.floor(H / 2);
    const r = (col - Math.floor(W / 2)) - (q - _par(q)) / 2;
    return { q: _z(q), r: _z(r), s: _z(0 - q - r) };
  }

  function fromCube(c, W, H) {
    const row = H - 1 - (c.q + Math.floor(H / 2));
    const col = c.r + (c.q - _par(c.q)) / 2 + Math.floor(W / 2);
    return { col: _z(col), row: _z(row) };
  }

  function cubeDistance(a, b) {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }

  function cubeRound(f) {
    let q = Math.round(f.q), r = Math.round(f.r), s = Math.round(f.s);
    const dq = Math.abs(q - f.q), dr = Math.abs(r - f.r), ds = Math.abs(s - f.s);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s; else s = -q - r;
    return { q: _z(q), r: _z(r), s: _z(s) };
  }

  // Cube lerp line. The 1e-6 nudge keeps exact-edge ties from flipping between runs.
  function cubeLine(a, b) {
    const n = cubeDistance(a, b), out = [];
    const e = { q: a.q + 1e-6, r: a.r + 2e-6, s: a.s - 3e-6 };
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      out.push(cubeRound({ q: e.q + (b.q - e.q) * t, r: e.r + (b.r - e.r) * t, s: e.s + (b.s - e.s) * t }));
    }
    return out;
  }

  function cubeDisc(center, radius) {
    const out = [];
    for (let dq = -radius; dq <= radius; dq++)
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++)
        out.push({ q: center.q + dq, r: center.r + dr, s: _z(center.s - dq - dr) });
    return out;
  }

  function cubeRing(center, radius) {
    if (radius === 0) return [{ q: center.q, r: center.r, s: center.s }];
    const out = [];
    let c = { q: center.q + CUBE_DIRS[4].q * radius, r: center.r + CUBE_DIRS[4].r * radius, s: center.s + CUBE_DIRS[4].s * radius };
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < radius; j++) {
        out.push(c);
        const d = CUBE_DIRS[i];
        c = { q: c.q + d.q, r: c.r + d.r, s: c.s + d.s };
      }
    }
    return out;
  }

  function rotateCube(c, steps) {
    let { q, r, s } = c;
    steps = ((steps % 6) + 6) % 6;
    for (let i = 0; i < steps; i++) { const nq = -s, nr = -q, ns = -r; q = nq; r = nr; s = ns; }
    return { q: _z(q), r: _z(r), s: _z(s) };
  }

  function mirrorCube(c, axis) {
    return axis === 'h'
      ? { q: _z(-c.q), r: _z(-c.s), s: _z(-c.r) }
      : { q: _z(c.q), r: _z(c.s), s: _z(c.r) };
  }

  function inBounds(col, row, W, H) { return col >= 0 && col < W && row >= 0 && row < H; }

  function cellsFromCubes(cubes, W, H) {
    const out = [], seen = new Set();
    for (const c of cubes) {
      const p = fromCube(c, W, H);
      if (!inBounds(p.col, p.row, W, H)) continue;
      const k = p.col + ',' + p.row;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  }

  const _add = (c, d) => ({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s });
  function neighbors(col, row, W, H) {
    const c = toCube(col, row, W, H);
    return cellsFromCubes(CUBE_DIRS.map(d => _add(c, d)), W, H);
  }
  function discCells(col, row, radius, W, H) {
    return cellsFromCubes(cubeDisc(toCube(col, row, W, H), radius), W, H);
  }
  function ringCells(col, row, radius, W, H) {
    return cellsFromCubes(cubeRing(toCube(col, row, W, H), radius), W, H);
  }
  function lineCells(a, b, W, H) {
    return cellsFromCubes(cubeLine(toCube(a.col, a.row, W, H), toCube(b.col, b.row, W, H)), W, H);
  }

  return {
    CUBE_DIRS, toCube, fromCube, cubeDistance, cubeRound, cubeLine, cubeDisc, cubeRing,
    rotateCube, mirrorCube, inBounds, cellsFromCubes, neighbors, discCells, ringCells, lineCells,
  };
})();
```

In `MapEditorPro.html`, insert the tag immediately before the zone-painter tag:

```html
<script src="hex-utils.js?v=1"></script>
<script src="zone-painter.js?v=8"></script>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/hex-utils.spec.ts --reporter=line`
Expected: 3 passed, 1 skipped (fixme).

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/hex-utils.spec.ts tests/editor-globals.d.ts
git commit -m "feat(hex): add HexUtils cube-coordinate geometry module

Pure toCube/fromCube, distance, line, disc, ring, rotate and mirror, checked
against Canvas.hexCenterWorld pixels. Documents the broken legacy _DIRS tables
as a fixme test.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the rotation direction and mirror axes are asserted against real pixel positions on three map sizes (including odd 451 and non-square 12x10); check no later task reintroduces `_DIRS_*`.

---

### Task T2.2: Shared `applyTerrainCells`, edge re-resolution for Rectangle/Fill/Paint, hex-correct Fill

Covers roadmap 2.5. After this task Paint, Fill and Rectangle all go through one function that re-resolves river/lake edge tiles (reusing `_autoResolveEdgesAround`), and Fill floods true hex neighbours.

**Files:**
- Modify: `MapEditorPro.html` `Tools` module. Anchors: `function _autoResolveEdgesAround(cellsPainted) {` (~4097), `function _paint(col, row) {` (~4137), `function _fill(col, row) {` (~4186), `function _applyRect(c1, r1, c2, r2) {` (~4220), `return { init, setActive, getActive, selectBuilding, getSelectedBuildingId };` (~4558).
- Create: `tests/editor-helpers.ts`, `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.neighbors`, `Terrain.byHexId`, `EdgeTiling.resolveEdgeTile`, `getSatelliteAnchor`, `invalidateSatelliteMap`.
- Produces (added to the `Tools` return object):
  - `Tools.applyTerrainCells(cells: {col,row}[], hexId: string, opts?: {noSymmetry?: boolean}) -> {col,row,prev}[]` (cells actually changed, with the previous id). Caller owns `History.push()`.
  - `Tools.autoResolveEdgesAround(cells: {col,row,prev?}[])`
  - `Tools.fillAt(col,row)`, `Tools.applyRect(c1,r1,c2,r2)`
- Produces test helpers in `tests/editor-helpers.ts`: `freshEditor(page)`, `cellPoint(page,col,row)`, `clickCell(page,col,row)`, `dragCells(page,a,b,{shift?})`, `idAt(page,col,row)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/editor-helpers.ts`:

```ts
import { Page } from '@playwright/test';
import { openEditor } from './helpers';

export type Cell = { col: number; row: number };

/** Opens the editor on a blank 450x450 map, city centred on screen, Paint tool, brush radius 0. */
export async function freshEditor(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().length > 0 && BldDB.getAll().length > 0);
  await page.evaluate(() => {
    IO.newMap(true);                              // silent: blank 450x450 map, city at centre
    window.dispatchEvent(new Event('resize'));
    UI.selectTerrain('Plain_1');
    Tools.setActive('paint');
    Brush.setSize(0);
    Canvas.centerOnCity();                        // also renders
  });
}

/** Page coordinates of a cell centre (the city cell, col 225 row 224, is near the canvas centre). */
export async function cellPoint(page: Page, col: number, row: number) {
  return page.evaluate(([c, r]) => {
    const p = Canvas.hexScreenPos(c, r);
    const b = document.getElementById('map-canvas')!.getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y };
  }, [col, row]);
}

export async function clickCell(page: Page, col: number, row: number) {
  const p = await cellPoint(page, col, row);
  await page.mouse.click(p.x, p.y);
}

export async function dragCells(page: Page, a: Cell, b: Cell, opts: { shift?: boolean } = {}) {
  const pa = await cellPoint(page, a.col, a.row);
  const pb = await cellPoint(page, b.col, b.row);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 4 });
  await page.mouse.move(pb.x, pb.y, { steps: 4 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

export async function idAt(page: Page, col: number, row: number): Promise<string> {
  return page.evaluate(([c, r]) => mapData[r * MAP_WIDTH + c], [col, row]);
}
```

Create `tests/paint-tools.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor, clickCell, dragCells } from './editor-helpers';

const CITY = { col: 225, row: 224 };

test.describe('terrain apply and edge re-resolution (T2.2)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Rectangle re-resolves directional river tiles', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('River_L_1'); Tools.setActive('rect'); });
    await page.evaluate(() => {
      (window as any).__resolveCalls = 0;
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { (window as any).__resolveCalls++; return orig(...a); };
    });
    await dragCells(page, { col: 224, row: 222 }, { col: 226, row: 226 });
    const n = await page.evaluate(() => (window as any).__resolveCalls);
    expect(n).toBeGreaterThan(0);
  });

  test('painting land over a river re-resolves its directional neighbours', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const c = { col: 225, row: 224 };
      const nb = HexUtils.neighbors(c.col, c.row, W, MAP_HEIGHT)[0];
      mapData[c.row * W + c.col] = 'River_L_1';
      mapData[nb.row * W + nb.col] = 'River_L_1';
      const seen: string[] = [];
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (col: number, row: number, ...rest: any[]) => { seen.push(col + ',' + row); return orig(col, row, ...rest); };
      Tools.applyTerrainCells([c], 'Plain_1');
      EdgeTiling.resolveEdgeTile = orig;
      return { seen, nb: nb.col + ',' + nb.row };
    });
    expect(r.seen).toContain(r.nb);
  });

  test('Fill stays inside a hex ring and fills exactly the 7 enclosed cells', async ({ page }) => {
    const filled = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const centre = HexUtils.toCube(225, 224, W, H);
      for (const p of HexUtils.cellsFromCubes(HexUtils.cubeRing(centre, 2), W, H)) mapData[p.row * W + p.col] = 'Rubble_1';
      UI.selectTerrain('Forest_1');
      Tools.fillAt(225, 224);
      return mapData.filter(id => id === 'Forest_1').length;
    });
    expect(filled).toBe(7);
  });

  test('Paint still undoes in one step', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await clickCell(page, CITY.col + 2, CITY.row);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Water_1');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Plain_1');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected failures: Rectangle test `expect(n).toBeGreaterThan(0)` received 0; second test `TypeError: Tools.applyTerrainCells is not a function`; Fill test `Tools.fillAt is not a function`. The undo test passes.

- [ ] **Step 3: Implement in the `Tools` module**

(a) Replace the whole `_autoResolveEdgesAround` function (from its leading comment block through its closing brace, ~4092-4127) with:

```js
  // Edge-tiled families are Water and Rivers. A cell is "directional" when its HexDB
  // entry has a non-empty edgeFaces array (River_*, Lake_*); plain flat water has [].
  const _EDGE_FAMILY = ['Water', 'Rivers'];
  function _isDirectional(entry) { return !!entry && Array.isArray(entry.edgeFaces) && entry.edgeFaces.length > 0; }
  function _inEdgeFamily(entry) { return !!entry && _EDGE_FAMILY.includes(entry.type); }

  // cellsPainted: [{col,row,prev?}] where prev is the id the cell held BEFORE the edit.
  // A directional tile painted here re-resolves itself and its water/river neighbours (original
  // rule). A water/river cell appearing or disappearing here re-resolves directional neighbours,
  // so erasing or replacing a river no longer leaves stale sprites next to it.
  // Neighbour discovery uses HexUtils (true adjacency), not the legacy _DIRS tables (issue K1).
  function _autoResolveEdgesAround(cellsPainted) {
    if (typeof EdgeTiling === 'undefined' || typeof HexDB === 'undefined') return;
    const familyTypes = _EDGE_FAMILY;
    const toResolve = new Set();
    for (const { col: c, row: r, prev } of cellsPainted) {
      if (c < 0 || c >= MAP_WIDTH || r < 0 || r >= MAP_HEIGHT) continue;
      const entry = Terrain.byHexId(mapData[r * MAP_WIDTH + c]);
      const prevEntry = prev ? Terrain.byHexId(prev) : null;
      const nowDirectional = _isDirectional(entry);
      if (!nowDirectional && !_inEdgeFamily(entry) && !_inEdgeFamily(prevEntry)) continue;
      if (nowDirectional) toResolve.add(r * MAP_WIDTH + c);
      for (const n of HexUtils.neighbors(c, r, MAP_WIDTH, MAP_HEIGHT)) {
        const nEntry = Terrain.byHexId(mapData[n.row * MAP_WIDTH + n.col]);
        if (_isDirectional(nEntry) || (nowDirectional && nEntry && familyTypes.includes(nEntry.type)))
          toResolve.add(n.row * MAP_WIDTH + n.col);
      }
    }
    const fallbackIds = [_riverFallbackId('Water_Dirty_1'), _riverFallbackId('Water_1'), _riverFallbackId('Water_Rock_1')];
    for (const idx of toResolve) {
      const rr = Math.floor(idx / MAP_WIDTH), rc = idx % MAP_WIDTH;
      mapData[idx] = EdgeTiling.resolveEdgeTile(rc, rr, MAP_WIDTH, MAP_HEIGHT, mapData, familyTypes, Math.random, fallbackIds);
    }
  }

  // Single entry point for every terrain-writing tool. Returns the cells that really changed.
  function _applyTerrainCells(cells, hexId, opts) {
    const seen = new Set();
    const touched = [];
    for (const { col: c, row: r } of cells) {
      if (c < 0 || c >= MAP_WIDTH || r < 0 || r >= MAP_HEIGHT) continue;
      const k = c + ',' + r;
      if (seen.has(k)) continue;
      seen.add(k);
      if (getSatelliteAnchor(c, r)) continue;      // never paint under a multi-tile footprint
      const idx = r * MAP_WIDTH + c;
      touched.push({ col: c, row: r, prev: mapData[idx] });
      mapData[idx] = hexId;
      const bi = bridgesData.findIndex(b => b.col === c && b.row === r);
      if (bi >= 0) bridgesData.splice(bi, 1);
    }
    invalidateSatelliteMap();
    _autoResolveEdgesAround(touched);
    return touched;
  }
```

(b) In `_paint`, replace the block from `const tiles = Brush.getAffectedTiles(col, row);` through `_autoResolveEdgesAround(tiles);` (the lines that loop `tiles.forEach`, call `invalidateSatelliteMap()` and `_autoResolveEdgesAround(tiles)`) with:

```js
    const tiles = Brush.getAffectedTiles(col, row);
    _applyTerrainCells(tiles, UI.getSelectedTerrain());
```

(c) Replace `_fill` entirely:

```js
  function _fill(col, row) {
    const targetId = mapData[row * MAP_WIDTH + col];
    const fillId   = UI.getSelectedTerrain();
    if (targetId === fillId) return;
    const visited = new Set([col + ',' + row]);
    const queue   = [{ col, row }];
    const touched = [];
    for (let qi = 0; qi < queue.length; qi++) {
      const { col: c, row: r } = queue[qi];
      if (getSatelliteAnchor(c, r)) continue;       // skip tiles under multi-tile footprint
      touched.push({ col: c, row: r, prev: targetId });
      mapData[r * MAP_WIDTH + c] = fillId;
      for (const n of HexUtils.neighbors(c, r, MAP_WIDTH, MAP_HEIGHT)) {
        const k = n.col + ',' + n.row;
        if (visited.has(k) || mapData[n.row * MAP_WIDTH + n.col] !== targetId) continue;
        visited.add(k);
        queue.push(n);
      }
    }
    invalidateSatelliteMap();
    _autoResolveEdgesAround(touched);
    Canvas.render();
  }
```

(d) Replace `_applyRect` entirely:

```js
  function _applyRect(c1, r1, c2, r2) {
    const minC = Math.max(0, Math.min(c1, c2)), maxC = Math.min(MAP_WIDTH - 1, Math.max(c1, c2));
    const minR = Math.max(0, Math.min(r1, r2)), maxR = Math.min(MAP_HEIGHT - 1, Math.max(r1, r2));
    const cells = [];
    for (let c = minC; c <= maxC; c++)
      for (let r = minR; r <= maxR; r++) cells.push({ col: c, row: r });
    _applyTerrainCells(cells, UI.getSelectedTerrain());
    Canvas.render();
  }
```

(e) Change the module's return line to:

```js
  return { init, setActive, getActive, selectBuilding, getSelectedBuildingId,
           applyTerrainCells: _applyTerrainCells, autoResolveEdgesAround: _autoResolveEdgesAround,
           fillAt: _fill, applyRect: _applyRect };
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/paint-tools.spec.ts tests/editor-helpers.ts
git commit -m "feat(tools): shared applyTerrainCells with edge re-resolution for Rectangle/Fill

Rectangle now re-resolves river tiles, replacing a river re-resolves its
neighbours, and Fill floods true hex neighbours (was c%2 on the wrong axis).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `_autoResolveEdgesAround` still honours the original "painted directional tile also re-resolves plain-water neighbours" rule; confirm Phase 1 item 4 keeps `HexUtils.neighbors` when it rewrites the fill queue; note the edge mask itself still uses the legacy tables (K1).

---

### Task T2.3: Larger brush sizes and shortcuts

Covers the brush half of roadmap 2.3.

**Files:**
- Modify: `MapEditorPro.html` `Brush` module. Anchors: `const Brush = (() => {` (~3921), `function getAffectedTiles(col, row) {` (~3939), `function setSize(s) {` (~3969), `return { getAffectedTiles, setSize, getSize };` (~3978).
- Modify: `MapEditorPro.html` brush panel HTML. Anchor: `<div id="brush-sizes">` (~1433); add a slider row after its closing `</div>`.
- Modify: `MapEditorPro.html` `Tools.init` keydown handler. Anchor: `if (e.ctrlKey || e.metaKey) return;` inside `function init()` of Tools (~4544).
- Modify: `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.discCells`.
- Produces: `Brush.getAffectedTiles(col,row)` (any radius 0..12, true hex disc), `Brush.setSize(n)` (clamped 0..`Brush.MAX_SIZE`), `Brush.grow()`, `Brush.shrink()`, `Brush.MAX_SIZE` (12).

- [ ] **Step 1: Write the failing tests** (append to `tests/paint-tools.spec.ts`)

```ts
test.describe('brush sizes (T2.3)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('brush disc matches HexUtils on an odd-sized map (old parity bug K3)', async ({ page }) => {
    const [got, want] = await page.evaluate(() => {
      const save = [MAP_WIDTH, MAP_HEIGHT];
      MAP_WIDTH = 451; MAP_HEIGHT = 451;
      Brush.setSize(2);
      const key = (t: any) => t.col + ',' + t.row;
      const got = Brush.getAffectedTiles(200, 200).map(key).sort();
      const want = HexUtils.discCells(200, 200, 2, 451, 451).map(key).sort();
      MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
      Brush.setSize(0);
      return [got, want];
    });
    expect(got).toEqual(want);
  });

  test('radius 9 gives 271 tiles and is clamped at 12', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(9);
      const n9 = Brush.getAffectedTiles(225, 224).length;
      Brush.setSize(99);
      const size = Brush.getSize();
      return { n9, size };
    });
    expect(r.n9).toBe(271);
    expect(r.size).toBe(12);
  });

  test('[ and ] shrink and grow the brush', async ({ page }) => {
    await page.keyboard.press('BracketRight');
    await page.keyboard.press('BracketRight');
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    await page.keyboard.press('BracketLeft');
    expect(await page.evaluate(() => Brush.getSize())).toBe(1);
    await page.keyboard.press('BracketLeft');
    await page.keyboard.press('BracketLeft');
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/paint-tools.spec.ts -g "brush sizes" --reporter=line`
Expected: parity test fails (arrays differ), clamp test `expected 12, received 99`, shortcut test `expected 2, received 0`.

- [ ] **Step 3: Implement**

Replace the body of the `Brush` module from `let _size = 0;` through the `return` line with:

```js
const Brush = (() => {
  const MAX_SIZE = 12;
  let _size = 0;   // hex radius: 0 = single tile, n = disc of radius n (3n(n+1)+1 tiles)

  function getAffectedTiles(col, row) {
    if (_size === 0) return [{ col, row }];
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return [];
    return HexUtils.discCells(col, row, _size, MAP_WIDTH, MAP_HEIGHT);
  }

  function setSize(s) {
    _size = Math.max(0, Math.min(MAX_SIZE, parseInt(s) || 0));
    document.querySelectorAll('.brush-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.brush) === _size);
    });
    const range = document.getElementById('brush-size-range');
    if (range) range.value = String(_size);
    const label = document.getElementById('brush-size-label');
    if (label) label.textContent = `Radius ${_size} (${3 * _size * (_size + 1) + 1} tiles)`;
  }

  function getSize() { return _size; }
  function grow()   { setSize(_size + 1); }
  function shrink() { setSize(_size - 1); }

  return { getAffectedTiles, setSize, getSize, grow, shrink, MAX_SIZE };
})();
```

Brush panel HTML: directly after the closing `</div>` of `<div id="brush-sizes">...</div>` add:

```html
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
          <input id="brush-size-range" type="range" min="0" max="12" step="1" value="0"
                 style="flex:1" oninput="Brush.setSize(this.value)" title="Brush radius ([ and ] keys)">
        </div>
        <div id="brush-size-label" style="font-size:10px;color:var(--muted);margin-top:2px">Radius 0 (1 tiles)</div>
```

In `Tools.init`, immediately after the line `if (e.ctrlKey || e.metaKey) return;` add:

```js
      if (!document.body.classList.contains('mode-map')) return;
      if (e.code === 'BracketLeft')  { Brush.shrink(); return; }
      if (e.code === 'BracketRight') { Brush.grow();   return; }
```

Note: the existing guard `if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;` sits above it, so typing in inputs is unaffected.

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/paint-tools.spec.ts
git commit -m "feat(brush): hex-disc brush up to radius 12 with [ ] shortcuts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the brush preview in `Canvas.render` calls `Brush.getAffectedTiles` for every mouse move; radius 12 is 469 tiles, so check it stays smooth at 25% zoom.

---

### Task T2.4: Line, Circle and Polygon tools (with the `Canvas.setHighlight` overlay API)

Covers the shape half of roadmap 2.3. Line uses cube lerp; circle is a hex ring (Shift = filled disc); polygon fills by point-in-polygon on true cell-centre pixels.

**Files:**
- Modify: `hex-utils.js` (add `cubeToPixel`, `polygonCells`; extend the return object).
- Modify: `MapEditorPro.html` `Canvas`. Anchors: `// Rect preview overlay drawn by Tools if needed` (~2924) inside `render()`, and the `Canvas` return object `selectTile, clearSelection, applyTileInspectorUnder, clearTileInspectorUnder,` (~3903).
- Modify: `MapEditorPro.html` `Tools`. Anchors: `const TOOL_NAMES = {` (~3994), `_rectStart = null;` inside `setActive` (~4005), `case 'rect':` in `_onDown` (~4428), `function _onMove(sx, sy, e) {` (~4481), `function _onUp(e) {` (~4518), `case 'z': setActive('zone');` (~4553).
- Modify: `MapEditorPro.html` toolbar. Anchor: `data-tool="rect"` button (~1320).
- Modify: `tests/hex-utils.spec.ts`, `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `Brush.getAffectedTiles`, `Tools.applyTerrainCells` (T2.2), `HexUtils.lineCells/ringCells/discCells`.
- Produces:
  - `HexUtils.cubeToPixel(c) -> {x,y}` (unit hex size, screen y down), `HexUtils.polygonCells(cubes, W, H, filled=true) -> {col,row}[]`
  - `Canvas.setHighlight(name: string, cells: {col,row}[] | null, style?: {stroke?: string, fill?: string})` - named overlay layer; null/empty removes it.
  - Tools `'line'`, `'circle'`, `'polygon'`; keys L, O, G; polygon commits on Enter (Shift+Enter = outline only) or double-click, Esc cancels.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hex-utils.spec.ts`:

```ts
test('polygonCells: hexagon corners give a filled 37-cell disc, outline gives the 18-cell ring', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const W = 450, H = 450;
    const a = HexUtils.toCube(225, 224, W, H);
    const ring = HexUtils.cubeRing(a, 3);
    const corners = [0, 3, 6, 9, 12, 15].map(i => ring[i]);
    return {
      filled: HexUtils.polygonCells(corners, W, H, true).length,
      outline: HexUtils.polygonCells(corners, W, H, false).length,
    };
  });
  expect(r.filled).toBe(37);
  expect(r.outline).toBe(18);
});
```

Append to `tests/paint-tools.spec.ts`:

```ts
test.describe('shape tools (T2.4)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const water = async (page: any) => page.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < mapData.length; i++) if (mapData[i] === 'Water_1') out.push((i % MAP_WIDTH) + ',' + Math.floor(i / MAP_WIDTH));
    return out.sort();
  });

  test('Line tool paints exactly HexUtils.lineCells and undoes in one step', async ({ page }) => {
    const a = { col: 222, row: 219 }, b = { col: 228, row: 228 };
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('line'); });
    const before = await page.evaluate(() => History.undoSize());
    await dragCells(page, a, b);
    const want = await page.evaluate(([a, b]) =>
      HexUtils.lineCells(a, b, MAP_WIDTH, MAP_HEIGHT).map((c: any) => c.col + ',' + c.row).sort(), [a, b]);
    expect(await water(page)).toEqual(want);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await water(page)).toEqual([]);
  });

  test('Circle tool draws a ring of 6*radius cells and Shift fills the disc', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('circle'); });
    const edge = await page.evaluate(() => {
      const c = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
      return HexUtils.fromCube({ q: c.q - 4, r: c.r, s: c.s + 4 }, MAP_WIDTH, MAP_HEIGHT);
    });
    await dragCells(page, { col: 225, row: 224 }, edge);
    expect((await water(page)).length).toBe(24);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Plain_1');
    await page.evaluate(() => History.undo());
    await dragCells(page, { col: 225, row: 224 }, edge, { shift: true });
    expect((await water(page)).length).toBe(61);
  });

  test('Polygon tool: three clicks and Enter fill the triangle', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('polygon'); });
    const verts = await page.evaluate(() => {
      const a = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
      return [a, { q: a.q + 5, r: a.r, s: a.s - 5 }, { q: a.q, r: a.r + 5, s: a.s - 5 }]
        .map(c => HexUtils.fromCube(c, MAP_WIDTH, MAP_HEIGHT));
    });
    for (const v of verts) await clickCell(page, v.col, v.row);
    await page.keyboard.press('Enter');
    const want = await page.evaluate((verts) => {
      const cubes = verts.map((v: any) => HexUtils.toCube(v.col, v.row, MAP_WIDTH, MAP_HEIGHT));
      return HexUtils.polygonCells(cubes, MAP_WIDTH, MAP_HEIGHT, true).map((c: any) => c.col + ',' + c.row).sort();
    }, verts);
    expect(await water(page)).toEqual(want);
    expect(want.length).toBeGreaterThan(20);
  });

  test('L, O, G select the shape tools', async ({ page }) => {
    for (const [key, tool] of [['l', 'line'], ['o', 'circle'], ['g', 'polygon']]) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Tools.getActive())).toBe(tool);
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/hex-utils.spec.ts tests/paint-tools.spec.ts -g "polygonCells|shape tools" --reporter=line`
Expected: `HexUtils.polygonCells is not a function`; shape-tool tests fail on the wrong active tool or an empty water list.

- [ ] **Step 3: Implement**

(a) `hex-utils.js`: add before the `return {` line:

```js
  // Unit-size flat-top pixel centre (screen y points down). Matches hexCenterWorld up to a constant offset.
  function cubeToPixel(c) { return { x: 1.5 * c.q, y: -Math.sqrt(3) * (c.r + c.q / 2) }; }

  function _inPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // Cells on the outline (cube lines between consecutive vertices) plus, when filled, every cell
  // whose centre is inside the polygon.
  function polygonCells(verts, W, H, filled) {
    const out = new Map();
    const add = c => out.set(c.q + ',' + c.r, c);
    for (let i = 0; i < verts.length; i++) {
      if (verts.length === 1) { add(verts[0]); break; }
      for (const c of cubeLine(verts[i], verts[(i + 1) % verts.length])) add(c);
      if (verts.length === 2) break;
    }
    if (filled !== false && verts.length >= 3) {
      const px = verts.map(cubeToPixel);
      const qs = verts.map(v => v.q), rs = verts.map(v => v.r);
      for (let q = Math.min(...qs); q <= Math.max(...qs); q++)
        for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
          const c = { q, r, s: 0 - q - r };
          if (_inPoly(cubeToPixel(c), px)) add(c);
        }
    }
    return cellsFromCubes([...out.values()], W, H);
  }
```

and add `cubeToPixel, polygonCells,` to the returned object.

(b) `Canvas`: inside `render()`, directly after the `if (_toolsRectPreview) { _drawRectPreview(_toolsRectPreview, radius); }` block add:

```js
    _drawHighlights(radius);
```

Add before `function _drawRectPreview(preview, radius) {`:

```js
  // Named overlay layers drawn by tools (selection, shape previews, paste ghost).
  const _highlights = new Map();   // name -> { cells, stroke, fill }
  function setHighlight(name, cells, style) {
    if (!cells || cells.length === 0) _highlights.delete(name);
    else _highlights.set(name, {
      cells,
      stroke: (style && style.stroke) || 'rgba(79,195,247,0.9)',
      fill:   (style && style.fill) || null,
    });
    render();
  }
  function _drawHighlights(radius) {
    if (_highlights.size === 0) return;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, radius * 0.08);
    _highlights.forEach(h => {
      ctx.strokeStyle = h.stroke;
      if (h.fill) ctx.fillStyle = h.fill;
      for (const { col, row } of h.cells) {
        const s = hexScreenPos(col, row);
        if (s.x + radius * 2 < 0 || s.x - radius * 2 > canvas.width ||
            s.y + radius * 2 < 0 || s.y - radius * 2 > canvas.height) continue;
        hexClipPath(s.x, s.y, radius);
        if (h.fill) ctx.fill();
        ctx.stroke();
      }
    });
    ctx.restore();
  }
```

Export: change `selectTile, clearSelection, applyTileInspectorUnder, clearTileInspectorUnder,` to `selectTile, clearSelection, applyTileInspectorUnder, clearTileInspectorUnder, setHighlight,`.

(c) `Tools`:

1. `TOOL_NAMES`: add `line: 'Line', circle: 'Circle', polygon: 'Polygon',` inside the object.
2. Add state next to `let _rectStart = null;`:
```js
  let _shapeStart = null;     // { col, row } while dragging a line or circle
  let _shapeEnd   = null;
  let _polyVerts  = [];       // pending polygon corners
```
3. In `setActive`, after `_rectStart = null;` add:
```js
    _shapeStart = null; _shapeEnd = null; _polyVerts = [];
    Canvas.setHighlight('shape', null);
```
4. Add helpers before `// ── Mouse callbacks (registered with Canvas) ───`:
```js
  // ── Shapes ─────────────────────────────────────────────────
  function _expandByBrush(cells) {
    const out = new Map();
    for (const { col, row } of cells)
      for (const t of Brush.getAffectedTiles(col, row)) out.set(t.col + ',' + t.row, t);
    return [...out.values()];
  }

  function _shapeCells(tool, a, b, filled) {
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    if (tool === 'line') return _expandByBrush(HexUtils.lineCells(a, b, W, H));
    const radius = HexUtils.cubeDistance(HexUtils.toCube(a.col, a.row, W, H), HexUtils.toCube(b.col, b.row, W, H));
    return filled ? HexUtils.discCells(a.col, a.row, radius, W, H)
                  : _expandByBrush(HexUtils.ringCells(a.col, a.row, radius, W, H));
  }

  function _polyCells(verts, outlineOnly) {
    const cubes = verts.map(v => HexUtils.toCube(v.col, v.row, MAP_WIDTH, MAP_HEIGHT));
    return HexUtils.polygonCells(cubes, MAP_WIDTH, MAP_HEIGHT, !outlineOnly);
  }

  function _previewPolygon(cursor) {
    const verts = cursor ? _polyVerts.concat([cursor]) : _polyVerts;
    Canvas.setHighlight('shape', _polyCells(verts, true), { fill: 'rgba(79,195,247,0.12)' });
  }

  function _commitPolygon(outlineOnly) {
    const verts = _polyVerts.filter((v, i, a) => i === 0 || v.col !== a[i - 1].col || v.row !== a[i - 1].row);
    _polyVerts = [];
    Canvas.setHighlight('shape', null);
    if (verts.length < 2) return;
    History.push();
    _applyTerrainCells(_polyCells(verts, outlineOnly), UI.getSelectedTerrain());
    Canvas.drawMinimap();
    Canvas.render();
  }
```
5. `_onDown`: after the `case 'rect':` block (before `case 'select':`) add:
```js
      case 'line':
      case 'circle':
        _shapeStart = { col, row }; _shapeEnd = { col, row };
        Canvas.setHighlight('shape', _shapeCells(_active, _shapeStart, _shapeEnd, false), { fill: 'rgba(79,195,247,0.12)' });
        break;
      case 'polygon':
        if (e && e.detail >= 2 && _polyVerts.length >= 3) { _commitPolygon(e.shiftKey); _isDown = false; break; }
        _polyVerts.push({ col, row });
        _previewPolygon(null);
        _isDown = false;
        break;
```
6. `_onMove`: replace its first line `if (!_isDown) return;` with:
```js
    if (_active === 'polygon' && _polyVerts.length) {
      const hov = Canvas.screenToHex(sx, sy);
      if (hov.col >= 0 && hov.col < MAP_WIDTH && hov.row >= 0 && hov.row < MAP_HEIGHT) _previewPolygon(hov);
    }
    if (!_isDown) return;
```
and inside its `switch (_active)` add:
```js
      case 'line':
      case 'circle':
        if (_shapeStart) {
          _shapeEnd = { col, row };
          Canvas.setHighlight('shape', _shapeCells(_active, _shapeStart, _shapeEnd, _active === 'circle' && e.shiftKey),
                              { fill: 'rgba(79,195,247,0.12)' });
        }
        break;
```
7. `_onUp`: change the first `if` condition's list to also include nothing new, and add a new `else if` after the `rect` branch:
```js
    } else if ((_active === 'line' || _active === 'circle') && _shapeStart) {
      const cells = _shapeCells(_active, _shapeStart, _shapeEnd || _shapeStart, _active === 'circle' && e.shiftKey);
      History.push();
      _applyTerrainCells(cells, UI.getSelectedTerrain());
      _shapeStart = null; _shapeEnd = null;
      Canvas.setHighlight('shape', null);
      Canvas.drawMinimap();
      Canvas.render();
    }
```
(make it part of the existing `if / else if` chain, directly after the `rect` branch's closing brace and before `_lastPainted = null;`).
8. Add next to `TOOL_NAMES` a physical-key shortcut table (layout independent; later tasks add entries):
```js
  const CODE_TOOLS = { KeyL: 'line', KeyO: 'circle', KeyG: 'polygon' };
```
and in the `Tools.init` key handler, after the bracket lines from T2.3 and before the `switch (e.key.toLowerCase())`, add:
```js
      if (e.key === 'Enter' && _active === 'polygon' && _polyVerts.length >= 2) { _commitPolygon(e.shiftKey); return; }
      if (e.key === 'Escape') { _shapeStart = null; _shapeEnd = null; _polyVerts = []; Canvas.setHighlight('shape', null); }
      if (CODE_TOOLS[e.code] && !e.shiftKey && !e.altKey) { setActive(CODE_TOOLS[e.code]); return; }
```

(d) Toolbar: after the Rectangle button add:

```html
      <button class="tool-btn" data-tool="line" onclick="Tools.setActive('line')">╱<span class="tooltip">Line (L) - drag, uses brush size</span></button>
      <button class="tool-btn" data-tool="circle" onclick="Tools.setActive('circle')">◯<span class="tooltip">Circle (O) - drag from centre, Shift = filled</span></button>
      <button class="tool-btn" data-tool="polygon" onclick="Tools.setActive('polygon')">⬠<span class="tooltip">Polygon (G) - click corners, Enter fills, Shift+Enter outline, Esc cancels</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/hex-utils.spec.ts tests/paint-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/hex-utils.spec.ts tests/paint-tools.spec.ts
git commit -m "feat(tools): line, circle and polygon tools with highlight overlay API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `Canvas.setHighlight` calls `render()` on every call, so check it does not double-render per mousemove next to the existing cursor render; polygon double-click adds a duplicate vertex that `_commitPolygon` de-duplicates.

---

### Task T2.5: Symmetric painting

Covers the symmetry half of roadmap 2.6. Modes: off, mirror left/right (`h`), mirror top/bottom (`v`), both mirrors (`hv`), 3-fold and 6-fold rotation, all about the map-centre cell.

**Files:**
- Modify: `hex-utils.js` (add `SYMMETRY_MODES`, `symmetryCubes`, `symmetryCells`).
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function _applyTerrainCells(cells, hexId, opts) {` (added in T2.2) and `const CODE_TOOLS = {` (added in T2.4).
- Modify: `MapEditorPro.html` brush panel. Anchor: `<div id="brush-size-label"` (T2.3).
- Modify: `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.toCube/mirrorCube/rotateCube/cellsFromCubes`.
- Produces: `HexUtils.symmetryCells(cells, mode, centerCell, W, H) -> {col,row}[]`; `Tools.setSymmetry(mode)`, `Tools.getSymmetry()`, `Tools.cycleSymmetry()`; every call to `Tools.applyTerrainCells` expands by the active mode unless `opts.noSymmetry`. Key `Y` cycles.

- [ ] **Step 1: Write the failing tests** (append to `tests/paint-tools.spec.ts`)

```ts
test.describe('symmetry (T2.5)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('each mode multiplies a single off-axis stroke', async ({ page }) => {
    const counts = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const c = HexUtils.toCube(225, 224, W, H);
      const p = HexUtils.fromCube({ q: c.q + 3, r: c.r - 1, s: c.s - 2 }, W, H);
      const out: Record<string, number> = {};
      for (const mode of ['none', 'h', 'v', 'hv', 'rot3', 'rot6']) {
        mapData.fill('Plain_1');
        Tools.setSymmetry(mode);
        Tools.applyTerrainCells([p], 'Water_1');
        out[mode] = mapData.filter(id => id === 'Water_1').length;
      }
      Tools.setSymmetry('none');
      return out;
    });
    expect(counts).toEqual({ none: 1, h: 2, v: 2, hv: 4, rot3: 3, rot6: 6 });
  });

  test("mode 'h' is a true left/right mirror in screen pixels, and Y cycles", async ({ page }) => {
    const ok = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const c = HexUtils.toCube(225, 224, W, H);
      const p = HexUtils.fromCube({ q: c.q + 3, r: c.r - 1, s: c.s - 2 }, W, H);
      Tools.setSymmetry('h');
      Tools.applyTerrainCells([p], 'Water_1');
      const pts: any[] = [];
      mapData.forEach((id, i) => { if (id === 'Water_1') pts.push(Canvas.hexCenterWorld(i % W, Math.floor(i / W))); });
      const mid = Canvas.hexCenterWorld(225, 224);
      Tools.setSymmetry('none');
      return pts.length === 2 && Math.abs((pts[0].x + pts[1].x) / 2 - mid.x) < 1e-6 && Math.abs(pts[0].y - pts[1].y) < 1e-6;
    });
    expect(ok).toBe(true);
    await page.keyboard.press('y');
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('h');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/paint-tools.spec.ts -g symmetry --reporter=line`
Expected: `TypeError: Tools.setSymmetry is not a function`.

- [ ] **Step 3: Implement**

`hex-utils.js`, before `return {`:

```js
  const SYMMETRY_MODES = ['none', 'h', 'v', 'hv', 'rot3', 'rot6'];

  // Every image of cube c under the symmetry group about `center`, de-duplicated.
  function symmetryCubes(c, mode, center) {
    const rel = { q: c.q - center.q, r: c.r - center.r, s: c.s - center.s };
    let rels;
    switch (mode) {
      case 'h':    rels = [rel, mirrorCube(rel, 'h')]; break;
      case 'v':    rels = [rel, mirrorCube(rel, 'v')]; break;
      case 'hv':   rels = [rel, mirrorCube(rel, 'h'), mirrorCube(rel, 'v'), rotateCube(rel, 3)]; break;
      case 'rot3': rels = [rel, rotateCube(rel, 2), rotateCube(rel, 4)]; break;
      case 'rot6': rels = [0, 1, 2, 3, 4, 5].map(k => rotateCube(rel, k)); break;
      default:     rels = [rel];
    }
    const seen = new Set(), out = [];
    for (const x of rels) {
      const k = x.q + ',' + x.r;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ q: center.q + x.q, r: center.r + x.r, s: center.s + x.s });
    }
    return out;
  }

  function symmetryCells(cells, mode, centerCell, W, H) {
    if (!mode || mode === 'none') return cells;
    const center = toCube(centerCell.col, centerCell.row, W, H);
    const cubes = [];
    for (const { col, row } of cells)
      for (const c of symmetryCubes(toCube(col, row, W, H), mode, center)) cubes.push(c);
    return cellsFromCubes(cubes, W, H);
  }
```

and add `SYMMETRY_MODES, symmetryCubes, symmetryCells,` to the returned object.

`Tools`: add state and helpers after `let _polyVerts = [];`:

```js
  let _symMode = 'none';
  function _symCenter() { return { col: Math.floor(MAP_WIDTH / 2), row: Math.floor((MAP_HEIGHT - 1) / 2) }; }
  function _expandSymmetry(cells) {
    return HexUtils.symmetryCells(cells, _symMode, _symCenter(), MAP_WIDTH, MAP_HEIGHT);
  }
  function setSymmetry(mode) {
    _symMode = HexUtils.SYMMETRY_MODES.includes(mode) ? mode : 'none';
    const sel = document.getElementById('symmetry-select');
    if (sel) sel.value = _symMode;
  }
  function getSymmetry() { return _symMode; }
  function cycleSymmetry() {
    const m = HexUtils.SYMMETRY_MODES;
    setSymmetry(m[(m.indexOf(_symMode) + 1) % m.length]);
    UI.toast('Symmetry: ' + _symMode);
  }
```

First line of `_applyTerrainCells` body (before `const seen = new Set();`):

```js
    if (!(opts && opts.noSymmetry)) cells = _expandSymmetry(cells);
```

In the key handler add `KeyY` handling after the `CODE_TOOLS` line:

```js
      if (e.code === 'KeyY' && !e.shiftKey && !e.altKey) { cycleSymmetry(); return; }
```

Return object: add `setSymmetry, getSymmetry, cycleSymmetry`.

Brush panel HTML, after the `brush-size-label` div:

```html
        <div class="section-title" style="margin-top:8px">Symmetry (Y)</div>
        <select id="symmetry-select" class="hexdb-input" style="width:100%;font-size:11px" onchange="Tools.setSymmetry(this.value)">
          <option value="none">Off</option>
          <option value="h">Mirror left / right</option>
          <option value="v">Mirror top / bottom</option>
          <option value="hv">Both mirrors</option>
          <option value="rot3">3-fold rotation</option>
          <option value="rot6">6-fold rotation</option>
        </select>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/paint-tools.spec.ts
git commit -m "feat(tools): symmetric painting (mirror, 3-fold, 6-fold) about the map centre

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the centre is the map-centre cell (not the city, so symmetry stays put after T3.5 moves the city); the on-canvas cursor preview does not yet show the mirrored brushes.

---

### Task T2.6: Real eraser (reset to default tile, remove building/road/bridge)

Covers the eraser half of roadmap 2.4.

**Files:**
- Modify: `MapEditorPro.html` shared state. Anchor: `const HEX_SIZE  = 40;` (~12662) - add `DEFAULT_TILE_ID`.
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function _eraseObject(col, row) {` (~4311) (place `_resetCells` after `_removeSatellites`), `TOOL_NAMES` (~3994), `case 'erase':` in `_onDown`/`_onMove`/`_onUp` (~4447), return line.
- Modify: `MapEditorPro.html` toolbar. Anchor: the `data-tool="eye"` button (~1321).
- Modify: `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `_removeSatellites` (existing), `_expandSymmetry` (T2.5), `_autoResolveEdgesAround` (T2.2), `invalidateSatelliteMap`.
- Produces: global `DEFAULT_TILE_ID = 'Plain_1'`; tool `'eraser'` (key X); `Tools.eraseCells(cells, opts?: {noSymmetry?}) -> number` (cells reset).

- [ ] **Step 1: Write the failing tests** (append to `tests/paint-tools.spec.ts`)

```ts
test.describe('eraser (T2.6)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('eraseCells resets terrain and removes building, road, bridge and under-terrain', async ({ page }) => {
    const r = await page.evaluate(() => {
      const k = '226,224', idx = 224 * MAP_WIDTH + 226;
      mapData[idx] = 'Water_1';
      objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' }; tileExtras[k] = { underTerrainId: 'Water_1' };
      bridgesData.push({ col: 226, row: 224, axis: 0 });
      const n = Tools.eraseCells([{ col: 226, row: 224 }]);
      return { n, id: mapData[idx], o: k in objectsData, rd: k in roadsData, x: k in tileExtras, br: bridgesData.length };
    });
    expect(r).toEqual({ n: 1, id: 'Plain_1', o: false, rd: false, x: false, br: 0 });
  });

  test('X key + click erases and Ctrl+Z restores', async ({ page }) => {
    await page.evaluate(() => { mapData[224 * MAP_WIDTH + 227] = 'Water_1'; });
    await page.keyboard.press('x');
    expect(await page.evaluate(() => Tools.getActive())).toBe('eraser');
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Plain_1');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Water_1');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/paint-tools.spec.ts -g eraser --reporter=line`
Expected: `TypeError: Tools.eraseCells is not a function`; second test: active tool is `paint`, not `eraser`.

- [ ] **Step 3: Implement**

Shared state: after `const HEX_SIZE  = 40;` add:

```js
const DEFAULT_TILE_ID = 'Plain_1';   // blank-map / eraser tile
```

`Tools`: add after `_removeSatellites`:

```js
  // Reset cells to the default tile and drop everything that sat on them.
  function _resetCells(cells, opts) {
    const list = opts && opts.noSymmetry ? cells : _expandSymmetry(cells);
    const touched = [];
    const seen = new Set();
    for (const { col, row } of list) {
      if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) continue;
      const k = col + ',' + row;
      if (seen.has(k)) continue;
      seen.add(k);
      if (getSatelliteAnchor(col, row)) continue;
      const idx = row * MAP_WIDTH + col;
      touched.push({ col, row, prev: mapData[idx] });
      mapData[idx] = DEFAULT_TILE_ID;
      if (objectsData[k]) { const id = objectsData[k]; delete objectsData[k]; _removeSatellites(col, row, id); }
      delete roadsData[k];
      delete tileExtras[k];
      const bi = bridgesData.findIndex(b => b.col === col && b.row === row);
      if (bi >= 0) bridgesData.splice(bi, 1);
    }
    invalidateSatelliteMap();
    _autoResolveEdgesAround(touched);
    return touched.length;
  }
```

`TOOL_NAMES`: add `eraser: 'Eraser',`. `CODE_TOOLS`: add `KeyX: 'eraser',`.

`_onDown`: add before `case 'select':`

```js
      case 'eraser':
        History.push();
        _resetCells(Brush.getAffectedTiles(col, row));
        Canvas.render();
        _lastPainted = { col, row };
        break;
```

`_onMove` `switch`: add

```js
      case 'eraser':
        if (_lastPainted && _lastPainted.col === col && _lastPainted.row === row) break;
        _resetCells(Brush.getAffectedTiles(col, row));
        Canvas.render();
        _lastPainted = { col, row };
        break;
```

`_onUp`: change `if (_active === 'paint' || _active === 'road' || ...)` so the condition also contains `|| _active === 'eraser'`.

Return object: add `eraseCells: _resetCells`.

Toolbar, after the Eyedropper button:

```html
      <button class="tool-btn" data-tool="eraser" onclick="Tools.setActive('eraser')">⌫<span class="tooltip">Eraser (X) - resets tiles to Plain_1 and removes buildings, roads, bridges</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/paint-tools.spec.ts
git commit -m "feat(tools): real eraser resets tiles to the default and removes overlays

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** zones and settlements are deliberately untouched by the eraser (they have their own tools); T2.18 makes it respect locked layers.

---

### Task T2.7: Scatter tool for decoration variants

Covers the scatter half of roadmap 2.6.

**Files:**
- Modify: `hex-utils.js` (add `scatterPick`).
- Modify: `MapEditorPro.html` `Tools` (state, `scatterCells`, `_onDown/_onMove/_onUp`, `CODE_TOOLS`, return) and toolbar (button + density input, after the eraser button).
- Modify: `tests/paint-tools.spec.ts`

**Interfaces:**
- Consumes: `Tools.applyTerrainCells(..., {noSymmetry:true})`, `_expandSymmetry`, `HexDB.getAll()`.
- Produces: `HexUtils.scatterPick(cells, ids, density, rng) -> {col,row,id}[]` (density 0-100); `Tools.scatterCells(cells, hexId, density) -> number placed`; `Tools.setScatterRng(fn)`; tool `'scatter'` (key A); toolbar input `#scatter-density`. Variants of an id = HexDB entries with the same `type` and same first `_` segment, excluding multi-tile anchors and ids matching `/_test|kaiju|chicken/i`.

- [ ] **Step 1: Write the failing test** (append to `tests/paint-tools.spec.ts`)

```ts
test.describe('scatter (T2.7)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('scatter places only variants of the active family; density 0 places nothing', async ({ page }) => {
    const r = await page.evaluate(() => {
      let s = 12345;
      Tools.setScatterRng(() => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; });
      const W = MAP_WIDTH;
      const cells = HexUtils.discCells(225, 224, 3, W, MAP_HEIGHT);
      const n = Tools.scatterCells(cells, 'Forest_1', 100);
      const ids = [...new Set(cells.map((c: any) => mapData[c.row * W + c.col]))].sort();
      const none = Tools.scatterCells(cells, 'Water_1', 0);
      return { n, ids, none };
    });
    expect(r.n).toBe(37);
    expect(r.none).toBe(0);
    expect(r.ids.every((id: string) => /^Forest_[123]$/.test(id))).toBe(true);
    expect(r.ids.length).toBeGreaterThan(1);
  });

  test('A key selects the tool and a click scatters at the toolbar density', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Brush.setSize(3); });
    await page.keyboard.press('a');
    await page.fill('#scatter-density', '100');
    await clickCell(page, 225, 224);
    const n = await page.evaluate(() => mapData.filter(id => /^Forest_/.test(id)).length);
    expect(n).toBe(37);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/paint-tools.spec.ts -g scatter --reporter=line`
Expected: `HexUtils.scatterPick is not a function` / `Tools.setScatterRng is not a function`.

- [ ] **Step 3: Implement**

`hex-utils.js`, before `return {`:

```js
  // For each cell, with probability density% pick one of ids at random.
  function scatterPick(cells, ids, density, rng) {
    const out = [];
    for (const { col, row } of cells)
      if (rng() * 100 < density) out.push({ col, row, id: ids[Math.floor(rng() * ids.length)] });
    return out;
  }
```

Add `scatterPick,` to the returned object.

`Tools`: after the `_resetCells` function add:

```js
  // ── Scatter ────────────────────────────────────────────────
  let _scatterRng = Math.random;
  function setScatterRng(fn) { _scatterRng = fn || Math.random; }

  function _scatterVariants(hexId) {
    const base = Terrain.byHexId(hexId);
    if (!base) return [hexId];
    const prefix = hexId.split('_')[0].toLowerCase();
    const ids = HexDB.getAll()
      .filter(h => h.id && h.type === base.type && h.id.split('_')[0].toLowerCase() === prefix &&
                   !(Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length) &&
                   !/_test|kaiju|chicken/i.test(h.id))
      .map(h => h.id);
    return ids.length ? ids : [hexId];
  }

  function _scatterDensity() {
    const el = document.getElementById('scatter-density');
    return el ? Math.max(0, Math.min(100, parseInt(el.value) || 0)) : 40;
  }

  function scatterCells(cells, hexId, density) {
    const picks = HexUtils.scatterPick(_expandSymmetry(cells), _scatterVariants(hexId), density, _scatterRng);
    const byId = new Map();
    for (const p of picks) { if (!byId.has(p.id)) byId.set(p.id, []); byId.get(p.id).push(p); }
    let n = 0;
    for (const [id, list] of byId) n += _applyTerrainCells(list, id, { noSymmetry: true }).length;
    return n;
  }
```

`TOOL_NAMES`: add `scatter: 'Scatter',`. `CODE_TOOLS`: add `KeyA: 'scatter',`.

`_onDown` (before `case 'select':`):

```js
      case 'scatter':
        History.push();
        scatterCells(Brush.getAffectedTiles(col, row), UI.getSelectedTerrain(), _scatterDensity());
        Canvas.render();
        _lastPainted = { col, row };
        break;
```

`_onMove` switch:

```js
      case 'scatter':
        if (_lastPainted && _lastPainted.col === col && _lastPainted.row === row) break;
        scatterCells(Brush.getAffectedTiles(col, row), UI.getSelectedTerrain(), _scatterDensity());
        Canvas.render();
        _lastPainted = { col, row };
        break;
```

`_onUp`: extend the minimap condition with `|| _active === 'scatter'`. Return object: add `scatterCells, setScatterRng`.

Toolbar, after the eraser button:

```html
      <button class="tool-btn" data-tool="scatter" onclick="Tools.setActive('scatter')">⁘<span class="tooltip">Scatter (A) - sprinkles variants of the active terrain</span></button>
      <input id="scatter-density" type="number" min="0" max="100" step="5" value="40" title="Scatter density %"
             style="width:42px;background:#111;border:1px solid #444;color:#4fc3f7;font-size:11px;padding:2px 4px;border-radius:3px;text-align:center;vertical-align:middle">
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/paint-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/paint-tools.spec.ts
git commit -m "feat(tools): scatter tool for terrain variants with density control

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** variant discovery is name/type based (`Forest_1` -> `Forest_1..3`); check it does not pull in unexpected entries from packages once Phase 5 adds per-package ids.

---

### Task T2.8: Region selection (marquee tool, `Selection` module)

Covers the selection half of roadmap 2.1. Selection is a set of cells shown as a yellow overlay; the tool drags a rectangle (Shift adds, Alt subtracts).

**Files:**
- Modify: `MapEditorPro.html`: new `Selection` module immediately before `// TOOLS MODULE` banner (anchor: `// TOOLS MODULE — paint, fill, rect, eyedropper, settlement, erase`, ~3981); `Tools` (`TOOL_NAMES`, `CODE_TOOLS`, `_onDown`/`_onMove`/`_onUp`, `init`, return, `_applyRect`); toolbar after the Rectangle button.
- Create: `tests/selection.spec.ts`

**Interfaces:**
- Consumes: `Canvas.setHighlight` (T2.4).
- Produces (global `Selection`): `getCells() -> {col,row}[]`, `setCells(cells, mode='replace'|'add'|'subtract')`, `clear()`, `isEmpty()`, `has(col,row)`, `size()`, `selectAll()`. Tool `'marquee'` (key M), Esc clears, Ctrl+A selects all. Internal: `Tools._rectCells(c1,r1,c2,r2)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/selection.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor, clickCell, dragCells } from './editor-helpers';

test.describe('region selection (T2.8)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('M + drag selects the rectangle, Shift adds, Alt subtracts, Esc clears', async ({ page }) => {
    await page.keyboard.press('m');
    expect(await page.evaluate(() => Tools.getActive())).toBe('marquee');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    expect(await page.evaluate(() => Selection.size())).toBe(25);
    await dragCells(page, { col: 228, row: 220 }, { col: 228, row: 222 }, { shift: true });
    expect(await page.evaluate(() => Selection.size())).toBe(28);
    await page.keyboard.down('Alt');
    await dragCells(page, { col: 222, row: 220 }, { col: 222, row: 221 });
    await page.keyboard.up('Alt');
    expect(await page.evaluate(() => Selection.size())).toBe(26);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Selection.isEmpty())).toBe(true);
  });

  test('Ctrl+A selects the whole map', async ({ page }) => {
    await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => Selection.size())).toBe(450 * 450);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/selection.spec.ts --reporter=line`
Expected: first test `expected "marquee", received "paint"`; second `ReferenceError: Selection is not defined`.

- [ ] **Step 3: Implement**

New module, inserted immediately before the `// TOOLS MODULE` banner comment:

```js
// ════════════════════════════════════════════════════════════
// SELECTION MODULE — editable set of cells shown as a yellow overlay
// ════════════════════════════════════════════════════════════
const Selection = (() => {
  let _keys = new Set();   // "col,row"
  const STYLE = { stroke: 'rgba(245,197,24,0.95)', fill: 'rgba(245,197,24,0.10)' };

  function getCells() {
    return [..._keys].map(k => { const [col, row] = k.split(',').map(Number); return { col, row }; });
  }
  function _publish() { Canvas.setHighlight('selection', getCells(), STYLE); }

  function setCells(cells, mode) {
    if (mode !== 'add' && mode !== 'subtract') _keys = new Set();
    for (const { col, row } of cells) {
      const k = col + ',' + row;
      if (mode === 'subtract') _keys.delete(k); else _keys.add(k);
    }
    _publish();
  }
  function clear() { _keys = new Set(); _publish(); }
  function isEmpty() { return _keys.size === 0; }
  function has(col, row) { return _keys.has(col + ',' + row); }
  function size() { return _keys.size; }
  function selectAll() {
    _keys = new Set();
    for (let r = 0; r < MAP_HEIGHT; r++) for (let c = 0; c < MAP_WIDTH; c++) _keys.add(c + ',' + r);
    _publish();
  }
  return { getCells, setCells, clear, isEmpty, has, size, selectAll };
})();
```

`Tools`:

1. `TOOL_NAMES`: add `marquee: 'Select Region',`. `CODE_TOOLS`: add `KeyM: 'marquee',`.
2. Add a shared helper and use it in `_applyRect`. Add before `function _applyRect`:

```js
  function _rectCells(c1, r1, c2, r2) {
    const minC = Math.max(0, Math.min(c1, c2)), maxC = Math.min(MAP_WIDTH - 1, Math.max(c1, c2));
    const minR = Math.max(0, Math.min(r1, r2)), maxR = Math.min(MAP_HEIGHT - 1, Math.max(r1, r2));
    const cells = [];
    for (let c = minC; c <= maxC; c++)
      for (let r = minR; r <= maxR; r++) cells.push({ col: c, row: r });
    return cells;
  }
```

and replace the body of `_applyRect` (T2.2 version) with:

```js
  function _applyRect(c1, r1, c2, r2) {
    _applyTerrainCells(_rectCells(c1, r1, c2, r2), UI.getSelectedTerrain());
    Canvas.render();
  }
```
3. `_onDown`: change `case 'rect':` to
```js
      case 'rect':
      case 'marquee':
```
(the body that sets `_rectStart` and `_toolsRectPreview` is shared). In `_onMove` do the same for `case 'rect':`.
4. `_onUp`: after the `rect` branch (inside the same `if / else if` chain) add:

```js
    } else if (_active === 'marquee' && _rectStart && _toolsRectPreview) {
      const p = _toolsRectPreview;
      Selection.setCells(_rectCells(p.c1, p.r1, p.c2, p.r2), e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');
      _rectStart = null;
      _toolsRectPreview = null;
      Canvas.render();
    }
```
5. Key handling. In the Escape line from T2.4 add selection clearing:

```js
      if (e.key === 'Escape') { _shapeStart = null; _shapeEnd = null; _polyVerts = []; Canvas.setHighlight('shape', null); if (!Selection.isEmpty()) Selection.clear(); }
```

Add a Ctrl-key listener function before `function init()` of Tools and call it from `init`:

```js
  function _initCtrlKeys() {
    window.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (!document.body.classList.contains('mode-map')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      switch (e.code) {
        case 'KeyA': e.preventDefault(); Selection.selectAll(); break;
      }
    });
  }
```

In `init()`, after `Canvas.setMouseCallbacks(_onDown, _onMove, _onUp);` add `_initCtrlKeys();`.

Toolbar, after the Rectangle button:

```html
      <button class="tool-btn" data-tool="marquee" onclick="Tools.setActive('marquee')">⛶<span class="tooltip">Select Region (M) - drag; Shift adds, Alt subtracts, Esc clears, Ctrl+A all</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/selection.spec.ts tests/paint-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/selection.spec.ts
git commit -m "feat(select): marquee region selection with add/subtract and select-all

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `Selection.selectAll` on 450x450 creates 202,500 highlight cells, and `_drawHighlights` iterates all of them every render (culling happens per cell); confirm Phase 1 item 1 range-culling also covers highlights.

---

### Task T2.9: Copy, cut, paste, delete (layered clipboard)

Covers roadmap 2.1 copy/cut/paste. The buffer stores every layer (terrain, building, road, under-terrain extras, zone) as cube offsets from an anchor cell, so it is position independent and can be re-used by stamps.

**Files:**
- Modify: `hex-utils.js` (add `anchorOf`).
- Modify: `MapEditorPro.html`: new `Clipboard` module right after `Selection`; `Tools` (`_float` state, selection ops, paste tool, keys, hover preview, return); toolbar `paste` has no button.
- Modify: `tests/selection.spec.ts`

**Interfaces:**
- Consumes: `Selection`, `Tools.autoResolveEdgesAround`, `Tools.eraseCells` (T2.6), `ZonePainter.getZoneLayer()`.
- Produces:
  - `HexUtils.anchorOf(cubes) -> cube` (the member closest to the mean; ties go to the first).
  - `Clipboard.capture(cells) -> Buffer | null` with `Buffer = { v:1, origin:{col,row}, cells:[{dq,dr,t,o?,rd?,x?,z?}] }` (`t` terrain id, `o` building id, `rd` road record, `x` tileExtras copy, `z` zone id).
  - `Clipboard.place(buf, target, xf, layers) -> number`, `Clipboard.previewCells(buf, target, xf) -> {col,row}[]`, `Clipboard.get()`, `Clipboard.set(buf)`.
  - `Tools.copySelection()`, `Tools.cutSelection()`, `Tools.deleteSelection()`, `Tools.beginPaste(buf)`, `Tools.dropFloat(col,row)`; tool `'paste'`; keys Ctrl+C / Ctrl+X / Ctrl+V / Delete / Esc (cancel paste).

- [ ] **Step 1: Write the failing tests** (append to `tests/selection.spec.ts`)

```ts
test.describe('clipboard (T2.9)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH;
      mapData[224 * W + 225] = 'Water_1'; mapData[224 * W + 226] = 'Forest_1';
      objectsData['225,224'] = 'Grain_1';
      roadsData['226,224'] = { type: 'road_hex' };
      Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }]);
    });
  });

  const count = (page: any, id: string) => page.evaluate((id: string) => mapData.filter(x => x === id).length, id);

  test('Ctrl+C then Ctrl+V and a click stamps all layers at the cursor, one undo step', async ({ page }) => {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
    expect(await count(page, 'Forest_1')).toBe(2);
    expect(await page.evaluate(() => mapData[219 * MAP_WIDTH + 225])).toBe('Water_1');
    expect(await page.evaluate(() => objectsData['225,219'])).toBe('Grain_1');
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(2);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(1);
  });

  test('Ctrl+X removes the source (terrain, building, road) and keeps it pasteable', async ({ page }) => {
    await page.keyboard.press('Control+x');
    const r = await page.evaluate(() => ({
      water: mapData.filter(x => x === 'Water_1').length,
      o: Object.keys(objectsData).length, rd: Object.keys(roadsData).length,
      clip: Clipboard.get().cells.length,
    }));
    expect(r).toEqual({ water: 0, o: 0, rd: 0, clip: 2 });
    await page.keyboard.press('Control+v');
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(1);
  });

  test('Delete clears the selected region', async ({ page }) => {
    await page.keyboard.press('Delete');
    expect(await count(page, 'Forest_1')).toBe(0);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(0);
  });

  test('Esc cancels a paste without changing the map', async ({ page }) => {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
    expect(await count(page, 'Water_1')).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/selection.spec.ts -g clipboard --reporter=line`
Expected: `ReferenceError: Clipboard is not defined` (Ctrl+C does nothing, so `Clipboard.get()`/active tool assertions fail first).

- [ ] **Step 3: Implement**

`hex-utils.js`, before `return {`:

```js
  // Member of `cubes` closest to their mean; ties go to the first (stable, so clicks paste "at the first cell").
  function anchorOf(cubes) {
    let q = 0, r = 0, s = 0;
    for (const c of cubes) { q += c.q; r += c.r; s += c.s; }
    const n = cubes.length, m = { q: q / n, r: r / n, s: s / n };
    let best = cubes[0], bd = Infinity;
    for (const c of cubes) {
      const d = Math.hypot(c.q - m.q, c.r - m.r, c.s - m.s);
      if (d < bd - 1e-9) { bd = d; best = c; }
    }
    return best;
  }
```

Add `anchorOf,` to the returned object.

`Clipboard` module, inserted right after the `Selection` module:

```js
// ════════════════════════════════════════════════════════════
// CLIPBOARD MODULE — layered, position-independent cell buffer (also used by Stamps)
// ════════════════════════════════════════════════════════════
const Clipboard = (() => {
  let _buf = null;

  function capture(cells) {
    if (!cells || !cells.length) return null;
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const cubes = cells.map(c => HexUtils.toCube(c.col, c.row, W, H));
    const anchor = HexUtils.anchorOf(cubes);
    const zl = typeof ZonePainter !== 'undefined' ? ZonePainter.getZoneLayer() : null;
    const out = cells.map((c, i) => {
      const k = c.col + ',' + c.row, idx = c.row * W + c.col;
      const e = { dq: cubes[i].q - anchor.q, dr: cubes[i].r - anchor.r, t: mapData[idx] };
      if (objectsData[k]) e.o = objectsData[k];
      if (roadsData[k]) e.rd = Object.assign({}, roadsData[k]);
      if (tileExtras[k]) e.x = JSON.parse(JSON.stringify(tileExtras[k]));
      if (zl && zl[idx]) e.z = zl[idx];
      return e;
    });
    return { v: 1, origin: HexUtils.fromCube(anchor, W, H), cells: out };
  }

  // Offset of a buffer cell from the anchor after the float's transform (identity until T2.10).
  function _offset(e, xf) { return { q: e.dq, r: e.dr, s: 0 - e.dq - e.dr }; }

  function _target(e, target, xf) {
    const t0 = HexUtils.toCube(target.col, target.row, MAP_WIDTH, MAP_HEIGHT);
    const o = _offset(e, xf);
    return HexUtils.fromCube({ q: t0.q + o.q, r: t0.r + o.r, s: t0.s + o.s }, MAP_WIDTH, MAP_HEIGHT);
  }

  function previewCells(buf, target, xf) {
    const out = [];
    for (const e of buf.cells) {
      const p = _target(e, target, xf);
      if (HexUtils.inBounds(p.col, p.row, MAP_WIDTH, MAP_HEIGHT)) out.push(p);
    }
    return out;
  }

  // Terrain always overwrites; building / road / zone overwrite only where the buffer has one.
  // layers: { terrain, objects, roads, zones } booleans (false = skip that layer).
  function place(buf, target, xf, layers) {
    layers = layers || {};
    const W = MAP_WIDTH;
    const zl = typeof ZonePainter !== 'undefined' ? ZonePainter.getZoneLayer() : null;
    const touched = [];
    for (const e of buf.cells) {
      const p = _target(e, target, xf);
      if (!HexUtils.inBounds(p.col, p.row, W, MAP_HEIGHT)) continue;
      if (getSatelliteAnchor(p.col, p.row)) continue;
      const k = p.col + ',' + p.row, idx = p.row * W + p.col;
      if (layers.terrain !== false) {
        touched.push({ col: p.col, row: p.row, prev: mapData[idx] });
        mapData[idx] = e.t;
        const bi = bridgesData.findIndex(b => b.col === p.col && b.row === p.row);
        if (bi >= 0) bridgesData.splice(bi, 1);
      }
      if (layers.objects !== false) {
        if (e.o) objectsData[k] = e.o;
        delete tileExtras[k];
        if (e.x) tileExtras[k] = JSON.parse(JSON.stringify(e.x));
      }
      if (layers.roads !== false && e.rd) roadsData[k] = Object.assign({}, e.rd);
      if (layers.zones !== false && zl && e.z) zl[idx] = e.z;
    }
    invalidateSatelliteMap();
    Tools.autoResolveEdgesAround(touched);
    return touched.length;
  }

  function get() { return _buf; }
  function set(buf) { _buf = buf; }
  return { capture, previewCells, place, get, set };
})();
```

`Tools` changes:

1. State next to `let _symMode`: `let _float = null; let _prevTool = 'paint';`
2. `TOOL_NAMES`: add `paste: 'Paste',`.
3. In `setActive`, after the `_shapeStart = null; ...` lines, add:

```js
    if (name !== 'paste') { _float = null; Canvas.setHighlight('paste', null); }
```

4. Add before `// ── Mouse callbacks (registered with Canvas) ───`:

```js
  // ── Selection operations, paste ────────────────────────────
  function _pasteLayers() { return { terrain: true, objects: true, roads: true, zones: true }; }

  function _selectionOrToast() {
    if (Selection.isEmpty()) { UI.toast('Select a region first (M)'); return null; }
    return Selection.getCells();
  }

  function _clearCells(cells) {
    _resetCells(cells, { noSymmetry: true });
    const zl = ZonePainter.getZoneLayer();
    if (zl) for (const { col, row } of cells) zl[row * MAP_WIDTH + col] = 0;
  }

  function copySelection() {
    const cells = _selectionOrToast();
    if (!cells) return false;
    Clipboard.set(Clipboard.capture(cells));
    UI.toast(`Copied ${cells.length} tiles`);
    return true;
  }

  function cutSelection() {
    const cells = _selectionOrToast();
    if (!cells) return false;
    Clipboard.set(Clipboard.capture(cells));
    History.push();
    _clearCells(cells);
    Canvas.drawMinimap(); Canvas.render(); IO.scheduleAutoSave();
    UI.toast(`Cut ${cells.length} tiles`);
    return true;
  }

  function deleteSelection() {
    const cells = _selectionOrToast();
    if (!cells) return false;
    History.push();
    _clearCells(cells);
    Canvas.drawMinimap(); Canvas.render(); IO.scheduleAutoSave();
    return true;
  }

  function beginPaste(buf) {
    if (!buf) { UI.toast('Clipboard is empty'); return; }
    if (_active !== 'paste') _prevTool = _active;
    setActive('paste');
    _float = { buf, rot: 0, mh: false, mv: false, move: false };
  }

  function _previewFloat(hov) {
    Canvas.setHighlight('paste', Clipboard.previewCells(_float.buf, hov, _float),
                        { stroke: 'rgba(129,199,132,0.95)', fill: 'rgba(129,199,132,0.18)' });
  }

  function dropFloat(col, row) {
    if (!_float) return;
    History.push();
    Clipboard.place(_float.buf, { col, row }, _float, _pasteLayers());
    Canvas.drawMinimap(); Canvas.render(); IO.scheduleAutoSave();
  }

  function _cancelFloat() {
    if (!_float) return;
    setActive(_prevTool || 'paint');
  }
```

5. `_onDown`: add `case 'paste': dropFloat(col, row); _isDown = false; break;` before `case 'select':`.
6. `_onMove`: replace the T2.4 polygon-hover block (the `if (_active === 'polygon' && _polyVerts.length) { ... }` lines) with:

```js
    if (_active === 'polygon' || _active === 'paste') {
      const hov = Canvas.screenToHex(sx, sy);
      if (hov.col >= 0 && hov.col < MAP_WIDTH && hov.row >= 0 && hov.row < MAP_HEIGHT) {
        if (_active === 'polygon' && _polyVerts.length) _previewPolygon(hov);
        if (_active === 'paste' && _float) _previewFloat(hov);
      }
    }
```
7. Key handlers. In the non-ctrl handler, insert this line immediately BEFORE the existing `if (e.key === 'Escape') {` line (so cancelling a paste does not also clear the selection), and the Delete line after it:

```js
      if (e.key === 'Escape' && _float) { _cancelFloat(); return; }
```

```js
      if (e.key === 'Delete' && !_float && !Selection.isEmpty()) { deleteSelection(); return; }
```
and extend `_initCtrlKeys` switch:

```js
        case 'KeyC': e.preventDefault(); copySelection(); break;
        case 'KeyX': e.preventDefault(); cutSelection(); break;
        case 'KeyV': e.preventDefault(); beginPaste(Clipboard.get()); break;
```
8. Return object: add `copySelection, cutSelection, deleteSelection, beginPaste, dropFloat`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/selection.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/selection.spec.ts
git commit -m "feat(select): copy, cut, paste and delete across all map layers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** Ctrl+X on a bare key must not collide with the eraser's plain `X` (handled in separate listeners, ctrl vs non-ctrl); paste drops stay in paste mode so one click can stamp repeatedly until Esc.

---

### Task T2.10: Rotate, mirror and move for pasted / lifted regions

Covers roadmap 2.1 move/rotate/mirror. A paste (or a lifted selection) is a "float" that can be rotated in 60 degree steps and mirrored before it is dropped. Rotation and mirrors are cube transforms about the anchor, tested against screen pixels.

**Files:**
- Modify: `hex-utils.js` (add `transformOffset`).
- Modify: `MapEditorPro.html`: `Clipboard._offset`; `Tools` (`rotateFloat`, `mirrorFloat`, `beginMove`, drop-as-move, keys, return); toolbar float buttons.
- Modify: `tests/selection.spec.ts`

**Interfaces:**
- Consumes: `Clipboard` (T2.9), `HexUtils.rotateCube/mirrorCube`.
- Produces: `HexUtils.transformOffset(c, rot, mh, mv) -> cube` (mirror h, then mirror v, then rotate `rot` screen-clockwise 60 degree steps); `Tools.rotateFloat(steps)`, `Tools.mirrorFloat('h'|'v')`, `Tools.beginMove()` (lifts the selection: pushes undo, clears the source, floats it), keys `.` / `,` (rotate cw / ccw), `/` (mirror left-right), `;` (mirror top-bottom), `Enter` (begin move), Esc while moving puts it back. Dropping a move re-selects the dropped cells.

- [ ] **Step 1: Write the failing tests** (append to `tests/selection.spec.ts`)

```ts
test.describe('transform and move (T2.10)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const n = HexUtils.neighbors(225, 224, W, H)[0];
      (window as any).__n = n;
      mapData[224 * W + 225] = 'Water_1';
      mapData[n.row * W + n.col] = 'Forest_1';
      Selection.setCells([{ col: 225, row: 224 }, n]);
    });
  });

  // Vector (in world pixels) from the Water_1 copy to the Forest_1 copy at the drop target, vs the source vector.
  const vectors = (page: any) => page.evaluate(() => {
    const W = MAP_WIDTH;
    const pos = (i: number) => Canvas.hexCenterWorld(i % W, Math.floor(i / W));
    const water: number[] = [], forest: number[] = [];
    mapData.forEach((id, i) => { if (id === 'Water_1') water.push(i); if (id === 'Forest_1') forest.push(i); });
    const srcW = 224 * W + 225, n = (window as any).__n, srcF = n.row * W + n.col;
    const dstW = water.find(i => i !== srcW)!, dstF = forest.find(i => i !== srcF)!;
    const v = (a: number, b: number) => ({ x: pos(b).x - pos(a).x, y: pos(b).y - pos(a).y });
    return { src: v(srcW, srcF), dst: v(dstW, dstF) };
  });

  async function pasteWith(page: any, keys: string[]) {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    for (const k of keys) await page.keyboard.press(k);
    await clickCell(page, 225, 219);
  }

  test('"." rotates 60 degrees clockwise on screen', async ({ page }) => {
    await pasteWith(page, ['.']);
    const { src, dst } = await vectors(page);
    const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
    expect(dst.x).toBeCloseTo(src.x * cs - src.y * sn, 4);
    expect(dst.y).toBeCloseTo(src.x * sn + src.y * cs, 4);
  });

  test('"," rotates counter-clockwise, "/" mirrors left-right, ";" mirrors top-bottom', async ({ page }) => {
    await pasteWith(page, [',']);
    let v = await vectors(page);
    const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
    expect(v.dst.x).toBeCloseTo(v.src.x * cs + v.src.y * sn, 4);
    expect(v.dst.y).toBeCloseTo(-v.src.x * sn + v.src.y * cs, 4);
    await page.evaluate(() => History.undo());
    await pasteWith(page, ['/']);
    v = await vectors(page);
    expect(v.dst.x).toBeCloseTo(-v.src.x, 4); expect(v.dst.y).toBeCloseTo(v.src.y, 4);
    await page.evaluate(() => History.undo());
    await pasteWith(page, [';']);
    v = await vectors(page);
    expect(v.dst.x).toBeCloseTo(v.src.x, 4); expect(v.dst.y).toBeCloseTo(-v.src.y, 4);
  });

  test('Enter lifts the selection (source cleared) and a click drops it, selecting the new cells', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => mapData.filter(x => x === 'Water_1').length)).toBe(0);
    await clickCell(page, 225, 219);
    const r = await page.evaluate(() => ({
      water: mapData.filter(x => x === 'Water_1').length, forest: mapData.filter(x => x === 'Forest_1').length,
      sel: Selection.size(), moved: mapData[219 * MAP_WIDTH + 225],
    }));
    expect(r).toEqual({ water: 1, forest: 1, sel: 2, moved: 'Water_1' });
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
  });

  test('Esc while moving restores the original region', async ({ page }) => {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Water_1');
    expect(await page.evaluate(() => Selection.size())).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/selection.spec.ts -g "transform and move" --reporter=line`
Expected: rotation/mirror tests fail (the copy keeps the source vector); Enter test: water count is 1 not 0.

- [ ] **Step 3: Implement**

`hex-utils.js`, before `return {`:

```js
  function transformOffset(c, rot, mh, mv) {
    let o = c;
    if (mh) o = mirrorCube(o, 'h');
    if (mv) o = mirrorCube(o, 'v');
    return rotateCube(o, rot || 0);
  }
```

Add `transformOffset,` to the returned object.

`Clipboard._offset` (replace the T2.9 identity body):

```js
  function _offset(e, xf) {
    const c = { q: e.dq, r: e.dr, s: 0 - e.dq - e.dr };
    return xf ? HexUtils.transformOffset(c, xf.rot, xf.mh, xf.mv) : c;
  }
```

`Tools`:

1. Add after `_cancelFloat`'s predecessor helpers (replace `_cancelFloat` and `dropFloat` from T2.9 with these versions):

```js
  function rotateFloat(steps) {
    if (!_float) return;
    _float.rot = (((_float.rot + steps) % 6) + 6) % 6;
  }
  function mirrorFloat(axis) {
    if (!_float) return;
    if (axis === 'h') _float.mh = !_float.mh; else _float.mv = !_float.mv;
  }

  function beginMove() {
    const cells = _selectionOrToast();
    if (!cells) return false;
    const buf = Clipboard.capture(cells);
    History.push();
    _clearCells(cells);
    Selection.clear();
    Canvas.drawMinimap();
    if (_active !== 'paste') _prevTool = _active;
    setActive('paste');
    _float = { buf, rot: 0, mh: false, mv: false, move: true };
    return true;
  }

  function dropFloat(col, row) {
    if (!_float) return;
    History.push();
    Clipboard.place(_float.buf, { col, row }, _float, _pasteLayers());
    const f = _float;
    if (f.move) {
      const cells = Clipboard.previewCells(f.buf, { col, row }, f);
      setActive(_prevTool || 'marquee');
      Selection.setCells(cells);
    }
    Canvas.drawMinimap(); Canvas.render(); IO.scheduleAutoSave();
  }

  function _cancelFloat() {
    if (!_float) return;
    const f = _float;
    if (f.move) {
      Clipboard.place(f.buf, f.buf.origin, null, _pasteLayers());   // put it back, no new undo entry
      setActive(_prevTool || 'marquee');
      Selection.setCells(Clipboard.previewCells(f.buf, f.buf.origin, null));
      Canvas.drawMinimap(); Canvas.render();
    } else {
      setActive(_prevTool || 'paint');
    }
  }
```

(The `setActive` lines clear `_float` because of the `name !== 'paste'` rule, so `f` is captured first.)

2. Key handler. In the non-ctrl handler, after the Delete/Escape lines from T2.9 add:

```js
      if (_active === 'paste' && _float) {
        if (e.code === 'Period')    { rotateFloat(1);  _previewAtCursor(); return; }
        if (e.code === 'Comma')     { rotateFloat(-1); _previewAtCursor(); return; }
        if (e.code === 'Slash')     { mirrorFloat('h'); _previewAtCursor(); return; }
        if (e.code === 'Semicolon') { mirrorFloat('v'); _previewAtCursor(); return; }
      }
      if (e.key === 'Enter' && !_float && _active !== 'polygon' && !Selection.isEmpty()) { beginMove(); return; }
```

and define (next to `_previewFloat`) a helper that re-renders the ghost at the last hover cell. Track the last hover cell by adding `let _lastHover = null;` at the top state and setting `_lastHover = hov;` inside the `_onMove` hover block (right after computing `hov` in-bounds):

```js
  function _previewAtCursor() { if (_float && _lastHover) _previewFloat(_lastHover); }
```

In `_onMove`'s hover block change to:

```js
      if (hov.col >= 0 && hov.col < MAP_WIDTH && hov.row >= 0 && hov.row < MAP_HEIGHT) {
        _lastHover = hov;
        if (_active === 'polygon' && _polyVerts.length) _previewPolygon(hov);
        if (_active === 'paste' && _float) _previewFloat(hov);
      }
```

3. Return object: add `rotateFloat, mirrorFloat, beginMove`.

Toolbar: after the Zone Painter button add a span shown only while pasting; toggle it in `setActive` by adding, after the `if (name !== 'paste')` line:

```js
    const pt = document.getElementById('paste-tools');
    if (pt) pt.style.display = name === 'paste' ? 'inline-flex' : 'none';
```

```html
      <span id="paste-tools" style="display:none;gap:2px;vertical-align:middle">
        <button class="tool-btn" onclick="Tools.rotateFloat(-1)" title="Rotate counter-clockwise (,)">⟲</button>
        <button class="tool-btn" onclick="Tools.rotateFloat(1)" title="Rotate clockwise (.)">⟳</button>
        <button class="tool-btn" onclick="Tools.mirrorFloat('h')" title="Mirror left/right (/)">⇋</button>
        <button class="tool-btn" onclick="Tools.mirrorFloat('v')" title="Mirror top/bottom (;)">⇅</button>
      </span>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/selection.spec.ts tests/hex-utils.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js MapEditorPro.html tests/selection.spec.ts
git commit -m "feat(select): rotate, mirror and move regions using cube transforms

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** directional river tiles are not rotated tile-by-tile; `Clipboard.place` calls `Tools.autoResolveEdgesAround`, so river edges re-resolve against the new neighbours (and the K1 table caveat applies); multi-tile anchors keep their id and footprint rather than rotating.

---

### Task T2.11: Replace X with Y

Covers the replace half of roadmap 2.4: a modal (Edit menu) and an `H` click-tool, scoped to the whole map or the current selection.

**Files:**
- Modify: `MapEditorPro.html` `Tools` (`replaceTerrain`, `openReplace`, `closeReplace`, `applyReplace`, `case 'replace'`, `CODE_TOOLS`, `TOOL_NAMES`, return); Edit menu (anchor: `<button onclick="IO.fillMap()">Fill Map</button>`, ~1228); new modal before `<!-- Bridge tile under-terrain picker -->` (~2003); toolbar button after the scatter input.
- Modify: `tests/selection.spec.ts`

**Interfaces:**
- Consumes: `Selection`, `_autoResolveEdgesAround`, `getSatelliteAnchor`.
- Produces: `Tools.replaceTerrain(fromId, toId, cells|null) -> number` (null = whole map); `Tools.openReplace()`, `Tools.closeReplace()`, `Tools.applyReplace()`; tool `'replace'` (key H) replaces the clicked tile's id with the active terrain (inside the selection when one exists).

- [ ] **Step 1: Write the failing tests** (append to `tests/selection.spec.ts`)

```ts
test.describe('replace (T2.11)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH;
      for (const [c, r] of [[225, 224], [226, 224], [227, 224], [225, 230], [226, 230]]) mapData[r * W + c] = 'Rubble_1';
      Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }, { col: 227, row: 224 }]);
    });
  });
  const rubble = (page: any) => page.evaluate(() => mapData.filter(x => x === 'Rubble_1').length);

  test('replaceTerrain honours the selection scope and the whole-map scope', async ({ page }) => {
    const n = await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'Plain_2', Selection.getCells()));
    expect(n).toBe(3);
    expect(await rubble(page)).toBe(2);
    const m = await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'Plain_2', null));
    expect(m).toBe(2);
    expect(await rubble(page)).toBe(0);
  });

  test('Edit > Replace modal replaces inside the selection and undoes in one step', async ({ page }) => {
    await page.evaluate(() => Tools.openReplace());
    await page.fill('#replace-from', 'Rubble_1');
    await page.fill('#replace-to', 'Water_1');
    await page.check('#replace-sel-only');
    const before = await page.evaluate(() => History.undoSize());
    await page.click('#replace-apply');
    expect(await rubble(page)).toBe(2);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await rubble(page)).toBe(5);
  });

  test('H tool replaces the clicked tile id with the active terrain', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Plain_2'); });
    await page.keyboard.press('h');
    await clickCell(page, 226, 224);
    expect(await rubble(page)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/selection.spec.ts -g replace --reporter=line`
Expected: `TypeError: Tools.replaceTerrain is not a function`.

- [ ] **Step 3: Implement**

`Tools` (add after the scatter helpers):

```js
  // ── Replace ────────────────────────────────────────────────
  function replaceTerrain(fromId, toId, cells) {
    const W = MAP_WIDTH;
    const touched = [];
    const visit = (c, r) => {
      const idx = r * W + c;
      if (mapData[idx] !== fromId || getSatelliteAnchor(c, r)) return;
      touched.push({ col: c, row: r, prev: fromId });
      mapData[idx] = toId;
    };
    if (cells) { for (const { col, row } of cells) visit(col, row); }
    else for (let r = 0; r < MAP_HEIGHT; r++) for (let c = 0; c < W; c++) visit(c, r);
    invalidateSatelliteMap();
    _autoResolveEdgesAround(touched);
    return touched.length;
  }

  function openReplace() {
    const dl = document.getElementById('replace-id-list');
    if (dl) dl.innerHTML = HexDB.getAll().map(h => `<option value="${h.id}">`).join('');
    document.getElementById('replace-to').value = UI.getSelectedTerrain();
    document.getElementById('replace-sel-only').checked = !Selection.isEmpty();
    document.getElementById('replace-modal').classList.add('open');
    UI.closeAllMenus();
  }
  function closeReplace() { document.getElementById('replace-modal').classList.remove('open'); }

  function applyReplace() {
    const from = document.getElementById('replace-from').value.trim();
    const to   = document.getElementById('replace-to').value.trim();
    if (!from || !to || from === to) { UI.toast('Pick two different tile ids'); return; }
    const selOnly = document.getElementById('replace-sel-only').checked;
    if (selOnly && Selection.isEmpty()) { UI.toast('Select a region first (M)'); return; }
    History.push();
    const n = replaceTerrain(from, to, selOnly ? Selection.getCells() : null);
    closeReplace();
    Canvas.drawMinimap(); Canvas.render(); IO.scheduleAutoSave();
    UI.toast(`Replaced ${n} tiles`);
  }
```

`TOOL_NAMES`: add `replace: 'Replace Tile',`. `CODE_TOOLS`: add `KeyH: 'replace',`.

`_onDown` (before `case 'select':`):

```js
      case 'replace': {
        const fromId = mapData[row * MAP_WIDTH + col], toId = UI.getSelectedTerrain();
        _isDown = false;
        if (fromId === toId) { UI.toast('Active terrain is already ' + toId); break; }
        History.push();
        const n = replaceTerrain(fromId, toId, Selection.isEmpty() ? null : Selection.getCells());
        Canvas.drawMinimap(); Canvas.render();
        UI.toast(`Replaced ${n} x ${fromId}`);
        break;
      }
```

Return object: add `replaceTerrain, openReplace, closeReplace, applyReplace`.

Edit menu: after the Fill Map button:

```html
        <button onclick="Tools.openReplace()">Replace Tile…</button>
```

Modal (before the bridge-terrain modal comment):

```html
<!-- Replace tile modal -->
<div class="modal-overlay" id="replace-modal">
  <div class="modal-box" style="max-width:360px">
    <h3 style="margin:0 0 8px">Replace tile</h3>
    <datalist id="replace-id-list"></datalist>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      <label style="font-size:11px;color:var(--muted)">Replace
        <input id="replace-from" class="hexdb-input" type="text" list="replace-id-list" style="width:100%" placeholder="e.g. Rubble_1"></label>
      <label style="font-size:11px;color:var(--muted)">With
        <input id="replace-to" class="hexdb-input" type="text" list="replace-id-list" style="width:100%"></label>
      <label style="font-size:12px"><input id="replace-sel-only" type="checkbox"> Selection only</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-cancel" onclick="Tools.closeReplace()">Cancel</button>
      <button class="btn btn-primary" id="replace-apply" onclick="Tools.applyReplace()">Replace</button>
    </div>
  </div>
</div>
```

Toolbar, after the scatter density input:

```html
      <button class="tool-btn" data-tool="replace" onclick="Tools.setActive('replace')">⇄<span class="tooltip">Replace (H) - click a tile to replace all of that id with the active terrain</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/selection.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/selection.spec.ts
git commit -m "feat(tools): replace tile id with another, whole map or selection

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** replace compares exact ids (case-sensitive, as stored in `mapData`); on a 450x450 map the whole-map scan is 202,500 cells and runs synchronously (fine, but Phase 1 may want it chunked).

---

### Task T2.12: Stamp store (IndexedDB, independent of the map JSON)

Covers the storage half of roadmap 2.2. Stamps are saved in their own IndexedDB database (`MapEditorStamps`), never in the map JSON, and can be exported/imported as a JSON file.

**Files:**
- Modify: `MapEditorPro.html`: new `Stamps` module right after `Clipboard`.
- Create: `tests/stamps.spec.ts`

**Interfaces:**
- Consumes: `Clipboard.capture` buffers, `HexUtils.cubeToPixel`, `Terrain.color`.
- Produces (global `Stamps`): `save(name, buf) -> Promise<Record>`, `list() -> Promise<Record[]>` (newest first), `remove(id) -> Promise`, `exportJson() -> Promise<string>`, `importJson(text) -> Promise<number>` (throws `Error` on malformed input, writes nothing), `toBuffer(rec) -> Buffer`, `thumbnail(rec, size=48) -> dataURL`. `Record = { id, name, created, v:1, cells }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/stamps.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { freshEditor, clickCell } from './editor-helpers';

async function seedPond(page: any) {
  await page.evaluate(() => {
    mapData[224 * MAP_WIDTH + 225] = 'Water_1';
    mapData[224 * MAP_WIDTH + 226] = 'Forest_1';
    Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }]);
  });
}

test.describe('stamp store (T2.12)', () => {
  test('stamps persist across a reload', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    await page.evaluate(async () => { await Stamps.save('pond', Clipboard.capture(Selection.getCells())); });
    await page.reload();
    await openEditor(page);
    const list = await page.evaluate(async () => (await Stamps.list()).map((s: any) => ({ name: s.name, n: s.cells.length })));
    expect(list).toEqual([{ name: 'pond', n: 2 }]);
  });

  test('export / import round-trips and malformed input writes nothing', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    const r = await page.evaluate(async () => {
      const a = await Stamps.save('a', Clipboard.capture(Selection.getCells()));
      const json = await Stamps.exportJson();
      await Stamps.remove(a.id);
      const imported = await Stamps.importJson(json);
      let err = '';
      try { await Stamps.importJson('{"format":"mapeditor-stamps","version":1,"stamps":[{"name":"bad","cells":[{"dq":"x"}]}]}'); }
      catch (e: any) { err = e.message; }
      const names = (await Stamps.list()).map((s: any) => s.name);
      return { imported, err, names };
    });
    expect(r.imported).toBe(1);
    expect(r.err).toMatch(/invalid/i);
    expect(r.names).toEqual(['a']);
  });

  test('toBuffer feeds Clipboard.place', async ({ page }) => {
    await freshEditor(page);
    await seedPond(page);
    await page.evaluate(async () => {
      const rec = await Stamps.save('p', Clipboard.capture(Selection.getCells()));
      Clipboard.place(Stamps.toBuffer(rec), { col: 225, row: 219 }, null, {});
    });
    expect(await page.evaluate(() => mapData[219 * MAP_WIDTH + 225])).toBe('Water_1');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/stamps.spec.ts --reporter=line`
Expected: `ReferenceError: Stamps is not defined` (3 failures).

- [ ] **Step 3: Implement**

`Stamps` module, inserted after the `Clipboard` module:

```js
// ════════════════════════════════════════════════════════════
// STAMPS MODULE — named reusable buffers in IndexedDB (never part of the map JSON)
// ════════════════════════════════════════════════════════════
const Stamps = (() => {
  const DB_NAME = 'MapEditorStamps', STORE = 'stamps';
  let _db = null;

  function _open() {
    return _db ? Promise.resolve(_db) : new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = e => { _db = e.target.result; res(_db); };
      r.onerror = e => rej(e.target.error);
    });
  }
  function _req(mode, fn) {
    return _open().then(db => new Promise((res, rej) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    }));
  }
  function _newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function save(name, buf) {
    if (!buf || !buf.cells || !buf.cells.length) return Promise.reject(new Error('Nothing selected'));
    const rec = { id: _newId(), name: (name || '').trim() || 'Stamp', created: Date.now(), v: 1, cells: buf.cells };
    return _req('readwrite', s => s.put(rec)).then(() => rec);
  }
  function list() { return _req('readonly', s => s.getAll()).then(a => a.sort((x, y) => y.created - x.created)); }
  function remove(id) { return _req('readwrite', s => s.delete(id)); }
  function toBuffer(rec) { return { v: 1, origin: null, cells: rec.cells }; }

  function _validCell(c) {
    return c && Number.isInteger(c.dq) && Number.isInteger(c.dr) && typeof c.t === 'string' && c.t.length > 0;
  }

  function exportJson() {
    return list().then(a => JSON.stringify({ format: 'mapeditor-stamps', version: 1, stamps: a }));
  }

  function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return Promise.reject(new Error('Invalid stamp file: not JSON')); }
    if (!data || data.format !== 'mapeditor-stamps' || !Array.isArray(data.stamps))
      return Promise.reject(new Error('Invalid stamp file: wrong format'));
    for (const s of data.stamps)
      if (!s || !Array.isArray(s.cells) || !s.cells.length || !s.cells.every(_validCell))
        return Promise.reject(new Error('Invalid stamp file: bad stamp "' + (s && s.name) + '"'));
    return Promise.all(data.stamps.map(s => {
      const rec = { id: _newId(), name: s.name || 'Stamp', created: Date.now(), v: 1, cells: s.cells };
      return _req('readwrite', st => st.put(rec));
    })).then(() => data.stamps.length);
  }

  function thumbnail(rec, size) {
    size = size || 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#111'; cx.fillRect(0, 0, size, size);
    const pts = rec.cells.map(c => ({ p: HexUtils.cubeToPixel({ q: c.dq, r: c.dr, s: 0 - c.dq - c.dr }), t: c.t }));
    const xs = pts.map(o => o.p.x), ys = pts.map(o => o.p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
    const unit = (size - 8) / (span + 2);
    for (const { p, t } of pts) {
      const [r, g, b] = Terrain.color(t);
      cx.fillStyle = `rgb(${r},${g},${b})`;
      cx.beginPath();
      cx.arc(4 + (p.x - minX + 1) * unit, 4 + (p.y - minY + 1) * unit, Math.max(1.2, unit * 0.8), 0, Math.PI * 2);
      cx.fill();
    }
    return cv.toDataURL();
  }

  return { save, list, remove, toBuffer, exportJson, importJson, thumbnail };
})();
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/stamps.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/stamps.spec.ts
git commit -m "feat(stamps): IndexedDB stamp store with JSON export/import

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** stamps reference tile ids by name, so a stamp saved with a custom-package id places an unknown tile if the package is not loaded (Phase 0 item 5 style warning is not wired here).

---

### Task T2.13: Stamps panel (save from selection, place, delete, import/export)

**Files:**
- Modify: `MapEditorPro.html`: CSS near `#brush-panel` (~245); panel HTML after the `brush-panel` closing `</div>` (anchor: `<div id="right-active-terrain">`, ~1440); `Stamps.initPanel/refresh/saveSelection/exportFile/importFile`; `window.addEventListener('load'` handler (anchor `Tools.init();` ~12848).
- Modify: `tests/stamps.spec.ts`

**Interfaces:**
- Consumes: `Stamps` store (T2.12), `Selection`, `Clipboard.capture`, `Tools.beginPaste`.
- Produces: `Stamps.initPanel()`, `Stamps.refresh() -> Promise`, `Stamps.saveSelection()`, `Stamps.exportFile()`, `Stamps.importFile(event)`; DOM `#stamp-panel`, `#stamp-name`, `#stamp-save-btn`, `#stamp-list` with rows `.stamp-row[data-id]` (click = begin paste) and `.stamp-del`.

- [ ] **Step 1: Write the failing test** (append to `tests/stamps.spec.ts`)

```ts
test('stamp panel: save the selection, place it with a click, delete it', async ({ page }) => {
  await freshEditor(page);
  await seedPond(page);
  await page.fill('#stamp-name', 'pond');
  await page.click('#stamp-save-btn');
  await expect(page.locator('.stamp-row')).toHaveCount(1);
  await expect(page.locator('.stamp-row')).toContainText('pond');
  await page.click('.stamp-row .stamp-name');
  expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
  await clickCell(page, 225, 219);
  expect(await page.evaluate(() => mapData[219 * MAP_WIDTH + 225])).toBe('Water_1');
  await page.click('.stamp-row .stamp-del');
  await expect(page.locator('.stamp-row')).toHaveCount(0);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/stamps.spec.ts -g "stamp panel" --reporter=line`
Expected: `locator.fill: Test timeout ... waiting for locator('#stamp-name')`.

- [ ] **Step 3: Implement**

CSS (after the `.brush-btn.active` rule):

```css
#stamp-panel { padding: 10px; border-bottom: 1px solid var(--border); }
#stamp-panel .section-title { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
.stamp-row { display: flex; align-items: center; gap: 6px; padding: 3px 2px; border-bottom: 1px solid var(--border); cursor: pointer; }
.stamp-row:hover { background: var(--hover); }
.stamp-row img { width: 32px; height: 32px; image-rendering: pixelated; flex-shrink: 0; }
.stamp-name { flex: 1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stamp-del { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 12px; }
.stamp-del:hover { color: var(--danger); }
```

Panel HTML, inserted before `<div id="right-active-terrain">`:

```html
      <div id="stamp-panel">
        <div class="section-title">Stamps</div>
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <input id="stamp-name" class="hexdb-input" type="text" placeholder="Stamp name" style="flex:1;font-size:11px;padding:3px 6px">
          <button class="hexdb-tool-btn" id="stamp-save-btn" onclick="Stamps.saveSelection()" title="Save the current selection as a stamp">Save</button>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <button class="hexdb-tool-btn" onclick="Stamps.exportFile()">Export</button>
          <button class="hexdb-tool-btn" onclick="document.getElementById('stamp-import-file').click()">Import</button>
          <input id="stamp-import-file" type="file" accept="application/json" style="display:none" onchange="Stamps.importFile(event)">
        </div>
        <div id="stamp-list"></div>
      </div>
```

In the `Stamps` module, add before `return`:

```js
  async function refresh() {
    const box = document.getElementById('stamp-list');
    if (!box) return;
    let recs = [];
    try { recs = await list(); } catch (e) { box.textContent = 'Stamp storage unavailable: ' + e.message; return; }
    box.innerHTML = '';
    for (const rec of recs) {
      const row = document.createElement('div');
      row.className = 'stamp-row';
      row.dataset.id = rec.id;
      const img = document.createElement('img');
      img.src = thumbnail(rec, 32);
      const name = document.createElement('span');
      name.className = 'stamp-name';
      name.textContent = `${rec.name} (${rec.cells.length})`;
      name.title = 'Click, then click the map to place. . , / ; rotate and mirror.';
      name.addEventListener('click', () => Tools.beginPaste(toBuffer(rec)));
      const del = document.createElement('button');
      del.className = 'stamp-del';
      del.textContent = '✕';
      del.title = 'Delete stamp';
      del.addEventListener('click', async e => { e.stopPropagation(); await remove(rec.id); refresh(); });
      row.append(img, name, del);
      box.appendChild(row);
    }
  }

  async function saveSelection() {
    if (Selection.isEmpty()) { UI.toast('Select a region first (M)'); return; }
    const input = document.getElementById('stamp-name');
    try {
      await save(input.value, Clipboard.capture(Selection.getCells()));
      input.value = '';
      UI.toast('Stamp saved');
    } catch (e) { UI.toast('Could not save stamp: ' + e.message); }
    refresh();
  }

  async function exportFile() {
    const blob = new Blob([await exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stamps.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  function importFile(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { UI.toast(`Imported ${await importJson(reader.result)} stamps`); }
      catch (e) { UI.toast(e.message); }
      refresh();
    };
    reader.readAsText(file);
  }

  function initPanel() { refresh(); }
```

and change the return to `return { save, list, remove, toBuffer, exportJson, importJson, thumbnail, refresh, saveSelection, exportFile, importFile, initPanel };`

In the `load` handler, after `Tools.init();` add `Stamps.initPanel();`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/stamps.spec.ts --reporter=line`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/stamps.spec.ts
git commit -m "feat(stamps): stamps panel with save, place, delete, import and export

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the panel uses an inline name input instead of `prompt()` (Phase 0 item 7); import errors surface as toasts only.

---

### Task T2.14: Restore the building tools (Place Building B, Erase Building) with lazy undo

Covers the building third of roadmap 2.7. The toolbar buttons removed in commit `b5d924b` come back; the object tool code (`_placeObject`, `_eraseObject`, the picker) still exists. Two bugs are fixed on the way: `_spawnSatellites` references an undefined `hexData` (placing `Farm_Test_1`, which spawns `Grain_1` satellites, throws a `ReferenceError`), and `erase-object` never pushed an undo step.

**Files:**
- Modify: `MapEditorPro.html` toolbar. Anchor: the Zone Painter button `data-tool="zone"` (~1330) - insert after it (exact markup from `git show b5d924b`).
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function _spawnSatellites(col, row, bldId) {` (~4256, line `if (hexData[k] !== undefined) continue;`), `function _placeObject(col, row) {` (~4300), `function _eraseObject(col, row) {` (~4311), `case 'object':` and `case 'erase-object':` in `_onDown` (~4455), `function _onUp(e) {`, `const CODE_TOOLS = {`.
- Create: `tests/object-tools.spec.ts`

**Interfaces:**
- Consumes: `Tools.selectBuilding(id)`, `BldDB`, `objectsData`.
- Produces: `Tools._pushOnce()` pattern (one `History.push()` per stroke, only when something actually changes; `_strokePushed` resets on mouse-down/up and `setActive`); `_placeObject`/`_eraseObject` return `boolean`; tools `'object'` (key B) and `'erase-object'` (button only, no hotkey because X is now the eraser).

- [ ] **Step 1: Write the failing tests**

Create `tests/object-tools.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor, clickCell } from './editor-helpers';

const hidePicker = (page: any) => page.evaluate(() => { document.getElementById('obj-building-picker')!.style.display = 'none'; });

test.describe('building tools (T2.14)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('B places a building, one undo removes it; erase-object removes it and undo restores it', async ({ page }) => {
    await page.keyboard.press('b');
    expect(await page.evaluate(() => Tools.getActive())).toBe('object');
    await page.evaluate(() => Tools.selectBuilding('Artefact_Test_1'));
    await hidePicker(page);
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => '227,224' in objectsData)).toBe(false);

    await page.evaluate(() => { objectsData['227,224'] = 'Artefact_Test_1'; Tools.setActive('erase-object'); });
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => '227,224' in objectsData)).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Artefact_Test_1');
  });

  test('clicks that change nothing create no undo step', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('erase-object'));
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 228, 224);
    expect(await page.evaluate(() => History.undoSize())).toBe(before);
  });

  test('a building with satellites (Farm_Test_1 -> Grain_1) places without a page error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => { Tools.setActive('object'); Tools.selectBuilding('Farm_Test_1'); });
    await hidePicker(page);
    await clickCell(page, 227, 224);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Farm_Test_1');
    expect(await page.evaluate(() => Object.values(objectsData).filter(v => v === 'Grain_1').length)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/object-tools.spec.ts --reporter=line`
Expected: test 1: active tool is `paint` not `object`; test 2: undo size grows by 1 (or the tool button is missing); test 3: `pageerror` `ReferenceError: hexData is not defined`.

- [ ] **Step 3: Implement**

Toolbar markup, inserted right after the Zone Painter button:

```html
      <button class="tool-btn" data-tool="object" onclick="Tools.setActive('object')">🏗<span class="tooltip">Place Building (B)</span></button>
      <span id="obj-building-label" style="display:none;font-size:11px;color:var(--accent);vertical-align:middle;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button class="tool-btn" data-tool="erase-object" onclick="Tools.setActive('erase-object')">🗑<span class="tooltip">Erase Building</span></button>
```

`Tools`:

1. Add near the other state: 

```js
  let _strokePushed = false;
  // One undo entry per stroke, taken lazily right before the first real mutation.
  function _pushOnce() { if (!_strokePushed) { History.push(); _strokePushed = true; } }
```

2. In `setActive`, after `_rectStart = null;` add `_strokePushed = false;`. In `_onDown`, right after the bounds check `if (col < 0 ...) return;` add `_strokePushed = false;`. In `_onUp`, in the reset block beside `_lastPainted = null;` add `_strokePushed = false;`.
3. `CODE_TOOLS`: add `KeyB: 'object',`.
4. In `_spawnSatellites` delete the line `if (hexData[k] !== undefined) continue;   // skip if hex tool is active on that cell` (the hex tool no longer exists and `hexData` is not defined anywhere).
5. Replace `_placeObject` and `_eraseObject`:

```js
  function _placeObject(col, row) {
    const bldId = _selectedBuildingId;
    if (!bldId) return false;
    const key = col + ',' + row;
    if (objectsData[key] === bldId) return false;
    _pushOnce();
    objectsData[key] = bldId;
    _spawnSatellites(col, row, bldId);
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }

  function _eraseObject(col, row) {
    const key = col + ',' + row;
    if (!objectsData[key]) return false;
    _pushOnce();
    const erasedId = objectsData[key];
    delete objectsData[key];
    _removeSatellites(col, row, erasedId);
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }
```
6. In `_onDown`, remove the explicit `History.push();` from the two cases so they read:

```js
      case 'object':
        _placeObject(col, row);
        _lastObjectPainted = { col, row };
        break;
      case 'erase-object':
        _eraseObject(col, row);
        _lastObjectPainted = { col, row };
        break;
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/object-tools.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/object-tools.spec.ts
git commit -m "feat(tools): restore building tools with undo, fix hexData ReferenceError

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `_pushOnce` replaces the eager `History.push()` for object strokes; confirm drag-placing buildings still yields exactly one undo step (the guard resets only on mouse-down/up); satellite geometry itself is untouched (K7).

---

### Task T2.15: Restore the road tools (Draw Road W, Connect Road C, Erase Road Q)

Covers the road third of roadmap 2.7.

**Files:**
- Modify: `MapEditorPro.html` toolbar (after the Erase Building button added in T2.14).
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function _paintRoad(col, row) {` (~4338), `function _connectRoad(col, row) {` (~4354), `function _eraseRoad(col, row) {` (~4379), `case 'road':`, `case 'road-connect':`, `case 'erase-road':` in `_onDown` (~4464), `TOOL_NAMES`, `CODE_TOOLS`.
- Modify: `tests/object-tools.spec.ts`

**Interfaces:**
- Consumes: `_pushOnce` (T2.14), `Roads.getNeighbors`, `_hexPathBetween`, `_isRoadNetworkNeighbor`.
- Produces: `_paintRoad`, `_connectRoad`, `_eraseRoad` return `boolean` and call `_pushOnce()` only when they mutate; tools `'road'` (W), `'road-connect'` (C), `'erase-road'` (Q); `TOOL_NAMES` entries for the three.

- [ ] **Step 1: Write the failing tests** (append to `tests/object-tools.spec.ts`)

```ts
test.describe('road tools (T2.15)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // A neighbour of the city that the road-network gate (which uses Roads.getNeighbors both ways) accepts.
  const goodNeighbour = (page: any) => page.evaluate(() =>
    Roads.getNeighbors(225, 224).find((n: any) => Roads.getNeighbors(n.col, n.row).some((m: any) => m.col === 225 && m.row === 224)));

  test('W draws a connected road tile in one undo step and rejects a floating one', async ({ page }) => {
    const nb = await goodNeighbour(page);
    await page.keyboard.press('w');
    expect(await page.evaluate(() => Tools.getActive())).toBe('road');
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, nb.col, nb.row);
    expect(await page.evaluate((k) => k in roadsData, nb.col + ',' + nb.row)).toBe(true);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await clickCell(page, 230, 224);                         // five cells from the city, outside the network
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(1);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(0);
  });

  test('C connects a start and a destination with a path; Q erases a tile', async ({ page }) => {
    await page.keyboard.press('c');
    expect(await page.evaluate(() => Tools.getActive())).toBe('road-connect');
    await clickCell(page, 222, 224);
    await clickCell(page, 228, 224);
    const keys = await page.evaluate(() => Object.keys(roadsData));
    expect(keys).toContain('222,224');
    expect(keys).toContain('228,224');
    expect(keys.length).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('q');
    expect(await page.evaluate(() => Tools.getActive())).toBe('erase-road');
    await clickCell(page, 228, 224);
    expect(await page.evaluate(() => '228,224' in roadsData)).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => '228,224' in roadsData)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/object-tools.spec.ts -g "road tools" --reporter=line`
Expected: active tool stays `paint` after `w` / `c` / `q`.

- [ ] **Step 3: Implement**

Toolbar, after the Erase Building button:

```html
      <button class="tool-btn" data-tool="road" onclick="Tools.setActive('road')">🛣<span class="tooltip">Draw Road (W)</span></button>
      <button class="tool-btn" data-tool="road-connect" onclick="Tools.setActive('road-connect')">🔗<span class="tooltip">Connect Road: click start, click destination (C)</span></button>
      <button class="tool-btn" data-tool="erase-road" onclick="Tools.setActive('erase-road')">🚫<span class="tooltip">Erase Road (Q)</span></button>
```

`TOOL_NAMES`: add `road: 'Draw Road', 'erase-road': 'Erase Road',` (the existing `'road-connect': 'Connect Road'` stays). `CODE_TOOLS`: add `KeyW: 'road', KeyC: 'road-connect', KeyQ: 'erase-road',`.

Replace the three road functions:

```js
  function _paintRoad(col, row) {
    const key = col + ',' + row;
    if (roadsData[key]) return false;
    if (!_isRoadNetworkNeighbor(col, row)) {
      UI.toast('⚠ Road must connect to an existing road, the city, or a settlement');
      return false;
    }
    _pushOnce();
    roadsData[key] = { type: 'road_hex' };
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }

  function _connectRoad(col, row) {
    if (!_roadConnectStart) {
      const key = col + ',' + row;
      _pushOnce();
      if (!roadsData[key]) roadsData[key] = { type: 'road_hex' };
      _roadConnectStart = { col, row };
      IO.scheduleAutoSave();
      Canvas.render();
      UI.toast('Road start set — click a destination to connect');
      return true;
    }
    if (_roadConnectStart.col === col && _roadConnectStart.row === row) return false;
    const path = _hexPathBetween(_roadConnectStart.col, _roadConnectStart.row, col, row);
    if (!path) { UI.toast('Destination too far to connect'); return false; }
    _pushOnce();
    path.forEach(c => {
      const k = c.col + ',' + c.row;
      if (!roadsData[k]) roadsData[k] = { type: 'road_hex' };
    });
    _roadConnectStart = { col, row };
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }

  function _eraseRoad(col, row) {
    const key = col + ',' + row;
    if (!roadsData[key]) return false;
    _pushOnce();
    delete roadsData[key];
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }
```

`_onDown`: remove `History.push();` from the three road cases:

```js
      case 'road':
        _paintRoad(col, row);
        _lastRoadPainted = { col, row };
        break;
      case 'road-connect':
        _connectRoad(col, row);
        break;
      case 'erase-road':
        _eraseRoad(col, row);
        _lastRoadPainted = { col, row };
        break;
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/object-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/object-tools.spec.ts
git commit -m "feat(tools): restore Draw/Connect/Erase Road tools with lazy undo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the road-network gate and `_hexPathBetween` run on `Roads.getNeighbors`, which inherits the K1 table bug (a "neighbour" can be two cells away); the test therefore picks a symmetric neighbour. Fixing K1 would tighten the gate.

---

### Task T2.16: Bridge tool (U)

Covers the bridge third of roadmap 2.7. The legacy axis bridges (`bridgesData`, sprites no longer hosted) are not revived; the tool places the `Road_Bridge_*` buildings from `BldDB` (category `Bridge`) on river tiles, using the same picker panel as buildings.

**Files:**
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function setActive(name) {` object-picker block (~4017-4035), `function _populateBuildingPicker() {` (~4047), `function selectBuilding(id) {` (~4066), `function _updateBuildingLabel() {` (~4072), `return { init, setActive, ...` , `TOOL_NAMES`, `CODE_TOOLS`.
- Modify: `MapEditorPro.html` toolbar (after the Erase Road button).
- Modify: `tests/object-tools.spec.ts`

**Interfaces:**
- Consumes: `_isRiverTile` (existing), `_pushOnce`, `BldDB.getAll()`.
- Produces: tool `'bridge'` (key U); `Tools.getSelectedBridgeId()`; `_populateBuildingPicker(mode)` with `mode = 'object' | 'bridge'`; clicking a river tile places the selected bridge building in `objectsData` (clicking the same bridge again removes it); other tiles toast "Bridges can only be built on river tiles".

- [ ] **Step 1: Write the failing test** (append to `tests/object-tools.spec.ts`)

```ts
test.describe('bridge tool (T2.16)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('U places a bridge on a river tile, toggles it off, and refuses land', async ({ page }) => {
    await page.evaluate(() => { mapData[224 * MAP_WIDTH + 227] = 'River_L_1'; });
    await page.keyboard.press('u');
    expect(await page.evaluate(() => Tools.getActive())).toBe('bridge');
    await page.evaluate(() => Tools.selectBuilding('Road_Bridge_NS_1'));
    await hidePicker(page);
    expect(await page.evaluate(() => Tools.getSelectedBridgeId())).toBe('Road_Bridge_NS_1');
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => objectsData['227,224'])).toBe('Road_Bridge_NS_1');
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => '227,224' in objectsData)).toBe(false);
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 228, 224);                          // Plain_1
    await expect(page.locator('#toast-container')).toContainText('river tiles');
    expect(await page.evaluate(() => History.undoSize())).toBe(before);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/object-tools.spec.ts -g "bridge tool" --reporter=line`
Expected: active tool is `paint` after `u`.

- [ ] **Step 3: Implement**

`Tools`:

1. State: next to `let _selectedBuildingId = null;` add `let _selectedBridgeId = null; let _pickerMode = 'object';`.
2. `TOOL_NAMES`: add `bridge: 'Place Bridge',`. `CODE_TOOLS`: add `KeyU: 'bridge',`.
3. In `setActive`, replace the whole object-picker block (from `// Object tool: show/hide building picker panel` through the closing of the `else { if (picker) ... }`) with:

```js
    // Object / Bridge tools: show the building picker (bridge mode lists Bridge-category buildings)
    const picker = document.getElementById('obj-building-picker');
    const label  = document.getElementById('obj-building-label');
    if (name === 'object' || name === 'bridge') {
      _pickerMode = name;
      _populateBuildingPicker(name);
      if (picker) {
        const btn = document.querySelector(`.tool-btn[data-tool="${name}"]`);
        if (btn) {
          const r = btn.getBoundingClientRect();
          picker.style.left = r.left + 'px';
          picker.style.top  = (r.bottom + 4) + 'px';
        }
        picker.style.display = 'block';
      }
      if (label) label.style.display = 'inline';
    } else {
      if (picker) picker.style.display = 'none';
      if (label)  label.style.display  = 'none';
    }
```
4. Replace `_populateBuildingPicker`, `selectBuilding`, `_updateBuildingLabel`, `getSelectedBuildingId`:

```js
  function _populateBuildingPicker(mode) {
    const grid = document.getElementById('obj-building-picker-grid');
    if (!grid) return;
    const bridges = mode === 'bridge';
    // Road/Bridge have dedicated tools, so the generic building picker excludes them (and vice versa).
    const buildings = BldDB.getAll().filter(b => b.id &&
      (bridges ? b.buildingCategory === 'Bridge' : (b.buildingCategory !== 'Bridge' && !b.isRoad)));
    if (bridges) { if (!_selectedBridgeId && buildings.length) _selectedBridgeId = buildings[0].id; }
    else if (!_selectedBuildingId && buildings.length) _selectedBuildingId = buildings[0].id;
    const selId = bridges ? _selectedBridgeId : _selectedBuildingId;

    grid.innerHTML = buildings.map(b => {
      const src = _bldSpriteUrl(b);
      const sel = b.id === selId ? ' selected' : '';
      return `<div class="bld-card${sel}" data-bld-id="${b.id}" onclick="Tools.selectBuilding('${b.id.replace(/'/g,"\\'")}')">` +
        `<img src="${src}" alt="" onerror="this.style.visibility='hidden'">` +
        `<span>${b.id}</span></div>`;
    }).join('');
    _updateBuildingLabel();
  }

  function selectBuilding(id) {
    if (_pickerMode === 'bridge') _selectedBridgeId = id; else _selectedBuildingId = id;
    document.querySelectorAll('.bld-card').forEach(c => c.classList.toggle('selected', c.dataset.bldId === id));
    _updateBuildingLabel();
  }

  function _updateBuildingLabel() {
    const label = document.getElementById('obj-building-label');
    if (label) label.textContent = (_pickerMode === 'bridge' ? _selectedBridgeId : _selectedBuildingId) || '';
  }

  function getSelectedBuildingId() { return _selectedBuildingId; }
  function getSelectedBridgeId()   { return _selectedBridgeId; }
```

5. Add the bridge placement next to `_placeObject`:

```js
  function _placeBridge(col, row) {
    if (!_selectedBridgeId) return false;
    if (!_isRiverTile(col, row)) { UI.toast('⚠ Bridges can only be built on river tiles'); return false; }
    const key = col + ',' + row;
    _pushOnce();
    if (objectsData[key] === _selectedBridgeId) delete objectsData[key];   // same bridge again = remove
    else objectsData[key] = _selectedBridgeId;
    IO.scheduleAutoSave();
    Canvas.render();
    return true;
  }
```

6. `_onDown` (before `case 'select':`): `case 'bridge': _placeBridge(col, row); break;`
7. Return object: add `getSelectedBridgeId`.

Toolbar, after the Erase Road button:

```html
      <button class="tool-btn" data-tool="bridge" onclick="Tools.setActive('bridge')">🌉<span class="tooltip">Place Bridge on a river tile (U)</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/object-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/object-tools.spec.ts
git commit -m "feat(tools): bridge tool placing Road_Bridge buildings on river tiles

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** which bridge variant fits which river orientation is left to the user (picker choice); the game's rule for bridges (`CoastlineEdgeDetector.IsRiverTerrain`) is mirrored only by the river-tile check.

---

### Task T2.17: Layers panel (visibility)

Covers the visibility half of roadmap 2.8. Five layers: terrain, buildings and bridges, roads, settlements, zone overlay. State is editor-only (localStorage), never in the map JSON.

**Files:**
- Modify: `MapEditorPro.html`: new `Layers` module immediately before the `// CANVAS MODULE` banner (anchor: `// CANVAS MODULE — hex renderer, viewport, zoom/pan`, ~2738); `Canvas.render()` (anchors: `const _anchorPass = [];`, `_drawHexTile(s.x, s.y, radius, _hid, col, row);`, `if (typeof ZonePainter !== 'undefined' && ZonePainter.isOverlayVisible()`, `settlements.forEach(s => {`, `bridgesData.forEach(b => {`, `Object.entries(roadsData).forEach(([key]) => {`, `Object.entries(objectsData).forEach(([key, bldId]) => {`); panel HTML before `<div id="stamp-panel">`; CSS; `load` handler (after `Stamps.initPanel();`).
- Create: `tests/layers.spec.ts`

**Interfaces:**
- Produces (global `Layers`): `NAMES`, `isVisible(name)`, `isLocked(name)`, `setVisible(name, bool)`, `setLocked(name, bool)`, `initPanel()`. Persisted in `localStorage['layer_state_v1']`. Panel rows `#layers-panel .layer-row[data-layer]` with `.layer-eye` and `.layer-lock` buttons.

- [ ] **Step 1: Write the failing tests**

Create `tests/layers.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { freshEditor, clickCell } from './editor-helpers';

test.describe('layers: visibility (T2.17)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('hiding the roads layer stops road overlays being drawn', async ({ page }) => {
    const r = await page.evaluate(() => {
      roadsData['226,224'] = { type: 'road_hex' };
      let n = 0;
      const orig = Roads.drawOverlay;
      Roads.drawOverlay = (...a: any[]) => { n++; return orig(...a); };
      Canvas.render();
      const visible = n;
      Layers.setVisible('roads', false);
      n = 0;
      Canvas.render();
      const hidden = n;
      Layers.setVisible('roads', true);
      Roads.drawOverlay = orig;
      return { visible, hidden };
    });
    expect(r.visible).toBeGreaterThan(0);
    expect(r.hidden).toBe(0);
  });

  test('panel eye buttons toggle layers and the state survives a reload', async ({ page }) => {
    await page.click('.layer-row[data-layer="objects"] .layer-eye');
    expect(await page.evaluate(() => Layers.isVisible('objects'))).toBe(false);
    await page.reload();
    await openEditor(page);
    expect(await page.evaluate(() => Layers.isVisible('objects'))).toBe(false);
    expect(await page.evaluate(() => Layers.isVisible('terrain'))).toBe(true);
  });

  test('hiding terrain skips tile sprites', async ({ page }) => {
    const r = await page.evaluate(() => {
      let n = 0;
      const orig = Terrain.getSprite;
      Terrain.getSprite = (...a: any[]) => { n++; return orig(...a); };
      Layers.setVisible('terrain', false);
      const spritesWhileHidden = n;
      Layers.setVisible('terrain', true);
      Terrain.getSprite = orig;
      return { spritesWhileHidden };
    });
    expect(r.spritesWhileHidden).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/layers.spec.ts --reporter=line`
Expected: `ReferenceError: Layers is not defined`.

- [ ] **Step 3: Implement**

`Layers` module (before the `// CANVAS MODULE` banner):

```js
// ════════════════════════════════════════════════════════════
// LAYERS MODULE — per-layer visibility and lock (editor-only, stored in localStorage)
// ════════════════════════════════════════════════════════════
const Layers = (() => {
  const NAMES  = ['terrain', 'objects', 'roads', 'settlements', 'zones'];
  const LABELS = { terrain: 'Terrain', objects: 'Buildings & bridges', roads: 'Roads', settlements: 'Settlements', zones: 'Zone overlay' };
  const LS_KEY = 'layer_state_v1';
  const _state = {};
  NAMES.forEach(n => { _state[n] = { visible: true, locked: false }; });
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) NAMES.forEach(n => { if (saved[n]) _state[n] = { visible: saved[n].visible !== false, locked: !!saved[n].locked }; });
  } catch (e) { /* storage unavailable: defaults */ }

  function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (e) {} }
  function isVisible(n) { return !_state[n] || _state[n].visible; }
  function isLocked(n)  { return !!(_state[n] && _state[n].locked); }

  function _sync() {
    document.querySelectorAll('#layers-panel .layer-row').forEach(row => {
      const n = row.dataset.layer;
      row.querySelector('.layer-eye').style.opacity  = isVisible(n) ? '1' : '0.3';
      row.querySelector('.layer-lock').textContent   = isLocked(n) ? '🔒' : '🔓';
    });
  }
  function setVisible(n, v) {
    if (!_state[n]) return;
    _state[n].visible = !!v; _save(); _sync();
    if (typeof Canvas !== 'undefined') Canvas.render();
  }
  function setLocked(n, v) {
    if (!_state[n]) return;
    _state[n].locked = !!v; _save(); _sync();
  }

  function initPanel() {
    const box = document.getElementById('layers-list');
    if (!box) return;
    box.innerHTML = '';
    NAMES.forEach(n => {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.dataset.layer = n;
      row.innerHTML = `<button class="layer-eye" title="Show / hide">👁</button><span class="layer-name">${LABELS[n]}</span>` +
                      `<button class="layer-lock" title="Lock / unlock editing">🔓</button>`;
      row.querySelector('.layer-eye').addEventListener('click', () => setVisible(n, !isVisible(n)));
      row.querySelector('.layer-lock').addEventListener('click', () => setLocked(n, !isLocked(n)));
      box.appendChild(row);
    });
    _sync();
  }

  return { NAMES, isVisible, isLocked, setVisible, setLocked, initPanel };
})();
```

`Canvas.render()` edits:

1. After `const _anchorPass = [];   // multi-tile anchors: drawn again in second pass` add:
```js
    const _terrainVisible = Layers.isVisible('terrain');
```
2. Immediately after the line `const _hid = mapData[row * MAP_WIDTH + col];` add:
```js
        if (!_terrainVisible) { hexClipPath(s.x, s.y, radius); ctx.fillStyle = '#1b1b1b'; ctx.fill(); continue; }
```
3. `if (typeof ZonePainter !== 'undefined' && ZonePainter.isOverlayVisible() && ZonePainter.getZones().length > 0) {` becomes `if (Layers.isVisible('zones') && typeof ZonePainter !== 'undefined' && ZonePainter.isOverlayVisible() && ZonePainter.getZones().length > 0) {`.
4. In `settlements.forEach(s => {` add as the first statement `if (!Layers.isVisible('settlements')) return;`.
5. Replace the three collection expressions:
   - `bridgesData.forEach(b => {` -> `(Layers.isVisible('objects') ? bridgesData : []).forEach(b => {`
   - `Object.entries(roadsData).forEach(([key]) => {` -> `(Layers.isVisible('roads') ? Object.entries(roadsData) : []).forEach(([key]) => {`
   - `Object.entries(objectsData).forEach(([key, bldId]) => {` -> `(Layers.isVisible('objects') ? Object.entries(objectsData) : []).forEach(([key, bldId]) => {`

Panel HTML, before `<div id="stamp-panel">`:

```html
      <div id="layers-panel">
        <div class="section-title">Layers</div>
        <div id="layers-list"></div>
      </div>
```

CSS (after the stamp styles):

```css
#layers-panel { padding: 10px; border-bottom: 1px solid var(--border); }
#layers-panel .section-title { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
.layer-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.layer-name { flex: 1; font-size: 11px; }
.layer-eye, .layer-lock { background: none; border: none; cursor: pointer; font-size: 13px; padding: 0 2px; }
```

`load` handler: after `Stamps.initPanel();` add `Layers.initPanel();`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/layers.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/layers.spec.ts
git commit -m "feat(layers): layers panel with per-layer visibility

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** hidden terrain still iterates every visible cell (flat fill), so it does not speed rendering; the minimap and exported JSON ignore visibility by design.

---

### Task T2.18: Layer locks gate every tool

**Files:**
- Modify: `MapEditorPro.html` `Tools`. Anchors: `function _resetCells(cells, opts) {` (T2.6), `function _pasteLayers() {` (T2.9), `function cutSelection() {`, `function deleteSelection() {`, `function beginMove() {`, `function applyReplace() {`, `function _onDown(sx, sy, e) {` (the line `_isDown = true;`).
- Modify: `tests/layers.spec.ts`

**Interfaces:**
- Consumes: `Layers.isLocked` (T2.17).
- Produces: `TOOL_LAYER` map (tool name -> layer); `_layerLocked(layer) -> boolean` (toasts when locked); mouse tools and selection commands refuse to edit a locked layer; `eraseCells` and paste skip locked secondary layers (buildings/roads/zones) while still editing unlocked ones.

- [ ] **Step 1: Write the failing tests** (append to `tests/layers.spec.ts`)

```ts
test.describe('layers: locks (T2.18)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('a locked terrain layer blocks painting and creates no undo step', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Layers.setLocked('terrain', true); });
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Plain_1');
    await expect(page.locator('#toast-container')).toContainText('locked');
    expect(await page.evaluate(() => History.undoSize())).toBe(before);
    await page.evaluate(() => Layers.setLocked('terrain', false));
    await clickCell(page, 227, 224);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Water_1');
  });

  test('the eraser resets terrain but leaves a locked buildings layer alone', async ({ page }) => {
    const r = await page.evaluate(() => {
      const k = '226,224';
      mapData[224 * MAP_WIDTH + 226] = 'Water_1';
      objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' };
      Layers.setLocked('objects', true);
      Tools.eraseCells([{ col: 226, row: 224 }]);
      const out = { id: mapData[224 * MAP_WIDTH + 226], o: k in objectsData, rd: k in roadsData };
      Layers.setLocked('objects', false);
      return out;
    });
    expect(r).toEqual({ id: 'Plain_1', o: true, rd: false });
  });

  test('cut and delete refuse when terrain is locked', async ({ page }) => {
    await page.evaluate(() => {
      mapData[224 * MAP_WIDTH + 225] = 'Water_1';
      Selection.setCells([{ col: 225, row: 224 }]);
      Layers.setLocked('terrain', true);
    });
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Water_1');
    await page.keyboard.press('Control+x');
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Water_1');
    await page.evaluate(() => Layers.setLocked('terrain', false));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/layers.spec.ts -g locks --reporter=line`
Expected: first test paints Water_1 despite the lock (`expected "Plain_1", received "Water_1"`).

- [ ] **Step 3: Implement**

Add near `TOOL_NAMES`:

```js
  // Which layer each tool edits (used by the lock gate in _onDown).
  const TOOL_LAYER = {
    paint: 'terrain', fill: 'terrain', rect: 'terrain', line: 'terrain', circle: 'terrain', polygon: 'terrain',
    eraser: 'terrain', scatter: 'terrain', replace: 'terrain', paste: 'terrain',
    object: 'objects', 'erase-object': 'objects', bridge: 'objects',
    road: 'roads', 'road-connect': 'roads', 'erase-road': 'roads',
    settlement: 'settlements', erase: 'settlements', city: 'settlements',
    zone: 'zones',
  };
  function _layerLocked(layer) {
    if (Layers.isLocked(layer)) { UI.toast(`Layer "${layer}" is locked`); return true; }
    return false;
  }
```

`_onDown`: change

```js
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return;
    _strokePushed = false;
    _isDown = true;
```

to

```js
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return;
    _strokePushed = false;
    const _lockLayer = TOOL_LAYER[_active];
    if (_lockLayer && _layerLocked(_lockLayer)) return;
    _isDown = true;
```

`_resetCells`: replace the three overlay-removal statements inside the loop with:

```js
      if (!Layers.isLocked('objects')) {
        if (objectsData[k]) { const id = objectsData[k]; delete objectsData[k]; _removeSatellites(col, row, id); }
        delete tileExtras[k];
        const bi = bridgesData.findIndex(b => b.col === col && b.row === row);
        if (bi >= 0) bridgesData.splice(bi, 1);
      }
      if (!Layers.isLocked('roads')) delete roadsData[k];
```

`_pasteLayers`:

```js
  function _pasteLayers() {
    return { terrain: !Layers.isLocked('terrain'), objects: !Layers.isLocked('objects'),
             roads: !Layers.isLocked('roads'), zones: !Layers.isLocked('zones') };
  }
```

In `cutSelection`, `deleteSelection` and `beginMove`, add directly after the `if (!cells) return false;` line:

```js
    if (_layerLocked('terrain')) return false;
```

In `applyReplace`, add as the first line: `if (_layerLocked('terrain')) return;`

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/layers.spec.ts tests/paint-tools.spec.ts tests/selection.spec.ts tests/object-tools.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/layers.spec.ts
git commit -m "feat(layers): layer locks gate tools, eraser, cut/delete/paste

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** programmatic APIs (`applyTerrainCells`, `replaceTerrain`, `scatterCells`) are deliberately not gated, only user-facing entry points are; Generator and Satellite apply do not check locks yet.

---

### Task T2.19: Clear Map clears every layer

Covers the second half of roadmap 2.8. Today `IO.clearMap` resets terrain and bridges only; buildings, roads, under-terrain extras and zones survive.

**Files:**
- Modify: `MapEditorPro.html` `IO.clearMap`. Anchor: `function clearMap() {` (~6577).
- Modify: `tests/layers.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_TILE_ID` (T2.6), `Layers.isLocked` (T2.17), `ZonePainter.clearZoneLayer()`.
- Produces: `IO.clearMap()` clears terrain (+ bridges), buildings (+ extras), roads, zones and non-city settlements, skipping any locked layer; undoable in one step.

- [ ] **Step 1: Write the failing test** (append to `tests/layers.spec.ts`)

```ts
test.describe('Clear Map (T2.19)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  const dirty = (page: any) => page.evaluate(() => {
    mapData[224 * MAP_WIDTH + 226] = 'Water_1';
    objectsData['226,224'] = 'Grain_1'; roadsData['227,224'] = { type: 'road_hex' };
    tileExtras['226,224'] = { underTerrainId: 'Water_1' };
    ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 228] = 1;
    settlements.push({ col: 230, row: 224, type: 'settlement' });
  });
  const state = (page: any) => page.evaluate(() => ({
    water: mapData.filter(x => x === 'Water_1').length, o: Object.keys(objectsData).length,
    rd: Object.keys(roadsData).length, x: Object.keys(tileExtras).length,
    z: ZonePainter.getZoneLayer().reduce((a: number, b: number) => a + b, 0), s: settlements.length,
  }));

  test('clears every layer, keeps the city, and undoes in one step', async ({ page }) => {
    await dirty(page);
    await page.evaluate(() => IO.clearMap());
    await page.click('#confirm-ok');
    expect(await state(page)).toEqual({ water: 0, o: 0, rd: 0, x: 0, z: 0, s: 1 });
    await page.evaluate(() => History.undo());
    expect(await state(page)).toEqual({ water: 1, o: 1, rd: 1, x: 1, z: 1, s: 2 });
  });

  test('locked layers are skipped', async ({ page }) => {
    await dirty(page);
    await page.evaluate(() => { Layers.setLocked('roads', true); Layers.setLocked('zones', true); });
    await page.evaluate(() => IO.clearMap());
    await page.click('#confirm-ok');
    expect(await state(page)).toEqual({ water: 0, o: 0, rd: 1, x: 0, z: 1, s: 1 });
    await page.evaluate(() => { Layers.setLocked('roads', false); Layers.setLocked('zones', false); });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/layers.spec.ts -g "Clear Map" --reporter=line`
Expected: `expected {water:0,o:0,rd:0,...} received {water:0,o:1,rd:1,x:1,z:1,s:1}`.

- [ ] **Step 3: Implement**

Replace `clearMap` in `IO`:

```js
  function clearMap() {
    UI.closeAllMenus();
    UI.showConfirm('Clear Map', 'Clear every unlocked layer (terrain, buildings, roads, zones, settlements)? The city is kept.', () => {
      History.push();
      if (!Layers.isLocked('terrain')) { mapData.fill(DEFAULT_TILE_ID); bridgesData = []; }
      if (!Layers.isLocked('objects')) { objectsData = {}; tileExtras = {}; }
      if (!Layers.isLocked('roads'))   roadsData = {};
      if (!Layers.isLocked('zones') && typeof ZonePainter !== 'undefined') ZonePainter.clearZoneLayer();
      if (!Layers.isLocked('settlements')) {
        settlements = settlements.filter(s => s.type === 'city');
        if (settlements.length === 0) settlements.push({ col: getCityCol(), row: getCityRow(), type: 'city' });
      }
      invalidateSatelliteMap();
      UI.updateSettlementCount();
      Canvas.render();
      Canvas.drawMinimap();
      UI.toast('Map cleared');
      _autoSave();
    });
  }
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/layers.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/layers.spec.ts
git commit -m "fix(io): Clear Map clears buildings, roads, extras and zones too

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the confirm text changed; the Phase 0 modal rewrite (item 7) should keep the "locked layers are skipped" wording; slot configuration (`settlementSlots`) is intentionally kept.

---

## Phase 3: generation and map design

Goal: generate into a selected region with blending, build maps from real heightmaps, move the city and configure difficulty bands, place resources/artifacts/mega-cities like the real game, and stop hard-coding tile ids in the generator. Pure maths goes in `hex-utils.js` (feather) and a second new pure file `gen-utils.js` (heightmap, placement algorithms, tile-class resolver), loaded by `<script>` tags right after `hex-utils.js`.

Preconditions: all of Phase 2 is merged (Phase 3 uses `Selection`, `Tools.autoResolveEdgesAround`, `Tools._pushOnce`, `Canvas.setHighlight`, `Layers`, `HexUtils.neighbors`).

### Phase 3 files-touched table

| File | Tasks | What changes |
|---|---|---|
| `hex-utils.js` | T3.1 | `edgeDistances`, `blendWeight` |
| `gen-utils.js` (new) | T3.3, T3.7, T3.9 | `GenUtils`: luminance / orientation-correct resample / normalise / sea level; spread and Poisson picking, ore clusters; role-to-tile-class resolver |
| `MapEditorPro.html` `Generator` (~6814-7222) | T3.2, T3.4, T3.5, T3.9 | `window` mode, `applyToRegion`, elevation override, import UI, city-relative exclusion, class-based id table |
| `MapEditorPro.html` `Satellite` (~7227) | T3.9 | tile-class id table |
| `MapEditorPro.html` shared state (~12604-12680), `Canvas` rings, `IO` load/save | T3.5, T3.6 | city derived from settlements, `cityDistance`, `DistanceBands` |
| `MapEditorPro.html` new `Placement` module, Generate menu, modal | T3.8 | resource / artifact / mega-city helper |
| `tests/generation.spec.ts`, `tests/city.spec.ts`, `tests/placement.spec.ts` (new), `tests/hex-utils.spec.ts` | T3.1-T3.9 | Playwright specs |

---

### Task T3.1: Feather maths for blending (`edgeDistances`, `blendWeight`)

**Files:**
- Modify: `hex-utils.js` (add two functions and exports).
- Modify: `tests/hex-utils.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.cubeRing`, `toCube`, `fromCube`, `inBounds`.
- Produces: `HexUtils.edgeDistances(keys: Set<string>, W, H) -> Map<string, number>` where `keys` are `"col,row"`; boundary cells (a neighbour inside the map that is not in the set) get 1, interior cells grow by 1 per step inward; map-edge cells do not count as boundary. `HexUtils.blendWeight(d, width) -> number` = 1 when `width <= 0`, else `min(1, d / (width + 1))`.

- [ ] **Step 1: Write the failing test** (append to `tests/hex-utils.spec.ts`)

```ts
test('edgeDistances of a radius-5 disc and blendWeight ramp', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const W = 450, H = 450;
    const keys = new Set<string>(HexUtils.discCells(225, 224, 5, W, H).map((c: any) => c.col + ',' + c.row));
    const dist = HexUtils.edgeDistances(keys, W, H);
    const hist: Record<number, number> = {};
    for (const v of dist.values()) hist[v] = (hist[v] || 0) + 1;
    return {
      hist,
      w: [HexUtils.blendWeight(1, 0), HexUtils.blendWeight(1, 3), HexUtils.blendWeight(4, 3), HexUtils.blendWeight(9, 3)],
    };
  });
  expect(r.hist).toEqual({ 1: 30, 2: 24, 3: 18, 4: 12, 5: 6, 6: 1 });
  expect(r.w).toEqual([1, 0.25, 1, 1]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/hex-utils.spec.ts -g edgeDistances --reporter=line`
Expected: `HexUtils.edgeDistances is not a function`.

- [ ] **Step 3: Implement** (in `hex-utils.js`, before `return {`; add both names to the returned object)

```js
  // Distance (in steps) of every cell in `keys` from the selection boundary: boundary = 1.
  function edgeDistances(keys, W, H) {
    const dist = new Map();
    let frontier = [];
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      const isEdge = cubeRing(toCube(c, r, W, H), 1).some(n => {
        const p = fromCube(n, W, H);
        return inBounds(p.col, p.row, W, H) && !keys.has(p.col + ',' + p.row);
      });
      if (isEdge) { dist.set(k, 1); frontier.push([c, r]); }
    }
    let d = 1;
    while (frontier.length) {
      d++;
      const next = [];
      for (const [c, r] of frontier) {
        for (const n of cubeRing(toCube(c, r, W, H), 1)) {
          const p = fromCube(n, W, H);
          const k = p.col + ',' + p.row;
          if (!inBounds(p.col, p.row, W, H) || !keys.has(k) || dist.has(k)) continue;
          dist.set(k, d);
          next.push([p.col, p.row]);
        }
      }
      frontier = next;
    }
    for (const k of keys) if (!dist.has(k)) dist.set(k, d);   // selection with no boundary (whole map)
    return dist;
  }

  function blendWeight(d, width) {
    return width <= 0 ? 1 : Math.min(1, d / (width + 1));
  }
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/hex-utils.spec.ts --reporter=line`
Expected: all pass (fixme skipped).

- [ ] **Step 5: Commit**

```bash
git add hex-utils.js tests/hex-utils.spec.ts
git commit -m "feat(hex): edge-distance and blend-weight helpers for feathered regions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** a whole-map selection has no boundary, so every cell gets the same large distance (weight 1); confirm that is the wanted "no feathering at map edges" behaviour.

---

### Task T3.2: Generate into a selection with blending

Covers roadmap 3.1. The generator renders the whole map into a scratch array in "window" mode (no centre flattening, no ocean falloff, so any region gets full terrain), then copies only the selected cells, feathering the border with a stochastic dissolve.

**Files:**
- Modify: `MapEditorPro.html` `Generator`. Anchors: `const t    = Math.max(0, 1.0 - dist / infR);` (~7009), `const coastInf = coastT * coastT * (3 - 2 * coastT);` (~7021), `function apply() {` (~7207), `return { open, close, apply, applyPreset, schedule };` (~7221), `['gen-rivers','gen-goldCount','gen-oilCount'].forEach(id => {` in `_updateLabels` (~7138).
- Modify: `MapEditorPro.html` generator modal. Anchor: `<!-- Presets -->` (~2126).
- Create: `tests/generation.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.edgeDistances/blendWeight`, `Tools.autoResolveEdgesAround`, `Selection`, `getSatelliteAnchor`, `_lcg`.
- Produces: `Generator.generateInto(dest, params, opts)` (= `_generateInto`; new `opts.window`), `Generator.getParams()`, `Generator.applyToRegion(cells, params, blendWidth) -> number changed`. UI: `#gen-sel-only` checkbox and `#gen-blend` range; `Generator.apply()` honours them.

- [ ] **Step 1: Write the failing tests**

Create `tests/generation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

test.describe('generate into selection (T3.2)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('generates only inside the region and feathers the border', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      mapData.fill('BrokenRails_1');                    // a Special tile the generator never produces
      const cells = HexUtils.discCells(200, 200, 12, W, H);
      const keys = new Set<string>(cells.map((c: any) => c.col + ',' + c.row));
      const dist = HexUtils.edgeDistances(keys, W, H);
      const p = Generator.getParams(); p.seed = 7;
      Generator.applyToRegion(cells, p, 4);
      let outside = 0;
      for (let i = 0; i < mapData.length; i++)
        if (mapData[i] !== 'BrokenRails_1' && !keys.has((i % W) + ',' + Math.floor(i / W))) outside++;
      let edgeN = 0, edgeC = 0, inN = 0, inC = 0;
      for (const c of cells) {
        const d = dist.get(c.col + ',' + c.row), changed = mapData[c.row * W + c.col] !== 'BrokenRails_1';
        if (d === 1) { edgeN++; if (changed) edgeC++; }
        if (d >= 6) { inN++; if (changed) inC++; }
      }
      return { outside, edge: edgeC / edgeN, inner: inC / inN };
    });
    expect(r.outside).toBe(0);
    expect(r.inner).toBeGreaterThan(0.95);
    expect(r.edge).toBeLessThan(0.6);
  });

  test('Generate dialog: "only inside the selection" is one undo step and touches nothing else', async ({ page }) => {
    await page.evaluate(() => {
      mapData.fill('BrokenRails_1');
      Selection.setCells(HexUtils.discCells(225, 224, 6, MAP_WIDTH, MAP_HEIGHT));
      Generator.open();
    });
    await page.check('#gen-sel-only');
    await page.fill('#gen-blend', '0');
    const before = await page.evaluate(() => History.undoSize());
    await page.click('.gen-modal-footer .btn-primary');
    const r = await page.evaluate(() => ({
      changed: mapData.filter(x => x !== 'BrokenRails_1').length, undo: History.undoSize(),
    }));
    expect(r.changed).toBeGreaterThan(80);
    expect(r.changed).toBeLessThanOrEqual(127 + 6 * 7);   // region plus a few re-resolved river neighbours at most
    expect(r.undo).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.filter(x => x !== 'BrokenRails_1').length)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/generation.spec.ts --reporter=line`
Expected: `Generator.getParams is not a function`; second test: `locator.check: ... waiting for locator('#gen-sel-only')`.

- [ ] **Step 3: Implement**

In `_generateInto`:
- Change `const t    = Math.max(0, 1.0 - dist / infR);` to `const t    = opts.window ? 0 : Math.max(0, 1.0 - dist / infR);`
- Change `const coastInf = coastT * coastT * (3 - 2 * coastT);` to `const coastInf = opts.window ? 0 : coastT * coastT * (3 - 2 * coastT);`

Add before `function _updateLabels() {`:

```js
  // Generate the whole map into a scratch array in "window" mode (no centre flatten, no ocean
  // falloff), then copy only `cells`. Border cells are kept with probability 1 - weight so the
  // new terrain dissolves into the old over `blendWidth` steps.
  function applyToRegion(cells, params, blendWidth) {
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const gen = mapData.slice();
    _generateInto(gen, params, { window: true });
    const keys = new Set(cells.map(c => c.col + ',' + c.row));
    const dist = HexUtils.edgeDistances(keys, W, H);
    const rng = _lcg((params.seed ^ 0x9e3779b9) >>> 0);
    const touched = [];
    for (const { col, row } of cells) {
      if (col < 0 || col >= W || row < 0 || row >= H) continue;
      if (getSatelliteAnchor(col, row)) continue;
      const w = HexUtils.blendWeight(dist.get(col + ',' + row), blendWidth);
      if (w < 1 && rng() >= w) continue;
      const idx = row * W + col;
      if (mapData[idx] === gen[idx]) continue;
      touched.push({ col, row, prev: mapData[idx] });
      mapData[idx] = gen[idx];
    }
    invalidateSatelliteMap();
    Tools.autoResolveEdgesAround(touched);
    return touched.length;
  }
```

Replace `apply()`:

```js
  function apply() {
    if (!mapData) return;
    const selOnly = document.getElementById('gen-sel-only');
    if (selOnly && selOnly.checked) {
      if (Selection.isEmpty()) { UI.toast('Select a region first (M)'); return; }
      History.push();
      const n = applyToRegion(Selection.getCells(), _getParams(), parseInt(document.getElementById('gen-blend').value) || 0);
      close();
      Canvas.render();
      Canvas.drawMinimap();
      UI.toast(`Generated into selection (${n} tiles)`);
      return;
    }
    History.push();
    _generateInto(mapData, _getParams());
    const cityC = getCityCol(), cityR = getCityRow();
    settlements = settlements.filter(s => s.type !== 'city');
    settlements.unshift({ col: cityC, row: cityR, type: 'city' });
    UI.updateSettlementCount();
    close();
    Canvas.render();
    Canvas.drawMinimap();
    UI.toast('Map generated');
  }
```

`_updateLabels`: change `['gen-rivers','gen-goldCount','gen-oilCount'].forEach(id => {` to `['gen-rivers','gen-goldCount','gen-oilCount','gen-blend'].forEach(id => {`.

Return line: `return { open, close, apply, applyPreset, schedule, applyToRegion, generateInto: _generateInto, getParams: _getParams };`

Modal markup, inserted before `<!-- Presets -->`:

```html
        <!-- Region -->
        <div class="gen-section">Region</div>
        <div class="gen-check-row">
          <input id="gen-sel-only" type="checkbox">
          <label for="gen-sel-only">Only inside the selection (M)</label>
        </div>
        <div class="gen-row">
          <label>Blend width</label>
          <input id="gen-blend" type="range" min="0" max="12" step="1" value="4" oninput="Generator.schedule()">
          <span id="gen-blend-v" class="gen-val">4</span>
        </div>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/generation.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/generation.spec.ts
git commit -m "feat(generator): generate into the selection with feathered blending

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the region receives "what this seed would generate there", so changing the seed reshapes the region without moving its borders; generated rivers are resolved against the scratch map, then `autoResolveEdgesAround` re-resolves them against the real neighbours (K1 caveat); existing buildings/roads inside the region are kept.

---

### Task T3.3: Heightmap maths in `gen-utils.js` (orientation-correct)

Covers the pure half of roadmap 3.2 per `docs/superpowers/specs/2026-08-06-heightmap-elevation-import-design.md`: luminance, resample, auto-normalise, sea-level offset. The spec's "stretch to `MAP_WIDTH x MAP_HEIGHT`" is implemented with the screen orientation of the grid (issue K4), so a north-up image lands north-up.

**Files:**
- Create: `gen-utils.js`
- Modify: `MapEditorPro.html` script tags. Anchor: `<script src="hex-utils.js?v=1"></script>` - add `<script src="gen-utils.js?v=1"></script>` after it.
- Modify: `tests/generation.spec.ts`

**Interfaces:**
- Produces (global `GenUtils`):
  - `luminanceGrid(rgba: Uint8ClampedArray, w, h) -> Float32Array` (0.299 R + 0.587 G + 0.114 B)
  - `resampleToMap(src: Float32Array, sw, sh, W, H) -> Float32Array(W*H)` indexed `[row*W+col]`; image x maps to `xi = H-1-row`, image y maps to `W-1-col` (north = top = high `col`)
  - `normalize(grid) -> {grid: Float32Array, flat: boolean}` (min..max stretched to 0..1; uniform input gives all 0.5 and `flat: true`)
  - `applySeaLevel(grid, offset) -> Float32Array` (`clamp(v - offset, 0, 1)`)

- [ ] **Step 1: Write the failing tests** (append to `tests/generation.spec.ts`)

```ts
test.describe('heightmap maths (T3.3)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('resampleToMap keeps a north-up, west-left image oriented on screen', async ({ page }) => {
    const r = await page.evaluate(() => {
      const mk = (w: number, h: number, bright: (x: number, y: number) => boolean) => {
        const px = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, v = bright(x, y) ? 255 : 0;
          px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
        }
        return GenUtils.luminanceGrid(px, w, h);
      };
      const W = 10, H = 10;
      const left = GenUtils.resampleToMap(mk(4, 2, x => x < 2), 4, 2, W, H);   // left half bright
      const top  = GenUtils.resampleToMap(mk(2, 4, (_x, y) => y < 2), 2, 4, W, H); // top half bright
      // screen-left = high row (west), screen-top = high col (north)
      return { leftWest: left[9 * W + 0], leftEast: left[0 * W + 0], topNorth: top[0 * W + 9], topSouth: top[0 * W + 0] };
    });
    expect(r.leftWest).toBeCloseTo(255, 1);
    expect(r.leftEast).toBeCloseTo(0, 1);
    expect(r.topNorth).toBeCloseTo(255, 1);
    expect(r.topSouth).toBeCloseTo(0, 1);
  });

  test('normalize stretches to 0..1, flags a flat image, and the sea level shifts and clamps', async ({ page }) => {
    const r = await page.evaluate(() => {
      const n = GenUtils.normalize(Float32Array.from([10, 20, 30]));
      const flat = GenUtils.normalize(new Float32Array(5));
      const sea = GenUtils.applySeaLevel(Float32Array.from([0.1, 0.5, 0.9]), 0.2);
      return { grid: Array.from(n.grid), flatFlag: flat.flat, flatVals: Array.from(flat.grid), sea: Array.from(sea) };
    });
    expect(r.grid).toEqual([0, 0.5, 1]);
    expect(r.flatFlag).toBe(true);
    expect(r.flatVals).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(r.sea[0]).toBe(0);
    expect(r.sea[1]).toBeCloseTo(0.3, 5);
    expect(r.sea[2]).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/generation.spec.ts -g "heightmap maths" --reporter=line`
Expected: `ReferenceError: GenUtils is not defined`.

- [ ] **Step 3: Implement**

Create `/Users/sergii.tyshchenko/Post Apo Map Editor/gen-utils.js`:

```js
// gen-utils.js - pure helpers for map generation. No DOM, no editor globals except HexUtils at call time.
const GenUtils = (() => {
  // ── Heightmap import ─────────────────────────────────────────
  function luminanceGrid(rgba, w, h) {
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return out;
  }

  // The grid's horizontal screen axis is the ROW axis (xi = H-1-row grows east) and its vertical
  // screen axis is the COL axis (col grows north), so a north-up image maps image-x -> xi and
  // image-y -> W-1-col. Nearest-neighbour, deterministic.
  function resampleToMap(src, sw, sh, W, H) {
    const out = new Float32Array(W * H);
    for (let row = 0; row < H; row++) {
      const sx = Math.min(sw - 1, Math.floor(((H - 1 - row) + 0.5) / H * sw));
      for (let col = 0; col < W; col++) {
        const sy = Math.min(sh - 1, Math.floor(((W - 1 - col) + 0.5) / W * sh));
        out[row * W + col] = src[sy * sw + sx];
      }
    }
    return out;
  }

  function normalize(grid) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v < min) min = v; if (v > max) max = v; }
    const out = new Float32Array(grid.length);
    if (!(max > min)) { out.fill(0.5); return { grid: out, flat: true }; }
    const span = max - min;
    for (let i = 0; i < grid.length; i++) out[i] = (grid[i] - min) / span;
    return { grid: out, flat: false };
  }

  function applySeaLevel(grid, offset) {
    const out = new Float32Array(grid.length);
    for (let i = 0; i < grid.length; i++) out[i] = Math.max(0, Math.min(1, grid[i] - offset));
    return out;
  }

  return { luminanceGrid, resampleToMap, normalize, applySeaLevel };
})();
```

Script tags in `MapEditorPro.html`:

```html
<script src="hex-utils.js?v=1"></script>
<script src="gen-utils.js?v=1"></script>
<script src="zone-painter.js?v=8"></script>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/generation.spec.ts -g "heightmap maths" --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add gen-utils.js MapEditorPro.html tests/generation.spec.ts
git commit -m "feat(gen): heightmap maths with screen-correct orientation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the spec's resample step said "stretch to MAP_WIDTH x MAP_HEIGHT" without saying which image axis goes where; this task fixes that with a tested orientation (north-up, west-left); nearest-neighbour is kept as the spec says.

---

### Task T3.4: Import Elevation in the Generator (wiring, sea level, errors)

Covers the UI half of roadmap 3.2. Deviation from the spec, deliberate: importing a file loads and normalises the elevation and ticks "Use imported elevation"; the destructive step stays the existing Generate button, and because the Generator already has a live preview the sea-level slider previews for free. Moisture and biome noise still come from the selected preset.

**Files:**
- Modify: `MapEditorPro.html` `Generator`. Anchors: `let e = eNoise(col, row)                           * (1-inf) + TARGET_E * inf;` (~7011), `e = e * (1 - coastInf) + TARGET_OCEAN * coastInf;` (~7022), `debug:      document.getElementById('gen-debug').checked,` in `_getParams` (~6946), `['gen-coastR',2],['gen-coastWobble',2],['gen-coastBand',2]].forEach(([id, dp]) => {` in `_updateLabels` (~7134), the return line.
- Modify: `MapEditorPro.html` generator modal: `<div class="gen-presets">` (~2127) and the `<!-- Region -->` block from T3.2.
- Modify: `tests/generation.spec.ts`

**Interfaces:**
- Consumes: `GenUtils` (T3.3), `createImageBitmap`, `UI.toast`.
- Produces: `Generator.importElevation(file: File) -> Promise<void>` (validates, decodes, resamples, normalises; on any failure toasts and leaves state untouched), `Generator.hasElevation() -> boolean`, `Generator.clearElevation()`, `Generator.onElevFile(event)`. `_getParams()` gains `elevOverride: Float32Array | null` (normalised grid minus the `#gen-sea` slider value, only when `#gen-use-elev` is ticked). `_generateInto` uses `p.elevOverride` instead of the elevation noise and skips the ocean falloff (real coastlines); the city flatten stays so the city area is land. UI: `#gen-elev-file`, `#gen-use-elev`, `#gen-elev-name`, `#gen-sea` (-0.3..0.3).

- [ ] **Step 1: Write the failing tests** (append to `tests/generation.spec.ts`)

```ts
test.describe('heightmap import (T3.4)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  const importGradient = (page: any) => page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');   // dark west, bright east
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const blob: Blob = await new Promise(res => cv.toBlob(b => res(b!), 'image/png'));
    await Generator.importElevation(new File([blob], 'h.png', { type: 'image/png' }));
  });

  test('imported elevation is oriented east-bright and the sea level moves the coastline', async ({ page }) => {
    await importGradient(page);
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const p = Generator.getParams();
      const mean = (r0: number, r1: number) => { let s = 0, n = 0; for (let r = r0; r < r1; r++) for (let c = 0; c < W; c++) { s += p.elevOverride[r * W + c]; n++; } return s / n; };
      const eastMean = mean(0, H / 2), westMean = mean(H / 2, H);   // low rows = east
      const waterFrac = (sea: number) => {
        (document.getElementById('gen-sea') as HTMLInputElement).value = String(sea);
        const q = Generator.getParams(); q.rivers = 0;
        const tmp = new Array(W * H).fill('Plain_1');
        Generator.generateInto(tmp, q, {});
        let w = 0;
        for (const id of tmp) { const e = Terrain.byHexId(id); if (e && e.type === 'Water') w++; }
        return w / (W * H);
      };
      return { has: Generator.hasElevation(), len: p.elevOverride.length, eastMean, westMean, low: waterFrac(-0.3), high: waterFrac(0.3) };
    });
    expect(r.has).toBe(true);
    expect(r.len).toBe(450 * 450);
    expect(r.eastMean).toBeGreaterThan(r.westMean + 0.3);
    expect(r.high).toBeGreaterThan(r.low);
  });

  test('a non-image file is rejected and leaves no elevation', async ({ page }) => {
    await page.evaluate(async () => { await Generator.importElevation(new File(['x'], 'a.txt', { type: 'text/plain' })); });
    expect(await page.evaluate(() => Generator.hasElevation())).toBe(false);
    await expect(page.locator('#toast-container')).toContainText('not an image');
  });

  test('a uniform image warns and yields a flat 0.5 grid', async ({ page }) => {
    await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
      const g = cv.getContext('2d')!; g.fillStyle = '#808080'; g.fillRect(0, 0, 8, 8);
      const blob: Blob = await new Promise(res => cv.toBlob(b => res(b!), 'image/png'));
      await Generator.importElevation(new File([blob], 'flat.png', { type: 'image/png' }));
    });
    await expect(page.locator('#toast-container')).toContainText('no usable elevation variation');
    expect(await page.evaluate(() => Generator.getParams().elevOverride[12345])).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/generation.spec.ts -g "heightmap import" --reporter=line`
Expected: `Generator.importElevation is not a function`.

- [ ] **Step 3: Implement**

In `_generateInto`:
- `let e = eNoise(col, row)                           * (1-inf) + TARGET_E * inf;` becomes
  `let e = (p.elevOverride ? p.elevOverride[row * W + col] : eNoise(col, row)) * (1-inf) + TARGET_E * inf;`
- `e = e * (1 - coastInf) + TARGET_OCEAN * coastInf;` becomes
  `if (!p.elevOverride) e = e * (1 - coastInf) + TARGET_OCEAN * coastInf;`

In `_getParams`, after the `debug:` line add:

```js
      elevOverride: _currentElev(),
```

Add before `function _updateLabels() {`:

```js
  // ── Imported elevation (normalised 0..1 grid at map size) ────
  let _elevNorm = null, _elevName = '';

  function hasElevation() { return !!_elevNorm; }

  function _currentElev() {
    const use = document.getElementById('gen-use-elev');
    if (!_elevNorm || !use || !use.checked) return null;
    if (_elevNorm.length !== MAP_WIDTH * MAP_HEIGHT) {              // map was resized after the import
      clearElevation();
      UI.toast('Imported elevation cleared: the map size changed');
      return null;
    }
    const sea = parseFloat(document.getElementById('gen-sea').value) || 0;
    return GenUtils.applySeaLevel(_elevNorm, sea);
  }

  function _refreshElevUI() {
    const use = document.getElementById('gen-use-elev');
    if (use) { use.disabled = !_elevNorm; use.checked = !!_elevNorm; }
    const nm = document.getElementById('gen-elev-name');
    if (nm) nm.textContent = _elevNorm ? _elevName : 'none';
  }

  function clearElevation() { _elevNorm = null; _elevName = ''; _refreshElevUI(); schedule(); }

  async function importElevation(file) {
    try {
      if (!file || !/^image\//.test(file.type)) throw new Error('not an image file');
      const bmp = await createImageBitmap(file);
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0);
      const px = cx.getImageData(0, 0, cv.width, cv.height).data;
      const lum  = GenUtils.luminanceGrid(px, cv.width, cv.height);
      const grid = GenUtils.resampleToMap(lum, cv.width, cv.height, MAP_WIDTH, MAP_HEIGHT);
      const norm = GenUtils.normalize(grid);
      _elevNorm = norm.grid; _elevName = file.name;               // only assigned after every step succeeded
      _refreshElevUI();
      if (norm.flat) UI.toast('Warning: the image has no usable elevation variation');
      schedule();
    } catch (err) {
      UI.toast('Elevation import failed: ' + err.message);
    }
  }

  function onElevFile(ev) {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (f) importElevation(f);
  }
```

`_updateLabels`: change the first array to include `['gen-sea',2]`: `['gen-coastR',2],['gen-coastWobble',2],['gen-coastBand',2],['gen-sea',2]].forEach(([id, dp]) => {`.

Return line becomes:

```js
  return { open, close, apply, applyPreset, schedule, applyToRegion, generateInto: _generateInto, getParams: _getParams,
           importElevation, hasElevation, clearElevation, onElevFile };
```

Modal: inside `<div class="gen-presets">...</div>` add a sixth button, and add the elevation rows right after that `gen-presets` div:

```html
          <button class="gen-preset-btn" onclick="document.getElementById('gen-elev-file').click()">🏔 Import Elevation…</button>
```

```html
        <input id="gen-elev-file" type="file" accept="image/*" style="display:none" onchange="Generator.onElevFile(event)">
        <div class="gen-check-row">
          <input id="gen-use-elev" type="checkbox" disabled onchange="Generator.schedule()">
          <label for="gen-use-elev">Use imported elevation: <span id="gen-elev-name">none</span></label>
          <button class="gen-rnd-btn" title="Forget the imported image" onclick="Generator.clearElevation()">✕</button>
        </div>
        <div class="gen-row">
          <label>Sea level</label>
          <input id="gen-sea" type="range" min="-0.3" max="0.3" step="0.01" value="0" oninput="Generator.schedule()">
          <span id="gen-sea-v" class="gen-val">0.00</span>
        </div>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/generation.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/generation.spec.ts
git commit -m "feat(generator): import a heightmap image as the elevation source

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the spec asks import to overwrite the map immediately; this deliberately defers to the Generate button (non-destructive, with live preview). Confirm with the owner. Import runs on the main thread; Phase 1 item 5 will move generation into a worker.

---

### Task T3.5: Configurable city position

Covers the city half of roadmap 3.3. The city is the settlement whose `type === 'city'`; `getCityCol/getCityRow` read it (falling back to the map centre), so every existing consumer (roads, rings, minimap, camera, Generator and Satellite apply) follows automatically. Distances, rings, the slot-ring label and the generator's flatten/exclusion circle become city-relative.

**Files:**
- Modify: `MapEditorPro.html` shared state. Anchors: `function getCityCol() { return Math.floor(MAP_WIDTH  / 2); }` and `function getCityRow()` (~12668), `function _hexDistFromCity(col, row) {` (~12673).
- Modify: `MapEditorPro.html` `Canvas`. Anchors: `document.getElementById('st-dist').textContent = Canvas.hexDist(appX, appY);` (~3456); in `_drawZoneOverlays` the three lines `const appX = ...; const appY = ...; const d    = hexDist(appX, appY);` followed by `const zi   = Math.min(`; in `_drawSlotRings` the same three lines followed by `if (d < slot.minDist || d > slot.maxDist) continue;`; `const labelRow = MAP_HEIGHT - 1 - (slot.maxDist + Math.floor(MAP_HEIGHT / 2));` and `const labelCol = Math.floor(MAP_WIDTH / 2);` (~3663).
- Modify: `MapEditorPro.html` `IO._loadFromJSON`. Anchor: `// Ensure city exists at center` (~6489).
- Modify: `MapEditorPro.html` `Generator`. Anchors: `const halfH  = Math.floor(H / 2);` (~6990), `const dx = col - halfW, dy = row - halfH;` (~7007), `const ddx = sc - halfW, ddy = sr - halfH;` (~7044), `const dx = cc - halfW, dy = cr - halfH;` (~7057), `const dx = ac - halfW, dy = ar - halfH;` (~7108), `const tdx = tc - halfW, tdy = tr - halfH;` (~7120), `debug:      document.getElementById('gen-debug').checked,`.
- Modify: `MapEditorPro.html` `Tools` (tool `'city'`) and toolbar (after the Erase Settlement button, anchor `data-tool="erase"`).
- Create: `tests/city.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.toCube/cubeDistance`, `Tools._pushOnce`.
- Produces: `getCityCol()/getCityRow()` derived from `settlements`; global `cityDistance(col,row) -> number` (hex distance to the city); `_hexDistFromCity` delegates to it; `Tools.moveCity(col,row) -> boolean` (undoable; replaces the city entry, drops any settlement already on the target); tool `'city'` (key K); `Generator._getParams()` gains `cityCol, cityRow`.

- [ ] **Step 1: Write the failing tests**

Create `tests/city.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor, clickCell } from './editor-helpers';

test.describe('configurable city (T3.5)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('moveCity relocates the city, distances follow it, and it survives save/load', async ({ page }) => {
    const r = await page.evaluate(() => {
      const moved = Tools.moveCity(240, 230);
      const out: any = { moved, col: getCityCol(), row: getCityRow(), d0: cityDistance(240, 230),
        d1: HexUtils.neighbors(240, 230, MAP_WIDTH, MAP_HEIGHT).map((n: any) => cityDistance(n.col, n.row)) };
      IO.loadFromJSON(JSON.parse(IO.getMapJson()));
      out.after = { col: getCityCol(), row: getCityRow(), cities: settlements.filter((s: any) => s.type === 'city').length };
      return out;
    });
    expect(r.moved).toBe(true);
    expect([r.col, r.row]).toEqual([240, 230]);
    expect(r.d0).toBe(0);
    expect(r.d1.every((d: number) => d === 1)).toBe(true);
    expect(r.after).toEqual({ col: 240, row: 230, cities: 1 });
  });

  test('K + click moves the city and Ctrl+Z puts it back', async ({ page }) => {
    await page.keyboard.press('k');
    expect(await page.evaluate(() => Tools.getActive())).toBe('city');
    await clickCell(page, 228, 226);
    expect(await page.evaluate(() => [getCityCol(), getCityRow()])).toEqual([228, 226]);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => [getCityCol(), getCityRow()])).toEqual([225, 224]);
  });

  test('generator exclusion and flatten follow the city', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.moveCity(300, 300);
      return Generator.getParams();
    });
    expect([r.cityCol, r.cityRow]).toEqual([300, 300]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/city.spec.ts --reporter=line`
Expected: `Tools.moveCity is not a function`; third test `cityCol` undefined.

- [ ] **Step 3: Implement**

Shared state: replace the two `getCity*` lines and `_hexDistFromCity`:

```js
function _cityEntry() { return settlements.find(s => s.type === 'city') || null; }
function getCityCol() { const c = _cityEntry(); return c ? c.col : Math.floor(MAP_WIDTH  / 2); }
function getCityRow() { const c = _cityEntry(); return c ? c.row : Math.floor((MAP_HEIGHT - 1) / 2); }

// Hex distance from (col,row) to the city (cube distance, same maths as the status-bar readout).
function cityDistance(col, row) {
  return HexUtils.cubeDistance(
    HexUtils.toCube(col, row, MAP_WIDTH, MAP_HEIGHT),
    HexUtils.toCube(getCityCol(), getCityRow(), MAP_WIDTH, MAP_HEIGHT));
}
```

and replace the body of `_hexDistFromCity(col, row)` with `return cityDistance(col, row);`.

`Canvas`:
- status bar: change `document.getElementById('st-dist').textContent = Canvas.hexDist(appX, appY);` to `document.getElementById('st-dist').textContent = cityDistance(col, row);`
- `_drawZoneOverlays`: replace the three lines (`const appX ...`, `const appY ...`, `const d    = hexDist(appX, appY);`) with `const d    = cityDistance(col, row);`
- `_drawSlotRings`: replace the same three lines with `const d    = cityDistance(col, row);`
- label: replace the two label lines with `const labelRow = getCityRow() - slot.maxDist;` and `const labelCol = getCityCol();`

`IO._loadFromJSON`: replace the block starting `// Ensure city exists at center` (the five lines through `else settlements.unshift({ col: cc, row: cr, type: 'city' });`) with:

```js
        // Keep the saved city wherever it is; fall back to the map centre only when the file has none.
        const cities = settlements.filter(s => s.type === 'city');
        if (cities.length === 0) {
          const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
          const at = settlements.find(s => s.col === cc && s.row === cr);
          if (at) at.type = 'city'; else settlements.unshift({ col: cc, row: cr, type: 'city' });
        } else if (cities.length > 1) {
          settlements = settlements.filter(s => s.type !== 'city' || s === cities[0]);
        }
```

`Generator`:
- after `const halfH  = Math.floor(H / 2);` add `const cityC = p.cityCol ?? halfW, cityR = p.cityRow ?? halfH;   // flatten / exclusion centre (the coastline stays map-centred)`
- loop: replace `const t    = opts.window ? 0 : Math.max(0, 1.0 - dist / infR);` with
```js
        const cdx = col - cityC, cdy = row - cityR;
        const t    = opts.window ? 0 : Math.max(0, 1.0 - Math.sqrt(cdx * cdx + cdy * cdy) / infR);
```
- `const ddx = sc - halfW, ddy = sr - halfH;` -> `const ddx = sc - cityC, ddy = sr - cityR;`
- `const dx = cc - halfW, dy = cr - halfH;` -> `const dx = cc - cityC, dy = cr - cityR;`
- `const dx = ac - halfW, dy = ar - halfH;` -> `const dx = ac - cityC, dy = ar - cityR;`
- `const tdx = tc - halfW, tdy = tr - halfH;` -> `const tdx = tc - cityC, tdy = tr - cityR;`
- `_getParams`: after the `elevOverride` line add `cityCol: getCityCol(), cityRow: getCityRow(),`

`Tools`:
- `TOOL_NAMES`: add `city: 'Move City',`; `CODE_TOOLS`: add `KeyK: 'city',`.
- Add near `_placeSettlement`:

```js
  function moveCity(col, row) {
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return false;
    if (getCityCol() === col && getCityRow() === row) return false;
    _pushOnce();
    settlements = settlements.filter(s => s.type !== 'city' && !(s.col === col && s.row === row));
    settlements.unshift({ col, row, type: 'city' });
    UI.updateSettlementCount();
    IO.scheduleAutoSave();
    Canvas.render();
    Canvas.drawMinimap();
    UI.toast(`City moved to ${col}, ${row}`);
    return true;
  }
```
- `_onDown` (before `case 'select':`): `case 'city': moveCity(col, row); _isDown = false; break;`
- Return object: add `moveCity`.

Toolbar, after the Erase Settlement button:

```html
      <button class="tool-btn" data-tool="city" onclick="Tools.setActive('city')">🏙<span class="tooltip">Move City (K)</span></button>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/city.spec.ts tests/generation.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/city.spec.ts
git commit -m "feat(map): configurable city position with city-relative distances

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** OPEN QUESTION for the owner - does the game accept a city away from the map centre (roadmap open questions list the map-format question)? The JSON is unchanged (the city is already a `type: "city"` settlement), but an older editor reading such a file would add a second city at the centre. Symmetry (T2.5) stays centred on the map, not the city.

---

### Task T3.6: Configurable difficulty (distance) bands

Covers the zones half of roadmap 3.3. The distance rings and tints currently use a fixed interval (`#ring-interval`, 10 bands). A `DistanceBands` module adds an explicit list of band limits (for example `10,20,35,60`), saved in the map JSON as `distance_bands`; an empty list keeps the interval behaviour.

**Files:**
- Modify: `MapEditorPro.html`: new `DistanceBands` module immediately before the `Layers` module (anchor: `// LAYERS MODULE`); `Canvas._drawZoneOverlays` (anchors: `const interval = Math.max(1, parseInt(document.getElementById('ring-interval')?.value) || 10);`, `const zi   = Math.min(Math.floor(d / interval), ZONE_PALETTE.length - 1);`, `for (let i = 0; i < ZONE_PALETTE.length; i++) {` and the following `const d  = (i + 1) * interval;`); `IO._buildJson` (anchor: `return JSON.stringify(result);` at the end of `_buildJson`, ~6252); `IO._loadFromJSON` and `IO.tryRestoreAutosave` (anchor: `ZonePainter._uiRebuildZoneConfig();` in each, ~6347 and ~6528); `IO.newMap` silent branch (anchor: `settlementSlots = [];` ~6368) and `applyNewMap` (anchor: `settlements = [{ col: getCityCol(), row: getCityRow(), type: 'city' }];` ~6417); toolbar (after the `ring-interval` input, ~1329).
- Modify: `tests/city.spec.ts`

**Interfaces:**
- Produces (global `DistanceBands`): `getBounds() -> number[]` (explicit list, else `i * interval` for i = 1..10), `setBounds(arr)` (sorted, unique, positive, max 10 values; empty clears), `setFromInput(text)`, `bandIndex(d) -> number` (0 for `d < first limit`), `toJson() -> number[] | null`, `fromJson(arr)`. Map JSON key `distance_bands` (omitted when empty). Toolbar input `#ring-bounds`.

- [ ] **Step 1: Write the failing test** (append to `tests/city.spec.ts`)

```ts
test('distance bands: explicit limits, band index, JSON round trip', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    DistanceBands.setBounds([30, 5, 12, 12, -3]);
    const bounds = DistanceBands.getBounds();
    const idx = [4, 5, 11, 12, 29, 30, 99].map(d => DistanceBands.bandIndex(d));
    const json = JSON.parse(IO.getMapJson());
    DistanceBands.setBounds([]);
    const def = DistanceBands.getBounds().slice(0, 3);
    IO.loadFromJSON(json);
    return { bounds, idx, saved: json.distance_bands, def, after: DistanceBands.getBounds() };
  });
  expect(r.bounds).toEqual([5, 12, 30]);
  expect(r.idx).toEqual([0, 1, 1, 2, 2, 3, 3]);
  expect(r.saved).toEqual([5, 12, 30]);
  expect(r.def).toEqual([10, 20, 30]);
  expect(r.after).toEqual([5, 12, 30]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/city.spec.ts -g "distance bands" --reporter=line`
Expected: `ReferenceError: DistanceBands is not defined`.

- [ ] **Step 3: Implement**

Module (before `// LAYERS MODULE`):

```js
// ════════════════════════════════════════════════════════════
// DISTANCE BANDS — difficulty ring limits around the city
// ════════════════════════════════════════════════════════════
const DistanceBands = (() => {
  let _bounds = null;   // null = derive from the #ring-interval input

  function _interval() { return Math.max(1, parseInt(document.getElementById('ring-interval')?.value) || 10); }

  function getBounds() {
    if (_bounds) return _bounds.slice();
    const iv = _interval();
    return Array.from({ length: 10 }, (_, i) => (i + 1) * iv);
  }

  function setBounds(arr) {
    const clean = [...new Set((arr || []).map(n => Math.round(Number(n))).filter(n => n > 0 && n <= 1000))]
      .sort((a, b) => a - b).slice(0, 10);
    _bounds = clean.length ? clean : null;
    const el = document.getElementById('ring-bounds');
    if (el && document.activeElement !== el) el.value = _bounds ? _bounds.join(',') : '';
  }

  function setFromInput(text) { setBounds(String(text).split(/[\s,;]+/).filter(Boolean)); }

  function bandIndex(d) {
    const b = getBounds();
    let i = 0;
    while (i < b.length && d >= b[i]) i++;
    return i;
  }

  function toJson() { return _bounds ? _bounds.slice() : null; }
  function fromJson(a) { setBounds(Array.isArray(a) ? a : []); }

  return { getBounds, setBounds, setFromInput, bandIndex, toJson, fromJson };
})();
```

`_drawZoneOverlays`:
- replace the `const interval = ...` line with `const bounds = DistanceBands.getBounds();`
- replace `const zi   = Math.min(Math.floor(d / interval), ZONE_PALETTE.length - 1);` with `const zi   = Math.min(DistanceBands.bandIndex(d), ZONE_PALETTE.length - 1);`
- replace `for (let i = 0; i < ZONE_PALETTE.length; i++) {` with `for (let i = 0; i < Math.min(bounds.length, ZONE_PALETTE.length); i++) {` and `const d  = (i + 1) * interval;` with `const d  = bounds[i];`

`IO._buildJson`: before `return JSON.stringify(result);` add

```js
    const bands = DistanceBands.toJson();
    if (bands) result.distance_bands = bands;
```

`IO._loadFromJSON` and `IO.tryRestoreAutosave`: after the `ZonePainter._uiRebuildZoneConfig();` line (inside the `if (typeof ZonePainter !== 'undefined')` block's closing, i.e. right after that block) add `DistanceBands.fromJson(json.distance_bands);`. `IO.newMap` silent branch and `applyNewMap`: add `DistanceBands.setBounds([]);` next to the settlement reset.

Toolbar, after the `ring-interval` input:

```html
      <input id="ring-bounds" type="text" placeholder="10,20,35…"
             title="Difficulty band limits (comma list, max 10). Empty = every N tiles"
             style="width:84px;background:#111;border:1px solid #444;color:#4fc3f7;font-size:11px;padding:2px 4px;border-radius:3px;vertical-align:middle"
             oninput="DistanceBands.setFromInput(this.value);Canvas.render()">
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/city.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/city.spec.ts
git commit -m "feat(map): configurable difficulty band limits saved in the map JSON

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `distance_bands` is an editor-only extension key (the game presumably ignores it); the ring ellipses are still the existing approximation of hex iso-distance, only their radii and tints changed.

---

### Task T3.7: Placement algorithms (pure): spread, Poisson, ore clusters

Pure building blocks for the placement helper (roadmap 3.4), unit-tested without the editor state.

**Files:**
- Modify: `gen-utils.js` (add three functions and exports).
- Modify: `tests/generation.spec.ts`

**Interfaces:**
- Consumes: `HexUtils.cubeDisc` (at call time).
- Produces: `GenUtils.spreadPick(candidates, count, rng, dist) -> candidate[]` (farthest-point sampling, first pick random); `GenUtils.poissonPick(candidates, count, minSpacing, rng, dist, taken?) -> candidate[]` (random order, rejects anything closer than `minSpacing` to a pick or to `taken`); `GenUtils.oreCluster(centerCube, size, rng) -> cube[]` (centre first, then random cells of the radius-2 disc). `dist(a,b)` is any metric; callers pass cube distance on candidates that carry `q,r,s`.

- [ ] **Step 1: Write the failing test** (append to `tests/generation.spec.ts`)

```ts
test('placement primitives: spread, spacing and cluster shape', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    let s = 5;
    const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const W = 450, H = 450;
    const cands: any[] = [];
    for (let row = 0; row < H; row += 3) for (let col = 0; col < W; col += 3) cands.push({ col, row, ...HexUtils.toCube(col, row, W, H) });
    const dist = (a: any, b: any) => HexUtils.cubeDistance(a, b);
    const spread = GenUtils.spreadPick(cands, 5, rng, dist);
    let minSpread = Infinity;
    for (let i = 0; i < spread.length; i++) for (let j = i + 1; j < spread.length; j++) minSpread = Math.min(minSpread, dist(spread[i], spread[j]));
    const pois = GenUtils.poissonPick(cands, 80, 20, rng, dist, []);
    let minPois = Infinity;
    for (let i = 0; i < pois.length; i++) for (let j = i + 1; j < pois.length; j++) minPois = Math.min(minPois, dist(pois[i], pois[j]));
    const centre = HexUtils.toCube(225, 224, W, H);
    const cluster = GenUtils.oreCluster(centre, 4, rng);
    return { n: spread.length, minSpread, p: pois.length, minPois,
             clusterLen: cluster.length, first: cluster[0].q === centre.q && cluster[0].r === centre.r,
             within: cluster.every((c: any) => dist(c, centre) <= 2),
             distinct: new Set(cluster.map((c: any) => c.q + ',' + c.r)).size };
  });
  expect(r.n).toBe(5);
  expect(r.minSpread).toBeGreaterThan(150);
  expect(r.p).toBe(80);
  expect(r.minPois).toBeGreaterThanOrEqual(20);
  expect(r.clusterLen).toBe(4);
  expect(r.first && r.within).toBe(true);
  expect(r.distinct).toBe(4);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/generation.spec.ts -g "placement primitives" --reporter=line`
Expected: `GenUtils.spreadPick is not a function`.

- [ ] **Step 3: Implement** (in `gen-utils.js`, before `return {`; extend the returned object with the three names)

```js
  // ── Placement primitives ─────────────────────────────────────
  // Farthest-point sampling: first pick random, every next pick maximises its distance to the picks so far.
  function spreadPick(candidates, count, rng, dist) {
    if (!candidates.length || count <= 0) return [];
    const picked = [candidates[Math.floor(rng() * candidates.length)]];
    const best = candidates.map(c => dist(c, picked[0]));
    while (picked.length < count && picked.length < candidates.length) {
      let bi = -1, bd = 0;
      for (let i = 0; i < candidates.length; i++) if (best[i] > bd) { bd = best[i]; bi = i; }
      if (bi < 0) break;
      picked.push(candidates[bi]);
      for (let i = 0; i < candidates.length; i++) best[i] = Math.min(best[i], dist(candidates[i], candidates[bi]));
    }
    return picked;
  }

  // Random-order rejection sampling with a minimum spacing (also against `taken`).
  function poissonPick(candidates, count, minSpacing, rng, dist, taken) {
    const order = candidates.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const picked = [], all = (taken || []).slice();
    for (const c of order) {
      if (picked.length >= count) break;
      let ok = true;
      for (let i = 0; i < all.length; i++) if (dist(c, all[i]) < minSpacing) { ok = false; break; }
      if (ok) { picked.push(c); all.push(c); }
    }
    return picked;
  }

  // A deposit: the centre plus random cells of its radius-2 disc.
  function oreCluster(center, size, rng) {
    const disc = HexUtils.cubeDisc(center, 2).filter(c => !(c.q === center.q && c.r === center.r));
    for (let i = disc.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = disc[i]; disc[i] = disc[j]; disc[j] = t;
    }
    return [{ q: center.q, r: center.r, s: center.s }].concat(disc.slice(0, Math.max(0, size - 1)));
  }
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/generation.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gen-utils.js tests/generation.spec.ts
git commit -m "feat(gen): spread, Poisson and ore-cluster placement primitives

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `spreadPick` is O(candidates x count) and `poissonPick` O(picks x candidates) worst case; a quick Node run measured 450 picks from 202,500 candidates in a few milliseconds, but re-measure if candidates stop being pre-filtered.

---

### Task T3.8: Resource / artifact / mega-city placement helper

Covers roadmap 3.4. Defaults mirror the real game's scale: about 450 bunkers, 5 mega cities, 12 artifacts and ore clusters of gold, copper, gems and uranium. The real game's exact cluster counts are NOT in the repo, so the ore numbers below are labelled assumptions and editable in the dialog. The repo has no bunker/mega-city/copper/uranium ids either: those are configurable ids, and unknown ones are reported instead of silently placed.

**Files:**
- Modify: `MapEditorPro.html`: new `Placement` module right before `function autoPlaceSettlements() {` (~12768); Generate menu (anchor: `<button onclick="Satellite.open()">Satellite Import…</button>`, ~1248); new modal before `<!-- Replace tile modal -->`.
- Create: `tests/placement.spec.ts`

**Interfaces:**
- Consumes: `GenUtils.spreadPick/poissonPick/oreCluster`, `HexUtils`, `cityDistance` (T3.5), `Terrain.byHexId`, `BldDB.getAll()`, `HexDB.getAll()`, `getSatelliteAnchor`, `Layers`.
- Produces (global `Placement`):
  - `Placement.DEFAULTS` (see code) and `Placement.run(cfg, rng = Math.random) -> {placed: Record<string, number>, skipped: {what: string, reason: string}[]}`. Pure of undo: caller pushes history.
  - `Placement.openUI()`, `Placement.closeUI()`, `Placement.apply()` (reads the dialog, `History.push()`, runs, toasts a summary).
  - Rules: candidates are land cells (not Water, Rivers, Hills/Mountains, Volcanic/Rift), not occupied by a settlement, building or multi-tile footprint. Mega cities and artifacts use farthest-point spread beyond `minCity` hex distance from the city; ore deposits are Poisson-spaced clusters written as tiles; bunkers fill the remaining land with spacing `max(2, floor(sqrt(candidates/count) * 0.7))`. `kind: 'settlement'` writes `{col,row,type:id}` into `settlements`; `kind: 'object'` writes `objectsData` and is skipped when the id is not in `BldDB`; an ore whose id is not in `HexDB` is skipped with reason "no tile".

- [ ] **Step 1: Write the failing test**

Create `tests/placement.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

test('placement helper: counts, city distance, spread, ore clusters, unknown ids reported', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    let s = 99;
    const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const cfg = {
      bunkers:    { count: 60, kind: 'settlement', id: 'bunker',   minCity: 6 },
      megaCities: { count: 5,  kind: 'settlement', id: 'megacity', minCity: 40 },
      artifacts:  { count: 12, kind: 'object',     id: 'Artefact_Test_1', minCity: 25 },
      ores: [{ name: 'gold', id: 'GoldVein_1', clusters: 4, size: 4 }, { name: 'uranium', id: 'Uranium_1', clusters: 3, size: 3 }],
    };
    const rep = Placement.run(cfg, rng);
    const of = (t: string) => settlements.filter((x: any) => x.type === t);
    const mega = of('megacity');
    const cube = (m: any) => HexUtils.toCube(m.col, m.row, MAP_WIDTH, MAP_HEIGHT);
    let minMega = Infinity;
    for (let i = 0; i < mega.length; i++) for (let j = i + 1; j < mega.length; j++)
      minMega = Math.min(minMega, HexUtils.cubeDistance(cube(mega[i]), cube(mega[j])));
    return {
      rep, bunkers: of('bunker').length, mega: mega.length,
      minCityMega: Math.min(...mega.map((m: any) => cityDistance(m.col, m.row))), minMega,
      artifacts: Object.values(objectsData).filter(v => v === 'Artefact_Test_1').length,
      gold: mapData.filter(x => x === 'GoldVein_1').length,
    };
  });
  expect(r.bunkers).toBe(60);
  expect(r.mega).toBe(5);
  expect(r.minCityMega).toBeGreaterThanOrEqual(40);
  expect(r.minMega).toBeGreaterThanOrEqual(30);
  expect(r.artifacts).toBe(12);
  expect(r.gold).toBeGreaterThanOrEqual(8);
  expect(r.rep.skipped.map((x: any) => x.what)).toEqual(['uranium']);
  expect(r.rep.skipped[0].reason).toMatch(/no tile/i);
});

test('Generate > Placement Helper dialog places everything in one undo step', async ({ page }) => {
  await freshEditor(page);
  await page.evaluate(() => Placement.openUI());
  await page.fill('#pl-bunkers-count', '20');
  await page.fill('#pl-artifacts-count', '3');
  await page.fill('#pl-megaCities-count', '2');
  const before = await page.evaluate(() => History.undoSize());
  await page.click('#pl-apply');
  const r = await page.evaluate(() => ({ undo: History.undoSize(), s: settlements.length }));
  expect(r.undo).toBe(before + 1);
  expect(r.s).toBe(1 + 20 + 2);
  await page.evaluate(() => History.undo());
  expect(await page.evaluate(() => settlements.length)).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/placement.spec.ts --reporter=line`
Expected: `ReferenceError: Placement is not defined` (2 failures).

- [ ] **Step 3: Implement**

`Placement` module, inserted before `function autoPlaceSettlements() {`:

```js
// ════════════════════════════════════════════════════════════
// PLACEMENT HELPER — bunkers, mega cities, artifacts and ore clusters at game scale
// ════════════════════════════════════════════════════════════
const Placement = (() => {
  // Reference scale from the real game: ~450 bunkers, 5 mega cities, 12 artifacts.
  // ASSUMPTIONS (not in the repo, edit in the dialog): ore cluster counts and sizes, minCity limits, the
  // 'bunker' / 'megacity' settlement type ids, and the copper / uranium tile ids.
  const DEFAULTS = {
    bunkers:    { count: 450, kind: 'settlement', id: 'bunker',   minCity: 6 },
    megaCities: { count: 5,   kind: 'settlement', id: 'megacity', minCity: 40 },
    artifacts:  { count: 12,  kind: 'object',     id: 'Artefact_Test_1', minCity: 25 },
    ores: [
      { name: 'gold',    id: 'GoldVein_1',   clusters: 10, size: 4 },
      { name: 'copper',  id: 'CopperVein_1', clusters: 10, size: 4 },
      { name: 'gems',    id: 'GemField_1',   clusters: 6,  size: 3 },
      { name: 'uranium', id: 'Uranium_1',    clusters: 4,  size: 3 },
    ],
  };
  const BLOCKED_TYPES = ['Water', 'Rivers', 'Hills/Mountains', 'Volcanic/Rift'];

  function _candidates(used) {
    const out = [];
    const occupied = new Set(settlements.map(s => s.col + ',' + s.row));
    const blockedById = new Map();   // Terrain.byHexId scans HexDB, so look each id up once
    const isBlocked = id => {
      let b = blockedById.get(id);
      if (b === undefined) { const e = Terrain.byHexId(id); b = !e || BLOCKED_TYPES.includes(e.type); blockedById.set(id, b); }
      return b;
    };
    for (let row = 0; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        const k = col + ',' + row;
        if (occupied.has(k) || used.has(k) || objectsData[k] || getSatelliteAnchor(col, row)) continue;
        if (isBlocked(mapData[row * MAP_WIDTH + col])) continue;
        out.push(Object.assign({ col, row, d: cityDistance(col, row) }, HexUtils.toCube(col, row, MAP_WIDTH, MAP_HEIGHT)));
      }
    }
    return out;
  }

  function run(cfg, rng) {
    rng = rng || Math.random;
    cfg = cfg || DEFAULTS;
    const placed = {}, skipped = [], used = new Set();
    const dist = (a, b) => HexUtils.cubeDistance(a, b);
    const takenCubes = [];
    const take = c => { used.add(c.col + ',' + c.row); takenCubes.push(c); };
    const write = (cat, c) => {
      if (cat.kind === 'object') objectsData[c.col + ',' + c.row] = cat.id;
      else settlements.push({ col: c.col, row: c.row, type: cat.id });
    };

    // 1. mega cities and 2. artifacts: spread out beyond minCity
    for (const key of ['megaCities', 'artifacts']) {
      const cat = cfg[key];
      if (!cat || cat.count <= 0) continue;
      if (cat.kind === 'object' && !BldDB.getAll().some(b => b.id === cat.id)) {
        skipped.push({ what: key, reason: `no building "${cat.id}" in BldDB` });
        continue;
      }
      const far = _candidates(used).filter(c => c.d >= (cat.minCity || 0));
      const picks = GenUtils.spreadPick(far, cat.count, rng, dist);
      picks.forEach(c => { write(cat, c); take(c); });
      placed[key] = picks.length;
    }

    // 3. ore deposits: Poisson-spaced clusters written as tiles
    for (const ore of cfg.ores || []) {
      const entry = HexDB.getAll().find(h => h.id && h.id.toLowerCase() === String(ore.id).toLowerCase());
      if (!entry) { skipped.push({ what: ore.name, reason: `no tile "${ore.id}" in HexDB` }); continue; }
      const land = _candidates(used).filter(c => c.d >= 10);
      const centres = GenUtils.poissonPick(land, ore.clusters, 10, rng, dist, takenCubes);
      let tiles = 0;
      for (const centre of centres) {
        for (const cube of GenUtils.oreCluster(centre, ore.size, rng)) {
          const p = HexUtils.fromCube(cube, MAP_WIDTH, MAP_HEIGHT);
          if (!HexUtils.inBounds(p.col, p.row, MAP_WIDTH, MAP_HEIGHT) || getSatelliteAnchor(p.col, p.row)) continue;
          const t = Terrain.byHexId(mapData[p.row * MAP_WIDTH + p.col]);
          if (!t || BLOCKED_TYPES.includes(t.type)) continue;
          mapData[p.row * MAP_WIDTH + p.col] = entry.id;
          used.add(p.col + ',' + p.row);
          tiles++;
        }
        takenCubes.push(centre);
      }
      placed[ore.name] = tiles;
    }
    invalidateSatelliteMap();

    // 4. bunkers: fill the remaining land with even spacing
    const bk = cfg.bunkers;
    if (bk && bk.count > 0) {
      const land = _candidates(used).filter(c => c.d >= (bk.minCity || 0));
      const spacing = Math.max(2, Math.floor(Math.sqrt(land.length / bk.count) * 0.7));
      const picks = GenUtils.poissonPick(land, bk.count, spacing, rng, dist, takenCubes);
      picks.forEach(c => { write(bk, c); take(c); });
      placed.bunkers = picks.length;
    }
    return { placed, skipped };
  }

  // ── Dialog ────────────────────────────────────────────────
  function openUI() {
    const D = DEFAULTS;
    const cat = (key, label, c) =>
      `<tr><td>${label}</td><td><input id="pl-${key}-count" type="number" min="0" value="${c.count}" style="width:64px"></td>` +
      `<td><input id="pl-${key}-id" value="${c.id}" style="width:150px"></td>` +
      `<td><input id="pl-${key}-min" type="number" min="0" value="${c.minCity}" style="width:52px" title="Minimum distance from the city"></td></tr>`;
    const ores = D.ores.map((o, i) =>
      `<tr><td>${o.name}</td><td><input id="pl-ore${i}-clusters" type="number" min="0" value="${o.clusters}" style="width:64px"></td>` +
      `<td><input id="pl-ore${i}-id" value="${o.id}" style="width:150px"></td>` +
      `<td><input id="pl-ore${i}-size" type="number" min="1" value="${o.size}" style="width:52px" title="Tiles per cluster"></td></tr>`).join('');
    document.getElementById('pl-form').innerHTML =
      '<table style="font-size:12px;border-spacing:4px"><tr><th></th><th>Count</th><th>Id</th><th>Min dist</th></tr>' +
      cat('bunkers', 'Bunkers', D.bunkers) + cat('megaCities', 'Mega cities', D.megaCities) + cat('artifacts', 'Artifacts', D.artifacts) +
      '<tr><th>Ore</th><th>Clusters</th><th>Tile id</th><th>Size</th></tr>' + ores + '</table>';
    UI.closeAllMenus();
    document.getElementById('place-modal').classList.add('open');
  }
  function closeUI() { document.getElementById('place-modal').classList.remove('open'); }

  function apply() {
    const num = id => Math.max(0, parseInt(document.getElementById(id).value) || 0);
    const str = id => document.getElementById(id).value.trim();
    const cat = (key, base) => ({ count: num(`pl-${key}-count`), kind: base.kind, id: str(`pl-${key}-id`), minCity: num(`pl-${key}-min`) });
    const cfg = {
      bunkers: cat('bunkers', DEFAULTS.bunkers), megaCities: cat('megaCities', DEFAULTS.megaCities), artifacts: cat('artifacts', DEFAULTS.artifacts),
      ores: DEFAULTS.ores.map((o, i) => ({ name: o.name, id: str(`pl-ore${i}-id`), clusters: num(`pl-ore${i}-clusters`), size: Math.max(1, num(`pl-ore${i}-size`)) })),
    };
    History.push();
    const rep = run(cfg);
    closeUI();
    UI.updateSettlementCount();
    Canvas.render(); Canvas.drawMinimap(); IO.scheduleAutoSave();
    const msg = Object.entries(rep.placed).map(([k, v]) => `${k}: ${v}`).join(', ');
    UI.toast('Placed ' + msg + (rep.skipped.length ? ` | skipped ${rep.skipped.map(s => s.what + ' (' + s.reason + ')').join('; ')}` : ''));
  }

  return { DEFAULTS, run, openUI, closeUI, apply };
})();
```

Generate menu: after the Satellite Import button add `<button onclick="Placement.openUI()">Placement Helper…</button>`.

Modal, before `<!-- Replace tile modal -->`:

```html
<!-- Placement helper modal -->
<div class="modal-overlay" id="place-modal">
  <div class="modal-box" style="max-width:520px">
    <h3 style="margin:0 0 8px">Placement helper</h3>
    <p style="margin-bottom:8px">Scatters bunkers, mega cities, artifacts and ore clusters over land. Unknown ids are reported, not placed.</p>
    <div id="pl-form"></div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-cancel" onclick="Placement.closeUI()">Cancel</button>
      <button class="btn btn-primary" id="pl-apply" onclick="Placement.apply()">Place</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/placement.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/placement.spec.ts
git commit -m "feat(map): placement helper for bunkers, mega cities, artifacts and ore clusters

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** OPEN QUESTIONS for the owner - the real counts per ore, the settlement type ids used for bunkers and mega cities, and whether the game wants objects or settlements for them; the tile ids for copper and uranium do not exist in `hex_database.json` today, so they are skipped with a message until the entries are added. Placement ignores locked layers (tool gate only covers mouse tools); with a settlement-heavy preset (450 bunkers) check render cost.

---

### Task T3.9: Generator driven by tile classes (and a cache that refreshes)

Covers roadmap 3.5 and fixes K5. The generator and the satellite import resolve their roles (`WATER_LIGHT`, `FOREST_2`, ...) through `GenUtils.resolveRoles`, which uses the preferred id when it exists and otherwise falls back to a plain tile of the same HexDB `type` ("class"), so a package that removes or renames `Forest_2` no longer breaks generation. The table is rebuilt whenever the HexDB id/type list changes.

**Files:**
- Modify: `gen-utils.js` (add `ROLE_SPEC`, `resolveRoles`; export).
- Modify: `MapEditorPro.html` `Generator`. Anchors: `let _genT = null;` and `function _getGenT() {` through its closing brace (~6854-6878), `function _generateInto(dest, p, opts) {` (~6979).
- Modify: `MapEditorPro.html` `Satellite`. Anchors: `let _T = null;` and `function _getT() {` through its closing brace (~7233-7256), the Satellite `function open() {` (~7410).
- Modify: `tests/generation.spec.ts`

**Interfaces:**
- Consumes: `HexDB.getAll()` entries (`id`, `type`, `occupiedOffsets`, `isLayered`, `edgeFaces`).
- Produces: `GenUtils.ROLE_SPEC` and `GenUtils.resolveRoles(entries) -> Record<role, id>` for the 22 roles used today. Resolution order: exact preferred id (case-insensitive); else a "plain" entry of the role's class (not multi-tile, not layered, not directional, id not matching `/_test|kaiju|chicken|settlement/i`), preferring ids not already assigned to another role, cycling when the class has fewer entries than roles; else the role's `like` role (`BROKEN_PLAIN` follows `PLAIN_2`); else the raw preferred id (today's behaviour). `Generator` refreshes its table at the start of every `_generateInto` when the id/type signature changed.

- [ ] **Step 1: Write the failing tests** (append to `tests/generation.spec.ts`)

```ts
test.describe('tile classes (T3.9)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('resolveRoles falls back to same-class tiles when preferred ids are missing', async ({ page }) => {
    const t = await page.evaluate(() => GenUtils.resolveRoles([
      { id: 'Tree_A', type: 'Forests' }, { id: 'Tree_B', type: 'Forests' },
      { id: 'Grass_A', type: 'Plains' }, { id: 'Plain_2', type: 'Plains' },
    ]));
    expect(t.FOREST_1).toBe('Tree_A');
    expect(t.FOREST_2).toBe('Tree_B');
    expect(t.FOREST_3).toBe('Tree_A');           // class has 2 tiles for 3 roles: cycles
    expect(t.PLAIN_2).toBe('Plain_2');           // exact id wins
    expect(t.PLAIN_1).toBe('Grass_A');           // missing id -> unused same-class tile
    expect(t.BROKEN_PLAIN).toBe('Plain_2');      // follows PLAIN_2, never a random Special tile
    expect(t.WATER_LIGHT).toBe('Water_1');       // no entries at all -> raw preferred id
  });

  test('with the stock HexDB every role keeps its original id', async ({ page }) => {
    const t = await page.evaluate(() => GenUtils.resolveRoles(HexDB.getAll()));
    expect(t.FOREST_2).toBe('Forest_2');
    expect(t.WATER_DARK).toBe('Water_Dirty_1');
    expect(t.BROKEN_PLAIN).toBe('BrokenPlane_1');
    expect(t.GOLD).toBe('GoldVein_1');
    expect(t.LAVA_RIFT).toBe('Lava_Rift_1');
  });

  test('generation picks up a HexDB change without a reload (K5)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const p = Generator.getParams(); p.seed = 3; p.rivers = 0;
      const run = () => { const tmp = new Array(W * H).fill('x'); Generator.generateInto(tmp, p, {}); return [...new Set(tmp)] as string[]; };
      const before = run();
      const orig = HexDB.getAll;
      // rename Forest_1..3 to Tree_1..3: the class fallback must switch to the new ids
      HexDB.getAll = () => orig.call(HexDB).map((h: any) => /^Forest_[123]$/.test(h.id) ? { ...h, id: h.id.replace('Forest', 'Tree') } : h);
      const after = run();
      HexDB.getAll = orig;
      return { beforeForest: before.filter(id => /^Forest_[123]$/.test(id)), afterForest: after.filter(id => /^Forest_[123]$/.test(id)),
               afterTree: after.filter(id => /^Tree_[123]$/.test(id)) };
    });
    expect(r.beforeForest.length).toBeGreaterThan(0);
    expect(r.afterForest).toEqual([]);
    expect(r.afterTree.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/generation.spec.ts -g "tile classes" --reporter=line`
Expected: `GenUtils.resolveRoles is not a function`.

- [ ] **Step 3: Implement**

`gen-utils.js`, before `return {` (add `ROLE_SPEC, resolveRoles` to the returned object):

```js
  // ── Tile classes ─────────────────────────────────────────────
  // role -> preferred id and HexDB `type` (the class used when the preferred id is missing).
  const ROLE_SPEC = {
    WATER_DARK:   { id: 'Water_Dirty_1',  cls: 'Water' },
    WATER_LIGHT:  { id: 'Water_1',        cls: 'Water' },
    WATER_ROCK:   { id: 'Water_Rock_1',   cls: 'Water' },
    RUBBLE_1:     { id: 'Rubble_1',       cls: 'Rubble' },
    RUBBLE_2:     { id: 'Rubble_2',       cls: 'Rubble' },
    RUBBLE_3:     { id: 'Rubble_3',       cls: 'Rubble' },
    PLAIN_1:      { id: 'Plain_1',        cls: 'Plains' },
    PLAIN_2:      { id: 'Plain_2',        cls: 'Plains' },
    BROKEN_PLAIN: { id: 'BrokenPlane_1',  cls: null, like: 'PLAIN_2' },
    FOREST_1:     { id: 'Forest_1',       cls: 'Forests' },
    FOREST_2:     { id: 'Forest_2',       cls: 'Forests' },
    FOREST_3:     { id: 'Forest_3',       cls: 'Forests' },
    HILLS:        { id: 'Hills_1',        cls: 'Hills/Mountains' },
    MOUNTAIN:     { id: 'Mountain_1',     cls: 'Hills/Mountains' },
    GOLD:         { id: 'GoldVein_1',     cls: 'Resources' },
    OIL:          { id: 'Oil_1',          cls: 'Resources' },
    BARREN:       { id: 'Barren_1',       cls: 'Barren/Desert' },
    DESERT:       { id: 'Desert_1',       cls: 'Barren/Desert' },
    SWAMP:        { id: 'Swamp_1',        cls: 'Swamp' },
    LAVA:         { id: 'Lava_Plain_1',   cls: 'Volcanic/Rift' },
    LAVA_RIFT:    { id: 'Lava_Rift_1',    cls: 'Volcanic/Rift' },
    RIFT:         { id: 'Rift_1',         cls: 'Volcanic/Rift' },
  };
  const _EXCLUDE = /_test|kaiju|chicken|settlement/i;
  function _plainEntry(h) {
    return h && h.id && !(Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length) && !h.isLayered &&
           !(Array.isArray(h.edgeFaces) && h.edgeFaces.length) && !_EXCLUDE.test(h.id);
  }

  function resolveRoles(entries) {
    const byLower = new Map(entries.filter(h => h && h.id).map(h => [h.id.toLowerCase(), h.id]));
    const out = {};
    for (const [role, spec] of Object.entries(ROLE_SPEC))
      if (byLower.has(spec.id.toLowerCase())) out[role] = byLower.get(spec.id.toLowerCase());
    for (const [role, spec] of Object.entries(ROLE_SPEC)) {
      if (out[role] || !spec.cls) continue;
      const pool = entries.filter(h => h.type === spec.cls && _plainEntry(h)).map(h => h.id);
      if (!pool.length) continue;
      const taken = new Set(Object.values(out));
      out[role] = pool.find(id => !taken.has(id)) || pool[0];
    }
    for (const [role, spec] of Object.entries(ROLE_SPEC))
      if (!out[role]) out[role] = (spec.like && out[spec.like]) || spec.id;
    return out;
  }
```

`Generator`: replace the `let _genT = null;` block and `_getGenT` (from the `// Lazy terrain ID table resolved from HexDB as string hex IDs.` comment through the closing `}` of `_getGenT`) with:

```js
  // Role -> id table, rebuilt whenever the HexDB id/type list changes (checked once per generate, not per cell).
  let _genT = null, _genSig = '';
  function _refreshGenT() {
    const entries = typeof HexDB !== 'undefined' ? HexDB.getAll() : [];
    const sig = entries.map(h => h.id + '/' + h.type).join('|');
    if (_genT && sig === _genSig) return _genT;
    _genSig = sig;
    _genT = GenUtils.resolveRoles(entries);
    return _genT;
  }
  function _getGenT() { return _genT || _refreshGenT(); }
```

and as the first statement of `_generateInto` (right after `opts = opts || {};`) add `_refreshGenT();`.

`Satellite`: replace `let _T = null;` and `_getT` with:

```js
  let _T = null;
  function _getT() {
    if (_T) return _T;
    _T = GenUtils.resolveRoles(typeof HexDB !== 'undefined' ? HexDB.getAll() : []);
    return _T;
  }
```

and as the first line of Satellite's `function open() {` add `_T = null;   // re-resolve tile classes against the current HexDB`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx playwright test tests/generation.spec.ts tests/city.spec.ts tests/placement.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gen-utils.js MapEditorPro.html tests/generation.spec.ts
git commit -m "feat(generator): resolve terrain roles through HexDB tile classes

Generator and satellite import fall back to a same-class tile when a
preferred id is missing, and the generator table refreshes when HexDB changes.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `ZonePainter`'s `_IMPASSABLE` / `_WATER_TYPES` constants and `settlementPriority1/2` still hard-code ids; this task covers the Generator and Satellite only. A class with a single plain tile makes several roles collapse onto it (by design, never an error).

---

## Verification checklist for the whole of Phase 2 and Phase 3

- [ ] `npx playwright test --reporter=line` passes with only the one `test.fixme` (K1) skipped.
- [ ] Manual smoke (record in the PR): open the editor, draw a line, a circle and a polygon; copy a region, rotate it with `.` and stamp it; save it as a stamp and reload the page; lock the terrain layer and confirm the paint tool refuses; move the city with `K`; import a grayscale PNG and watch the preview change with the sea-level slider; run the placement helper and Ctrl+Z once.
- [ ] Owner questions raised in this section: (1) is `_DIRS_*` (K1) meant to match the game? (2) does the game accept an off-centre city? (3) real ore counts and the settlement type ids for bunkers and mega cities; (4) should heightmap import overwrite the map immediately (spec) or wait for Generate (implemented)?


---

# Editor Improvement Roadmap: Phases 4, 5 and 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver roadmap phases 4 (navigation and feedback), 5 (packages UX) and 6 (quality and docs) for `MapEditorPro.html`.

**Architecture:** The editor is one vanilla-JS file. Each feature is a small IIFE module or a few functions added to an existing module (`Canvas`, `History`, `IO`, `UI`, `Packages`, `HexDB`, `BldDB`, `SpriteStore`, `Terrain`, `GitHubSync`). New modules are `Bookmarks`, `Shortcuts`, `MapValidator` (Phase 4) and, in Phase 6, `MapFormat` and `Brush` as external classic scripts under `js/`. Every task is test-first with Playwright; all GitHub and CDN traffic is mocked with `page.route`.

**Tech Stack:** Vanilla JS/HTML/CSS in `MapEditorPro.html`, Playwright (`@playwright/test`), `jszip` (dev dependency, tests only).

## Conventions that apply to every task

- Working directory: `/Users/sergii.tyshchenko/Post Apo Map Editor`, branch `dev`.
- Line numbers below were read from the file at commit `efc9f5a` (before Phase 0-3 edits). They WILL drift. **Always locate code by the quoted anchor string** (`grep -n "<anchor>" MapEditorPro.html`), never by line number alone.
- Top-level `const Canvas = ...`, `const History = ...` etc. are global lexical bindings, not `window` properties. Inside `page.evaluate` they are reachable by bare name (`Canvas.zoomIn()`), but `window.Canvas` is `undefined`. `HexDB`, `BldDB`, `SttDB`, `UpgDB` are also on `window`.
- Map cells are `mapData[row * MAP_WIDTH + col]`; settlements are `{col,row,type}`; the city is `getCityCol()/getCityRow()` (225/224 on a 450x450 map).
- Run a single spec: `npx playwright test tests/<file>.spec.ts --reporter=line`. Run everything: `npx playwright test --reporter=line`.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit commands below pass it as a second `-m`.
- Tests are TypeScript compiled to CommonJS by Playwright (no `"type": "module"` in `package.json`). Types are not checked at run time.

## Interfaces provided by other phases (assumed, not implemented here)

**T0.0 (test harness)** provides `package.json` (with `@playwright/test`), `playwright.config.ts` (web server serving the repo root, `baseURL` set), and `tests/helpers.ts` exporting:

```ts
export async function openEditor(page: Page): Promise<void>
// goto('/MapEditorPro.html'), waits until Canvas/HexDB/Packages are initialised and a fresh 450x450 map exists.
```

**Phase 0** provides (this plan only consumes them):

```js
UI.showModal({ title, bodyHtml, actions, onClose }) -> { el: HTMLElement, close(): void }
// actions: [{ label: string, kind: 'primary'|'danger'|'cancel', onClick?: () => (void|false) }]
// Clicking an action runs onClick, then closes the modal unless onClick returned false.
// onClose() runs whenever the modal closes by ANY route (action, Escape, backdrop).
// While visible the root element carries classes "modal-overlay open".
UI.toast(msg)                              // already exists
Packages.loadAllPackages() -> Promise<{ loaded: string[], failed: {id:string,error:string}[] }>
Packages.publishPackage(id)                // existing-id guard + diff + package.json written last
```

If Phase 0 landed with slightly different parameter names, adapt the call sites in this plan, not the behaviour under test.

**Phase 1** may rewrite `Canvas.drawMinimap` (cached base layer) and `History` internals (diff-based). Phase 4 only appends one overlay call at the end of the minimap base paint and only uses `History.undo/redo` publicly, so both survive such a rewrite.

**Phase 2** may add brush sizes and tools. `Shortcuts` (T4.4) reads the brush button count from the DOM, so extra sizes are picked up automatically. Run T6.4 (Brush extraction) after Phase 2 has finished touching `Brush`.

---

## Phase 4: Navigation and feedback

Adds go-to coordinates, bookmarks, a larger minimap with zone and settlement overlays, a keyboard shortcut registry with a help panel, a map validator (results list, jump to cell, gate before export), PNG export, a documented decision about the game's map format, a history panel, and (added after the T2.13 review) a narrow-window layout fix that needs an owner decision before implementation (T4.11).

### Files touched in Phase 4

| File | Change |
|---|---|
| `MapEditorPro.html` | Canvas: `parseGoto`, `centerOnTile`, `getViewCenterTile`, minimap size/overlays. New modules `Bookmarks`, `Shortcuts`, `MapValidator`. `History`: labels, `getEntries`, `jumpBy`, `onChange`. `IO`: `exportPNG`, gate calls. New HTML: goto input, bookmarks/history panels, validator panel, menu entries. |
| `tests/editor-globals.d.ts` | New: `declare const` for editor globals used in tests |
| `tests/nav-goto.spec.ts`, `nav-bookmarks.spec.ts`, `nav-minimap.spec.ts`, `shortcuts.spec.ts`, `validator-core.spec.ts`, `validator-ui.spec.ts`, `export-png.spec.ts`, `map-json-contract.spec.ts`, `history-panel.spec.ts` | New |
| `docs/superpowers/decisions/2026-10-02-game-map-format.md` | New decision record |

---

### Task T4.1: Go-to coordinates

**Files:**
- Modify: `MapEditorPro.html`
  - Canvas module: insert after `function jumpToBlock(colIdx, rowIdx) {` ... (anchor: `function _rulerColAtScreenX(screenX) {`, ~L3722).
  - Canvas return object: anchor `    jumpToBlock,` (~L3897).
  - `Canvas.init`: anchor `const blockInput = document.getElementById('block-nav-input');` (~L3372).
  - HTML `#map-tools`: anchor `title="Type block address (e.g. B:4) and press Enter">` (~L1350).
  - CSS: anchor `#minimap { display: block; width: 220px; height: 220px; }` (~L243).
- Create: `tests/editor-globals.d.ts`, `tests/nav-goto.spec.ts`

**Interfaces:**
- Consumes: `Canvas.hexCenterWorld`, `Canvas.screenToHex`, `Canvas.clampCamera`, `UI.toast`, `getCityCol/Row`, `openEditor` (T0.0).
- Produces: `Canvas.parseGoto(text) -> {col,row}|null`, `Canvas.centerOnTile(col,row) -> boolean`, `Canvas.getViewCenterTile() -> {col,row,...}`, `Canvas.gotoText(text) -> boolean`; DOM `#goto-input`.

- [ ] **Step 1: Write the failing tests**

Create `tests/editor-globals.d.ts`:

```ts
// Editor globals reachable by bare name inside page.evaluate (declared only for readability).
declare const Canvas: any, Brush: any, History: any, IO: any, UI: any, Packages: any, HexDB: any,
  BldDB: any, SpriteStore: any, Terrain: any, GitHubSync: any, ZonePainter: any, EdgeTiling: any,
  Roads: any, Bookmarks: any, Shortcuts: any, MapValidator: any, MapFormat: any, Tools: any;
declare let mapData: string[], settlements: any[], roadsData: any, objectsData: any, bridgesData: any[],
  MAP_WIDTH: number, MAP_HEIGHT: number;
declare function getCityCol(): number;
declare function getCityRow(): number;
```

Create `tests/nav-goto.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.describe('go to coordinates', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('parseGoto accepts tile and app coordinates and rejects junk', async ({ page }) => {
    const r = await page.evaluate(() => ({
      tile: Canvas.parseGoto('120, 200'),
      app: Canvas.parseGoto('app:0,0'),
      oob: Canvas.parseGoto('999,5'),
      junk: Canvas.parseGoto('hello'),
      city: { col: getCityCol(), row: getCityRow() },
    }));
    expect(r.tile).toEqual({ col: 120, row: 200 });
    expect(r.app).toEqual(r.city);
    expect(r.oob).toBeNull();
    expect(r.junk).toBeNull();
  });

  test('typing a tile address centres the view on it', async ({ page }) => {
    await page.fill('#goto-input', '120,200');
    await page.press('#goto-input', 'Enter');
    expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  });

  test('bad input is flagged and the view does not move', async ({ page }) => {
    const before = await page.evaluate(() => Canvas.getCamera());
    await page.fill('#goto-input', '9999,9999');
    await page.press('#goto-input', 'Enter');
    await expect(page.locator('#goto-input')).toHaveClass(/invalid/);
    expect(await page.evaluate(() => Canvas.getCamera())).toEqual(before);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/nav-goto.spec.ts --reporter=line`
Expected: FAIL, `TypeError: Canvas.parseGoto is not a function` and `locator('#goto-input')` not found.

- [ ] **Step 3: Implement in Canvas**

Insert before `function _rulerColAtScreenX(screenX) {`:

```js
  // ── Go to coordinates ────────────────────────────────────
  function _inBounds(col, row) {
    return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT;
  }

  // Accepts "col,row" (editor tile coordinates) or "app:x,y" (Unity swizzled coordinates, the same
  // numbers the status bar shows in "App:"). Returns {col,row}, or null when malformed / outside the map.
  function parseGoto(text) {
    const s = String(text || '').trim().toLowerCase();
    let m = s.match(/^(-?\d+)\s*[, ]\s*(-?\d+)$/);
    if (m) {
      const col = +m[1], row = +m[2];
      return _inBounds(col, row) ? { col, row } : null;
    }
    m = s.match(/^app\s*:\s*(-?\d+)\s*[, ]\s*(-?\d+)$/);
    if (m) {
      const appX = +m[1], appY = +m[2];
      const row = MAP_HEIGHT - 1 - (appX + Math.floor(MAP_HEIGHT / 2));  // inverse of the status-bar formula
      const col = appY + Math.floor(MAP_WIDTH / 2);
      return _inBounds(col, row) ? { col, row } : null;
    }
    return null;
  }

  function centerOnTile(col, row) {
    if (!_inBounds(col, row)) return false;
    const scale = zoom / 100;
    const w = hexCenterWorld(col, row);
    cameraX = w.x * scale - canvas.width  / 2;
    cameraY = w.y * scale - canvas.height / 2;
    clampCamera();
    render();
    drawMinimap();
    return true;
  }

  function getViewCenterTile() { return screenToHex(canvas.width / 2, canvas.height / 2); }

  function gotoText(text) {
    const t = parseGoto(text);
    return t ? centerOnTile(t.col, t.row) : false;
  }

```

Export: replace `    jumpToBlock,` in the Canvas return object with:

```js
    jumpToBlock, parseGoto, centerOnTile, getViewCenterTile, gotoText,
```

In `Canvas.init`, immediately before `const blockInput = document.getElementById('block-nav-input');` insert:

```js
    const gotoInput = document.getElementById('goto-input');
    if (gotoInput) {
      gotoInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const ok = gotoText(gotoInput.value);
        gotoInput.classList.toggle('invalid', !ok);
        if (ok) gotoInput.blur();
        else UI.toast('⚠ Use "col,row" or "app:x,y" inside the map');
      });
      gotoInput.addEventListener('input', () => gotoInput.classList.remove('invalid'));
    }
```

HTML: after the `<input id="block-nav-input" ...>` element (ends with `title="Type block address (e.g. B:4) and press Enter">`) add:

```html
      <span style="color:#888;font-size:11px;margin-left:8px">Go to:</span>
      <input id="goto-input" type="text" placeholder="col,row"
        style="width:78px;background:#111;border:1px solid #444;color:#4fc3f7;font-size:11px;padding:2px 4px;border-radius:3px;font-family:monospace;text-align:center"
        title='Tile "col,row" or Unity app coordinates "app:x,y", then Enter (shortcut: G)'>
```

CSS: after the `#minimap { ... }` rule add:

```css
#goto-input.invalid { border-color: #f38ba8 !important; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/nav-goto.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/editor-globals.d.ts tests/nav-goto.spec.ts
git commit -m "feat(nav): go-to coordinates box and Canvas.centerOnTile" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the `app:x,y` inverse must round-trip with the status-bar formula (checked by the city test); out-of-range input must never move the camera.

---

### Task T4.2: Bookmarks

**Files:**
- Modify: `MapEditorPro.html`
  - New `Bookmarks` module: insert immediately above the comment line `// BRUSH MODULE — size/shape, hex neighbor expansion` (the `// ═══` banner line before it belongs with it; insert above that banner), ~L3918.
  - HTML: insert before `<div id="right-active-terrain">` (~L1439).
  - CSS: after `#brush-sizes { display: flex; gap: 6px; }` (~L250).
  - Init: anchor `  Tools.init();\n  History.initKeyboard();` in the `window.addEventListener('load'` handler (~L12821).
- Create: `tests/nav-bookmarks.spec.ts`

**Interfaces:**
- Consumes: `Canvas.getViewCenterTile`, `Canvas.centerOnTile`, `Canvas.getZoom`, `Canvas.setZoom`, `UI.toast`.
- Produces: `Bookmarks.init()`, `.add(name?) -> id|null`, `.remove(id)`, `.go(id) -> boolean`, `.list() -> [{id,name,col,row,zoom}]`, `.render()`; localStorage key `map_bookmarks`; DOM `#bm-add-btn`, `#bookmarks-list .bm-go`, `.bm-del`.
- Decision: bookmarks are per browser (localStorage), not stored in the map JSON, so the map format is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test('add, jump to, persist and delete a bookmark', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { Canvas.setZoom(100); Canvas.centerOnTile(120, 200); });
  await page.click('#bm-add-btn');
  await expect(page.locator('#bookmarks-list .bm-go')).toHaveCount(1);

  await page.evaluate(() => Canvas.centerOnCity());
  await page.click('#bookmarks-list .bm-go');
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });

  await page.reload();
  await page.waitForFunction(() => Bookmarks.list().length === 1);
  await page.click('#bookmarks-list .bm-del');
  await expect(page.locator('#bookmarks-list .bm-go')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('map_bookmarks') || '[]'))).toEqual([]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/nav-bookmarks.spec.ts --reporter=line`
Expected: FAIL, `locator('#bm-add-btn')` not found (timeout).

- [ ] **Step 3: Implement**

Module (insert above the Brush banner):

```js
// ════════════════════════════════════════════════════════════
// BOOKMARKS — saved view positions (per browser, localStorage)
// ════════════════════════════════════════════════════════════
const Bookmarks = (() => {
  const LS_KEY = 'map_bookmarks';
  let _list = [];

  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _load() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      _list = Array.isArray(a) ? a.filter(b => b && Number.isInteger(b.col) && Number.isInteger(b.row)) : [];
    } catch (e) { _list = []; }
  }
  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_list)); }
    catch (e) { UI.toast('⚠ Could not save bookmarks: ' + e.message); }
  }

  function list() { return _list.map(b => ({ ...b })); }

  function add(name) {
    const c = Canvas.getViewCenterTile();
    if (!c || c.col < 0 || c.col >= MAP_WIDTH || c.row < 0 || c.row >= MAP_HEIGHT) { UI.toast('⚠ Nothing to bookmark here'); return null; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const bm = { id, name: (name || `${c.col},${c.row}`).trim(), col: c.col, row: c.row, zoom: Canvas.getZoom() };
    _list.push(bm);
    _save();
    render();
    UI.toast(`Bookmarked ${bm.name}`);
    return id;
  }

  function remove(id) {
    _list = _list.filter(b => b.id !== id);
    _save();
    render();
  }

  function go(id) {
    const b = _list.find(x => x.id === id);
    if (!b) return false;
    Canvas.setZoom(b.zoom);
    return Canvas.centerOnTile(b.col, b.row);
  }

  function render() {
    const el = document.getElementById('bookmarks-list');
    if (!el) return;
    el.innerHTML = _list.length
      ? _list.map(b => `<div class="bm-row"><button class="bm-go" data-id="${_esc(b.id)}" title="Jump to ${b.col},${b.row} at ${b.zoom}%">🔖 ${_esc(b.name)}</button><button class="bm-del" data-id="${_esc(b.id)}" title="Delete bookmark">✕</button></div>`).join('')
      : '<div class="bm-empty">No bookmarks yet. Press Shift+B to add one.</div>';
  }

  function init() {
    _load();
    const el = document.getElementById('bookmarks-list');
    if (el) el.addEventListener('click', e => {
      const goBtn = e.target.closest('.bm-go'), delBtn = e.target.closest('.bm-del');
      if (goBtn) go(goBtn.dataset.id);
      else if (delBtn) remove(delBtn.dataset.id);
    });
    render();
  }

  return { init, add, remove, go, list, render };
})();

```

HTML (before `<div id="right-active-terrain">`):

```html
      <div id="bookmarks-panel" class="side-panel">
        <div class="section-title">Bookmarks
          <button class="hexdb-tool-btn" id="bm-add-btn" onclick="Bookmarks.add()" title="Bookmark the current view (Shift+B)">+</button>
        </div>
        <div id="bookmarks-list"></div>
      </div>
```

CSS (after `#brush-sizes { display: flex; gap: 6px; }`):

```css
.side-panel { padding: 10px; border-bottom: 1px solid var(--border); }
.side-panel .section-title { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
.bm-row { display: flex; gap: 4px; margin-bottom: 3px; }
.bm-go { flex: 1; text-align: left; background: var(--hover); border: 1px solid var(--border); color: var(--text); border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-del { background: none; border: none; color: var(--muted); cursor: pointer; }
.bm-empty { color: var(--muted); font-size: 11px; }
```

Init: replace `  Tools.init();\n  History.initKeyboard();` with `  Tools.init();\n  Bookmarks.init();\n  History.initKeyboard();`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/nav-bookmarks.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/nav-bookmarks.spec.ts
git commit -m "feat(nav): bookmarks panel persisted in localStorage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `localStorage` writes are wrapped (quota); bookmarks never touch the map JSON; the `.side-panel` CSS is reused by T4.10.

---

### Task T4.3: Bigger minimap with zones and settlements

**Files:**
- Modify: `MapEditorPro.html`
  - Canvas: new state/functions above `// ── Minimap ──` (anchor: `  function drawMinimap() {`, ~L3226); call site: anchor `    mCtx.putImageData(imgD, 0, 0);\n\n    // Viewport rect`; Canvas return object (anchor `toggleZones, hexDist, setSelectedSlot,`).
  - HTML: inside `<div id="minimap-container">` (~L1427).
  - CSS: after `#minimap { display: block; ... }` (~L243).
- Create: `tests/nav-minimap.spec.ts`

**Interfaces:**
- Consumes: `ZonePainter.getZoneLayer()` (Uint8Array, index `row*W+col`, 0 = no zone), `ZonePainter.getZones()` (`[{id,name,color:'#rrggbb'}]`), global `settlements`.
- Produces: `Canvas.toggleMinimapSize()`, `Canvas.isMinimapBig()`, `Canvas.toggleMinimapOverlay('zones'|'settlements')`; `body.minimap-big`; minimap canvas becomes 340x340.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

// Reads one minimap pixel for a map cell (same axis flip as Canvas.drawMinimap).
async function minimapPixel(page, col: number, row: number) {
  return page.evaluate(([c, r]) => {
    const mc = document.getElementById('minimap') as HTMLCanvasElement;
    const x = Math.floor((MAP_HEIGHT - 1 - r + 0.5) / MAP_HEIGHT * mc.width);
    const y = Math.floor((MAP_WIDTH - 1 - c + 0.5) / MAP_WIDTH * mc.height);
    return Array.from(mc.getContext('2d')!.getImageData(x, y, 1, 1).data);
  }, [col, row]);
}

test.describe('minimap', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('toggle enlarges the canvas and the grid column', async ({ page }) => {
    await page.evaluate(() => Canvas.toggleMinimapSize());
    await expect(page.locator('body')).toHaveClass(/minimap-big/);
    expect(await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width)).toBe(340);
    await page.evaluate(() => Canvas.toggleMinimapSize());
    expect(await page.evaluate(() => (document.getElementById('minimap') as HTMLCanvasElement).width)).toBe(220);
  });

  test('non-city settlements are drawn as yellow dots', async ({ page }) => {
    await page.evaluate(() => { settlements.push({ col: 100, row: 100, type: 'settlement' }); Canvas.drawMinimap(); });
    const [r, g, b] = await minimapPixel(page, 100, 100);
    expect(r).toBeGreaterThan(200); expect(g).toBeGreaterThan(170); expect(b).toBeLessThan(120);
  });

  test('zone cells are tinted with the zone colour and the toggle removes it', async ({ page }) => {
    await page.evaluate(() => {
      const id = ZonePainter.addZone('Red', '#ff0000');
      const zl = ZonePainter.getZoneLayer();
      for (let r = 80; r < 140; r++) for (let c = 80; c < 140; c++) zl[r * MAP_WIDTH + c] = id;
      Canvas.drawMinimap();
    });
    let [r, g] = await minimapPixel(page, 110, 110);
    expect(r - g).toBeGreaterThan(40);
    await page.click('#btn-mm-zones');
    [r, g] = await minimapPixel(page, 110, 110);
    expect(r - g).toBeLessThan(40);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/nav-minimap.spec.ts --reporter=line`
Expected: FAIL, `Canvas.toggleMinimapSize is not a function`.

- [ ] **Step 3: Implement**

Canvas, insert above `  function drawMinimap() {`:

```js
  // ── Minimap size + overlays ─────────────────────────────
  const MM_SMALL = 220, MM_BIG = 340;
  let _mmBig = false;
  const _mmOverlay = { zones: true, settlements: true };

  function toggleMinimapSize() {
    _mmBig = !_mmBig;
    const mc = document.getElementById('minimap');
    mc.width = mc.height = _mmBig ? MM_BIG : MM_SMALL;
    document.body.classList.toggle('minimap-big', _mmBig);
    window.dispatchEvent(new Event('resize'));   // re-measures the map canvas and redraws the minimap
  }
  function isMinimapBig() { return _mmBig; }

  function toggleMinimapOverlay(which) {
    if (!(which in _mmOverlay)) return;
    _mmOverlay[which] = !_mmOverlay[which];
    const btn = document.getElementById(which === 'zones' ? 'btn-mm-zones' : 'btn-mm-settle');
    if (btn) btn.classList.toggle('active', _mmOverlay[which]);
    drawMinimap();
  }

  function _hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Same axis flip as the terrain loop in drawMinimap: px -> row (flipped), py -> col (flipped).
  function _drawMinimapOverlays(mCtx, mw, mh) {
    if (_mmOverlay.zones && typeof ZonePainter !== 'undefined') {
      const zl = ZonePainter.getZoneLayer(), zones = ZonePainter.getZones();
      if (zl && zl.length === MAP_WIDTH * MAP_HEIGHT && zones.length) {
        const rgb = {};
        zones.forEach(z => { rgb[z.id] = _hexRgb(z.color); });
        const imgD = mCtx.createImageData(mw, mh);
        for (let py = 0; py < mh; py++) {
          for (let px = 0; px < mw; px++) {
            const row = MAP_HEIGHT - 1 - Math.floor(px / mw * MAP_HEIGHT);
            const col = MAP_WIDTH  - 1 - Math.floor(py / mh * MAP_WIDTH);
            const c = rgb[zl[row * MAP_WIDTH + col]];
            if (!c) continue;
            const i = (py * mw + px) * 4;
            imgD.data[i] = c[0]; imgD.data[i+1] = c[1]; imgD.data[i+2] = c[2]; imgD.data[i+3] = 255;
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = mw; tmp.height = mh;
        tmp.getContext('2d').putImageData(imgD, 0, 0);
        mCtx.save(); mCtx.globalAlpha = 0.35; mCtx.drawImage(tmp, 0, 0); mCtx.restore();
      }
    }
    if (_mmOverlay.settlements) {
      mCtx.fillStyle = '#ffd54f'; mCtx.strokeStyle = '#000'; mCtx.lineWidth = 0.5;
      const r = _mmBig ? 2.5 : 2;
      settlements.forEach(s => {
        if (s.type === 'city') return;              // the city dot is drawn later, in white
        const x = (MAP_HEIGHT - 1 - s.row + 0.5) / MAP_HEIGHT * mw;
        const y = (MAP_WIDTH  - 1 - s.col + 0.5) / MAP_WIDTH  * mh;
        mCtx.beginPath(); mCtx.arc(x, y, r, 0, Math.PI * 2); mCtx.fill(); mCtx.stroke();
      });
    }
  }

```

Call site: replace

```js
    mCtx.putImageData(imgD, 0, 0);

    // Viewport rect
```

with

```js
    mCtx.putImageData(imgD, 0, 0);
    _drawMinimapOverlays(mCtx, mw, mh);

    // Viewport rect
```

Return object: replace `toggleZones, hexDist, setSelectedSlot,` with `toggleZones, hexDist, setSelectedSlot, toggleMinimapSize, isMinimapBig, toggleMinimapOverlay,`.

HTML, inside `<div id="minimap-container">` after the `<canvas id="minimap" ...>` line:

```html
        <button id="btn-minimap-size" class="mm-btn" onclick="Canvas.toggleMinimapSize()" title="Enlarge or shrink the minimap (M)">⤢</button>
        <button id="btn-mm-zones" class="mm-btn active" style="right:30px" onclick="Canvas.toggleMinimapOverlay('zones')" title="Show zones on the minimap">Z</button>
        <button id="btn-mm-settle" class="mm-btn active" style="right:56px" onclick="Canvas.toggleMinimapOverlay('settlements')" title="Show settlements on the minimap">S</button>
```

CSS (after the `#minimap` rule):

```css
body.minimap-big #main { grid-template-columns: 220px 1fr 340px; }
body.minimap-big #minimap-container { width: 340px; height: 340px; }
body.minimap-big #minimap { width: 340px; height: 340px; }
.mm-btn { position: absolute; top: 4px; right: 4px; width: 22px; height: 20px; padding: 0; font-size: 11px; line-height: 1; cursor: pointer;
          background: rgba(0,0,0,0.55); color: #cdd6f4; border: 1px solid #45475a; border-radius: 3px; opacity: .55; }
.mm-btn.active, #btn-minimap-size { opacity: 1; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/nav-minimap.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/nav-minimap.spec.ts
git commit -m "feat(minimap): enlargeable minimap with zone and settlement overlays" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** zone overlay pass is O(minimap pixels) and only runs when zones exist; if Phase 1 caches the minimap, keep `_drawMinimapOverlays` after the cached base blit.

---

### Task T4.4: Shortcut registry and help panel

**Files:**
- Modify: `MapEditorPro.html`
  - New `Shortcuts` module: insert immediately above the comment line `// ── App: mode switching ────────────────────────────────────` (~L8259).
  - Init: in the `window.addEventListener('load'` handler, anchor `  IO.initKeyboard();` (~L12823).
  - View menu: anchor `<button onclick="Canvas.fitToScreen()">Fit Map</button>` (~L1237).
  - CSS: after the `.bm-empty` rule from T4.2.
- Create: `tests/shortcuts.spec.ts`

**Interfaces:**
- Consumes: `Canvas.zoomIn/zoomOut/fitToScreen/centerOnCity/toggleZones/toggleRulers/toggleCoastline/toggleMinimapSize`, `Brush.getSize/setSize`, `Bookmarks.add`, `UI.showModal` (Phase 0), `UI.toast`.
- Produces: `Shortcuts.register(def)`, `Shortcuts.getAll() -> [{id,group,keys,display,label,global?,bound}]`, `Shortcuts.showHelp()`, `Shortcuts.init()`. `def = { id, group, keys: string[] (exact KeyboardEvent.key values), display, label, global?: boolean, run?: (e) => void }`. Entries without `run` are documentation only (existing handlers keep working).

Key map: `+`/`=` zoom in, `-` zoom out, `0` fit map, `C` centre on city, `[` / `]` brush size, `1` distance rings, `2` rulers, `3` coastline, `G` go to, `M` minimap size, `Shift+B` add bookmark, `?` help (any tab). Tool keys P F R E S T D Z stay with `Tools.init`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.describe('shortcuts', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('zoom keys', async ({ page }) => {
    await page.evaluate(() => Canvas.setZoom(100));
    await page.keyboard.press('+');
    expect(await page.evaluate(() => Canvas.getZoom())).toBe(110);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    expect(await page.evaluate(() => Canvas.getZoom())).toBe(90);
  });

  test('bracket keys change and clamp brush size', async ({ page }) => {
    await page.evaluate(() => Brush.setSize(0));
    await page.keyboard.press(']');
    expect(await page.evaluate(() => Brush.getSize())).toBe(1);
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
  });

  test('1 toggles distance rings', async ({ page }) => {
    await expect(page.locator('#btn-zones')).not.toHaveClass(/active/);
    await page.keyboard.press('1');
    await expect(page.locator('#btn-zones')).toHaveClass(/active/);
  });

  test('G focuses the go-to box and M toggles the minimap, but not while typing', async ({ page }) => {
    await page.keyboard.press('g');
    await expect(page.locator('#goto-input')).toBeFocused();
    await page.keyboard.type('m');                       // typed into the input, must not toggle
    await expect(page.locator('body')).not.toHaveClass(/minimap-big/);
    await page.keyboard.press('Escape');
    await page.locator('#goto-input').blur();
    await page.keyboard.press('m');
    await expect(page.locator('body')).toHaveClass(/minimap-big/);
  });

  test('? opens a help panel listing every registered shortcut', async ({ page }) => {
    await page.keyboard.press('?');
    const help = page.locator('.shortcut-help').first();
    await expect(help).toBeVisible();
    const labels: string[] = await page.evaluate(() => Shortcuts.getAll().map((d: any) => d.label));
    expect(labels.length).toBeGreaterThan(15);
    const text = await page.locator('.shortcut-help-body').innerText();
    for (const l of labels) expect(text).toContain(l);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/shortcuts.spec.ts --reporter=line`
Expected: FAIL, first test gets zoom `100` instead of `110`; the last fails with `Shortcuts is not defined`.

- [ ] **Step 3: Implement the module**

Insert above `// ── App: mode switching ────────────────────────────────────`:

```js
// ════════════════════════════════════════════════════════════
// SHORTCUTS — one registry drives key handling AND the help panel
// ════════════════════════════════════════════════════════════
const Shortcuts = (() => {
  const _defs = [];

  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function register(def) {
    const i = _defs.findIndex(d => d.id === def.id);
    if (i >= 0) _defs[i] = def; else _defs.push(def);
  }
  function getAll() { return _defs.map(({ run, ...d }) => ({ ...d, bound: !!run })); }

  function _blocked(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return true;
    if (document.querySelector('.modal-overlay.open')) return true;
    return false;
  }

  function _onKey(e) {
    if (_blocked(e)) return;
    const def = _defs.find(d => d.run && d.keys.includes(e.key) &&
                                (d.global || document.body.classList.contains('mode-map')));
    if (!def) return;
    e.preventDefault();
    def.run(e);
  }

  function _brushStep(d) {
    const max = document.querySelectorAll('.brush-btn').length - 1;
    Brush.setSize(Math.max(0, Math.min(max, Brush.getSize() + d)));
    UI.toast(`Brush size ${Brush.getSize()}`);
  }

  function showHelp() {
    const groups = {};
    getAll().forEach(d => { (groups[d.group] = groups[d.group] || []).push(d); });
    const html = Object.entries(groups).map(([g, rows]) =>
      `<h4>${_esc(g)}</h4><table class="shortcut-help">${rows.map(d =>
        `<tr><td><kbd>${_esc(d.display)}</kbd></td><td>${_esc(d.label)}</td></tr>`).join('')}</table>`).join('');
    UI.showModal({ title: 'Keyboard shortcuts', bodyHtml: `<div class="shortcut-help-body">${html}</div>`,
                   actions: [{ label: 'Close', kind: 'cancel' }] });
  }

  function init() {
    const doc = (id, group, key, label) =>        // documentation-only: Tools.init / IO.initKeyboard handle these keys
      register({ id, group, keys: [key, key.toUpperCase()], display: key.length === 1 ? key.toUpperCase() : key, label });
    doc('tool-paint', 'Tools', 'p', 'Paint tool');       doc('tool-fill', 'Tools', 'f', 'Fill tool');
    doc('tool-rect', 'Tools', 'r', 'Rectangle tool');    doc('tool-eye', 'Tools', 'e', 'Eyedropper');
    doc('tool-select', 'Tools', 's', 'Select tile');     doc('tool-settle', 'Tools', 't', 'Place settlement');
    doc('tool-erase', 'Tools', 'd', 'Erase settlement'); doc('tool-zone', 'Tools', 'z', 'Zone painter');
    register({ id: 'undo', group: 'Edit', keys: [], display: 'Ctrl+Z', label: 'Undo' });
    register({ id: 'redo', group: 'Edit', keys: [], display: 'Ctrl+Y', label: 'Redo' });
    register({ id: 'file-save', group: 'File', keys: [], display: 'Ctrl+S', label: 'Save map' });

    register({ id: 'zoom-in',  group: 'View', keys: ['+', '='], display: '+', label: 'Zoom in',  run: () => Canvas.zoomIn() });
    register({ id: 'zoom-out', group: 'View', keys: ['-', '_'], display: '-', label: 'Zoom out', run: () => Canvas.zoomOut() });
    register({ id: 'fit-map',  group: 'View', keys: ['0'], display: '0', label: 'Fit map to screen', run: () => Canvas.fitToScreen() });
    register({ id: 'center-city', group: 'View', keys: ['c', 'C'], display: 'C', label: 'Centre on city', run: () => Canvas.centerOnCity() });
    register({ id: 'brush-smaller', group: 'Brush', keys: ['['], display: '[', label: 'Smaller brush', run: () => _brushStep(-1) });
    register({ id: 'brush-larger',  group: 'Brush', keys: [']'], display: ']', label: 'Larger brush',  run: () => _brushStep(+1) });
    register({ id: 'ov-rings',  group: 'Overlays', keys: ['1'], display: '1', label: 'Toggle distance rings', run: () => Canvas.toggleZones() });
    register({ id: 'ov-rulers', group: 'Overlays', keys: ['2'], display: '2', label: 'Toggle block rulers',   run: () => Canvas.toggleRulers() });
    register({ id: 'ov-coast',  group: 'Overlays', keys: ['3'], display: '3', label: 'Toggle coastline preview', run: () => Canvas.toggleCoastline() });
    register({ id: 'goto', group: 'Navigate', keys: ['g', 'G'], display: 'G', label: 'Go to coordinates',
               run: () => { const i = document.getElementById('goto-input'); if (i) { i.focus(); i.select(); } } });
    register({ id: 'minimap-size', group: 'Navigate', keys: ['m', 'M'], display: 'M', label: 'Enlarge or shrink minimap', run: () => Canvas.toggleMinimapSize() });
    register({ id: 'bookmark-add', group: 'Navigate', keys: ['B'], display: 'Shift+B', label: 'Add bookmark here', run: () => Bookmarks.add() });
    register({ id: 'help', group: 'Help', keys: ['?'], display: '?', label: 'Show this shortcut list', global: true, run: () => showHelp() });
    window.addEventListener('keydown', _onKey);
  }

  return { init, register, getAll, showHelp };
})();

```

Init: replace `  IO.initKeyboard();` (in the load handler) with `  IO.initKeyboard();\n  Shortcuts.init();`.

View menu: after `<button onclick="Canvas.fitToScreen()">Fit Map</button>` add:

```html
        <div class="separator"></div>
        <button onclick="Shortcuts.showHelp()">Keyboard Shortcuts <span class="menu-shortcut">?</span></button>
```

CSS:

```css
.shortcut-help-body h4 { margin: 10px 0 4px; font-size: 12px; color: var(--accent); }
.shortcut-help { border-collapse: collapse; font-size: 12px; width: 100%; }
.shortcut-help td { padding: 2px 8px 2px 0; }
.shortcut-help kbd { background: var(--hover); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; font-family: monospace; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/shortcuts.spec.ts --reporter=line`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/shortcuts.spec.ts
git commit -m "feat(shortcuts): registry-driven zoom, brush and overlay keys plus help panel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** shortcuts never fire while an input/select has focus or a `.modal-overlay.open` exists; `Tools` still owns P/F/R/E/S/T/D/Z (no double handling).

---

### Task T4.5: Map validator core (pure logic)

**Files:**
- Modify: `MapEditorPro.html`: new `MapValidator` module, insert above `// ── App: mode switching ────────────────────────────────────` (after `Shortcuts` from T4.4).
- Create: `tests/validator-core.spec.ts`

**Interfaces:**
- Consumes: `HexDB.getAll()`, `BldDB.getAll()`, `Terrain.getSprite(id)`, `Roads.getNeighbors(col,row)`, globals `mapData`, `settlements`, `roadsData`, `objectsData`, `bridgesData`, `MAP_WIDTH/HEIGHT`, `getCityCol/Row`.
- Produces: `MapValidator.validate(state) -> issues[]`, `MapValidator.collectState() -> state`, `MapValidator.run() -> issues[]`. `issue = { code, severity: 'error'|'warning', col, row, message }` with codes `unknown-id`, `unknown-object`, `missing-city`, `city-off-center`, `unreachable-settlement`, `orphan-road`, `missing-sprite`. `state = { width, height, data, settlements, roads, objects, bridges, hexById: Map<lowercaseId,entry>, bldById: Map, needRoad: Set<lowercaseId>, cityCol, cityRow, hasSprite(id), neighbors(col,row) }`.
- Impassable terrain: HexDB `type` `Water` or `Rivers` (a bridge on the cell makes it passable) and ids `mountain_1`, `lava_plain_1`, `lava_rift_1`, `rift_1` (mirrors `impassableIds` in `Generator`). Change `IMPASSABLE_TYPES/IDS` if the game rules differ.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

// Builds a 5x5 synthetic state (4-neighbour grid) and lets each test tweak it.
const run = (page, tweak: string) => page.evaluate((src) => {
  const W = 5, H = 5;
  const plain = { id: 'Plain_1', type: 'Plains', spriteName: 'Plain_1' };
  const water = { id: 'Water_1', type: 'Water', spriteName: 'Water_1' };
  const st: any = {
    width: W, height: H, data: new Array(W * H).fill('Plain_1'),
    settlements: [{ col: 2, row: 2, type: 'city' }], roads: {}, objects: {}, bridges: [],
    hexById: new Map([['plain_1', plain], ['water_1', water]]), bldById: new Map(), needRoad: new Set(),
    cityCol: 2, cityRow: 2, hasSprite: () => true,
    neighbors: (c: number, r: number) => [[c+1,r],[c-1,r],[c,r+1],[c,r-1]]
      .filter(([x, y]) => x >= 0 && x < W && y >= 0 && y < H).map(([col, row]) => ({ col, row })),
  };
  new Function('st', src)(st);
  return MapValidator.validate(st).map((i: any) => ({ code: i.code, severity: i.severity, col: i.col, row: i.row, message: i.message }));
}, tweak);

test.describe('MapValidator.validate', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('a clean map has no issues', async ({ page }) => {
    expect(await run(page, '')).toEqual([]);
  });

  test('unknown ids are aggregated per id and reported as errors', async ({ page }) => {
    const issues = await run(page, "st.data[0]='Nope_1'; st.data[7]='Nope_1';");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-id', severity: 'error', col: 0, row: 0 });
    expect(issues[0].message).toContain('2 cells');
  });

  test('missing city is an error', async ({ page }) => {
    const issues = await run(page, "st.settlements = [];");
    expect(issues.map(i => i.code)).toEqual(['missing-city']);
    expect(issues[0].severity).toBe('error');
  });

  test('a settlement walled in by water is unreachable', async ({ page }) => {
    const issues = await run(page,
      "st.settlements.push({col:4,row:4,type:'settlement'}); st.data[3*5+4]='Water_1'; st.data[4*5+3]='Water_1';");
    expect(issues).toEqual([expect.objectContaining({ code: 'unreachable-settlement', col: 4, row: 4, severity: 'warning' })]);
  });

  test('a river wall cuts settlements off unless a bridge crosses it', async ({ page }) => {
    const wall = "st.settlements.push({col:4,row:2,type:'settlement'}); for (let r=0;r<5;r++) st.data[r*5+3]='Water_1';";
    expect((await run(page, wall)).map(i => i.code)).toEqual(['unreachable-settlement']);
    expect(await run(page, wall + " st.bridges=[{col:3,row:2}];")).toEqual([]);
  });

  test('road touching nothing is orphaned; road next to the city is fine', async ({ page }) => {
    const issues = await run(page, "st.roads['0,0']={type:1}; st.roads['2,1']={type:1};");
    expect(issues).toEqual([expect.objectContaining({ code: 'orphan-road', col: 0, row: 0 })]);
  });

  test('tiles without a loaded sprite are reported once per id', async ({ page }) => {
    const issues = await run(page, "st.hasSprite = () => false;");
    expect(issues).toEqual([expect.objectContaining({ code: 'missing-sprite', severity: 'warning' })]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/validator-core.spec.ts --reporter=line`
Expected: FAIL, `ReferenceError: MapValidator is not defined`.

- [ ] **Step 3: Implement**

Insert above `// ── App: mode switching ────────────────────────────────────`:

```js
// ════════════════════════════════════════════════════════════
// MAP VALIDATOR — pure checks over a state snapshot (UI added in T4.6)
// ════════════════════════════════════════════════════════════
const MapValidator = (() => {
  // Terrain a unit cannot walk over. A bridge on the cell makes water/rivers passable.
  const IMPASSABLE_TYPES = new Set(['Water', 'Rivers']);
  const IMPASSABLE_IDS   = new Set(['mountain_1', 'lava_plain_1', 'lava_rift_1', 'rift_1']);

  function validate(st) {
    const issues = [];
    const W = st.width, H = st.height;
    const lc = s => String(s).toLowerCase();
    const entryOf = id => st.hexById.get(lc(id)) || st.bldById.get(lc(id)) || null;

    // 1. Unknown ids (aggregated per id so a bad palette does not produce 200k rows)
    const unknown = new Map();
    for (let i = 0; i < st.data.length; i++) {
      const id = st.data[i];
      if (entryOf(id)) continue;
      const u = unknown.get(id);
      if (u) u.count++; else unknown.set(id, { count: 1, col: i % W, row: Math.floor(i / W) });
    }
    unknown.forEach((u, id) => issues.push({ code: 'unknown-id', severity: 'error', col: u.col, row: u.row,
      message: `Unknown tile id "${id}" (${u.count} cell${u.count > 1 ? 's' : ''}): not in HexDB or BldDB` }));
    Object.entries(st.objects).forEach(([key, id]) => {
      if (entryOf(id)) return;
      const [c, r] = key.split(',').map(Number);
      issues.push({ code: 'unknown-object', severity: 'error', col: c, row: r, message: `Unknown building id "${id}" at ${c},${r}` });
    });

    // 2. City
    const city = st.settlements.find(s => s.type === 'city');
    if (!city) {
      issues.push({ code: 'missing-city', severity: 'error', col: st.cityCol, row: st.cityRow, message: 'Map has no city settlement' });
    } else if (city.col !== st.cityCol || city.row !== st.cityRow) {
      issues.push({ code: 'city-off-center', severity: 'warning', col: city.col, row: city.row,
        message: `City is at ${city.col},${city.row}, not at the map centre ${st.cityCol},${st.cityRow}` });
    }

    // 3. Unreachable settlements: BFS from the city over passable cells
    if (city) {
      const bridgeKeys = new Set((st.bridges || []).map(b => b.col + ',' + b.row));
      const passable = (c, r) => {
        if (bridgeKeys.has(c + ',' + r)) return true;
        const id = st.data[r * W + c], e = entryOf(id);
        return !(IMPASSABLE_IDS.has(lc(id)) || (e && IMPASSABLE_TYPES.has(e.type)));
      };
      const seen = new Uint8Array(W * H);
      const queue = [[city.col, city.row]];
      seen[city.row * W + city.col] = 1;
      for (let head = 0; head < queue.length; head++) {
        const [c, r] = queue[head];
        for (const n of st.neighbors(c, r)) {
          const k = n.row * W + n.col;
          if (seen[k] || !passable(n.col, n.row)) continue;
          seen[k] = 1;
          queue.push([n.col, n.row]);
        }
      }
      st.settlements.forEach(s => {
        if (s !== city && !seen[s.row * W + s.col])
          issues.push({ code: 'unreachable-settlement', severity: 'warning', col: s.col, row: s.row,
            message: `Settlement at ${s.col},${s.row} cannot be reached from the city` });
      });
    }

    // 4. Orphan roads (same "road-like neighbour" rule as Roads._isRoadLikeNeighbor)
    const settleKeys = new Set(st.settlements.map(s => s.col + ',' + s.row));
    const roadLike = (c, r) => {
      const k = c + ',' + r;
      return !!st.roads[k] || settleKeys.has(k) || (c === st.cityCol && r === st.cityRow) ||
             st.needRoad.has(lc(st.objects[k] || ''));
    };
    Object.keys(st.roads).forEach(k => {
      const [c, r] = k.split(',').map(Number);
      if (!st.neighbors(c, r).some(n => roadLike(n.col, n.row)))
        issues.push({ code: 'orphan-road', severity: 'warning', col: c, row: r, message: `Road at ${c},${r} connects to nothing` });
    });

    // 5. Missing sprites (once per distinct id)
    for (const id of new Set(st.data)) {
      const e = entryOf(id);
      if (!e || !e.spriteName || st.hasSprite(id)) continue;
      const i = st.data.indexOf(id);
      issues.push({ code: 'missing-sprite', severity: 'warning', col: i % W, row: Math.floor(i / W),
        message: `Tile "${id}" has no loaded sprite (spriteName "${e.spriteName}")` });
    }

    issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    return issues;
  }

  function collectState() {
    const lc = s => String(s).toLowerCase();
    const hexById = new Map(), bldById = new Map();
    HexDB.getAll().forEach(h => { if (h.id) hexById.set(lc(h.id), h); });
    const blds = BldDB.getAll();
    blds.forEach(b => { if (b.id) bldById.set(lc(b.id), b); });
    return {
      width: MAP_WIDTH, height: MAP_HEIGHT, data: mapData,
      settlements, roads: roadsData, objects: objectsData, bridges: bridgesData,
      hexById, bldById,
      needRoad: new Set(blds.filter(b => b.needRoad).map(b => lc(b.id))),
      cityCol: getCityCol(), cityRow: getCityRow(),
      hasSprite: id => !!Terrain.getSprite(id),
      neighbors: (c, r) => Roads.getNeighbors(c, r),
    };
  }

  function run() { return validate(collectState()); }

  return { validate, collectState, run, IMPASSABLE_TYPES, IMPASSABLE_IDS };
})();

```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/validator-core.spec.ts --reporter=line`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/validator-core.spec.ts
git commit -m "feat(validator): pure map validation core" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** BFS uses an index-walked array (no `shift`) and a typed `seen` array; the passable rule matches the game's rules (confirm rivers/mountains with the owner).

---

### Task T4.6: Validator results panel with jump-to-cell

**Files:**
- Modify: `MapEditorPro.html`
  - `MapValidator`: add panel functions and export (same module as T4.5).
  - HTML: before `<!-- Toast container -->` (~L1983); Edit menu: anchor `<button onclick="IO.openExpandMap()">Expand Map…</button>` (~L1228).
  - `Shortcuts.init` (T4.4): add the `validate` registration after the `help` registration.
  - Init: after `Shortcuts.init();` in the load handler.
  - CSS after the `.shortcut-help kbd` rule.
- Create: `tests/validator-ui.spec.ts`

**Interfaces:**
- Consumes: `MapValidator.run`, `Canvas.centerOnTile`, `Canvas.selectTile`.
- Produces: `MapValidator.openResults()`, `.closeResults()`, `.jumpTo(index)`, `.init()`; DOM `#validator-panel`, `#val-summary`, `#val-list .val-row`; shortcut `V`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test('results list shows problems and a click jumps to the cell', async ({ page }) => {
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().length > 0);
  await page.evaluate(() => { settlements = []; mapData[60 * MAP_WIDTH + 50] = 'Nope_1'; });
  await page.keyboard.press('v');
  await expect(page.locator('#validator-panel')).toBeVisible();
  await expect(page.locator('#val-summary')).toContainText('2 errors');
  const row = page.locator('#val-list .val-row', { hasText: 'Nope_1' });
  await expect(row).toHaveCount(1);
  await row.click();
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 50, row: 60 });
});

test('a clean map says so', async ({ page }) => {
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().length > 0);
  await page.evaluate(() => MapValidator.openResults());
  await expect(page.locator('#val-summary')).toContainText(/No problems|warning/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/validator-ui.spec.ts --reporter=line`
Expected: FAIL, `#validator-panel` not visible after pressing `v`.

- [ ] **Step 3: Implement**

In `MapValidator`, replace `  return { validate, collectState, run, IMPASSABLE_TYPES, IMPASSABLE_IDS };` with:

```js
  // ── Results panel ────────────────────────────────────────
  let _last = [];
  const MAX_ROWS = 500;
  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _renderPanel() {
    const errs = _last.filter(i => i.severity === 'error').length, warns = _last.length - errs;
    document.getElementById('val-summary').textContent = _last.length
      ? `${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`
      : '✓ No problems found';
    document.getElementById('val-list').innerHTML = _last.slice(0, MAX_ROWS).map((i, idx) =>
      `<button class="val-row ${i.severity}" data-idx="${idx}"><span>${i.severity === 'error' ? '⛔' : '⚠'}</span><span>${_esc(i.message)}</span><span class="val-pos">${i.col},${i.row}</span></button>`
    ).join('') + (_last.length > MAX_ROWS ? `<div class="val-more">…and ${_last.length - MAX_ROWS} more</div>` : '');
  }

  function openResults() {
    _last = run();
    _renderPanel();
    document.getElementById('validator-panel').style.display = 'flex';
    return _last;
  }
  function closeResults() { document.getElementById('validator-panel').style.display = 'none'; }
  function jumpTo(idx) {
    const i = _last[idx];
    if (!i) return;
    Canvas.centerOnTile(i.col, i.row);
    Canvas.selectTile(i.col, i.row);
  }
  function init() {
    document.getElementById('val-list').addEventListener('click', e => {
      const b = e.target.closest('.val-row');
      if (b) jumpTo(+b.dataset.idx);
    });
  }

  return { validate, collectState, run, openResults, closeResults, jumpTo, init, IMPASSABLE_TYPES, IMPASSABLE_IDS };
```

In `Shortcuts.init`, after the `help` registration add:

```js
    register({ id: 'validate', group: 'Navigate', keys: ['v', 'V'], display: 'V', label: 'Validate map', run: () => MapValidator.openResults() });
```

Init: replace `  Shortcuts.init();` with `  Shortcuts.init();\n  MapValidator.init();`.

HTML before `<!-- Toast container -->`:

```html
<div id="validator-panel" style="display:none">
  <div class="val-head"><b>Map validation</b> <span id="val-summary"></span>
    <button class="hexdb-tool-btn" onclick="MapValidator.openResults()" title="Run again">↻</button>
    <button class="hexdb-tool-btn" onclick="MapValidator.closeResults()" title="Close">✕</button></div>
  <div id="val-list"></div>
</div>
```

Edit menu: after `<button onclick="IO.openExpandMap()">Expand Map…</button>` add `<button onclick="MapValidator.openResults()">Validate Map… <span class="menu-shortcut">V</span></button>`.

CSS:

```css
#validator-panel { position: fixed; left: 236px; bottom: 32px; width: 460px; max-height: 40vh; z-index: 400; flex-direction: column;
  background: var(--panel); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.6); }
.val-head { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.val-head #val-summary { flex: 1; color: var(--muted); }
#val-list { overflow-y: auto; }
.val-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 6px; width: 100%; text-align: left; background: none; border: 0;
  border-bottom: 1px solid var(--border); color: var(--text); font-size: 12px; padding: 4px 10px; cursor: pointer; }
.val-row:hover { background: var(--hover); }
.val-pos { color: var(--muted); font-family: monospace; }
.val-more { padding: 4px 10px; color: var(--muted); font-size: 11px; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/validator-ui.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/validator-ui.spec.ts
git commit -m "feat(validator): results panel with jump-to-cell and V shortcut" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the panel is non-modal so the canvas stays clickable; the list is capped at 500 rows with a "more" line.

---

### Task T4.7: Run the validator before export

**Files:**
- Modify: `MapEditorPro.html`
  - `MapValidator`: add `gate`.
  - `IO.saveMap` (anchor `  function saveMap() {`, ~L6547) and `IO.exportCSV` (anchor `  function exportCSV() {`, ~L6561).
  - `GitHubSync.publishMap` (anchor `const mapJson = IO.getMapJson();`, ~L5128).
- Create: `tests/validator-gate.spec.ts`

**Interfaces:**
- Consumes: `MapValidator.run/openResults`, `UI.showModal` (Phase 0), `UI.toast`.
- Produces: `MapValidator.gate(label) -> Promise<boolean>`. Errors open a modal with buttons `Show problems` and `<label> anyway`; warnings only toast; no issues proceeds silently. `IO.saveMap` becomes `async`. Button label for Save is exactly `Save map anyway`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().length > 0);
});

test('errors block Save until the user confirms', async ({ page }) => {
  await page.evaluate(() => { settlements = []; });
  await page.evaluate(() => { IO.saveMap(); });
  await expect(page.locator('#gate-errors')).toContainText('no city');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save map anyway' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.json$/);
});

test('"Show problems" cancels the save and opens the results panel', async ({ page }) => {
  await page.evaluate(() => { settlements = []; });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.evaluate(() => { IO.saveMap(); });
  await page.getByRole('button', { name: 'Show problems' }).click();
  await expect(page.locator('#validator-panel')).toBeVisible();
  expect(downloads).toBe(0);
});

test('a clean map saves without a prompt', async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { IO.saveMap(); })]);
  expect(dl.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.locator('#gate-errors')).toHaveCount(0);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/validator-gate.spec.ts --reporter=line`
Expected: first two FAIL (`#gate-errors` never appears; the download happens immediately).

- [ ] **Step 3: Implement**

In `MapValidator`, add before the `return {` line:

```js
  // Resolves true when the caller may proceed. Errors need an explicit "anyway"; warnings only toast.
  function gate(label) {
    return new Promise(resolve => {
      const issues = run();
      const errs = issues.filter(i => i.severity === 'error');
      if (!errs.length) {
        if (issues.length) UI.toast(`⚠ ${issues.length} validation warning${issues.length === 1 ? '' : 's'} (Edit → Validate Map)`);
        return resolve(true);
      }
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      UI.showModal({
        title: `${label}: ${errs.length} validation error${errs.length === 1 ? '' : 's'}`,
        bodyHtml: `<p>The map has problems the game may reject:</p><ul id="gate-errors">${errs.slice(0, 5).map(i => `<li>${_esc(i.message)}</li>`).join('')}</ul>` +
                  (errs.length > 5 ? `<p>…and ${errs.length - 5} more.</p>` : ''),
        actions: [
          { label: 'Show problems', kind: 'cancel', onClick: () => { finish(false); openResults(); } },
          { label: `${label} anyway`, kind: 'danger', onClick: () => finish(true) },
        ],
        onClose: () => finish(false),
      });
    });
  }
```

and add `gate` to the returned object (`..., openResults, closeResults, jumpTo, init, gate, ...`).

`IO.saveMap`: replace

```js
  function saveMap() {
    UI.closeAllMenus();
    if (!mapData) return;
```

with

```js
  async function saveMap() {
    UI.closeAllMenus();
    if (!mapData) return;
    if (typeof MapValidator !== 'undefined' && !(await MapValidator.gate('Save map'))) return;
```

`IO.exportCSV`: replace

```js
  function exportCSV() {
    UI.closeAllMenus();
    if (!mapData) return;
```

with

```js
  async function exportCSV() {
    UI.closeAllMenus();
    if (!mapData) return;
    if (typeof MapValidator !== 'undefined' && !(await MapValidator.gate('Export CSV'))) return;
```

`GitHubSync.publishMap`: after the line `if (!mapJson) { UI.toast('No map to publish'); return; }` add:

```js
    if (typeof MapValidator !== 'undefined' && !(await MapValidator.gate('Publish map'))) return;
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/validator-gate.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/validator-gate.spec.ts
git commit -m "feat(validator): gate save, CSV export and map publish on validation errors" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** autosave is deliberately NOT gated; `finish()` is single-shot so closing the modal after "anyway" cannot flip the result.

---

### Task T4.8: PNG export

**Files:**
- Modify: `MapEditorPro.html`
  - `IO`: new `exportPNG` after `exportCSV` (anchor `  function clearMap() {`); return object (anchor `return { newMap, openMap, saveMap, exportCSV,`).
  - File menu: anchor `<button onclick="IO.exportCSV()">Export CSV</button>` (~L1219).
- Create: `tests/export-png.spec.ts`

**Interfaces:**
- Consumes: `Canvas.hexCenterWorld`, `Terrain.color(id)`, constants `HEX_SIZE/COL_PITCH/ROW_PITCH/STAGGER`, `settlements`, `_currentFileName`.
- Produces: `IO.exportPNG(mode: 'overview'|'view') -> Promise<void>`; download named `<mapname>-overview.png` or `-view.png`. Overview scale is 0.1 (about 2702x3122 px for 450x450), one flat-colour hexagon per tile plus settlement dots.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { openEditor } from './helpers';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('overview export downloads a valid PNG of the whole map', async ({ page }) => {
  test.setTimeout(60_000);
  await openEditor(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => IO.exportPNG('overview'))]);
  expect(dl.suggestedFilename()).toMatch(/-overview\.png$/);
  const buf = fs.readFileSync((await dl.path())!);
  expect([...buf.subarray(0, 8)]).toEqual(PNG_SIG);
  expect(buf.readUInt32BE(16)).toBe(2702);                           // IHDR width
  expect(Math.abs(buf.readUInt32BE(20) - 3122)).toBeLessThanOrEqual(2); // IHDR height
});

test('view export downloads the visible canvas', async ({ page }) => {
  await openEditor(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => IO.exportPNG('view'))]);
  expect(dl.suggestedFilename()).toMatch(/-view\.png$/);
  expect([...fs.readFileSync((await dl.path())!).subarray(0, 8)]).toEqual(PNG_SIG);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/export-png.spec.ts --reporter=line`
Expected: FAIL, `IO.exportPNG is not a function`.

- [ ] **Step 3: Implement**

Insert in `IO` above `  function clearMap() {`:

```js
  // ── PNG export ───────────────────────────────────────────
  const PNG_OVERVIEW_SCALE = 0.1;

  function _canvasToBlob(c) {
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('PNG encoding failed')), 'image/png'));
  }

  // One flat-colour hexagon per tile (Terrain.color) at PNG_OVERVIEW_SCALE, plus settlement dots.
  function _renderOverview(scale) {
    const mapPixelW = (MAP_HEIGHT - 1) * COL_PITCH + HEX_SIZE * 2;
    const mapPixelH = (MAP_WIDTH  - 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2;
    const c = document.createElement('canvas');
    c.width  = Math.round(mapPixelW * scale);
    c.height = Math.round(mapPixelH * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, c.width, c.height);
    const r = HEX_SIZE * scale * 1.02;       // slight overlap hides seams
    for (let row = 0; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        const w = Canvas.hexCenterWorld(col, row);
        const cx = (w.x + HEX_SIZE) * scale, cy = (w.y + HEX_SIZE) * scale;
        const [R, G, B] = Terrain.color(mapData[row * MAP_WIDTH + col]);
        g.fillStyle = `rgb(${R},${G},${B})`;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i;
          g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        g.fill();
      }
    }
    settlements.forEach(s => {
      const w = Canvas.hexCenterWorld(s.col, s.row);
      g.fillStyle = s.type === 'city' ? '#ffffff' : '#ffd54f';
      g.beginPath();
      g.arc((w.x + HEX_SIZE) * scale, (w.y + HEX_SIZE) * scale, HEX_SIZE * scale * (s.type === 'city' ? 1.4 : 1), 0, Math.PI * 2);
      g.fill();
    });
    return c;
  }

  async function exportPNG(mode) {
    UI.closeAllMenus();
    if (!mapData) return;
    try {
      const view = mode === 'view';
      const blob = await _canvasToBlob(view ? document.getElementById('map-canvas') : _renderOverview(PNG_OVERVIEW_SCALE));
      const base = (_currentFileName && _currentFileName !== '(autosave)') ? _currentFileName : 'map';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}-${view ? 'view' : 'overview'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 100);
      UI.toast('PNG exported');
    } catch (e) {
      UI.toast('⚠ PNG export failed: ' + e.message);
    }
  }

```

Export: replace `return { newMap, openMap, saveMap, exportCSV,` with `return { newMap, openMap, saveMap, exportCSV, exportPNG,`.

File menu: after `<button onclick="IO.exportCSV()">Export CSV</button>` add:

```html
        <button onclick="IO.exportPNG('overview')">Export PNG (whole map)</button>
        <button onclick="IO.exportPNG('view')">Export PNG (current view)</button>
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/export-png.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/export-png.spec.ts
git commit -m "feat(export): PNG export of the whole map or the current view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `Math.round` sizing (exact IHDR width asserted); the overview loop is 202k path fills, acceptable for a one-off export.

---

### Task T4.9: Game-format export is a documented decision point

No converter is written until the owner answers the open question in the roadmap. This task records the evidence and the decision gate, and adds a characterization test that pins today's JSON contract so any later format change is visible.

**Files:**
- Create: `docs/superpowers/decisions/2026-10-02-game-map-format.md`, `tests/map-json-contract.spec.ts`

**Interfaces:**
- Consumes: `IO.getMapJson()`.
- Produces: the decision record. If the answer is "B" (different game format), the follow-up is a new task adding `IO.exportGameJson()` behind the same `MapValidator.gate`.

- [ ] **Step 1: Write the characterization test**

This test describes existing behaviour, so it is expected to PASS immediately. If it fails, correct the expected key list (not the editor) after checking `IO._buildJson`.

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test('a fresh map exports the contract the game reads today (version 2)', async ({ page }) => {
  await openEditor(page);
  const json = await page.evaluate(() => JSON.parse(IO.getMapJson()));
  expect(json.version).toBe(2);
  expect(Object.keys(json).sort()).toEqual(
    ['data', 'height', 'packages', 'settlement_priorities', 'settlements', 'version', 'width']);
  expect(json.data).toHaveLength(json.height);        // row-major: data[row][col]
  expect(json.data[0]).toHaveLength(json.width);
  expect(json.settlements).toContainEqual({ col: 225, row: 224, type: 'city' });
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/map-json-contract.spec.ts --reporter=line`
Expected: 1 passed (characterization test; see note above).

- [ ] **Step 3: Write the decision record**

Create `docs/superpowers/decisions/2026-10-02-game-map-format.md`:

```markdown
# Decision: does the game need a different map format than the editor JSON?

Status: OPEN. Owner: project owner. Raised: 2026-10-02 (roadmap "Open questions", Phase 4 item 4).

## What the editor writes today
`IO._buildJson` (MapEditorPro.html) emits `version: 2` with `packages`, `width`, `height`, `data` (rows of hex id
strings, `data[row][col]`), `settlements [{col,row,type}]`, and when non-empty: `bridges`, `objects`, `tileExtras`,
`roads`, `settlement_slots`, `settlement_priorities`, `zones`, `zoneMap`, `biomePresets`, `_zoneNextId`.
`tests/map-json-contract.spec.ts` pins the always-present keys.

## Question
Which loader in the game repo reads `maps/*.json`, and does it accept this shape unchanged?

## Options
| Option | Meaning | Editor work |
|---|---|---|
| A | The editor JSON is the game format | None. Close this record. |
| B | The game wants a trimmed or reshaped file (no editor-only keys, flat array, numeric ids, ...) | Add `IO.exportGameJson()` as a pure adapter `editorJson -> gameJson`, unit-tested, gated by `MapValidator.gate`, new File menu entry. |
| C | Both formats must be published | B plus a "Publish game format" entry that writes `maps/game/<name>.json` and lists it in `map_list.json`. |

## How to decide
1. In the game repo find the map loader (`grep -rn "map_list.json\|maps/" <game-repo>`).
2. List the keys it reads and any key it rejects. Compare with the list above.
3. Record the answer here and mark Status DECIDED (A, B or C).

## Gate
Do not implement B or C before this record says DECIDED. Any change to the editor's top-level keys must update `tests/map-json-contract.spec.ts` in the same commit.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/decisions/2026-10-02-game-map-format.md tests/map-json-contract.spec.ts
git commit -m "docs(decision): record open question on game map format, pin JSON contract" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the record states the gate explicitly; the contract test lists only keys present on a fresh map.

---

### Task T4.10: History panel

**Files:**
- Modify: `MapEditorPro.html`
  - `History` module (anchor `const History = (() => {`, ~L4563): labels, `getEntries`, `jumpBy`, `onChange`, `initPanel`.
  - Label call sites (anchors listed in Step 3).
  - HTML: after the `#bookmarks-panel` added in T4.2.
  - `Shortcuts.init`: add `Shift+H`.
  - Init: anchor `  History.initKeyboard();` in the load handler.
- Create: `tests/history-panel.spec.ts`

**Interfaces:**
- Consumes: existing snapshot/restore, `UI.updateMenuHistoryState`, `UI.toast`.
- Produces: `History.push(label?)`, `History.undo(quiet?)`, `History.redo(quiet?)`, `History.getEntries() -> {done:[{label,t}], undone:[{label,t}]}` (done oldest first; undone in redo order), `History.jumpBy(n)` (negative = undo n times, positive = redo n times), `History.onChange(fn)`, `History.initPanel()`; DOM `#history-list .hist-row`.
- Semantics: a snapshot is taken BEFORE each action, so entry `i` of `done` is "state after action `i`"; clicking it undoes `done.length - 1 - i` times. Only the public undo/redo are used by `jumpBy`, so a Phase 1 diff-based rewrite keeps working.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test('history panel lists labelled actions newest first and jumps through them', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    History.clear();
    History.push('Open map');            // baseline
    History.push('Paint');  mapData[0] = 'A_1';
    History.push('Fill');   mapData[0] = 'B_1';
  });
  const labels = await page.locator('#history-list .hist-row').allTextContents();
  expect(labels).toEqual(['Fill', 'Paint', 'Open map']);

  const cell = () => page.evaluate(() => mapData[0]);
  await page.locator('#history-list .hist-row', { hasText: 'Paint' }).click();
  expect(await cell()).toBe('A_1');
  await page.locator('#history-list .hist-row', { hasText: 'Open map' }).click();
  expect(await cell()).toBe('Plain_1');
  await page.locator('#history-list .hist-row', { hasText: 'Fill' }).click();   // redo two steps
  expect(await cell()).toBe('B_1');
});

test('a new action after jumping back drops the undone entries', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { History.clear(); History.push('Open map'); History.push('Paint'); mapData[0] = 'A_1'; });
  await page.locator('#history-list .hist-row', { hasText: 'Open map' }).click();
  await page.evaluate(() => { History.push('Erase'); mapData[0] = 'C_1'; });
  const labels = await page.locator('#history-list .hist-row').allTextContents();
  expect(labels).toEqual(['Erase', 'Open map']);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/history-panel.spec.ts --reporter=line`
Expected: FAIL, `#history-list .hist-row` has no rows (element missing).

- [ ] **Step 3: Implement**

History module edits (replace the functions, keep `_snapshot`/`_restore`):

```js
  const _undoMeta = [];   // parallel to _undo: { label, t } of the action each snapshot precedes
  const _redoMeta = [];
  const _listeners = [];

  function _notify() {
    UI.updateMenuHistoryState();
    _listeners.forEach(fn => fn());
  }

  function push(label) {
    if (_undo.length >= MAX) { _undo.shift(); _undoMeta.shift(); }  // evict oldest
    _undo.push(_snapshot());
    _undoMeta.push({ label: label || 'Edit', t: Date.now() });
    _redo.length = 0; _redoMeta.length = 0;                          // clear redo on new action
    _notify();
  }

  function undo(quiet) {
    if (_undo.length === 0) return;
    _redo.push(_snapshot());
    _redoMeta.push(_undoMeta.pop());
    _restore(_undo.pop());
    Canvas.render();
    Canvas.drawMinimap();
    _notify();
    if (!quiet) UI.toast('Undo');
  }

  function redo(quiet) {
    if (_redo.length === 0) return;
    _undo.push(_snapshot());
    _undoMeta.push(_redoMeta.pop());
    _restore(_redo.pop());
    Canvas.render();
    Canvas.drawMinimap();
    _notify();
    if (!quiet) UI.toast('Redo');
  }

  function clear() {
    _undo.length = 0; _redo.length = 0; _undoMeta.length = 0; _redoMeta.length = 0;
    _notify();
  }

  function getEntries() {
    return { done: _undoMeta.map(m => ({ ...m })), undone: _redoMeta.slice().reverse().map(m => ({ ...m })) };
  }

  function jumpBy(n) {
    const steps = Math.abs(n);
    for (let i = 0; i < steps; i++) { if (n < 0) undo(true); else redo(true); }
    if (steps) UI.toast(n < 0 ? `Undid ${steps} step${steps > 1 ? 's' : ''}` : `Redid ${steps} step${steps > 1 ? 's' : ''}`);
  }

  function onChange(fn) { _listeners.push(fn); }

  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _renderPanel() {
    const el = document.getElementById('history-list');
    if (!el) return;
    const { done, undone } = getEntries();
    const rows = [];
    done.forEach((m, i) => rows.push(
      `<button class="hist-row${i === done.length - 1 ? ' current' : ''}" data-jump="${-(done.length - 1 - i)}">${_esc(m.label)}</button>`));
    undone.forEach((m, j) => rows.push(`<button class="hist-row undone" data-jump="${j + 1}">${_esc(m.label)}</button>`));
    el.innerHTML = rows.reverse().join('');
  }

  function initPanel() {
    onChange(_renderPanel);
    const el = document.getElementById('history-list');
    if (el) el.addEventListener('click', e => {
      const b = e.target.closest('.hist-row');
      if (b && +b.dataset.jump) jumpBy(+b.dataset.jump);
    });
    _renderPanel();
  }
```

Replace the old `push`, `undo`, `redo`, `clear` definitions with the above, and change the return line to:

```js
  return { push, undo, redo, clear, undoSize, redoSize, initKeyboard, getEntries, jumpBy, onChange, initPanel };
```

Label call sites (each is an exact, unique substring to replace inside `Tools`/`IO`; use `grep -n` to find them):

| Find | Replace `History.push();` with |
|---|---|
| `History.push();   // save pre-paint state before first stroke` | `History.push('Paint');` |
| `History.push();\n        _fill(col, row);` | `History.push('Fill');` |
| `History.push();\n      _applyRect(` | `History.push('Rectangle');` |
| `History.push();\n        _paintZone(col, row);` | `History.push('Zone paint');` |
| `History.push();\n        _placeObject(col, row);` | `History.push('Place object');` |
| `History.push();\n        _paintRoad(col, row);` | `History.push('Road');` |
| `History.push();\n        _connectRoad(col, row);` | `History.push('Connect road');` |
| `History.push();\n        _eraseRoad(col, row);` | `History.push('Erase road');` |
| `History.push();\n    const type = (col === getCityCol()` | `History.push('Place settlement');` |
| `History.push();\n      mapData.fill('Plain_1');` | `History.push('Clear map');` |
| `History.push();\n      mapData.fill(hexId);` | `History.push('Fill map');` |
| the `History.clear();\n      History.push();` and `History.clear();\n    History.push();` pairs in `IO.newMap`, `IO.applyNewMap`, `IO.tryRestoreAutosave`, `IO._loadFromJSON` | `History.push('Open map');` |

Unlabelled calls keep working and show as `Edit`.

HTML (after `#bookmarks-panel`):

```html
      <div id="history-panel" class="side-panel">
        <div class="section-title">History</div>
        <div id="history-list"></div>
      </div>
```

CSS:

```css
#history-list { max-height: 140px; overflow-y: auto; }
.hist-row { display: block; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--border); color: var(--text); font-size: 11px; padding: 2px 4px; cursor: pointer; }
.hist-row:hover { background: var(--hover); }
.hist-row.current { color: var(--accent); font-weight: bold; }
.hist-row.undone { color: var(--muted); font-style: italic; }
```

`Shortcuts.init`, after the `validate` registration:

```js
    register({ id: 'history-focus', group: 'Navigate', keys: ['H'], display: 'Shift+H', label: 'Scroll history to latest entry',
               run: () => { const l = document.getElementById('history-list'); if (l) l.scrollTop = 0; } });
```

Init: replace `  History.initKeyboard();` with `  History.initKeyboard();\n  History.initPanel();`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/history-panel.spec.ts tests/nav-bookmarks.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/history-panel.spec.ts
git commit -m "feat(history): labelled history panel with click-to-jump" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** parallel `_undoMeta/_redoMeta` stay in lockstep with the snapshot stacks in every path (push, evict, undo, redo, clear); `jumpBy` relies only on public undo/redo.

### Task T4.11: Narrow-window layout (controller ruling: option B, collapsible right panel)

**Why this exists:** found during T2.13 review. The app has a fixed ~1931 px layout (`html, body { overflow: hidden }`, `#app` is a one-column `1fr` grid whose width is pushed by the non-wrapping toolbar row, `#main` is `220px 1fr 220px`). At 1400x900 the canvas is 1491 px wide and the whole right panel (minimap, brush, active terrain, anything placed there) starts at x about 1711, completely off-screen (1491 + 220 + 220 = 1931 > 1400). Until this task is done, new controls go in the LEFT palette (standing rule).

**Ruling (controller, option B; the owner had not answered).** ONE design, with no mixed claims:

1. **Wide viewports (width >= 1920 px, "classic" threshold `NARROW_BELOW = 1920`):** the layout is exactly today's: toolbar row, left palette 220 px, canvas, right panel 220 px expanded inline. Nothing changes for these viewports (the canvas at 1920x1080 is today's size; the test compares against numbers recorded from the unchanged layout BEFORE editing).
2. **Narrow viewports (width < 1920 px):** the right panel starts COLLAPSED (state `auto`) to a thin rail (about 28 px) holding the toggle button. The canvas fills the freed width: canvas width = viewport width - left palette - rail; canvas height is unchanged. The page never scrolls horizontally: the top toolbar gets `overflow-x: auto; flex-wrap: nowrap` (it scrolls inside itself) and no longer widens `#app`.
3. **Expanding on a narrow viewport:** the panel opens as an OVERLAY DRAWER above the canvas (absolute, right-aligned, 220 px, does not reflow). The canvas element keeps the size it has while collapsed, so canvas hit-testing, the ruler strips and the minimap mapping stay correct; the drawer simply covers the right-most 220 px of the canvas while open. Minimap, brush panel and active-terrain panel are therefore reachable at every viewport by expanding.
4. **Toggle:** `#right-panel-toggle`, a real `<button>` with `aria-expanded` and `aria-controls`, operable with Enter and Space, blurs to the map shortcuts after a pointer click (like the Layers buttons). State is stored per viewer under one localStorage key with the values `auto` (default), `collapsed`, `expanded`; every storage read and write is in try/catch and the page renders and works with storage blocked. At >= 1920 px `auto` means expanded inline; an explicit `collapsed` collapses there too and the canvas widens by the freed width.
5. **Classic escape hatch for the perf specs:** the perf specs all run at a fixed 1400x900 viewport (`VIEWPORT` in `tests/perf-scene.ts`, applied with `test.use({ viewport: VIEWPORT })` in every `tests/perf-*.spec.ts`; `perf-zoom-floor.spec.ts` also resizes to 1400x900 and 2800x1800 inside one test). 1400 is below 1920, so under this design the canvas at that viewport WOULD change from 1491x808 and the canvas-pixel hashes in `tests/perf-baseline.json` would break. They are therefore NOT unaffected by default. To keep them valid without touching the baseline file, the same storage key accepts a fourth value `classic`, which forces today's fixed layout at any viewport (a documented, supported setting, not a test-only hack); `tests/perf-scene.ts` (and `tests/helpers.ts` `openEditor`, for specs that assert 1491x808) seed `classic` with `page.addInitScript` before load. The implementer must verify this by running `perf-equivalence.spec.ts` and the existing 1491x808 canvas-size test, and must never edit or regenerate `tests/perf-baseline.json`; if a hash still differs, stop and report.

**Files:**
- Modify: `MapEditorPro.html` (CSS for `#main`, `#right-panel`, `#toolbar` overflow; the rail, toggle and drawer; one `Canvas.resize` call per state change; persisted state with try/catch)
- Modify: `tests/perf-scene.ts`, `tests/helpers.ts` (seed `classic`)
- Create: `tests/layout-narrow.spec.ts`

**Interfaces:**
- Consumes: the existing `#right-panel` children (`#minimap`, brush panel, `#right-active-terrain`).
- Produces: `#right-panel-toggle` (`aria-expanded`), the persisted state key, a rule that no control is unreachable at 1100x700 (visible, scrollable into view inside the toolbar, or behind the visible toggle).

- [ ] **Step 1: Write the failing tests** in `tests/layout-narrow.spec.ts`
  - Record the canvas size at 1920x1080 and 1400x900 from the UNCHANGED layout first (as literals in the test, derived by running against the current HEAD).
  - No horizontal PAGE scroll (`document.documentElement.scrollWidth <= innerWidth`, and `body`/`#app` not wider than the viewport) at 1100x700, 1280x720, 1400x900 and 1920x1080.
  - At 1920x1080 with `auto`: the expanded layout equals today's (canvas size and right-panel position).
  - At 1100x700, 1280x720 and 1400x900 with `auto`: the panel is collapsed, the canvas width equals viewport width - left palette - rail, the height is unchanged.
  - At every one of the four viewports the minimap, brush panel and active-terrain panel can be brought fully inside the viewport by pressing the toggle (a real click, then a real click on each), and the canvas size is the same before and after expanding on the narrow ones (overlay, no reflow).
  - A real mouse click on a map cell not covered by the drawer still paints the right cell with the drawer open (hit-testing stays correct), and a click at the same position with the panel collapsed hits the cell under the cursor.
  - Toggle: keyboard-operable (Enter and Space), `aria-expanded` matches the state, persisted across reload, and with `localStorage` throwing the page still starts and the toggle still works for the session.
  - `classic` forces today's fixed layout: the canvas at 1400x900 is 1491x808.
- [ ] **Step 2: Run, confirm failure** against the current layout.
- [ ] **Step 3: Implement** the design above. Keep `tests/perf-baseline.json` untouched.
- [ ] **Step 4: Run the full default suite once** (at the end of the whole plan, per the user directive). Pre-existing canvas-size assertions and perf hashes must stay green, which is what the `classic` seeding is for.
- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/layout-narrow.spec.ts tests/perf-scene.ts tests/helpers.ts
git commit -m "feat(layout): collapsible right panel; narrow windows get the canvas width and a drawer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** nothing becomes unreachable at 1100x700; canvas coordinates, hit-testing and the ruler strips stay correct when the panel collapses or the drawer opens (`Canvas.resize` called once per toggle, not per frame); minimap redraw after toggling; a storage that throws never blocks startup; `classic` leaves every pre-existing geometry assertion and perf hash unchanged; once this task lands, the Stamps panel may optionally move back to the right panel (separate owner decision).

---

## Phase 5: Packages UX

Makes the PACKAGES tab self-explanatory, makes the active package selectable where entries are authored, stores sprites per package, replaces `window.prompt` with a searchable reskin picker, hardens publish, import and export, adds dependencies and a 512x512 preview, groups the palette by package, and adds a local-only mode without a GitHub token.

Roadmap mapping: 5.1 -> T5.1, 5.2 -> T5.2, 5.3 -> T5.3 + T5.4, 5.4 -> T5.5, 5.5 -> T5.6, 5.6 -> T5.7 + T5.8, 5.7 -> T5.9, 5.8 -> T5.10 + T5.11, 5.9 -> T5.12.

### Files touched in Phase 5

| File | Change |
|---|---|
| `MapEditorPro.html` | `Packages` module (panel, publish dialog, import/export, details, local registry), `SpriteStore` (per-package keys), `Terrain` (`getUploadedUrl(name,pkg)`, `applyHexDbOverrides`), `UI` (`handleSpriteUpload`, `buildPalette`, `showSpritePicker`), `HexDB/BldDB.promptReskin`, `GitHubSync` (`_removeFile`, `publishAllSprites`, `cleanGhostSprites`), `IO._collectMapPackages`, toolbars and modals (HTML/CSS) |
| `package.json` | devDependency `jszip` (tests only) |
| `tests/helpers-github.ts` | New: GitHub Contents API + gh-pages + jsDelivr JSZip mocks and seeding helpers |
| `tests/packages-*.spec.ts` | New specs, one per task |
| `docs/guides/content-packages-editor-guide.pdf` | Already present but untracked; committed in T5.1 because the PACKAGES tab links to it |

### Network mocking used by every Phase 5 test

The editor talks to three origins: `https://fidaykin.github.io/PostApocMapEditor` (reads, `BASE_URL`), `https://api.github.com/repos/fidaykin/PostApocMapEditor/contents` (writes, `GH_API`, branch `gh-pages`) and `https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm` (`Packages._loadJSZip`). T5.0 builds the mocks. No Phase 5 test touches the real network. Install mocks BEFORE `openEditor(page)`.

---

### Task T5.0: GitHub, JSZip and seeding test helpers

**Files:**
- Modify: `package.json` (devDependency `jszip`)
- Create: `tests/helpers-github.ts`, `tests/packages-helpers.spec.ts`

**Interfaces:**
- Consumes: `openEditor` (T0.0); `GitHubSync._putContents` request shapes (`GET .../contents/<path>?ref=gh-pages` -> `{sha}`; `PUT` body `{message, content(base64), branch, sha?}`).
- Produces (all exported from `tests/helpers-github.ts`):
  - `BASE`, `API`, `TINY_PNG: Buffer`, `REGISTRY_POSTAPOC`, `MEDIEVAL` (`{id:'medieval',name:'Medieval Kingdom',isDefault:false,version:'1.0.0'}`)
  - `mockGitHub(page, seed?) -> GhMock` where `GhMock = { files: Map<string,Buffer>, puts: string[], deletes: string[], failWhen(pred|null), setRegistry(pkgs) }`
  - `withPat(page)`, `mockJSZip(page)`, `makeZip(files) -> Promise<Buffer>`, `readZip(buf)`, `pkgJson(id, extra?)`, `hexRec(id, pkg, spriteName?)`, `dataUrl(buf)`, `seedHexes(page, hexes)`, `seedBuildings(page, blds)`

- [ ] **Step 1: Write the failing test**

Create `tests/packages-helpers.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, mockJSZip, REGISTRY_POSTAPOC, MEDIEVAL, withPat } from './helpers-github';

test('mocks serve a registry, accept writes and provide JSZip', async ({ page }) => {
  await withPat(page);
  await mockJSZip(page);
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);

  expect(await page.evaluate(async () => typeof (await Packages._loadJSZip()))).toBe('function');

  await page.evaluate(() => GitHubSync._putText('packages/x/a.json', '{"a":1}', 'test'));
  expect(gh.puts).toEqual(['packages/x/a.json']);
  expect(gh.files.get('packages/x/a.json')!.toString()).toBe('{"a":1}');
  expect(await page.evaluate(() => GitHubSync.isPATConfigured())).toBe(true);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-helpers.spec.ts --reporter=line`
Expected: FAIL, `Cannot find module './helpers-github'`.

- [ ] **Step 3: Implement**

Run: `npm install --save-dev jszip`

Create `tests/helpers-github.ts`:

```ts
import type { Page, Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

export const BASE = 'https://fidaykin.github.io/PostApocMapEditor';
export const API = 'https://api.github.com/repos/fidaykin/PostApocMapEditor/contents';
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const REGISTRY_POSTAPOC = { id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' };
export const MEDIEVAL = { id: 'medieval', name: 'Medieval Kingdom', isDefault: false, version: '1.0.0' };

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

export interface GhMock {
  files: Map<string, Buffer>;
  puts: string[];                       // paths in the order they were written
  deletes: string[];
  failWhen: (pred: ((p: string) => boolean) | null) => void;   // make matching PUTs return 500
  setRegistry: (pkgs: object[]) => void;
}

export async function mockGitHub(page: Page, seed: Record<string, string | Buffer> = {}): Promise<GhMock> {
  const files = new Map<string, Buffer>();
  const puts: string[] = [];
  const deletes: string[] = [];
  let failPred: ((p: string) => boolean) | null = null;
  const put = (p: string, b: string | Buffer) => files.set(p, Buffer.isBuffer(b) ? b : Buffer.from(b));
  const setRegistry = (pkgs: object[]) => put('packages/registry.json', JSON.stringify({ version: 1, packages: pkgs }));
  setRegistry([REGISTRY_POSTAPOC]);
  Object.entries(seed).forEach(([p, b]) => put(p, b));
  const sha = (b: Buffer) => 'sha' + b.length;

  await page.route(`${BASE}/**`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(new URL(route.request().url()).pathname.replace('/PostApocMapEditor/', ''));
    const b = files.get(p);
    if (!b) return route.fulfill({ status: 404, headers: CORS, body: 'not found' });
    const type = p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/plain';
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': type }, body: b });
  });

  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/fidaykin/PostApocMapEditor/contents/', ''));
    const json = (status: number, obj: unknown) =>
      route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
    if (m === 'GET') {
      const b = files.get(p);
      if (b) return json(200, { name: p.split('/').pop(), path: p, sha: sha(b), size: b.length,
                                content: b.toString('base64'), download_url: `${BASE}/${p}`, type: 'file' });
      const kids = [...files.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
      if (kids.length) return json(200, kids.map(k => ({ name: k.split('/').pop(), path: k, sha: sha(files.get(k)!),
                                size: files.get(k)!.length, download_url: `${BASE}/${k}`, type: 'file' })));
      return json(404, { message: 'Not Found' });
    }
    if (m === 'PUT') {
      if (failPred && failPred(p)) return json(500, { message: 'injected failure' });
      put(p, Buffer.from(req.postDataJSON().content, 'base64'));
      puts.push(p);
      return json(200, { content: { sha: sha(files.get(p)!) } });
    }
    if (m === 'DELETE') { files.delete(p); deletes.push(p); return json(200, {}); }
    return json(405, {});
  });

  return { files, puts, deletes, failWhen: f => { failPred = f; }, setRegistry };
}

export async function withPat(page: Page) {
  await page.addInitScript(() => localStorage.setItem('gh_sync_pat', 'test-token'));
}

// Serves the npm copy of JSZip as the ESM module Packages._loadJSZip() imports from jsDelivr.
export async function mockJSZip(page: Page) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'jszip', 'dist', 'jszip.min.js'), 'utf8');
  const esm = `const module = { exports: {} }; const exports = module.exports;\n(function () {\n${src}\n}).call(globalThis);\nexport default module.exports;`;
  await page.route('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm', r =>
    r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/javascript' }, body: esm }));
}

export async function makeZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  const z = new JSZip();
  Object.entries(files).forEach(([p, b]) => z.file(p, b));
  return z.generateAsync({ type: 'nodebuffer' });
}
export const readZip = (buf: Buffer) => JSZip.loadAsync(buf);

export const pkgJson = (id: string, extra: object = {}) =>
  JSON.stringify({ id, name: id[0].toUpperCase() + id.slice(1), version: '1.0.0', isDefault: false, ...extra });
export const hexRec = (id: string, pkg: string, spriteName: string = id) =>
  ({ id, type: 'Special', biome: 'Summer', spriteName, package: pkg, category: '⚙️ SPECIAL' });
export const dataUrl = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64');

export async function seedHexes(page: Page, hexes: object[]) {
  await page.evaluate(h => { const d = HexDB.getData(); HexDB.loadFromObject({ ...d, hexes: [...d.hexes, ...h] }); }, hexes);
}
export async function seedBuildings(page: Page, blds: object[]) {
  await page.evaluate(b => { b.forEach((x: any) => BldDB.pushRecord(x)); }, blds);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-helpers.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/helpers-github.ts tests/packages-helpers.spec.ts
git commit -m "test(packages): GitHub, JSZip and seeding helpers for Playwright" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the PUT handler mirrors the real `_putContents` contract (GET sha, then PUT base64); CORS preflight is answered because the page is on a different origin.

---

### Task T5.1: PACKAGES tab explains itself

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages.renderPanel` (anchor `const el = document.getElementById('pkg-panel');`, ~L7531) and `Packages.setActive` (anchor `localStorage.setItem(LS_ACTIVE, id);`, ~L7524); constants at the top of the module (anchor `const LS_ACTIVE   = 'pkg_active';`).
  - CSS: after `.pkg-filter-row { ... }` (~L650).
- Add to git: `docs/guides/content-packages-editor-guide.pdf`
- Create: `tests/packages-panel.spec.ts`

**Interfaces:**
- Consumes: `HexDB.getData().hexes`, `BldDB.getAll()`, `GitHubSync.isPATConfigured/openPATSettings`.
- Produces: `Packages.setActive` now also re-renders the panel; DOM ids `#pkg-help`, `#pkg-guide-link`, `#pkg-empty`, `#pkg-pat-warn`, `#pkg-game-notice`, rows `tr[data-pkg]` with `.pkg-hex-count`, `.pkg-bld-count`, `.pkg-active-dot`, `.pkg-set-active`; constant `GAME_LOADS_NON_DEFAULT = false`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, REGISTRY_POSTAPOC, MEDIEVAL, hexRec, seedHexes, withPat } from './helpers-github';

test('empty state, help text, notice, token warning and guide link', async ({ page, request }) => {
  await mockGitHub(page);
  await openEditor(page);
  await page.click('#tab-packages');
  await expect(page.locator('#pkg-help')).toContainText('content package');
  await expect(page.locator('#pkg-empty')).toContainText('No custom packages yet');
  await expect(page.locator('#pkg-game-notice')).toContainText('does not load non-default packages yet');
  await expect(page.locator('#pkg-pat-warn')).toContainText('GitHub token');
  const href = await page.locator('#pkg-guide-link').getAttribute('href');
  expect(href).toBe('docs/guides/content-packages-editor-guide.pdf');
  expect((await request.get('/' + href!)).status()).toBe(200);
});

test('token warning disappears when a token is configured', async ({ page }) => {
  await withPat(page);
  await mockGitHub(page);
  await openEditor(page);
  await page.click('#tab-packages');
  await expect(page.locator('#pkg-pat-warn')).toHaveCount(0);
});

test('rows show entry counts and the active marker', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await seedHexes(page, [hexRec('Med_A', 'medieval'), hexRec('Med_B', 'medieval')]);
  await page.click('#tab-packages');
  const row = page.locator('tr[data-pkg="medieval"]');
  await expect(row.locator('.pkg-hex-count')).toHaveText('2');
  await expect(row.locator('.pkg-bld-count')).toHaveText('0');
  await expect(page.locator('#pkg-empty')).toHaveCount(0);
  await expect(page.locator('tr[data-pkg="postapoc"] .pkg-active-dot')).toBeVisible();
  await row.locator('.pkg-set-active').click();
  await expect(row.locator('.pkg-active-dot')).toBeVisible();
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
  await expect(row.getByRole('button', { name: /Publish/ })).toHaveAttribute('title', /.+/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-panel.spec.ts --reporter=line`
Expected: FAIL, `#pkg-help` not found.

- [ ] **Step 3: Implement**

Top of the `Packages` module, after `const LS_REGISTRY = 'pkg_registry_cache';`:

```js
  const GAME_LOADS_NON_DEFAULT = false;   // flip to true once the game repo ships runtime package loading
  const GUIDE_URL = 'docs/guides/content-packages-editor-guide.pdf';
```

In `setActive`, after `renderActiveDropdowns();` add `renderPanel();`.

Replace the whole `renderPanel` function:

```js
  function _counts(id) {
    const hexes = (typeof HexDB !== 'undefined' ? HexDB.getData().hexes : []).filter(h => (h.package || 'postapoc') === id);
    const blds  = (typeof BldDB !== 'undefined' ? BldDB.getAll() : []).filter(b => (b.package || 'postapoc') === id);
    return { hexes: hexes.length, blds: blds.length };
  }

  function renderPanel() {
    const el = document.getElementById('pkg-panel');
    if (!el) return;
    const custom = _registry.filter(p => !p.isDefault);
    const rows = _registry.map(p => {
      const c = _counts(p.id);
      const pid = _esc(p.id);
      return `
      <tr data-pkg="${pid}">
        <td>${p.id === _active
          ? '<span class="pkg-active-dot" title="Active package: new hex tiles and buildings are tagged to it">● active</span>'
          : `<button class="hexdb-tool-btn pkg-set-active" onclick="Packages.setActive('${pid}')" title="Make this the active package">Set active</button>`}</td>
        <td><code>${pid}</code>${p.isDefault ? ' <span class="pkg-badge" title="Built-in content that ships with the game; it cannot be deleted">default</span>' : ''}</td>
        <td>${_esc(p.name)}</td>
        <td>${_esc(p.version || '—')}</td>
        <td class="pkg-hex-count" title="Hex tiles tagged to this package in the editor">${c.hexes}</td>
        <td class="pkg-bld-count" title="Buildings tagged to this package in the editor">${c.blds}</td>
        <td>
          <button class="hexdb-tool-btn" onclick="Packages.exportPackage('${pid}')" title="Download a ZIP of this package">↓ Export</button>
          <button class="hexdb-tool-btn" onclick="Packages.openPublishConfirm('${pid}')" title="Upload this package's entries and sprites to the server">Publish</button>
          ${!p.isDefault ? `<button class="hexdb-tool-btn" style="color:#f38ba8" onclick="Packages.confirmDelete('${pid}')" title="Remove this package from the registry">Delete</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    const patWarn = GitHubSync.isPATConfigured() ? '' :
      `<div id="pkg-pat-warn" class="pkg-notice warn">Creating, importing and publishing packages needs a GitHub token. <button class="hexdb-tool-btn" onclick="GitHubSync.openPATSettings()">⚙ Add token</button></div>`;
    const gameNote = GAME_LOADS_NON_DEFAULT ? '' :
      `<div id="pkg-game-notice" class="pkg-notice">The game does not load non-default packages yet. Published packages are stored on the server, but only <code>postapoc</code> content appears in the game today.</div>`;
    const empty = custom.length ? '' :
      `<div id="pkg-empty" class="pkg-notice">No custom packages yet. Click <b>+ New Package</b> to start one, or <b>↑ Import Package</b> to load a ZIP.</div>`;
    el.innerHTML = `
      <h3 style="color:#cdd6f4;margin:0 0 8px">Content Packages</h3>
      <p id="pkg-help" class="pkg-help">A <b>content package</b> bundles hex tiles, buildings and their sprites so they can be published separately from the base game (<code>postapoc</code>). Pick an <b>active package</b>: every new hex or building you add is tagged to it, and <b>Publish</b> uploads only that package's entries.
        <a id="pkg-guide-link" href="${GUIDE_URL}" target="_blank" rel="noopener">Packages guide (PDF)</a></p>
      ${patWarn}${gameNote}${empty}
      <div style="display:flex;gap:8px;margin:12px 0">
        <button class="hexdb-tool-btn" onclick="Packages.openImportModal()" title="Create a package from a ZIP exported by this editor">↑ Import Package</button>
        <button class="hexdb-tool-btn" onclick="Packages.openNewModal()" title="Create an empty package">+ New Package</button>
      </div>
      <table>
        <thead><tr><th></th><th>ID</th><th>Name</th><th>Version</th><th>Hex</th><th>Bldg</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
```

CSS:

```css
.pkg-help { color: #a6adc8; font-size: 12px; line-height: 1.5; margin: 0 0 12px; max-width: 680px; }
.pkg-notice { font-size: 12px; margin: 8px 0; padding: 8px 12px; border-radius: 4px; background: #181825; border-left: 3px solid #89b4fa; color: #cdd6f4; max-width: 680px; }
.pkg-notice.warn { border-left-color: #f9e2af; }
.pkg-active-dot { color: #a6e3a1; font-size: 11px; }
.pkg-error { color: #f38ba8; font-size: 12px; min-height: 16px; }
```

Stage the guide: `git add docs/guides/content-packages-editor-guide.pdf`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-panel.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-panel.spec.ts docs/guides/content-packages-editor-guide.pdf
git commit -m "feat(packages): self-explanatory PACKAGES tab with counts, active marker and notices" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the "game does not load non-default packages" notice is driven by one constant; the guide PDF is committed so the link cannot 404 after deploy.

---

### Task T5.2: Active-package selector in HEX DB and BUILDINGS toolbars

**Files:**
- Modify: `MapEditorPro.html`
  - HTML: `#hexdb-tools` (anchor `<button class="hexdb-tool-btn" onclick="HexDB.add()">+ Add Hex</button>`, ~L1346), `#bld-tools` (anchor `<button class="hexdb-tool-btn" onclick="BldDB.add()">+ Add Building</button>`, ~L1359), packages toolbar select (anchor `<select id="pkg-active-select"`, ~L1390).
  - `Packages.renderActiveDropdowns` (anchor `const sel = document.getElementById('pkg-active-select');`) and `Packages.init`.
- Create: `tests/packages-toolbar.spec.ts`

**Interfaces:**
- Consumes: `Packages.setActive`, `Packages.renderBadges`.
- Produces: `select.pkg-active-select` in three toolbars, all kept in sync by `renderActiveDropdowns()`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, REGISTRY_POSTAPOC, MEDIEVAL } from './helpers-github';

test('active package can be chosen from the HEX DB and BUILDINGS toolbars', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);

  await page.click('#tab-hexdb');
  const hexSel = page.locator('#hexdb-tools .pkg-active-select');
  await expect(hexSel).toBeVisible();
  await expect(hexSel.locator('option')).toHaveCount(2);
  await hexSel.selectOption('medieval');
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
  await expect(page.locator('#hexdb-pkg-badge')).toHaveText('[Medieval]');

  await page.click('#tab-buildings');
  await expect(page.locator('#bld-tools .pkg-active-select')).toHaveValue('medieval');
  await page.locator('#bld-tools .pkg-active-select').selectOption('postapoc');

  await page.click('#tab-packages');
  await expect(page.locator('#packages-tools .pkg-active-select')).toHaveValue('postapoc');
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-toolbar.spec.ts --reporter=line`
Expected: FAIL, `#hexdb-tools .pkg-active-select` not found.

- [ ] **Step 3: Implement**

HTML: insert as the first child of `#hexdb-tools` (before the `+ Add Hex` button) and of `#bld-tools` (before `+ Add Building`):

```html
      <select class="pkg-active-select" title="Active package: new entries are tagged to it" onchange="Packages.setActive(this.value)"></select>
```

In `#packages-tools`, change `<select id="pkg-active-select" style=` to `<select id="pkg-active-select" class="pkg-active-select" style=`.

CSS (next to `.pkg-help`):

```css
.pkg-active-select { font-size: 11px; background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 2px 6px; margin-right: 6px; }
```

Replace the top of `renderActiveDropdowns`:

```js
  function renderActiveDropdowns() {
    document.querySelectorAll('.pkg-active-select').forEach(sel => {
      sel.innerHTML = _registry.map(p =>
        `<option value="${_esc(p.id)}" ${p.id === _active ? 'selected' : ''}>${_esc(p.name)}</option>`
      ).join('');
    });
```

(keep the existing `const badge = document.getElementById('pkg-active-badge'); ...` block that follows, and its closing brace).

In `Packages.init`, after `_fetchRegistry();` add `renderActiveDropdowns(); renderBadges();` so the cached registry fills the selectors before the network answers.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-toolbar.spec.ts tests/packages-panel.spec.ts --reporter=line`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-toolbar.spec.ts
git commit -m "feat(packages): active-package selector in HEX DB and BUILDINGS toolbars" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** one render function updates every selector; `renderBadges` still inserts its badge before the select.

---

### Task T5.3: Per-package sprite storage and resolution

**Files:**
- Modify: `MapEditorPro.html`
  - `SpriteStore` (anchor `const SpriteStore = (() => {`, ~L4657): `save`, `loadByCategory`, `remove`, new `loadForPackage`, `keyFor`.
  - `Terrain.getUploadedUrl` and `applyHexDbOverrides` (anchor `function getUploadedUrl(name) { return _uploadedUrls[name] || null; }`, ~L2450).
  - `Packages`: new `spriteSrc`; `publishPackageSprites` local lookup (anchor `const local = await SpriteStore.loadAll();` inside it, ~L7792).
  - Callsites replaced with `Packages.spriteSrc`: `_bldSpriteUrl` (anchor `function _bldSpriteUrl(b) {`), palette hex image (anchor `img.src = spr ? spr.src :`), palette building image (anchor `img.src = bld.spriteName ? (Terrain.getUploadedUrl(bld.spriteName)`), HexDB panel (anchor `const spriteSrc = hex.spriteName`), BldDB panel (anchor `const _sprDir = bld.buildingCategory === 'Bridge'`).
  - `GitHubSync.publishAllSprites` / `cleanGhostSprites` (anchors `const all = await SpriteStore.loadAll();\n      if (!all.length) { UI.toast('No sprites in local store'); return; }` and `const local = await SpriteStore.loadAll();\n      const ghosts`): postapoc only.
  - `showSpritePicker` (anchor `const cached = await SpriteStore.loadByCategory(category);`).
- Create: `tests/packages-sprites-store.spec.ts`

**Interfaces:**
- Consumes: `GitHubSync.BASE_URL`.
- Produces:
  - `SpriteStore.keyFor(pkg, name)` -> `name` for `postapoc`, else `"<pkg>/<name>"`; `SpriteStore.save(name, dataUrl, category='hex', pkg='postapoc')`; `SpriteStore.loadForPackage(pkg) -> entries with bare name`; `SpriteStore.loadByCategory(category, pkg='postapoc')` (postapoc entries plus `pkg` entries, bare names, `pkg` wins); `SpriteStore.remove(name, pkg='postapoc')`. `loadAll()` stays raw (qualified names).
  - `Terrain.getUploadedUrl(name, pkg?)`: package-qualified entry first, then bare name.
  - `Packages.spriteSrc(rec, kind: 'hex'|'bld') -> string`: uploaded data URL, else `packages/postapoc/sprites/<dir>/<name>.png` (default package, relative) or `<BASE_URL>/packages/<pkg>/sprites/<dir>/<name>.png`. `<dir>`: `hex` for hexes and Bridge buildings, `terrain/roads` for `isRoad`, else `buildings`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, withPat, dataUrl, TINY_PNG, BASE } from './helpers-github';

test('sprites are stored and resolved per package', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    await SpriteStore.save('Foo', 'data:image/png;base64,AAAA', 'hex');
    await SpriteStore.save('Foo', 'data:image/png;base64,BBBB', 'hex', 'medieval');
    Terrain.registerUploadedUrls({ 'Foo': 'data:A', 'medieval/Foo': 'data:B' });
    const names = async (p: string) => (await SpriteStore.loadForPackage(p)).map((e: any) => e.name).filter((n: string) => n === 'Foo');
    return {
      pkg: await names('medieval'), base: await names('postapoc'),
      raw: (await SpriteStore.loadAll()).map((e: any) => e.name).filter((n: string) => n.endsWith('Foo')).sort(),
      merged: (await SpriteStore.loadByCategory('hex', 'medieval')).filter((e: any) => e.name === 'Foo').map((e: any) => e.dataUrl),
      urlPkg: Terrain.getUploadedUrl('Foo', 'medieval'), urlBase: Terrain.getUploadedUrl('Foo', 'postapoc'), urlLegacy: Terrain.getUploadedUrl('Foo'),
      srcPkg: Packages.spriteSrc({ spriteName: 'X', package: 'medieval' }, 'hex'),
      srcBase: Packages.spriteSrc({ spriteName: 'X' }, 'hex'),
      srcBridge: Packages.spriteSrc({ spriteName: 'Y', package: 'medieval', buildingCategory: 'Bridge' }, 'bld'),
      srcRoad: Packages.spriteSrc({ spriteName: 'Z', isRoad: true }, 'bld'),
      srcUp: Packages.spriteSrc({ spriteName: 'Foo', package: 'medieval' }, 'hex'),
    };
  });
  expect(r.pkg).toEqual(['Foo']);
  expect(r.base).toEqual(['Foo']);
  expect(r.raw).toEqual(['Foo', 'medieval/Foo']);
  expect(r.merged).toEqual(['data:image/png;base64,BBBB']);     // active package wins
  expect([r.urlPkg, r.urlBase, r.urlLegacy]).toEqual(['data:B', 'data:A', 'data:A']);
  expect(r.srcPkg).toBe(`${BASE}/packages/medieval/sprites/hex/X.png`);
  expect(r.srcBase).toBe('packages/postapoc/sprites/hex/X.png');
  expect(r.srcBridge).toBe(`${BASE}/packages/medieval/sprites/hex/Y.png`);
  expect(r.srcRoad).toBe('packages/postapoc/sprites/terrain/roads/Z.png');
  expect(r.srcUp).toBe('data:B');
});

test('Publish Sprites never pushes package sprites into the postapoc pool', async ({ page }) => {
  await withPat(page);
  const gh = await mockGitHub(page);
  await openEditor(page);
  await page.evaluate(async (d) => {
    await SpriteStore.save('Only_Base', d, 'hex');
    await SpriteStore.save('Only_Med', d, 'hex', 'medieval');
    await GitHubSync.publishAllSprites();
  }, dataUrl(TINY_PNG));
  expect(gh.puts).toContain('packages/postapoc/sprites/hex/Only_Base.png');
  expect(gh.puts.some(p => p.includes('Only_Med') || p.includes('medieval'))).toBe(false);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-sprites-store.spec.ts --reporter=line`
Expected: FAIL, `SpriteStore.loadForPackage is not a function`.

- [ ] **Step 3: Implement**

`SpriteStore`: replace `save`, `loadByCategory`, `remove` and the return line:

```js
  function keyFor(pkg, name) { return (!pkg || pkg === 'postapoc') ? name : `${pkg}/${name}`; }

  async function save(name, dataUrl, category = 'hex', pkg = 'postapoc') {
    const db = await _open();
    const rec = { name: keyFor(pkg, name), dataUrl, category };
    if (pkg && pkg !== 'postapoc') { rec.package = pkg; rec.baseName = name; }
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
    });
  }
```

(leave `loadAll` as is), then:

```js
  async function loadForPackage(pkg = 'postapoc') {
    const all = await loadAll();
    return all.filter(e => (e.package || 'postapoc') === pkg).map(e => ({ ...e, name: e.baseName || e.name }));
  }

  // postapoc entries plus the given package's; the package wins on equal names. Names are bare.
  async function loadByCategory(category, pkg = 'postapoc') {
    const merged = new Map();
    for (const e of await loadForPackage('postapoc')) merged.set(e.name, e);
    if (pkg !== 'postapoc') for (const e of await loadForPackage(pkg)) merged.set(e.name, e);
    return [...merged.values()].filter(e => (e.category || 'hex') === category);
  }

  async function remove(name, pkg = 'postapoc') {
    const db = await _open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(keyFor(pkg, name));
      tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
    });
  }

  return { save, loadAll, loadByCategory, loadForPackage, keyFor, remove };
```

`Terrain`: replace `function getUploadedUrl(name) { return _uploadedUrls[name] || null; }` with:

```js
  function getUploadedUrl(name, pkg) {
    if (pkg && pkg !== 'postapoc' && _uploadedUrls[pkg + '/' + name]) return _uploadedUrls[pkg + '/' + name];
    return _uploadedUrls[name] || null;
  }
```

and in `applyHexDbOverrides` replace `const src = _uploadedUrls[h.spriteName] || (spriteDir + h.spriteName + '.png');` with:

```js
      const pkg = h.package || 'postapoc';
      const src = getUploadedUrl(h.spriteName, pkg) ||
        (pkg === 'postapoc' ? spriteDir + h.spriteName + '.png'
                            : `${GitHubSync.BASE_URL}/${spriteDir.replace('packages/postapoc/', 'packages/' + pkg + '/')}${h.spriteName}.png`);
```

`Packages`: add after `_esc`:

```js
  // Best <img src> for a hex ('hex') or building ('bld') record, honouring its package.
  function spriteSrc(rec, kind) {
    if (!rec || !rec.spriteName) return '';
    const pkg = rec.package || 'postapoc';
    const uploaded = Terrain.getUploadedUrl(rec.spriteName, pkg);
    if (uploaded) return uploaded;
    const dir = kind === 'bld' ? (rec.buildingCategory === 'Bridge' ? 'hex' : rec.isRoad ? 'terrain/roads' : 'buildings') : 'hex';
    const rel = `packages/${pkg}/sprites/${dir}/${rec.spriteName}.png`;
    return pkg === 'postapoc' ? rel : `${BASE_URL}/${rel}`;
  }
```

Export `spriteSrc` from `Packages`. In `publishPackageSprites` replace

```js
    const local = await SpriteStore.loadAll();
    const localByName = new Map(local.map(e => [e.name, e]));
```

with

```js
    const [baseLocal, pkgLocal] = await Promise.all([SpriteStore.loadForPackage('postapoc'), SpriteStore.loadForPackage(id)]);
    const localByName = new Map([...baseLocal, ...pkgLocal].map(e => [e.name, e]));   // package copy wins
```

Callsites:
- `_bldSpriteUrl(b)`: body becomes `return Packages.spriteSrc(b, 'bld');`
- palette hex: `img.src = spr ? spr.src : (h.spriteName ? \`packages/postapoc/sprites/hex/${h.spriteName}.png\` : '');` -> `img.src = spr ? spr.src : Packages.spriteSrc(h, 'hex');`
- palette building: `img.src = bld.spriteName ? (Terrain.getUploadedUrl(...) || \`...\`) : '';` -> `img.src = Packages.spriteSrc(bld, 'bld');`
- HexDB panel: `const spriteSrc = hex.spriteName ? (Terrain.getUploadedUrl(hex.spriteName) || \`packages/postapoc/sprites/hex/${_esc(hex.spriteName)}.png\`) : '';` -> `const spriteSrc = _esc(Packages.spriteSrc(hex, 'hex'));`
- BldDB panel: remove the `_sprDir` declaration and set `const spriteSrc = _esc(Packages.spriteSrc(bld, 'bld'));`
- `publishAllSprites`: `const all = await SpriteStore.loadForPackage('postapoc');`; `cleanGhostSprites`: `const local = await SpriteStore.loadForPackage('postapoc');`
- `showSpritePicker`: add `let cacheOwner = {};` next to `let cacheMap = {};`, then:

```js
      const cached = await SpriteStore.loadByCategory(category, Packages.getActive());
      cacheMap   = Object.fromEntries(cached.map(e => [e.name, e.dataUrl]));
      cacheOwner = Object.fromEntries(cached.map(e => [e.name, e.package || 'postapoc']));
```

and in the picker's delete callback change `await SpriteStore.remove(n);` to `await SpriteStore.remove(n, cacheOwner[n] || 'postapoc');`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-sprites-store.spec.ts --reporter=line`
Expected: 2 passed. Then `npx playwright test --reporter=line` to catch image-path regressions.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-sprites-store.spec.ts
git commit -m "feat(packages): per-package sprite storage and src resolution" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** existing postapoc keys are unchanged (no IndexedDB migration); every mass operation on `SpriteStore.loadAll()` that talks to the postapoc server pool now uses `loadForPackage('postapoc')`.

---

### Task T5.4: Sprite upload: collision check and PNG validation or conversion

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: add `normalizeSpriteFile`, `checkSpriteName`.
  - `UI.handleSpriteUpload` (anchor `async function handleSpriteUpload(files) {`, ~L6011); add `_confirmAsync` next to it.
- Create: `tests/packages-sprite-upload.spec.ts`

**Interfaces:**
- Consumes: `SpriteStore.save/loadForPackage` (T5.3), `Terrain.registerUploadedUrls`, `UI.showModal`, `HexDB.getAll`, `BldDB.getAll`.
- Produces:
  - `Packages.normalizeSpriteFile(file) -> Promise<{ok:true,file:File,converted:boolean,warnings:string[]}|{ok:false,error:string}>` (PNG kept as is; JPEG/WebP/GIF converted to PNG; unreadable rejected; non-512x512 gives a warning).
  - `Packages.checkSpriteName(pkg, name, category) -> Promise<{collides:'self'|'postapoc'|null}>`.
  - Uploads while a non-default package is active are stored under that package and are NOT pushed to the postapoc server pool (they ship with the package publish).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, withPat, REGISTRY_POSTAPOC, MEDIEVAL } from './helpers-github';

test.describe('sprite validation', () => {
  test.beforeEach(async ({ page }) => { await openEditor(page); });

  test('normalizeSpriteFile keeps PNG, converts JPEG, rejects non-images and warns on size', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const mk = (w: number, h: number, type: string, name: string) => new Promise<File>(res => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.fillRect(0, 0, w, h);
        c.toBlob(b => res(new File([b!], name, { type })), type);
      });
      const png = await Packages.normalizeSpriteFile(await mk(512, 512, 'image/png', 'a.png'));
      const jpg = await Packages.normalizeSpriteFile(await mk(64, 64, 'image/jpeg', 'b.jpg'));
      const bad = await Packages.normalizeSpriteFile(new File(['hello'], 'c.txt', { type: 'text/plain' }));
      return { png: { ok: png.ok, converted: png.converted, warnings: png.warnings },
               jpg: { ok: jpg.ok, converted: jpg.converted, name: jpg.file.name, type: jpg.file.type, warnings: jpg.warnings },
               bad: { ok: bad.ok, error: bad.error } };
    });
    expect(r.png).toEqual({ ok: true, converted: false, warnings: [] });
    expect(r.jpg).toMatchObject({ ok: true, converted: true, name: 'b.png', type: 'image/png' });
    expect(r.jpg.warnings[0]).toContain('512');
    expect(r.bad.ok).toBe(false);
  });

  test('checkSpriteName reports same-package and postapoc collisions', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await SpriteStore.save('Mine', 'data:x', 'hex', 'medieval');
      await SpriteStore.save('Base_1', 'data:x', 'hex');
      return {
        self: await Packages.checkSpriteName('medieval', 'Mine', 'hex'),
        base: await Packages.checkSpriteName('medieval', 'Base_1', 'hex'),
        fresh: await Packages.checkSpriteName('medieval', 'Brand_New', 'hex'),
        otherCat: await Packages.checkSpriteName('medieval', 'Mine', 'buildings'),
      };
    });
    expect(r).toEqual({ self: { collides: 'self' }, base: { collides: 'postapoc' }, fresh: { collides: null }, otherCat: { collides: null } });
  });
});

test('uploading a JPEG while a package is active stores a PNG under that package and does not push it', async ({ page }) => {
  await withPat(page);
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());      // oxipng is optional
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await page.evaluate(() => Packages.setActive('medieval'));
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    c.getContext('2d')!.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/jpeg').split(',')[1];
  });
  await page.setInputFiles('#sprite-upload-input', { name: 'tile_conv.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(async () => (await SpriteStore.loadForPackage('medieval')).some((e: any) => e.name === 'tile_conv'));
  const rec = await page.evaluate(async () => (await SpriteStore.loadForPackage('medieval')).find((e: any) => e.name === 'tile_conv'));
  expect(rec.dataUrl.startsWith('data:image/png')).toBe(true);
  expect(await page.evaluate(() => Terrain.getUploadedUrl('tile_conv', 'medieval'))).toBe(rec.dataUrl);
  expect(gh.puts).toEqual([]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-sprite-upload.spec.ts --reporter=line`
Expected: FAIL, `Packages.normalizeSpriteFile is not a function`; the upload test times out because the JPEG is stored as `tile_conv` under `postapoc` with a JPEG data URL.

- [ ] **Step 3: Implement**

In `Packages` (after `spriteSrc`):

```js
  const _PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  // Keeps real PNGs untouched, converts other readable images to PNG, rejects everything else.
  async function normalizeSpriteFile(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) { return { ok: false, error: `"${file.name}" is not a readable image (use PNG).` }; }
    const warnings = [];
    if (bmp.width !== 512 || bmp.height !== 512)
      warnings.push(`"${file.name}" is ${bmp.width}×${bmp.height}; sprites are expected to be 512×512.`);
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (_PNG_SIG.every((b, i) => head[i] === b)) {
      if (bmp.close) bmp.close();
      return { ok: true, file, converted: false, warnings };
    }
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const out = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
    return { ok: true, file: out, converted: true, warnings };
  }

  // 'self': this package already has that sprite (same category). 'postapoc': the name is used by the base
  // content, which is confusing even though folders are separate on the server.
  async function checkSpriteName(pkg, name, category) {
    const own = await SpriteStore.loadForPackage(pkg);
    if (own.some(e => e.name === name && (e.category || 'hex') === category)) return { collides: 'self' };
    if (pkg !== 'postapoc') {
      const base = await SpriteStore.loadForPackage('postapoc');
      const inStore = base.some(e => e.name === name);
      const inDb = [...HexDB.getAll(), ...BldDB.getAll()].some(r => (r.package || 'postapoc') === 'postapoc' && r.spriteName === name);
      if (inStore || inDb) return { collides: 'postapoc' };
    }
    return { collides: null };
  }
```

Export `normalizeSpriteFile, checkSpriteName`.

In `UI`, add before `handleSpriteUpload` and replace that function:

```js
  function _confirmAsync(title, message, okLabel) {
    return new Promise(resolve => {
      UI.showModal({ title, bodyHtml: `<p>${message}</p>`,
        actions: [{ label: 'Cancel', kind: 'cancel', onClick: () => resolve(false) },
                  { label: okLabel, kind: 'danger', onClick: () => resolve(true) }],
        onClose: () => resolve(false) });
    });
  }

  async function handleSpriteUpload(files) {
    const pkg = (typeof Packages !== 'undefined') ? Packages.getActive() : 'postapoc';
    const uploadCategory = (_spritePickerOpts.folder || '').includes('buildings') ? 'buildings' : 'hex';
    for (const rawFile of files) {
      const norm = await Packages.normalizeSpriteFile(rawFile);
      if (!norm.ok) { toast('⚠ ' + norm.error); continue; }
      norm.warnings.forEach(w => toast('⚠ ' + w));
      if (norm.converted) toast(`Converted "${rawFile.name}" to PNG`);
      const name = norm.file.name.replace(/\.[^.]+$/, '');
      const chk = await Packages.checkSpriteName(pkg, name, uploadCategory);
      if (chk.collides === 'self' &&
          !(await _confirmAsync('Replace sprite', `A sprite named "${name}" already exists in package "${pkg}". Replace it?`, 'Replace'))) continue;
      if (chk.collides === 'postapoc')
        toast(`⚠ "${name}" has the same name as a postapoc sprite. It is stored under "${pkg}" and does not replace the base one.`);
      const optimizedFile = await _optimizePng(norm.file);
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(optimizedFile);
      });
      await SpriteStore.save(name, dataUrl, uploadCategory, pkg);
      Terrain.registerUploadedUrls({ [SpriteStore.keyFor(pkg, name)]: dataUrl });
      toast(`Uploaded "${name}"` + (pkg !== 'postapoc' ? ` to package "${pkg}"` : ''));
      if (pkg === 'postapoc') GitHubSync.pushSprite(name, optimizedFile, uploadCategory);   // other packages ship on publish
    }
    if (document.getElementById('sprite-picker-modal').classList.contains('open')) {
      showSpritePicker(_spritePickerCallback, _spritePickerOpts);
    }
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-sprite-upload.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-sprite-upload.spec.ts
git commit -m "feat(packages): sprite name collision check and PNG validation/conversion on upload" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** real PNGs are never re-encoded (alpha and metadata preserved); the replace confirmation resolves exactly once even when the modal is dismissed.

---

### Task T5.5: Searchable reskin picker with sprite preview

**Files:**
- Modify: `MapEditorPro.html`
  - `HexDB.promptReskin` (anchor `const baseId = window.prompt(\`Reskin which postapoc hex id?`, ~L9920) and `BldDB.promptReskin` (anchor `const baseId = window.prompt(\`Reskin which postapoc building id?`, ~L11335).
  - `Packages`: new `openReskinPicker`.
  - CSS after `.pkg-error`.
- Create: `tests/packages-reskin.spec.ts`

**Interfaces:**
- Consumes: `Packages.spriteSrc`, `UI.showModal`, `HexDB.addReskin(baseId)`, `BldDB.addReskin(baseId)`.
- Produces: `Packages.openReskinPicker({ kind: 'hex'|'bld', entries, onPick(id) })`; DOM `#reskin-search`, `.reskin-item[data-id]` (disabled when the active package already reskinned that id), `#reskin-empty`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, REGISTRY_POSTAPOC, MEDIEVAL, seedBuildings } from './helpers-github';

test.beforeEach(async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2 && HexDB.getAll().length > 0);
  await page.evaluate(() => Packages.setActive('medieval'));
});

test('hex reskin uses a searchable picker, not window.prompt', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.dismiss(); });
  await page.click('#tab-hexdb');
  await page.click('#hexdb-add-reskin-btn');
  const search = page.locator('#reskin-search');
  await expect(search).toBeVisible();
  const total = await page.locator('.reskin-item').count();
  expect(total).toBeGreaterThan(5);
  await search.fill('plain_1');
  expect(await page.locator('.reskin-item:visible').count()).toBeLessThan(total);
  await search.fill('zzz_no_such_id');
  await expect(page.locator('#reskin-empty')).toBeVisible();
  await search.fill('plain_1');
  await page.locator('.reskin-item[data-id="Plain_1"]').click();
  const pkgs = await page.evaluate(() => HexDB.getData().hexes.filter((h: any) => h.id === 'Plain_1').map((h: any) => h.package || 'postapoc').sort());
  expect(pkgs).toEqual(['medieval', 'postapoc']);
  expect(dialogs).toBe(0);

  await page.click('#hexdb-add-reskin-btn');
  await expect(page.locator('.reskin-item[data-id="Plain_1"]')).toBeDisabled();
});

test('building reskin uses the same picker', async ({ page }) => {
  await seedBuildings(page, [{ id: 'Farm_X', spriteName: 'Farm_1', buildingCategory: 'Standard', type: 'Ground Building' }]);
  await page.click('#tab-buildings');
  await page.click('#bld-add-reskin-btn');
  await page.fill('#reskin-search', 'farm_x');
  await page.locator('.reskin-item[data-id="Farm_X"]').click();
  const pkgs = await page.evaluate(() => BldDB.getAll().filter((b: any) => b.id === 'Farm_X').map((b: any) => b.package || 'postapoc').sort());
  expect(pkgs).toEqual(['medieval', 'postapoc']);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-reskin.spec.ts --reporter=line`
Expected: FAIL, `#reskin-search` not found (a native prompt dialog was dismissed instead).

- [ ] **Step 3: Implement**

`Packages` (after `checkSpriteName`):

```js
  // Replaces window.prompt: a searchable list of postapoc entries with sprite previews.
  function openReskinPicker({ kind, entries, onPick }) {
    const base = entries.filter(e => (e.package || 'postapoc') === 'postapoc');
    const taken = new Set(entries.filter(e => e.package === _active).map(e => e.id));
    const items = base.map(e =>
      `<button class="reskin-item" data-id="${_esc(e.id)}" ${taken.has(e.id) ? 'disabled title="Already reskinned in this package"' : ''}>` +
      `<img src="${_esc(spriteSrc(e, kind))}" alt="" loading="lazy" onerror="this.style.opacity=.2"><span>${_esc(e.id)}</span></button>`).join('');
    const m = UI.showModal({
      title: `Reskin which postapoc ${kind === 'bld' ? 'building' : 'hex'}?`,
      bodyHtml: `<input id="reskin-search" type="search" placeholder="Search ids…" autocomplete="off">` +
                `<div id="reskin-list" class="reskin-list">${items}</div><div id="reskin-empty" style="display:none">No matches</div>`,
      actions: [{ label: 'Cancel', kind: 'cancel' }],
    });
    const input = m.el.querySelector('#reskin-search');
    const list = m.el.querySelector('#reskin-list');
    const empty = m.el.querySelector('#reskin-empty');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll('.reskin-item').forEach(b => {
        const hit = !q || b.dataset.id.toLowerCase().includes(q);
        b.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      empty.style.display = shown ? 'none' : '';
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('.reskin-item');
      if (!b || b.disabled) return;
      m.close();
      onPick(b.dataset.id);
    });
    input.focus();
  }
```

Export `openReskinPicker`.

`HexDB.promptReskin`: replace the `options`/`window.prompt` lines with

```js
    Packages.openReskinPicker({ kind: 'hex', entries: _data.hexes, onPick: addReskin });
```

`BldDB.promptReskin`: replace its `options`/`window.prompt` lines with

```js
    Packages.openReskinPicker({ kind: 'bld', entries: _data.buildings, onPick: addReskin });
```

(keep the leading `if (typeof Packages === 'undefined' || Packages.getActive() === 'postapoc') { ... return; }` guard in both).

CSS:

```css
.reskin-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; max-height: 320px; overflow-y: auto; margin-top: 8px; }
.reskin-item { display: flex; align-items: center; gap: 6px; background: var(--hover); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 4px; font-size: 11px; cursor: pointer; text-align: left; }
.reskin-item img { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; }
.reskin-item:disabled { opacity: .4; cursor: default; }
#reskin-search { width: 100%; padding: 6px 8px; background: #313244; border: 1px solid #45475a; border-radius: 4px; color: #cdd6f4; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-reskin.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-reskin.spec.ts
git commit -m "feat(packages): searchable reskin picker with sprite preview replaces prompt()" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** ids are matched by `data-id` (never interpolated into JS); ids already reskinned by the active package are disabled to prevent duplicates.

---

### Task T5.6: Publish dialog: missing sprites, version bump, changelog

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: new `nextVersion`, `findMissingSprites`, `openPublishDialog`, `_fetchPackageJson`; `publishPackage` (anchors `async function publishPackage(id) {` and `// Bump version`); panel Publish button (T5.1 markup `Packages.openPublishConfirm('${pid}')`).
  - CSS after `.reskin-item:disabled`.
- Create: `tests/packages-publish.spec.ts`

**Interfaces:**
- Consumes: `_packageSpriteRefs`, `SpriteStore.loadForPackage`, `GitHubSync._putText/_putBinary/_withPublishBtn`, `UI.showModal`. Phase 0's overwrite guard and diff summary: if they were implemented inside `openPublishConfirm`, call the same helper from `openPublishDialog` and render its summary at the top of `#pub-dialog`; the write order (package.json after DBs and sprites, registry last) is unchanged here.
- Produces: `Packages.nextVersion(version, 'patch'|'minor'|'major'|'none') -> string`; `Packages.findMissingSprites(id) -> Promise<{name,category}[]>`; `Packages.openPublishDialog(id)`; `Packages.publishPackage(id, { bump?, changelog? })` (default bump `patch`). `package.json` gains `changelog: [{version,date,note}]`, appended to the entries already on the server.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, withPat, REGISTRY_POSTAPOC, MEDIEVAL, hexRec, seedHexes, dataUrl, TINY_PNG } from './helpers-github';

test('nextVersion', async ({ page }) => {
  await openEditor(page);
  const v = await page.evaluate(() => ['patch', 'minor', 'major', 'none'].map(b => Packages.nextVersion('1.2.3', b)).concat(Packages.nextVersion('junk', 'patch')));
  expect(v).toEqual(['1.2.4', '1.3.0', '2.0.0', '1.2.3', '1.0.1']);
});

test('dialog lists missing sprites, bumps the version and records the changelog', async ({ page }) => {
  await withPat(page);
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await seedHexes(page, [hexRec('Med_A', 'medieval', 'Have_1'), hexRec('Med_B', 'medieval', 'Gone_1')]);
  await page.evaluate(d => SpriteStore.save('Have_1', d, 'hex', 'medieval'), dataUrl(TINY_PNG));
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="medieval"]').getByRole('button', { name: 'Publish' }).click();

  await expect(page.locator('#pub-missing')).toContainText('Gone_1');
  await expect(page.locator('#pub-missing')).not.toContainText('Have_1');
  await page.selectOption('#pub-bump', 'minor');
  await page.fill('#pub-changelog', 'Added tiles');
  await page.getByRole('button', { name: 'Publish now' }).click();            // blocked: missing sprites not acknowledged
  await expect(page.locator('#pub-error')).toContainText('Publish anyway');
  await page.check('#pub-ack');
  await page.getByRole('button', { name: 'Publish now' }).click();

  await expect.poll(() => gh.puts.includes('packages/registry.json')).toBe(true);
  const pkg = JSON.parse(gh.files.get('packages/medieval/package.json')!.toString());
  expect(pkg.version).toBe('1.1.0');
  expect(pkg.changelog).toEqual([expect.objectContaining({ version: '1.1.0', note: 'Added tiles' })]);
  expect(gh.puts).toContain('packages/medieval/sprites/hex/Have_1.png');
  expect(gh.puts.some(p => p.includes('Gone_1'))).toBe(false);
  expect(gh.puts.indexOf('packages/medieval/package.json')).toBeGreaterThan(gh.puts.indexOf('packages/medieval/hex_database.json'));
  expect(JSON.parse(gh.files.get('packages/registry.json')!.toString()).packages.find((p: any) => p.id === 'medieval').version).toBe('1.1.0');
});

test('without a token the dialog says so and publishes nothing', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="medieval"]').getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('#pub-nopat')).toBeVisible();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.locator('#pub-error')).toContainText('token');
  expect(gh.puts).toEqual([]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-publish.spec.ts --reporter=line`
Expected: FAIL, `Packages.nextVersion is not a function`; the dialog test times out waiting for `#pub-missing`.

- [ ] **Step 3: Implement**

`Packages`, add before `openPublishConfirm`:

```js
  function nextVersion(v, bump) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
    const [maj, min, pat] = m ? [+m[1], +m[2], +m[3]] : [1, 0, 0];
    if (bump === 'major') return `${maj + 1}.0.0`;
    if (bump === 'minor') return `${maj}.${min + 1}.0`;
    if (bump === 'none')  return `${maj}.${min}.${pat}`;
    return `${maj}.${min}.${pat + 1}`;
  }

  // Sprites referenced by the package's entries that exist neither locally nor on the server's postapoc pool.
  async function findMissingSprites(id) {
    const refs = await _packageSpriteRefs(id);
    const [pkgLocal, baseLocal] = await Promise.all([SpriteStore.loadForPackage(id), SpriteStore.loadForPackage('postapoc')]);
    const have = new Set([...pkgLocal, ...baseLocal].map(e => e.name));
    const missing = [];
    for (const [name, category] of refs) {
      if (have.has(name)) continue;
      let ok = false;
      try { ok = (await fetch(`${BASE_URL}/packages/postapoc/sprites/${category}/${name}.png`, { method: 'HEAD' })).ok; } catch (e) {}
      if (!ok) missing.push({ name, category });
    }
    return missing;
  }

  async function _fetchPackageJson(id) {
    try {
      const r = await fetch(`${BASE_URL}/packages/${id}/package.json?_=${Date.now()}`);
      return r.ok ? await r.json() : {};
    } catch (e) { return {}; }
  }

  async function openPublishDialog(id) {
    if (isDefault(id)) return openPublishConfirm(id);
    const entry = getEntry(id);
    if (!entry) return UI.toast('⚠ Package not found');
    const c = _counts(id);
    const missing = await findMissingSprites(id);
    const opts = ['patch', 'minor', 'major', 'none'].map(b =>
      `<option value="${b}">${b === 'none' ? 'No bump' : b[0].toUpperCase() + b.slice(1)} → v${nextVersion(entry.version, b)}</option>`).join('');
    const body = `<div id="pub-dialog">
      <p>${_esc(entry.name)}: ${c.hexes} hex tiles, ${c.blds} buildings. Current version v${_esc(entry.version || '1.0.0')}.</p>
      ${GitHubSync.isPATConfigured() ? '' : '<p id="pub-nopat" class="pkg-notice warn">No GitHub token: add one under ⚙ GitHub before publishing.</p>'}
      ${missing.length ? `<p class="pkg-notice warn">${missing.length} sprite(s) were found neither locally nor on the server:</p>
        <ul id="pub-missing">${missing.map(m => `<li>${_esc(m.category)}/${_esc(m.name)}.png</li>`).join('')}</ul>
        <label><input type="checkbox" id="pub-ack"> Publish anyway</label>` : ''}
      <label>Version <select id="pub-bump">${opts}</select></label>
      <label>Changelog note <textarea id="pub-changelog" rows="3" placeholder="What changed?"></textarea></label>
      <div id="pub-error" class="pkg-error"></div></div>`;
    let m;
    m = UI.showModal({ title: `Publish ${entry.name}`, bodyHtml: body, actions: [
      { label: 'Cancel', kind: 'cancel' },
      { label: 'Publish now', kind: 'primary', onClick: () => {
        const err = m.el.querySelector('#pub-error');
        if (!GitHubSync.isPATConfigured()) { err.textContent = 'Add a GitHub token first (⚙ GitHub).'; return false; }
        if (missing.length && !m.el.querySelector('#pub-ack').checked) { err.textContent = 'Tick "Publish anyway" to publish with missing sprites.'; return false; }
        publishPackage(id, { bump: m.el.querySelector('#pub-bump').value, changelog: m.el.querySelector('#pub-changelog').value.trim() });
      } },
    ] });
  }
```

`publishPackage`: change the signature to `async function publishPackage(id, opts = {}) {` and replace the three lines under `// Bump version` (`const [maj, min, pat] = ...` and `const newVersion = ...`) with:

```js
      const newVersion = nextVersion(entry.version, opts.bump || 'patch');
      const logEntry = opts.changelog ? { version: newVersion, date: new Date().toISOString().slice(0, 10), note: opts.changelog } : null;
```

and replace the `const pkgJson = JSON.stringify({ ...entry, version: newVersion }, null, 2);` line (keep whatever extra fields Phase 0 merges into it) with:

```js
      const prev = await _fetchPackageJson(id);
      const pkgJson = JSON.stringify({ ...prev, ...entry, version: newVersion,
        changelog: [...(prev.changelog || []), ...(logEntry ? [logEntry] : [])] }, null, 2);
```

Panel: in `renderPanel` change `onclick="Packages.openPublishConfirm('${pid}')"` to `onclick="Packages.openPublishDialog('${pid}')"`. Export `nextVersion, findMissingSprites, openPublishDialog`.

CSS:

```css
#pub-dialog label { display: block; margin-top: 8px; font-size: 12px; color: #a6adc8; }
#pub-dialog textarea { display: block; width: 100%; margin-top: 4px; background: #313244; border: 1px solid #45475a; border-radius: 4px; color: #cdd6f4; padding: 6px; }
#pub-missing { font-size: 12px; font-family: monospace; margin: 4px 0 8px 18px; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-publish.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-publish.spec.ts
git commit -m "feat(packages): publish dialog with missing-sprite list, version bump and changelog" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `m` is assigned after `showModal` returns and only used inside later click handlers; `publishPackage` still writes `package.json` after databases and sprites, registry last.

---

### Task T5.7: Import ZIP validation and summary

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: new `validatePackageZip`; `_onImportFilePicked` (anchor `async function _onImportFilePicked(file) {`), `_showImportModal`, `closeImportModal`.
  - HTML: `#pkg-import-modal` (anchor `<div id="pkg-import-error" style="color:#f38ba8;font-size:12px;display:none"></div>` near `id="pkg-import-original-id"`).
- Create: `tests/packages-import-validate.spec.ts`

**Interfaces:**
- Consumes: `Packages._loadJSZip`, `UI.showModal`, `makeZip`/`mockJSZip` (T5.0).
- Produces: `Packages.validatePackageZip(zip) -> Promise<{ok, errors[], warnings[], pkg, hexes[], buildings[], summary:{hexCount,bldCount,spriteCount,missingSprites[]}}>`; `_importValidation` state; DOM `#pkg-import-summary` (counts + warnings) and, for rejected ZIPs, a modal containing `#pkg-import-errors`. Rules: `package.json` required and parseable, `id` present (non-kebab ids are a warning because the modal lets the user rename), no `..` or absolute paths, at most 3000 files, entries need unique string ids, only `sprites/hex|buildings/*.png` are imported, referenced-but-absent sprites are warnings (they may live in the postapoc pool).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, mockJSZip, makeZip, pkgJson, hexRec, TINY_PNG } from './helpers-github';

test.beforeEach(async ({ page }) => {
  await mockJSZip(page);
  await mockGitHub(page);
  await openEditor(page);
});

const pick = (page, buffer: Buffer) =>
  page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer });

test('a ZIP without package.json is rejected with the reason', async ({ page }) => {
  await pick(page, await makeZip({ 'hex_database.json': '{"hexes":[]}' }));
  await expect(page.locator('#pkg-import-errors')).toContainText('missing package.json');
  await expect(page.locator('#pkg-import-modal')).toBeHidden();
});

test('unsafe paths and duplicate ids are rejected', async ({ page }) => {
  await pick(page, await makeZip({
    'package.json': pkgJson('old'),
    'hex_database.json': JSON.stringify({ hexes: [hexRec('A', 'old'), hexRec('A', 'old')] }),
    '../evil.png': TINY_PNG,
  }));
  const text = await page.locator('#pkg-import-errors').innerText();
  expect(text).toContain('Duplicate entry id "A"');
  expect(text).toContain('Unsafe path');
});

test('a valid ZIP shows a summary with warnings before import', async ({ page }) => {
  await pick(page, await makeZip({
    'package.json': pkgJson('old'),
    'hex_database.json': JSON.stringify({ hexes: [hexRec('Old_A', 'old', 'Spr_A'), hexRec('Old_B', 'old', 'Gone_1')] }),
    'building_database.json': JSON.stringify({ buildings: [{ id: 'Old_Farm', spriteName: 'Farm_Spr' }] }),
    'sprites/hex/Spr_A.png': TINY_PNG,
    'sprites/buildings/Farm_Spr.png': TINY_PNG,
    'sprites/hex/notes.txt': 'x',
  }));
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  const s = page.locator('#pkg-import-summary');
  await expect(s).toContainText('2 hex tiles');
  await expect(s).toContainText('1 building');
  await expect(s).toContainText('2 sprites');
  await expect(s).toContainText('Sprite "Gone_1" is referenced but not in the ZIP');
  await expect(s).toContainText('Ignoring unsupported file sprites/hex/notes.txt');
  await expect(page.locator('#pkg-import-id')).toHaveValue('old');
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-import-validate.spec.ts --reporter=line`
Expected: FAIL, `#pkg-import-errors` not found (old code toasts and never validates).

- [ ] **Step 3: Implement**

`Packages` (near the Import section):

```js
  const _ID_RE = /^[a-z0-9][a-z0-9-]*$/;
  let _importValidation = null;

  async function validatePackageZip(zip) {
    const errors = [], warnings = [];
    const names = Object.keys(zip.files);
    if (names.length > 3000) errors.push(`ZIP has ${names.length} files (limit 3000).`);
    names.forEach(n => { if (n.includes('..') || n.startsWith('/')) errors.push(`Unsafe path in ZIP: ${n}`); });
    const readJson = async (name, required) => {
      const f = zip.file(name);
      if (!f) { if (required) errors.push(`ZIP is missing ${name}`); return null; }
      try { return JSON.parse(await f.async('text')); }
      catch (e) { errors.push(`${name} is not valid JSON: ${e.message}`); return null; }
    };
    const pkg = await readJson('package.json', true);
    if (pkg) {
      if (typeof pkg.id !== 'string' || !pkg.id) errors.push('package.json has no "id"');
      else if (!_ID_RE.test(pkg.id)) warnings.push(`Package id "${pkg.id}" is not lowercase-with-hyphens; rename it in the next step.`);
      if (typeof pkg.name !== 'string' || !pkg.name) warnings.push('package.json has no "name"; the id will be used.');
    }
    const hexData = await readJson('hex_database.json', false);
    const bldData = await readJson('building_database.json', false);
    if (hexData && !Array.isArray(hexData.hexes)) errors.push('hex_database.json has no "hexes" array');
    if (bldData && !Array.isArray(bldData.buildings)) errors.push('building_database.json has no "buildings" array');
    const hexes = Array.isArray(hexData?.hexes) ? hexData.hexes : [];
    const buildings = Array.isArray(bldData?.buildings) ? bldData.buildings : [];
    const seen = new Set();
    [...hexes, ...buildings].forEach(e => {
      if (!e || typeof e.id !== 'string' || !e.id) errors.push('An entry has no "id"');
      else if (seen.has(e.id)) errors.push(`Duplicate entry id "${e.id}"`);
      else seen.add(e.id);
    });
    const good = new Set();
    names.filter(n => !zip.files[n].dir && n.startsWith('sprites/')).forEach(n => {
      const m = /^sprites\/(hex|buildings)\/([^/]+)\.png$/i.exec(n);
      if (m) good.add(m[1] + '/' + m[2]);
      else warnings.push(`Ignoring unsupported file ${n} (only sprites/hex|buildings/*.png are imported).`);
    });
    const missing = [];
    [...hexes.map(h => ['hex', h.spriteName]),
     ...buildings.map(b => [b.buildingCategory === 'Bridge' ? 'hex' : 'buildings', b.spriteName])]
      .forEach(([cat, name]) => { if (name && !good.has(cat + '/' + name) && !missing.includes(name)) missing.push(name); });
    missing.forEach(n => warnings.push(`Sprite "${n}" is referenced but not in the ZIP.`));
    return { ok: errors.length === 0, errors, warnings, pkg, hexes, buildings,
             summary: { hexCount: hexes.length, bldCount: buildings.length, spriteCount: good.size, missingSprites: missing } };
  }
```

Replace `_onImportFilePicked`:

```js
  async function _onImportFilePicked(file) {
    if (!file) return;
    let zip;
    try { zip = await (await _loadJSZip()).loadAsync(file); }
    catch (e) { return UI.toast('⚠ Not a valid ZIP file'); }
    const v = await validatePackageZip(zip);
    if (!v.ok) {
      UI.showModal({ title: 'Cannot import this ZIP',
        bodyHtml: `<ul id="pkg-import-errors">${v.errors.map(e => `<li>${_esc(e)}</li>`).join('')}</ul>`,
        actions: [{ label: 'Close', kind: 'cancel' }] });
      return;
    }
    _showImportModal(String(v.pkg.id), String(v.pkg.name || v.pkg.id), zip, v);
  }
```

Replace `_showImportModal` and `closeImportModal`:

```js
  function _showImportModal(originalId, name, zip, v) {
    _importZip = zip;
    _importValidation = v || null;
    document.getElementById('pkg-import-original-id').value = originalId;
    document.getElementById('pkg-import-name').value        = name;
    document.getElementById('pkg-import-id').value          = originalId;
    document.getElementById('pkg-import-error').style.display = 'none';
    const s = v ? v.summary : null;
    document.getElementById('pkg-import-summary').innerHTML = s
      ? `<ul><li>${s.hexCount} hex tile${s.hexCount === 1 ? '' : 's'}</li><li>${s.bldCount} building${s.bldCount === 1 ? '' : 's'}</li><li>${s.spriteCount} sprite${s.spriteCount === 1 ? '' : 's'}</li></ul>` +
        v.warnings.map(w => `<div class="pkg-notice warn">${_esc(w)}</div>`).join('')
      : '';
    document.getElementById('pkg-import-modal').style.display = 'flex';
    document.getElementById('pkg-import-id').focus();
  }

  function closeImportModal() {
    document.getElementById('pkg-import-modal').style.display = 'none';
    _importZip = null;
    _importValidation = null;
  }
```

HTML: just before `<div id="pkg-import-error" ...>` add `<div id="pkg-import-summary" style="font-size:12px;color:#a6adc8;max-height:200px;overflow:auto"></div>`. Export `validatePackageZip`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-import-validate.spec.ts --reporter=line`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-import-validate.spec.ts
git commit -m "feat(packages): validate import ZIP and show a summary before importing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** nothing is written anywhere before the user confirms; errors never reach `confirmImport`.

---

### Task T5.8: Import: rollback on failure, keep reskin ids, rewrite cross-references

**Files:**
- Modify: `MapEditorPro.html`
  - `GitHubSync`: new `_removeFile` (after `_getFileSha`), exported next to `_putText`.
  - `Packages`: new `_rewriteAll`, `_rollback`, `_mergeIntoEditor`, `_importSpritesLocally`; `confirmImport` (anchor `async function confirmImport() {`): keep the validation block at the top (name, id, duplicate checks, `_importInProgress`, `const zip = _importZip;`) and replace everything from `try {` (the one containing `UI.progress(0, 'Starting import…');`) to the end of the function.
- Create: `tests/packages-import.spec.ts`

**Interfaces:**
- Consumes: `validatePackageZip`/`_importValidation` (T5.7), `GitHubSync._putText/_putBinary/_getFileSha/_deleteContents`, `SpriteStore.save`, `Terrain.registerUploadedUrls`, `HexDB.loadFromObject`, `BldDB.pushRecord`, `idPrefix`. If Phase 0 already loads imported entries into the editor, `_mergeIntoEditor` is idempotent (skips `(id, package)` pairs already present), so keep both.
- Produces: `GitHubSync._removeFile(path, message)`; `Packages._rewriteAll(hexes, buildings, originalId, newId, baseIds:Set<lowercase id>) -> {hexes, buildings, idMap:Map}`; `Packages._rollback(paths) -> Promise<string[]>` (paths that could not be removed). Reskin rule: an entry whose id does NOT start with the old package prefix but IS a postapoc id keeps its id. Reference fields rewritten when the value is in `idMap`: strings `destroyTransformTo, incomeTransformTo, storageUpgradeId, underTerrainId`; arrays `destroySource, destroySources, upgradeTo, requiredHex, parents`. Writes order: hex DB, building DB, sprites, `package.json`, registry; any failure removes every file written so far and leaves the registry and editor untouched.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, mockJSZip, makeZip, pkgJson, hexRec, withPat, TINY_PNG } from './helpers-github';

const build = () => makeZip({
  'package.json': pkgJson('old'),
  'hex_database.json': JSON.stringify({ hexes: [
    hexRec('Old_Tile', 'old', 'S1'),
    { ...hexRec('Old_Other', 'old', 'S1'), destroyTransformTo: 'Old_Tile', destroySource: ['Old_Tile', 'Plains_1'] },
    hexRec('Plain_1', 'old', 'S1'),                               // reskin of a postapoc id: id must stay
  ] }),
  'building_database.json': JSON.stringify({ buildings: [{ id: 'Old_Farm', spriteName: 'S2', destroyTransformTo: 'Old_Tile' }] }),
  'sprites/hex/S1.png': TINY_PNG, 'sprites/buildings/S2.png': TINY_PNG,
});

test.beforeEach(async ({ page }) => {
  await withPat(page);
  await mockJSZip(page);
});

const importAs = async (page, zip: Buffer, id: string) => {
  await page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer: zip });
  await page.fill('#pkg-import-id', id);
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
};

test('rewrites ids and cross-references, keeps reskin ids', async ({ page }) => {
  const gh = await mockGitHub(page);
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().some((h: any) => h.id === 'Plain_1'));
  await importAs(page, await build(), 'new-pack');
  await expect.poll(() => gh.puts.includes('packages/registry.json')).toBe(true);

  const hex = JSON.parse(gh.files.get('packages/new-pack/hex_database.json')!.toString());
  expect(hex.hexes.map((h: any) => h.id)).toEqual(['NewPack_Tile', 'NewPack_Other', 'Plain_1']);
  const other = hex.hexes[1];
  expect(other.destroyTransformTo).toBe('NewPack_Tile');
  expect(other.destroySource).toEqual(['NewPack_Tile', 'Plains_1']);          // unknown id untouched
  expect(hex.hexes.every((h: any) => h.package === 'new-pack')).toBe(true);
  const bld = JSON.parse(gh.files.get('packages/new-pack/building_database.json')!.toString());
  expect(bld.buildings[0]).toMatchObject({ id: 'NewPack_Farm', destroyTransformTo: 'NewPack_Tile' });
  expect(gh.puts.at(-2)).toBe('packages/new-pack/package.json');               // package.json right before the registry

  // entries are now in the editor, and the sprite is stored locally under the new package
  const local = await page.evaluate(async () => ({
    ids: HexDB.getData().hexes.filter((h: any) => h.package === 'new-pack').map((h: any) => h.id),
    sprites: (await SpriteStore.loadForPackage('new-pack')).map((e: any) => e.name).sort(),
  }));
  expect(local.ids).toEqual(['NewPack_Tile', 'NewPack_Other', 'Plain_1']);
  expect(local.sprites).toEqual(['S1', 'S2']);
});

test('a failed upload rolls back everything written so far', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.failWhen(p => p.endsWith('/sprites/buildings/S2.png'));
  await openEditor(page);
  await importAs(page, await build(), 'new-pack');
  await expect.poll(() => gh.deletes.length).toBeGreaterThanOrEqual(3);
  expect([...gh.files.keys()].filter(k => k.startsWith('packages/new-pack/'))).toEqual([]);
  expect(JSON.parse(gh.files.get('packages/registry.json')!.toString()).packages.map((p: any) => p.id)).toEqual(['postapoc']);
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.package === 'new-pack'))).toBe(false);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-import.spec.ts --reporter=line`
Expected: FAIL: ids come out as `NewPack_Plain_1` (reskin id lost), `destroyTransformTo` still `Old_Tile`, and nothing is deleted on failure.

- [ ] **Step 3: Implement**

`GitHubSync` (after `_getFileSha`):

```js
  async function _removeFile(path, message) {
    await _deleteContents(path, await _getFileSha(path), message);
  }
```

Export it: change `_putText, _putBinary, _listFolder, _withPublishBtn, BASE_URL,` to `_putText, _putBinary, _listFolder, _removeFile, _withPublishBtn, BASE_URL,`.

`Packages` (before `confirmImport`):

```js
  const _REF_FIELDS      = ['destroyTransformTo', 'incomeTransformTo', 'storageUpgradeId', 'underTerrainId'];
  const _REF_LIST_FIELDS = ['destroySource', 'destroySources', 'upgradeTo', 'requiredHex', 'parents'];

  // baseIds: lowercase ids of the postapoc entries. Entries not carrying the old prefix that match a
  // postapoc id are reskins and keep their id so they override the same slot at runtime.
  function _rewriteAll(hexes, buildings, originalId, newId, baseIds) {
    const oldP = idPrefix(originalId), newP = idPrefix(newId);
    const idMap = new Map();
    const newIdFor = id => {
      if (oldP && id.startsWith(oldP)) return newP + id.slice(oldP.length);
      if (baseIds.has(id.toLowerCase())) return id;
      return newP + id;
    };
    [...hexes, ...buildings].forEach(e => { const n = newIdFor(e.id); if (n !== e.id) idMap.set(e.id, n); });
    const fix = v => (typeof v === 'string' && idMap.has(v)) ? idMap.get(v) : v;
    const rewrite = e => {
      const out = { ...e, id: idMap.has(e.id) ? idMap.get(e.id) : e.id, package: newId };
      _REF_FIELDS.forEach(f => { if (f in out) out[f] = fix(out[f]); });
      _REF_LIST_FIELDS.forEach(f => { if (Array.isArray(out[f])) out[f] = out[f].map(fix); });
      return out;
    };
    return { hexes: hexes.map(rewrite), buildings: buildings.map(rewrite), idMap };
  }

  async function _rollback(paths) {
    const failed = [];
    for (const p of paths.slice().reverse()) {
      try { await GitHubSync._removeFile(p, `rollback import: ${p}`); } catch (e) { failed.push(p); }
    }
    return failed;
  }

  function _mergeIntoEditor(hexes, buildings) {
    const data = HexDB.getData();
    const have = new Set(data.hexes.map(h => h.id + '|' + (h.package || 'postapoc')));
    const fresh = hexes.filter(h => !have.has(h.id + '|' + h.package));
    if (fresh.length) HexDB.loadFromObject({ ...data, hexes: [...data.hexes, ...fresh] });
    const haveB = new Set(BldDB.getAll().map(b => b.id + '|' + (b.package || 'postapoc')));
    buildings.filter(b => !haveB.has(b.id + '|' + b.package)).forEach(b => BldDB.pushRecord(b));
  }

  async function _importSpritesLocally(zip, pkgId) {
    for (const [path, f] of Object.entries(zip.files)) {
      const m = /^sprites\/(hex|buildings)\/([^/]+)\.png$/i.exec(path);
      if (!m || f.dir) continue;
      const blob = await f.async('blob');
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      await SpriteStore.save(m[2], url, m[1].toLowerCase(), pkgId);
      Terrain.registerUploadedUrls({ [SpriteStore.keyFor(pkgId, m[2])]: url });
    }
  }
```

Replace the `try { ... } catch(e) { ... }` at the end of `confirmImport` (after the `const zip = _importZip; if (!zip) {...}` lines) with:

```js
    const written = [];
    const writeText = async (p, text, msg) => { await GitHubSync._putText(p, text, msg); written.push(p); };
    const writeBin  = async (p, blob, msg) => { await GitHubSync._putBinary(p, blob, msg); written.push(p); };
    try {
      UI.progress(0, 'Validating…');
      const v = _importValidation || await validatePackageZip(zip);
      if (!v.ok) throw new Error(v.errors[0]);
      const baseIds = new Set([...HexDB.getAll(), ...BldDB.getAll()]
        .filter(e => (e.package || 'postapoc') === 'postapoc').map(e => e.id.toLowerCase()));
      const { hexes, buildings } = _rewriteAll(v.hexes, v.buildings, origId, newId, baseIds);

      await writeText(`packages/${newId}/hex_database.json`,
        JSON.stringify({ version: 1, package: newId, hexes }, null, 2), `import ${newId}: hex_database.json`);
      UI.progress(10, 'Writing hex_database.json…');
      await writeText(`packages/${newId}/building_database.json`,
        JSON.stringify({ version: 1, package: newId, buildings }, null, 2), `import ${newId}: building_database.json`);
      UI.progress(20, 'Writing building_database.json…');

      const spriteFiles = Object.entries(zip.files).filter(([p, f]) => !f.dir && /^sprites\/(hex|buildings)\/[^/]+\.png$/i.test(p));
      let done = 0;
      for (const [path, file] of spriteFiles) {
        await writeBin(`packages/${newId}/${path}`, await file.async('blob'), `import ${newId}: ${path}`);
        done++;
        UI.progress(20 + Math.round((done / Math.max(spriteFiles.length, 1)) * 60), `Sprites: ${done}/${spriteFiles.length}…`);
      }

      const pkgText = JSON.stringify({ description: '', ...v.pkg, id: newId, name, version: '1.0.0', isDefault: false }, null, 2);
      await writeText(`packages/${newId}/package.json`, pkgText, `import package: ${newId}`);

      UI.progress(90, 'Updating registry…');
      let regData;
      try {
        const res = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
        regData = res.ok ? await res.json() : { version: 1, packages: [..._registry] };
      } catch (e) { regData = { version: 1, packages: [..._registry] }; }
      if (!regData.packages.find(p => p.id === newId)) regData.packages.push({ id: newId, name, isDefault: false, version: '1.0.0' });
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: add ${newId}`);

      _registry = regData.packages;
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      _mergeIntoEditor(hexes, buildings);
      await _importSpritesLocally(zip, newId);
      UI.progressDone(`✅ Package '${name}' imported`);
      UI.toast(`✅ Package '${name}' imported`);
      renderPanel();
      renderActiveDropdowns();
      closeImportModal();
      _importInProgress = false;
    } catch (e) {
      UI.progressDone('');
      const failed = await _rollback(written);
      UI.toast(`⚠ Import failed: ${e.message}. ` + (failed.length
        ? `${failed.length} file(s) could not be removed from the server.` : 'Nothing was left on the server.'));
      _importInProgress = false;
    }
```

Export `_rewriteAll` next to `_rewriteEntries`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-import.spec.ts tests/packages-import-validate.spec.ts --reporter=line`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-import.spec.ts
git commit -m "feat(packages): import keeps reskin ids, rewrites cross-references and rolls back on failure" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the registry is the last write so a failure before it leaves no trace; rollback runs in reverse order and reports files it could not delete; sprite upload errors are no longer swallowed.

---

### Task T5.9: Export from local state with an unpublished-changes warning

**Files:**
- Modify: `MapEditorPro.html`: `Packages.exportPackage` (anchor `async function exportPackage(id) {`, whole function replaced); new helpers `_stableStringify`, `entriesDiff`, `_localEntries`, `_serverEntries`, `_spriteBlob`.
- Create: `tests/packages-export.spec.ts`

**Interfaces:**
- Consumes: `_packageSpriteRefs`, `SpriteStore.loadForPackage`, `_loadJSZip`, `UI.showModal`.
- Produces: `Packages.entriesDiff(local, remote) -> {added, changed, removed, total}`; `Packages.exportPackage(id, {skipWarning?})`. The ZIP contains the LOCAL entries, `package.json` from the registry entry, and sprites resolved local package copy, local postapoc copy, published package copy, then postapoc pool. When local differs from the server (or the package was never published) a modal `#pkg-export-warn` offers `Export local version`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { openEditor } from './helpers';
import { mockGitHub, mockJSZip, readZip, REGISTRY_POSTAPOC, MEDIEVAL, hexRec, seedHexes, dataUrl, TINY_PNG } from './helpers-github';

test('entriesDiff counts added, changed and removed entries independent of key order', async ({ page }) => {
  await openEditor(page);
  const d = await page.evaluate(() => Packages.entriesDiff(
    [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 1 }, { id: 'c' }],
    [{ y: 2, x: 1, id: 'a' }, { id: 'b', x: 9 }, { id: 'gone' }]));
  expect(d).toEqual({ added: 1, changed: 1, removed: 1, total: 3 });
});

type Mode = 'never' | 'same' | 'differs';

// Seeds one local medieval hex + sprite. 'same'/'differs' publish the (migrated) local entry to the mock server first.
async function setup(page, mode: Mode) {
  await mockJSZip(page);
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2);
  await seedHexes(page, [hexRec('Med_A', 'medieval', 'Spr_1')]);
  await page.evaluate(d => SpriteStore.save('Spr_1', d, 'hex', 'medieval'), dataUrl(TINY_PNG));
  if (mode !== 'never') {
    const local = await page.evaluate(() => HexDB.getData().hexes.filter((h: any) => h.package === 'medieval'));
    const published = mode === 'same' ? local : local.map((h: any) => ({ ...h, type: 'Old' }));
    gh.files.set('packages/medieval/hex_database.json', Buffer.from(JSON.stringify({ hexes: published })));
  }
  await page.click('#tab-packages');
  return gh;
}
const exportBtn = page => page.locator('tr[data-pkg="medieval"]').getByRole('button', { name: /Export/ });

test('unpublished changes: warns, then exports the LOCAL version with its sprites', async ({ page }) => {
  await setup(page, 'differs');
  await exportBtn(page).click();
  await expect(page.locator('#pkg-export-warn')).toContainText('1 entry differs');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export local version' }).click()]);
  const zip = await readZip(fs.readFileSync((await dl.path())!));
  const hex = JSON.parse(await zip.file('hex_database.json')!.async('text'));
  expect(hex.hexes[0]).toMatchObject({ id: 'Med_A', type: 'Special' });             // local value, not the server's 'Old'
  expect(zip.file('sprites/hex/Spr_1.png')).not.toBeNull();
  expect(JSON.parse(await zip.file('package.json')!.async('text')).id).toBe('medieval');
});

test('never published: warns before exporting', async ({ page }) => {
  await setup(page, 'never');
  await exportBtn(page).click();
  await expect(page.locator('#pkg-export-warn')).toContainText('never been published');
});

test('in sync with the server: exports immediately without a warning', async ({ page }) => {
  await setup(page, 'same');
  const [dl] = await Promise.all([page.waitForEvent('download'), exportBtn(page).click()]);
  expect(dl.suggestedFilename()).toBe('medieval-1.0.0.zip');
  await expect(page.locator('#pkg-export-warn')).toHaveCount(0);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-export.spec.ts --reporter=line`
Expected: FAIL, `Packages.entriesDiff is not a function`; export tests find no `#pkg-export-warn` (old export needs the package to be published and never warns).

- [ ] **Step 3: Implement**

Replace `exportPackage` and add helpers in `Packages`:

```js
  function _stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + _stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }

  function entriesDiff(local, remote) {
    const r = new Map((remote || []).map(e => [e.id, _stableStringify(e)]));
    let added = 0, changed = 0;
    for (const e of local) {
      if (!r.has(e.id)) added++;
      else { if (r.get(e.id) !== _stableStringify(e)) changed++; r.delete(e.id); }
    }
    return { added, changed, removed: r.size, total: added + changed + r.size };
  }

  function _localEntries(id, kind) {
    return kind === 'hex'
      ? HexDB.getData().hexes.filter(h => h.package === id)
      : BldDB.getAll().filter(b => b.package === id);
  }

  async function _serverEntries(id, kind) {
    try {
      const r = await fetch(`${BASE_URL}/packages/${id}/${kind === 'hex' ? 'hex_database' : 'building_database'}.json?_=${Date.now()}`);
      if (!r.ok) return null;
      const j = await r.json();
      return (kind === 'hex' ? j.hexes : j.buildings) || [];
    } catch (e) { return null; }
  }

  async function _spriteBlob(id, name, fallbackCategory, localByName) {
    const loc = localByName.get(name);
    const category = loc?.category || fallbackCategory;
    const get = async url => { try { const r = await fetch(url); return r.ok ? await r.blob() : null; } catch (e) { return null; } };
    let blob = loc ? await get(loc.dataUrl) : null;
    if (!blob) blob = await get(`${BASE_URL}/packages/${id}/sprites/${category}/${name}.png?_=${Date.now()}`);
    if (!blob) blob = await get(`${BASE_URL}/packages/postapoc/sprites/${category}/${name}.png?_=${Date.now()}`);
    return blob ? { blob, category } : null;
  }

  async function exportPackage(id, opts = {}) {
    const entry = getEntry(id);
    if (!entry) return UI.toast('⚠ Package not found');
    const hexes = _localEntries(id, 'hex'), blds = _localEntries(id, 'bld');
    if (!opts.skipWarning) {
      const [sh, sb] = await Promise.all([_serverEntries(id, 'hex'), _serverEntries(id, 'bld')]);
      const d1 = entriesDiff(hexes, sh || []), d2 = entriesDiff(blds, sb || []);
      const total = d1.total + d2.total;
      if (total > 0) {
        const note = (sh === null && sb === null)
          ? 'This package has never been published.'
          : `${total} ${total === 1 ? 'entry differs' : 'entries differ'} from the published version (${d1.added + d2.added} added, ${d1.changed + d2.changed} changed, ${d1.removed + d2.removed} removed).`;
        UI.showModal({ title: 'Unpublished changes',
          bodyHtml: `<p id="pkg-export-warn">${_esc(note)} The ZIP will contain your <b>local</b> version.</p>`,
          actions: [{ label: 'Cancel', kind: 'cancel' },
                    { label: 'Export local version', kind: 'primary', onClick: () => { exportPackage(id, { skipWarning: true }); } }] });
        return;
      }
    }
    try {
      UI.progress(0, `Preparing export for "${entry.name}"…`);
      const JSZip = await _loadJSZip();
      const zip = new JSZip();
      const { localOnly, ...cleanEntry } = entry;
      zip.file('package.json', JSON.stringify(cleanEntry, null, 2));
      zip.file('hex_database.json', JSON.stringify({ version: 1, package: id, hexes }, null, 2));
      zip.file('building_database.json', JSON.stringify({ version: 1, package: id, buildings: blds }, null, 2));
      const [baseLocal, pkgLocal] = await Promise.all([SpriteStore.loadForPackage('postapoc'), SpriteStore.loadForPackage(id)]);
      const localByName = new Map([...baseLocal, ...pkgLocal].map(e => [e.name, e]));
      const refs = await _packageSpriteRefs(id);
      let done = 0, missing = 0;
      for (const [name, cat] of refs) {
        const s = await _spriteBlob(id, name, cat, localByName);
        if (s) zip.folder('sprites').folder(s.category).file(`${name}.png`, s.blob); else missing++;
        UI.progress(Math.round((++done / Math.max(refs.size, 1)) * 85), `Sprites: ${done}/${refs.size}…`);
      }
      UI.progress(92, 'Generating ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}-${entry.version || '1.0.0'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 100);
      UI.progressDone(`✅ Exported ${id}-${entry.version || '1.0.0'}.zip`);
      UI.toast(missing ? `⚠ Exported "${entry.name}" with ${missing} sprite(s) missing` : `✅ Package "${entry.name}" exported`);
    } catch (e) {
      UI.progressDone('');
      UI.toast(`⚠ Export failed: ${e.message}`);
    }
  }
```

Export `entriesDiff`. In the T5.1 panel markup change the Export button title to `Download a ZIP of the local version of this package`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-export.spec.ts --reporter=line`
Expected: 4 passed (diff test plus three export tests).

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-export.spec.ts
git commit -m "feat(packages): export from local state and warn about unpublished changes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the export no longer requires the package to be published; the `localOnly` flag (T5.12) is stripped from the exported `package.json`.

---

### Task T5.10: Package details: dependencies and a 512x512 preview

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: new `getDependencies`, `findDependencyCycle`, `resolveWithDependencies`, `updateDetails`, `makePreview512`, `savePreview`, `openDetails`; `publishPackage` (registry map, preview upload); panel row (T5.1 markup).
  - `IO._collectMapPackages` (anchor `return [...usedPkgs].sort();`).
- Create: `tests/packages-details.spec.ts`

**Interfaces:**
- Consumes: `SpriteStore.save(name, url, 'preview', pkg)` (T5.3), `UI.showModal`, `GitHubSync._putBinary`.
- Produces: registry entries gain `description` and `dependencies: string[]`; `Packages.getDependencies(id)`; `Packages.findDependencyCycle(graph) -> string[]|null`; `Packages.resolveWithDependencies(ids) -> ids` (dependencies first); `Packages.updateDetails(id, {description, dependencies}) -> boolean`; `Packages.makePreview512(file) -> Promise<Blob>` (centre-cropped, exactly 512x512 PNG); `Packages.savePreview(id, file)` (stored in `SpriteStore` as `<id>/__preview`, category `preview`; publish uploads `packages/<id>/preview.png`). Map JSON `packages` includes dependencies of used packages. `Packages.openDetails(id)` opens the editor dialog (`#pkg-det-desc`, `.pkg-det-dep`, `#pkg-det-preview`).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, withPat, REGISTRY_POSTAPOC, MEDIEVAL } from './helpers-github';

const BARBARIAN = { id: 'barbarian', name: 'Barbarians', isDefault: false, version: '1.0.0' };

test('cycle detection and dependency resolution', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => ({
    cycle: Packages.findDependencyCycle({ a: ['b'], b: ['c'], c: ['a'] }),
    none: Packages.findDependencyCycle({ a: ['b'], b: [], c: ['a'] }),
  }));
  expect(r.cycle).toEqual(['a', 'b', 'c', 'a']);
  expect(r.none).toBeNull();
});

test('details dialog saves dependencies, rejects cycles, and the map lists dependencies', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL, BARBARIAN]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 3);

  expect(await page.evaluate(() => Packages.updateDetails('medieval', { description: 'Castles', dependencies: ['barbarian'] }))).toBe(true);
  expect(await page.evaluate(() => Packages.getEntry('medieval').description)).toBe('Castles');
  expect(await page.evaluate(() => Packages.updateDetails('barbarian', { dependencies: ['medieval'] }))).toBe(false);   // cycle
  expect(await page.evaluate(() => Packages.getDependencies('barbarian'))).toEqual([]);
  expect(await page.evaluate(() => Packages.resolveWithDependencies(['medieval']))).toEqual(['barbarian', 'medieval']);

  await page.click('#tab-packages');
  await page.locator('tr[data-pkg="medieval"]').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('.pkg-det-dep[value="barbarian"]')).toBeChecked();
  await page.fill('#pkg-det-desc', 'Castles and knights');
  await page.getByRole('button', { name: 'Save details' }).click();
  expect(await page.evaluate(() => Packages.getEntry('medieval').description)).toBe('Castles and knights');
});

test('preview is cropped to 512x512 and published as preview.png with dependencies in package.json', async ({ page }) => {
  await withPat(page);
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL, BARBARIAN]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 3);
  const dims = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 300;
    c.getContext('2d')!.fillRect(0, 0, 800, 300);
    const file = await new Promise<File>(res => c.toBlob(b => res(new File([b!], 'p.png', { type: 'image/png' })), 'image/png'));
    const blob = await Packages.makePreview512(file);
    const bmp = await createImageBitmap(blob);
    await Packages.savePreview('medieval', file);
    Packages.updateDetails('medieval', { dependencies: ['barbarian'] });
    return [bmp.width, bmp.height];
  });
  expect(dims).toEqual([512, 512]);
  await page.evaluate(() => Packages.publishPackage('medieval', { bump: 'none' }));
  await expect.poll(() => gh.puts.includes('packages/registry.json')).toBe(true);
  expect(gh.puts).toContain('packages/medieval/preview.png');
  expect(JSON.parse(gh.files.get('packages/medieval/package.json')!.toString()).dependencies).toEqual(['barbarian']);
  expect(JSON.parse(gh.files.get('packages/registry.json')!.toString()).packages.find((p: any) => p.id === 'medieval').dependencies).toEqual(['barbarian']);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-details.spec.ts --reporter=line`
Expected: FAIL, `Packages.findDependencyCycle is not a function`.

- [ ] **Step 3: Implement**

`Packages` (after the export helpers):

```js
  function getDependencies(id) { return (getEntry(id)?.dependencies || []).slice(); }

  // graph: id -> dependency ids. Returns the cycle as an id path (first id repeated at the end) or null.
  function findDependencyCycle(graph) {
    const state = {}, stack = [];
    const visit = id => {
      if (state[id] === 2) return null;
      if (state[id] === 1) return stack.slice(stack.indexOf(id)).concat(id);
      state[id] = 1; stack.push(id);
      for (const d of graph[id] || []) { const c = visit(d); if (c) return c; }
      stack.pop(); state[id] = 2;
      return null;
    };
    for (const id of Object.keys(graph)) { const c = visit(id); if (c) return c; }
    return null;
  }

  function resolveWithDependencies(ids) {
    const out = [];
    const add = id => { if (out.includes(id)) return; getDependencies(id).forEach(add); out.push(id); };
    ids.forEach(add);
    return out;
  }

  function updateDetails(id, { description, dependencies }) {
    const e = getEntry(id);
    if (!e || e.isDefault) return false;
    const deps = (dependencies || []).filter(d => d !== id && d !== 'postapoc' && getEntry(d));
    const graph = {};
    _registry.forEach(p => { graph[p.id] = p.id === id ? deps : (p.dependencies || []); });
    const cycle = findDependencyCycle(graph);
    if (cycle) { UI.toast(`⚠ Dependency cycle: ${cycle.join(' → ')}`); return false; }
    if (description !== undefined) e.description = description;
    e.dependencies = deps;
    localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
    renderPanel();
    return true;
  }

  // Centre-crops to a square and scales to exactly 512x512 PNG.
  async function makePreview512(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 512, 512);
    if (bmp.close) bmp.close();
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  async function savePreview(id, file) {
    const blob = await makePreview512(file);
    const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    await SpriteStore.save('__preview', url, 'preview', id);
  }

  async function openDetails(id) {
    const e = getEntry(id);
    if (!e || e.isDefault) return;
    const others = _registry.filter(p => !p.isDefault && p.id !== id);
    const prev = (await SpriteStore.loadForPackage(id)).find(s => s.name === '__preview');
    let m;
    m = UI.showModal({ title: `Details: ${e.name}`, bodyHtml: `<div id="pkg-det">
        <label>Description<textarea id="pkg-det-desc" rows="3">${_esc(e.description || '')}</textarea></label>
        <div>Depends on: ${others.length ? others.map(p => `<label><input type="checkbox" class="pkg-det-dep" value="${_esc(p.id)}" ${(e.dependencies || []).includes(p.id) ? 'checked' : ''}> ${_esc(p.name)}</label>`).join('') : '<i>no other custom packages</i>'}</div>
        <label>Preview (cropped to 512×512)<input type="file" id="pkg-det-preview" accept="image/*"></label>
        ${prev ? `<img src="${prev.dataUrl}" width="96" height="96" alt="preview">` : ''}</div>`,
      actions: [{ label: 'Cancel', kind: 'cancel' }, { label: 'Save details', kind: 'primary', onClick: () => {
        const deps = [...m.el.querySelectorAll('.pkg-det-dep:checked')].map(c => c.value);
        if (!updateDetails(id, { description: m.el.querySelector('#pkg-det-desc').value, dependencies: deps })) return false;
        const f = m.el.querySelector('#pkg-det-preview').files[0];
        if (f) savePreview(id, f).then(() => renderPanel());
      } }] });
  }
```

Panel: add `<button class="hexdb-tool-btn" onclick="Packages.openDetails('${pid}')" title="Edit description, dependencies and preview image">Details</button>` inside the `!p.isDefault` branch next to Delete. Export `getDependencies, findDependencyCycle, resolveWithDependencies, updateDetails, makePreview512, savePreview, openDetails`.

`publishPackage`: replace the registry map line with

```js
      regData.packages = regData.packages.map(p => p.id === id
        ? { ...p, version: newVersion, dependencies: entry.dependencies || [] } : p);
```

and, immediately before `UI.progress(80, \`Updating ${id}/package.json…\`);`, add the preview upload:

```js
      const prevSprite = (await SpriteStore.loadForPackage(id)).find(s => s.name === '__preview');
      if (prevSprite) await GitHubSync._putBinary(`packages/${id}/preview.png`, await (await fetch(prevSprite.dataUrl)).blob(), `publish ${id}: preview.png`);
```

(`package.json` already spreads `entry`, so `description` and `dependencies` are written.)

`IO._collectMapPackages`: replace `return [...usedPkgs].sort();` with

```js
    if (typeof Packages !== 'undefined') Packages.resolveWithDependencies([...usedPkgs]).forEach(p => usedPkgs.add(p));
    return [...usedPkgs].sort();
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-details.spec.ts tests/packages-publish.spec.ts --reporter=line`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-details.spec.ts
git commit -m "feat(packages): dependencies field, cycle check and 512x512 preview" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `postapoc` is implicit and never listed as a dependency; cycles are rejected before any state changes; preview upload happens before `package.json`.

---

### Task T5.11: Palette grouped by package

**Files:**
- Modify: `MapEditorPro.html`: `UI.buildPalette` (anchors `const allHexes = HexDB.getAll().filter(h => h.id &&`, `visibleHexes.forEach(h => {`, `const allBuildings = typeof BldDB !== 'undefined' ? BldDB.getAll() : [];`, `tt.textContent = bld.id;`); CSS after `.cat-header::before`.
- Create: `tests/packages-palette.spec.ts`

**Interfaces:**
- Consumes: `Packages.getAll/getEntry/isPkgVisible/togglePkgFilter`.
- Produces: `.pkg-header` divs in `#palette-scroll` (only when more than one package is visible), hex sort order registry-first then category, buildings filtered by package visibility, building tooltip `Id [pkg]`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, REGISTRY_POSTAPOC, MEDIEVAL, hexRec, seedHexes, seedBuildings } from './helpers-github';

test('palette groups by package and the filter chips hide a package everywhere', async ({ page }) => {
  const gh = await mockGitHub(page);
  gh.setRegistry([REGISTRY_POSTAPOC, MEDIEVAL]);
  await openEditor(page);
  await page.waitForFunction(() => Packages.getAll().length === 2 && HexDB.getAll().length > 0);
  await seedHexes(page, [hexRec('Med_A', 'medieval'), hexRec('Med_B', 'medieval')]);
  await seedBuildings(page, [{ id: 'Med_Farm', spriteName: 'Farm_1', package: 'medieval', type: 'Ground Building', buildingCategory: 'Standard' }]);
  await page.evaluate(() => UI.buildPalette());

  const headers = page.locator('#palette-scroll .pkg-header');
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(0)).toContainText('Post-Apocalypse');
  await expect(headers.nth(1)).toContainText('Medieval Kingdom (2)');
  expect(await page.locator('#palette-scroll [data-hex-id="Med_A"]').count()).toBe(1);
  expect(await page.locator('#palette-scroll [data-hex-id="Med_Farm"]').count()).toBe(1);
  await expect(page.locator('#palette-scroll [data-hex-id="Med_Farm"] .tile-tooltip')).toHaveText('Med_Farm [medieval]');

  await page.evaluate(() => Packages.togglePkgFilter('medieval'));
  await expect(headers).toHaveCount(0);                               // single visible package: no headers
  expect(await page.locator('#palette-scroll [data-hex-id="Med_A"]').count()).toBe(0);
  expect(await page.locator('#palette-scroll [data-hex-id="Med_Farm"]').count()).toBe(0);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-palette.spec.ts --reporter=line`
Expected: FAIL, header count `0`, expected `2`.

- [ ] **Step 3: Implement**

In `buildPalette`, add before `const allHexes = ...`:

```js
    const _pkgOrder = id => { const i = typeof Packages !== 'undefined' ? Packages.getAll().findIndex(p => p.id === id) : -1; return i < 0 ? 999 : i; };
```

In the sort comparator, insert as its first lines (before `const oA = CAT_ORDER[a.category] ?? 99;`):

```js
      const pA = _pkgOrder(a.package || 'postapoc'), pB = _pkgOrder(b.package || 'postapoc');
      if (pA !== pB) return pA - pB;
```

After `const visibleHexes = ...;` add:

```js
    const _visiblePkgs = new Set(visibleHexes.map(h => h.package || 'postapoc'));
    const _multiPkg = _visiblePkgs.size > 1;
    let _currentPkg = null;
```

At the top of the `visibleHexes.forEach(h => {` body (before `const cat = h.category || '⚙️ SPECIAL';`) add:

```js
      const hPkg = h.package || 'postapoc';
      if (hPkg !== _currentPkg) {
        _currentPkg = hPkg;
        currentCatKey = null;                       // force a new category header inside the new package
        if (_multiPkg) {
          const ph = document.createElement('div');
          ph.className = 'pkg-header';
          const n = visibleHexes.filter(x => (x.package || 'postapoc') === hPkg).length;
          ph.textContent = `📦 ${(typeof Packages !== 'undefined' && Packages.getEntry(hPkg)?.name) || hPkg} (${n})`;
          scroll.appendChild(ph);
        }
      }
```

Buildings: replace `const allBuildings = typeof BldDB !== 'undefined' ? BldDB.getAll() : [];` with

```js
    const allBuildings = (typeof BldDB !== 'undefined' ? BldDB.getAll() : [])
      .filter(b => typeof Packages === 'undefined' || Packages.isPkgVisible(b.package || 'postapoc'));
```

and `tt.textContent = bld.id;` with `tt.textContent = bld.package ? \`${bld.id} [${bld.package}]\` : bld.id;`.

CSS:

```css
.pkg-header { padding: 6px 8px 2px; font-size: 11px; font-weight: bold; color: #a6e3a1; letter-spacing: .5px; border-top: 1px solid var(--border); margin-top: 6px; }
```

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-palette.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-palette.spec.ts
git commit -m "feat(packages): group palette by package and apply package filter to buildings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** a package change resets `currentCatKey` so category headers do not bleed across packages; buildings now honour the visibility chips like hexes do.

---

### Task T5.12: Local-only mode without a GitHub token

**Files:**
- Modify: `MapEditorPro.html`
  - `Packages`: `init`, `_fetchRegistry`, `createPackage` (anchor `closeNewModal();\n\n    try {`), `confirmImport` (T5.8 block), `publishPackage` (registry step), `deletePackage` (first line of the function that performs the registry write; anchor `async function deletePackage(id) {`), `renderPanel` (badge, PAT message); new `_localRegistry`, `_saveLocal`, `_mergeLocal`.
- Create: `tests/packages-local-only.spec.ts`

**Interfaces:**
- Consumes: T5.1 panel, T5.6 `publishPackage`, T5.8 `_mergeIntoEditor/_importSpritesLocally/_rewriteAll`.
- Produces: localStorage `pkg_local_registry` (array of registry entries). Registry entries created while no token is configured get `localOnly: true` in the in-memory registry; they merge with the server registry on every fetch, show a `.pkg-local-badge`, are never sent to the server by create/import/delete, and become normal registry entries when published with a token. `package.json` and `registry.json` written by publish do not contain `localOnly`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { mockGitHub, mockJSZip, makeZip, pkgJson, hexRec, TINY_PNG } from './helpers-github';

test('creating a package without a token stays local, survives reload, and publishes later', async ({ page }) => {
  const gh = await mockGitHub(page);
  await openEditor(page);
  await page.click('#tab-packages');
  await page.evaluate(() => Packages.openNewModal());
  await page.fill('#pkg-new-name', 'Local Pack');
  await expect(page.locator('#pkg-new-id')).toHaveValue('local-pack');
  await page.locator('#pkg-new-modal').getByRole('button', { name: 'Create' }).click();

  const row = page.locator('tr[data-pkg="local-pack"]');
  await expect(row.locator('.pkg-local-badge')).toBeVisible();
  expect(gh.puts).toEqual([]);

  await page.reload();
  await page.waitForFunction(() => Packages.getEntry('local-pack') !== null);
  await page.click('#tab-packages');
  await expect(page.locator('tr[data-pkg="local-pack"] .pkg-local-badge')).toBeVisible();

  // add a token, then publish: the package reaches the server registry and loses the local flag
  await page.evaluate(() => GitHubSync.setPAT('test-token'));
  await page.evaluate(() => Packages.publishPackage('local-pack', { bump: 'none' }));
  await expect.poll(() => gh.puts.includes('packages/registry.json')).toBe(true);
  const reg = JSON.parse(gh.files.get('packages/registry.json')!.toString());
  expect(reg.packages.map((p: any) => p.id)).toEqual(['postapoc', 'local-pack']);
  expect(JSON.stringify(reg)).not.toContain('localOnly');
  expect(JSON.stringify(JSON.parse(gh.files.get('packages/local-pack/package.json')!.toString()))).not.toContain('localOnly');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pkg_local_registry') || '[]'))).toEqual([]);
});

test('importing a ZIP without a token loads entries and sprites locally and writes nothing', async ({ page }) => {
  await mockJSZip(page);
  const gh = await mockGitHub(page);
  await openEditor(page);
  const zip = await makeZip({
    'package.json': pkgJson('old'),
    'hex_database.json': JSON.stringify({ hexes: [hexRec('Old_Tile', 'old', 'S1')] }),
    'sprites/hex/S1.png': TINY_PNG,
  });
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: zip });
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await page.waitForFunction(() => Packages.getEntry('old') !== null);
  expect(gh.puts).toEqual([]);
  expect(await page.evaluate(() => Packages.getEntry('old').localOnly)).toBe(true);
  expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.id === 'Old_Tile' && h.package === 'old'))).toBe(true);
  expect((await page.evaluate(async () => (await SpriteStore.loadForPackage('old')).length))).toBe(1);
});

test('deleting a local-only package never calls the server', async ({ page }) => {
  const gh = await mockGitHub(page);
  await openEditor(page);
  await page.evaluate(() => { localStorage.setItem('pkg_local_registry', JSON.stringify([{ id: 'tmp', name: 'Tmp', isDefault: false, version: '1.0.0' }])); });
  await page.reload();
  await page.waitForFunction(() => Packages.getEntry('tmp') !== null);
  await page.evaluate(() => Packages.deletePackage('tmp'));
  await page.waitForFunction(() => Packages.getEntry('tmp') === null);
  expect(gh.puts).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pkg_local_registry') || '[]'))).toEqual([]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/packages-local-only.spec.ts --reporter=line`
Expected: FAIL, `Create` runs `createPackage` which calls GitHub (`gh.puts` not empty / error toast) and no `.pkg-local-badge` exists.

- [ ] **Step 3: Implement**

`Packages` (near the top, after `_esc`):

```js
  const LS_LOCAL = 'pkg_local_registry';
  function _localRegistry() {
    try { const a = JSON.parse(localStorage.getItem(LS_LOCAL) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function _saveLocal(list) { localStorage.setItem(LS_LOCAL, JSON.stringify(list)); }
  // Server packages plus local-only ones the server does not know yet.
  function _mergeLocal(serverList) {
    const ids = new Set(serverList.map(p => p.id));
    return [...serverList, ..._localRegistry().filter(p => !ids.has(p.id)).map(p => ({ ...p, localOnly: true }))];
  }
```

`init`: after the cache is parsed (`if (c) _registry = JSON.parse(c);`) add `_registry = _mergeLocal(_registry.filter(p => !p.localOnly));`.
`_fetchRegistry`: replace `_registry = data.packages;` with `_registry = _mergeLocal(data.packages);`.

`createPackage`: immediately after `closeNewModal();` insert:

```js
    if (!GitHubSync.isPATConfigured()) {
      const entry = { id: rawId, name, isDefault: false, version: '1.0.0', description: '' };
      _saveLocal([..._localRegistry(), entry]);
      _registry = [..._registry, { ...entry, localOnly: true }];
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      UI.toast(`✅ Package "${name}" created locally (not on the server yet)`);
      renderPanel();
      renderActiveDropdowns();
      return;
    }
```

`confirmImport`, inside the `try`, directly after `const { hexes, buildings } = _rewriteAll(...)` insert:

```js
      if (!GitHubSync.isPATConfigured()) {
        _saveLocal([..._localRegistry(), { id: newId, name, isDefault: false, version: '1.0.0', description: v.pkg.description || '' }]);
        _registry = _mergeLocal(_registry.filter(p => !p.localOnly));
        localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
        _mergeIntoEditor(hexes, buildings);
        await _importSpritesLocally(zip, newId);
        UI.progressDone('');
        UI.toast(`✅ Package '${name}' imported locally (publish needs a token)`);
        renderPanel(); renderActiveDropdowns(); closeImportModal();
        _importInProgress = false;
        return;
      }
```

`publishPackage`: replace the line `regData.packages = regData.packages.map(p => p.id === id ? { ...p, version: newVersion, dependencies: ... } : p);` (from T5.10) with:

```js
      const regEntry = { id, name: entry.name, isDefault: false, version: newVersion, dependencies: entry.dependencies || [] };
      regData.packages = regData.packages.some(p => p.id === id)
        ? regData.packages.map(p => p.id === id ? { ...p, ...regEntry } : p)
        : [...regData.packages, regEntry];
```

and replace `_registry = regData.packages;` (the one following the registry write in `publishPackage`) with:

```js
      _saveLocal(_localRegistry().filter(p => p.id !== id));
      _registry = _mergeLocal(regData.packages);
```

and in the same function change the `package.json` spread so the local flag never leaks: replace `...entry, version: newVersion,` (T5.6 line) with `...(({ localOnly, ...e }) => e)(entry), version: newVersion,`.

`deletePackage`: first line inside the function (after the `isDefault` guard):

```js
    if (getEntry(id)?.localOnly) {
      _saveLocal(_localRegistry().filter(p => p.id !== id));
      _registry = _registry.filter(p => p.id !== id);
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      if (_active === id) setActive('postapoc');
      UI.toast(`✅ Local package "${id}" removed`);
      renderPanel(); renderActiveDropdowns();
      return;
    }
```

`renderPanel`: in the id cell add `${p.localOnly ? ' <span class="pkg-badge pkg-local-badge" title="Exists only in this browser until you publish it">local only</span>' : ''}`; change the `patWarn` text to `Without a GitHub token you can create, import and export packages locally; publishing needs a token.`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/packages-local-only.spec.ts tests/packages-panel.spec.ts --reporter=line`
Expected: 6 passed (T5.1 token-warning test still matches `GitHub token`).

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/packages-local-only.spec.ts
git commit -m "feat(packages): local-only mode when no GitHub token is configured" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `localOnly` is an in-memory flag derived from `pkg_local_registry` and stripped from every payload sent to the server; publish removes the package from the local list only after the registry write succeeds.

---

## Phase 6: Quality and docs

Pins existing pure logic with tests, adds map format versioning with schema validation (as the first external module under `js/`), extracts `Brush` as the first step of an optional incremental module split, brings README, CHANGELOG and both guides up to date with a Help menu, and removes unused files and dead code only after grep proves nothing references them.

### Files touched in Phase 6

| File | Change |
|---|---|
| `MapEditorPro.html` | `<script src="js/map-format.js">`, `IO._loadFromJSON` guard, `IO._buildJson` version, later `<script src="js/brush.js">`, Help menu, dead code removal |
| `js/map-format.js` | New UMD module: `MapFormat.validate/migrate/CURRENT_VERSION` |
| `js/brush.js` | New (T6.4): extracted verbatim `Brush` module |
| `scripts/extract_module.py`, `scripts/unreferenced.sh` | New helper scripts |
| `.github/workflows/deploy-dev.yml` | Also publish `js/` to gh-pages |
| `README.md`, `CHANGELOG.md`, `docs/guide_en.html`, `docs/guide_ua.html` | Updated |
| `tests/unit/*.spec.ts`, `tests/docs.spec.ts` | New |

---

### Task T6.1: Unit tests for existing pure logic

These are characterization tests of behaviour that already exists, so they are expected to PASS on first run. A failure means the expectation is wrong or a real bug: investigate before changing the test.

**Files:**
- Create: `tests/unit/pure-logic.spec.ts`

**Interfaces:**
- Consumes: `Packages.idPrefix/_rewriteEntries`, `History.push/undo/redo/clear/undoSize`, `EdgeTiling.resolveEdgeTile/clearCache`, `Roads.getNeighbors`, `IO.loadFromJSON`, `HexDB.loadFromObject`.
- Produces: regression net for id prefixing, history, edge autotiling, hex adjacency and legacy integer-map migration.

- [ ] **Step 1: Write the tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from '../helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

test('id prefixing', async ({ page }) => {
  const r = await page.evaluate(() => ({
    none: Packages.idPrefix('postapoc'), one: Packages.idPrefix('medieval'), two: Packages.idPrefix('dark-age'),
    rewritten: Packages._rewriteEntries([{ id: 'Old_A' }, { id: 'Bare' }], 'old', 'new-pack').map((e: any) => [e.id, e.package]),
  }));
  expect(r.none).toBe('');
  expect(r.one).toBe('Medieval_');
  expect(r.two).toBe('DarkAge_');
  expect(r.rewritten).toEqual([['NewPack_A', 'new-pack'], ['NewPack_Bare', 'new-pack']]);
});

test('history caps at 50 and undo/redo restore the grid', async ({ page }) => {
  const r = await page.evaluate(() => {
    History.clear();
    for (let i = 0; i < 60; i++) { mapData[0] = 'S' + i; History.push(); }
    const size = History.undoSize();
    History.clear();
    mapData[0] = 'X_1'; History.push(); mapData[0] = 'Y_1';
    History.undo(true); const afterUndo = mapData[0];
    History.redo(true); const afterRedo = mapData[0];
    return { size, afterUndo, afterRedo };
  });
  expect(r).toEqual({ size: 50, afterUndo: 'X_1', afterRedo: 'Y_1' });
});

test('hex adjacency is symmetric and has six neighbours', async ({ page }) => {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const [c, r] of [[10, 10], [11, 10], [10, 11], [200, 201]]) {
      const ns = Roads.getNeighbors(c, r);
      if (ns.length !== 6) out.push(`${c},${r} has ${ns.length}`);
      for (const n of ns) if (!Roads.getNeighbors(n.col, n.row).some((m: any) => m.col === c && m.row === r)) out.push(`${c},${r}->${n.col},${n.row}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('edge autotiling picks the tile whose faces match the neighbours, else the fallback', async ({ page }) => {
  const r = await page.evaluate(() => {
    const d = HexDB.getData();
    const faces = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];
    HexDB.loadFromObject({ ...d, hexes: [...d.hexes,
      { id: 'WT_ALL', type: 'Water', biome: 'Summer', spriteName: 'WT_ALL', edgeFaces: faces },
      { id: 'WT_NONE', type: 'Water', biome: 'Summer', spriteName: 'WT_NONE', edgeFaces: ['N'] }] });
    EdgeTiling.clearCache();
    const W = 5, H = 5, rng = () => 0;
    const surrounded = new Array(W * H).fill('WT_ALL'); surrounded[2 * W + 2] = 'Plain_1';
    const dry = new Array(W * H).fill('Plain_1');
    return {
      wet: EdgeTiling.resolveEdgeTile(2, 2, W, H, surrounded, ['Water'], rng, ['FALLBACK']),
      dry: EdgeTiling.resolveEdgeTile(2, 2, W, H, dry, ['Water'], rng, ['FALLBACK']),
    };
  });
  expect(r).toEqual({ wet: 'WT_ALL', dry: 'FALLBACK' });
});

test('a legacy integer map is migrated to id strings on load', async ({ page }) => {
  const cells = await page.evaluate(() => {
    IO.loadFromJSON({ width: 10, height: 10, data: Array.from({ length: 10 }, () => new Array(10).fill(12)), settlements: [] });
    return { w: MAP_WIDTH, first: mapData[0], allStrings: mapData.every((c: any) => typeof c === 'string') };
  });
  expect(cells).toEqual({ w: 10, first: 'Plain_1', allStrings: true });
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test tests/unit/pure-logic.spec.ts --reporter=line`
Expected: 5 passed (characterization).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/pure-logic.spec.ts
git commit -m "test: characterization tests for id prefixing, history, adjacency, edge tiling, migration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** each test mutates only page-local state (fresh context per test); the edge-tiling test restores nothing because the page is discarded.

---

### Task T6.2: `MapFormat` module (versioning and schema validation) in `js/`

**Files:**
- Create: `js/map-format.js`, `tests/unit/map-format.spec.ts`
- Modify: `MapEditorPro.html` (script tag; anchor `<script src="zone-painter.js?v=8"></script>`, ~L1202), `.github/workflows/deploy-dev.yml`
- Note: `deploy.sh` merges the branch into `gh-pages`, so `js/` is published by full deploys automatically. The dev workflow only copied the HTML, hence the workflow change (the dev page uses `<base href="../">`, so `js/map-format.js` must exist at the gh-pages root).

**Interfaces:**
- Produces (UMD, no DOM, loadable by `require` and as a browser global):
  - `MapFormat.CURRENT_VERSION = 2`, `MIN_SIZE = 10`, `MAX_SIZE = 450`
  - `MapFormat.validate(json) -> { ok: boolean, errors: string[], warnings: string[] }`
  - `MapFormat.migrate(json) -> object` (copy at `CURRENT_VERSION`; missing/1 gets `version: 2`, `packages: ['postapoc']`; never mutates the input)
- Rules: non-object, non-integer `version`, `version > CURRENT_VERSION`, missing/invalid `width`/`height`/`data`, a cell that is neither string nor number, non-array `settlements|bridges|objects|roads|tileExtras`, non-string `packages` entries are errors. Missing version, size outside 10..450, `data` row count differing from `height`, settlements outside the map are warnings.

- [ ] **Step 1: Write the failing tests** (node side, no browser)

```ts
import { test, expect } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MapFormat = require('../../js/map-format.js');

const good = () => ({ version: 2, packages: ['postapoc'], width: 3, height: 2, data: [['A', 'B', 'C'], ['D', 'E', 'F']], settlements: [{ col: 1, row: 1, type: 'city' }] });

test('accepts a valid current map', () => {
  expect(MapFormat.CURRENT_VERSION).toBe(2);
  expect(MapFormat.validate(good())).toEqual({ ok: true, errors: [], warnings: expect.any(Array) });
});

test('rejects structurally invalid maps', () => {
  expect(MapFormat.validate(null).ok).toBe(false);
  expect(MapFormat.validate({ ...good(), data: 'x' }).errors.join()).toMatch(/data/);
  expect(MapFormat.validate({ ...good(), width: 'wide' }).errors.join()).toMatch(/width/);
  expect(MapFormat.validate({ ...good(), version: 99 }).errors.join()).toMatch(/newer version/);
  expect(MapFormat.validate({ ...good(), version: 1.5 }).errors.join()).toMatch(/version/);
  expect(MapFormat.validate({ ...good(), data: [['A', {}, 'C'], ['D', 'E', 'F']] }).errors.join()).toMatch(/cell/);
  expect(MapFormat.validate({ ...good(), roads: {} }).errors.join()).toMatch(/roads/);
  expect(MapFormat.validate({ ...good(), packages: [1] }).errors.join()).toMatch(/packages/);
});

test('warnings for soft problems', () => {
  const noVersion: any = good(); delete noVersion.version;
  expect(MapFormat.validate(noVersion)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/no version/i)] });
  expect(MapFormat.validate({ ...good(), height: 3 }).warnings.join()).toMatch(/rows/);
  expect(MapFormat.validate({ ...good(), settlements: [{ col: 9, row: 9, type: 's' }] }).warnings.join()).toMatch(/outside/);
  expect(MapFormat.validate({ ...good(), width: 600, height: 600 }).warnings.join()).toMatch(/clamped/);
});

test('migrate upgrades old maps without mutating the input', () => {
  const old: any = { width: 3, height: 2, data: [[1, 2, 3], [4, 5, 6]], settlements: [] };
  const snapshot = JSON.stringify(old);
  const m = MapFormat.migrate(old);
  expect(m).toMatchObject({ version: 2, packages: ['postapoc'] });
  expect(JSON.stringify(old)).toBe(snapshot);
  expect(MapFormat.migrate(good())).toEqual(good());
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/unit/map-format.spec.ts --reporter=line`
Expected: FAIL, `Cannot find module '../../js/map-format.js'`.

- [ ] **Step 3: Implement**

Create `js/map-format.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapFormat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CURRENT_VERSION = 2, MIN_SIZE = 10, MAX_SIZE = 450;
  const LIST_KEYS = ['settlements', 'bridges', 'objects', 'roads', 'tileExtras'];

  function validate(json) {
    const errors = [], warnings = [];
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, errors: ['Map file is not a JSON object'], warnings };
    }
    if (json.version === undefined) warnings.push('Map has no version field; assuming an old format.');
    else if (!Number.isInteger(json.version)) errors.push('version must be an integer');
    else if (json.version > CURRENT_VERSION) errors.push(`Map was saved by a newer version of the editor (format ${json.version}, this editor reads up to ${CURRENT_VERSION}).`);
    if (!Number.isInteger(json.width))  errors.push('width must be an integer');
    if (!Number.isInteger(json.height)) errors.push('height must be an integer');
    if (!Array.isArray(json.data) || !json.data.every(Array.isArray)) errors.push('data must be an array of rows');
    if (errors.length) return { ok: false, errors, warnings };

    [['width', json.width], ['height', json.height]].forEach(([k, v]) => {
      if (v > MAX_SIZE) warnings.push(`${k} ${v} will be clamped to ${MAX_SIZE}.`);
      if (v < MIN_SIZE) warnings.push(`${k} ${v} is below the minimum and will be raised to ${MIN_SIZE}.`);
    });
    if (json.data.length !== json.height) warnings.push(`data has ${json.data.length} rows but height is ${json.height}.`);
    outer: for (let r = 0; r < json.data.length; r++) {
      for (let c = 0; c < json.data[r].length; c++) {
        const v = json.data[r][c];
        if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`Invalid cell at row ${r}, col ${c}`); break outer; }
      }
    }
    LIST_KEYS.forEach(k => { if (json[k] !== undefined && !Array.isArray(json[k])) errors.push(`${k} must be an array`); });
    if (json.packages !== undefined && !(Array.isArray(json.packages) && json.packages.every(p => typeof p === 'string')))
      errors.push('packages must be an array of strings');
    if (Array.isArray(json.settlements)) {
      const bad = json.settlements.filter(s => {
        const c = s && (s.col !== undefined ? s.col : s.x), r = s && (s.row !== undefined ? s.row : s.y);
        return !(c >= 0 && c < json.width && r >= 0 && r < json.height);
      });
      if (bad.length) warnings.push(`${bad.length} settlement(s) lie outside the map.`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  function migrate(json) {
    const out = JSON.parse(JSON.stringify(json));
    if (!(out.version >= 2)) out.version = CURRENT_VERSION;
    if (!Array.isArray(out.packages)) out.packages = ['postapoc'];
    return out;
  }

  return { CURRENT_VERSION, MIN_SIZE, MAX_SIZE, validate, migrate };
}));
```

HTML: after `<script src="zone-painter.js?v=8"></script>` add `<script src="js/map-format.js?v=1"></script>`.

Workflow `.github/workflows/deploy-dev.yml`: change `paths: ['MapEditorPro.html']` to `paths: ['MapEditorPro.html', 'js/**']`; in the build step append `rm -rf /tmp/js_dev && cp -r js /tmp/js_dev`; in the deploy step, after `cp /tmp/MapEditorPro_dev.html dev/MapEditorPro.html` add `mkdir -p js && cp /tmp/js_dev/* js/` and change `git add dev/MapEditorPro.html` to `git add dev/MapEditorPro.html js`.

- [ ] **Step 4: Run, expect pass; also check the page and the workflow YAML**

Run: `npx playwright test tests/unit/map-format.spec.ts --reporter=line`
Expected: 4 passed.
Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy-dev.yml"); puts "yaml ok"'`
Expected: `yaml ok`.
Add to `tests/unit/map-format.spec.ts` a browser check and run it again:

```ts
import { openEditor } from '../helpers';
test('the editor page loads js/map-format.js', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', r => { if (r.url().includes('js/map-format.js') && !r.ok()) failed.push(r.url()); });
  await openEditor(page);
  expect(await page.evaluate(() => typeof MapFormat.validate)).toBe('function');
  expect(failed).toEqual([]);
});
```

- [ ] **Step 5: Commit**

```bash
git add js/map-format.js tests/unit/map-format.spec.ts MapEditorPro.html .github/workflows/deploy-dev.yml
git commit -m "feat(format): MapFormat module with versioning and schema validation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** `validate` never throws on hostile input; `migrate` deep-copies; the dev workflow now ships `js/` so the dev page does not 404.

---

### Task T6.3: Validate and migrate on map load, stamp the version from `MapFormat`

**Files:**
- Modify: `MapEditorPro.html`: `IO._loadFromJSON` (anchor `if (!json.width || !json.height || !Array.isArray(json.data))`, ~L6447; Phase 0 may have changed the surrounding catch) and `IO._buildJson` (anchor `version: 2,`, ~L6202).
- Create: `tests/unit/map-load-format.spec.ts`

**Interfaces:**
- Consumes: `MapFormat.validate/migrate` (T6.2), `UI.toast`.
- Produces: invalid or too-new maps are rejected before any state changes; warnings surface as a toast; saved maps use `MapFormat.CURRENT_VERSION`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from '../helpers';

test('a map from a newer editor is rejected and the current map is untouched', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { mapData[0] = 'Sentinel_1'; });
  await page.evaluate(() => IO.loadFromJSON({ version: 99, width: 10, height: 10, data: Array.from({ length: 10 }, () => new Array(10).fill('Plain_1')) }));
  await expect(page.getByText(/newer version/i).first()).toBeVisible();
  expect(await page.evaluate(() => [mapData[0], MAP_WIDTH])).toEqual(['Sentinel_1', 450]);
});

test('a versionless old map still loads and warns', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => IO.loadFromJSON({ width: 10, height: 10, data: Array.from({ length: 10 }, () => new Array(10).fill('Plain_1')), settlements: [] }));
  expect(await page.evaluate(() => MAP_WIDTH)).toBe(10);
  await expect(page.getByText(/no version field/i).first()).toBeVisible();
});

test('saved maps carry MapFormat.CURRENT_VERSION', async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => JSON.parse(IO.getMapJson()).version === MapFormat.CURRENT_VERSION)).toBe(true);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/unit/map-load-format.spec.ts --reporter=line`
Expected: first test FAIL (a version 99 map loads and replaces the sentinel); second FAIL (no warning text).

- [ ] **Step 3: Implement**

Replace the guard

```js
      if (!json.width || !json.height || !Array.isArray(json.data))
        throw new Error('Invalid map file format');
```

with

```js
      const fmt = MapFormat.validate(json);
      if (!fmt.ok) throw new Error(fmt.errors.join('; '));
      json = MapFormat.migrate(json);
      if (fmt.warnings.length)
        UI.toast('⚠ Map format: ' + fmt.warnings[0] + (fmt.warnings.length > 1 ? ` (+${fmt.warnings.length - 1} more)` : ''));
```

(`json` is the function parameter, so reassigning it is valid). In `_buildJson` replace `version: 2,` with `version: MapFormat.CURRENT_VERSION,`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/unit tests/map-json-contract.spec.ts --reporter=line`
Expected: all passed (the contract test still sees version 2).

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html tests/unit/map-load-format.spec.ts
git commit -m "feat(format): validate and migrate maps on load" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** Phase 0's clamp/package warnings may also fire; both should coexist (this adds a format toast only). Toast text is truncated to one warning plus a count.

---

### Task T6.4: Safe incremental module split: extract `Brush` into `js/brush.js`

**Method (one module per change, repeat later for others):**
1. Pick a module with no top-level side effects whose only outside dependencies are globals read at call time (`MAP_WIDTH/HEIGHT`, `document`).
2. Write characterization tests first and run them green on the monolith.
3. Cut mechanically with `scripts/extract_module.py` (no hand-copying), add the script tag in `<head>`, ensure deployment copies `js/` (done in T6.2).
4. Run the whole suite; the change is one commit and trivially revertable.
5. Candidates in order: `Brush`, `EdgeTiling`, `Coastline`, `Roads`, `History`, `SpriteStore`; stop when the next candidate needs more than reading globals at call time.

A classic external script that declares `const Brush` creates the same global lexical binding the inline script did, and the module only reads `MAP_WIDTH/MAP_HEIGHT` inside functions, so load order is safe. Run this task after Phase 2 has finished changing `Brush`.

**Files:**
- Create: `scripts/extract_module.py`, `js/brush.js`, `tests/unit/brush.spec.ts`
- Modify: `MapEditorPro.html` (remove the `const Brush = (() => {` ... `})();` block and its banner comment; add the script tag after the `map-format.js` tag)

**Interfaces:**
- Consumes: global `MAP_WIDTH`, `MAP_HEIGHT`, DOM `.brush-btn[data-brush]`.
- Produces: `Brush.getAffectedTiles/setSize/getSize` unchanged; `python3 scripts/extract_module.py <html> <ConstName> <out.js> <script-src>`.

- [ ] **Step 1: Write the characterization test** (expected to pass before AND after the extraction)

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from '../helpers';

test('Brush footprints and clipping', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const count = (s: number, c: number, r: number) => { Brush.setSize(s); return Brush.getAffectedTiles(c, r).length; };
    const corner = (() => { Brush.setSize(1); return Brush.getAffectedTiles(0, 0); })();
    Brush.setSize(0);
    return { s0: count(0, 100, 100), s1: count(1, 100, 100), s2: count(2, 100, 100), s3: count(3, 100, 100),
             cornerLen: corner.length, cornerInBounds: corner.every((t: any) => t.col >= 0 && t.row >= 0), size: Brush.getSize() };
  });
  expect(r).toMatchObject({ s0: 1, s1: 7, s2: 19, s3: 37, cornerInBounds: true, size: 0 });
  expect(r.cornerLen).toBeLessThan(7);
});

test('js/brush.js is served and defines Brush', async ({ page }) => {
  const res = await page.request.get('/js/brush.js');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('const Brush = (() => {');
});
```

- [ ] **Step 2: Run to see the baseline**

Run: `npx playwright test tests/unit/brush.spec.ts --reporter=line`
Expected: first test passes, second FAILS with status 404 (file does not exist yet).

- [ ] **Step 3: Extract**

Create `scripts/extract_module.py`:

```python
#!/usr/bin/env python3
"""Move one top-level `const Name = (() => { ... })();` module out of the HTML into a classic script.
usage: extract_module.py MapEditorPro.html Brush js/brush.js js/brush.js?v=1"""
import re, sys

html_path, name, out_path, src = sys.argv[1:5]
text = open(html_path, encoding='utf-8').read()
start_re = re.compile(r'^const ' + re.escape(name) + r' = \(\(\) => \{\n', re.M)
m = start_re.search(text)
if not m:
    sys.exit(f'module {name} not found')
end = text.index('\n})();\n', m.start()) + len('\n})();\n')
# include the preceding 3-line banner comment (// ═══ / // NAME ... / // ═══) when present
banner = re.search(r'(?:^//[^\n]*\n){3}\Z', text[:m.start()], re.M)
cut_from = banner.start() if banner else m.start()
body = text[m.start():end]
open(out_path, 'w', encoding='utf-8').write(
    f'// Extracted from MapEditorPro.html by scripts/extract_module.py. Classic script: reads shared globals at call time.\n{body}')
tag = f'<script src="{src}"></script>'
text = text[:cut_from] + f'// {name} module lives in {out_path}\n' + text[end:]
anchor = '<script src="js/map-format.js?v=1"></script>'
assert anchor in text, 'map-format script tag anchor missing'
text = text.replace(anchor, anchor + '\n' + tag, 1)
open(html_path, 'w', encoding='utf-8').write(text)
print(f'extracted {name}: {len(body.splitlines())} lines -> {out_path}')
```

Run: `python3 scripts/extract_module.py MapEditorPro.html Brush js/brush.js "js/brush.js?v=1"`
Expected output: `extracted Brush: 6x lines -> js/brush.js`. Check: `grep -c "const Brush" MapEditorPro.html` prints `0`; `grep -n "brush.js" MapEditorPro.html` shows the script tag and the one-line comment; `git diff --stat` shows the HTML shrinking by about the module size.

- [ ] **Step 4: Run the whole suite**

Run: `npx playwright test --reporter=line`
Expected: everything passes, including both Brush tests and `tests/shortcuts.spec.ts` (uses `Brush` from the external file).

- [ ] **Step 5: Commit**

```bash
git add scripts/extract_module.py js/brush.js tests/unit/brush.spec.ts MapEditorPro.html
git commit -m "refactor: extract Brush into js/brush.js (first step of incremental module split)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the diff must be a pure move (verify with `git diff -M --stat`); `deploy.sh` merge and the dev workflow both publish `js/`; revert is one `git revert`.

---

### Task T6.5: README, CHANGELOG, EN and UA guides, Help menu

**Files:**
- Modify: `README.md` (rewrite), `CHANGELOG.md` (new top entry), `docs/guide_en.html` and `docs/guide_ua.html` (section 7 shortcuts table and new sections), `MapEditorPro.html` (Help menu; anchor `<div class="menu-item" id="menu-dev">Dev`, ~L1251, and CSS after `.menu-dropdown .separator`)
- Create: `tests/docs.spec.ts`

**Interfaces:**
- Consumes: `Shortcuts.getAll()` (T4.4) as the source of truth for the shortcut table.
- Produces: `#menu-help` with links to `docs/guide_en.html`, `docs/guide_ua.html`, the packages PDF, and a Shortcuts button.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openEditor } from './helpers';

const root = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

test('README describes the current project', () => {
  const r = read('README.md');
  expect(r).toContain('MapEditorPro.html');
  expect(r).not.toMatch(/MapEditor\.html/);
  expect(r).toContain('npx playwright test');
  expect(r).toContain('js/');
});

test('CHANGELOG has an entry for this release', () => {
  expect(read('CHANGELOG.md')).toMatch(/## 2026\.10 — 2026-10-\d\d/);
});

test('both guides document every registered shortcut and the new features', async ({ page }) => {
  await openEditor(page);
  const keys: string[] = await page.evaluate(() => Shortcuts.getAll().filter((d: any) => d.bound).map((d: any) => d.display));
  for (const f of ['docs/guide_en.html', 'docs/guide_ua.html']) {
    const g = read(f);
    for (const k of keys) expect(g, `${f} lacks shortcut ${k}`).toContain(`<kbd>${k}</kbd>`);
    for (const id of ['navigation', 'validator', 'packages-ux']) expect(g, `${f} lacks #${id}`).toContain(`id="${id}"`);
  }
});

test('Help menu links resolve', async ({ page, request }) => {
  await openEditor(page);
  const hrefs = await page.locator('#menu-help a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs).toEqual(['docs/guide_en.html', 'docs/guide_ua.html', 'docs/guides/content-packages-editor-guide.pdf']);
  for (const h of hrefs) expect((await request.get('/' + h)).status(), h!).toBe(200);
  await page.click('#menu-help');
  await page.getByRole('button', { name: /Keyboard Shortcuts/ }).last().click();
  await expect(page.locator('.shortcut-help').first()).toBeVisible();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx playwright test tests/docs.spec.ts --reporter=line`
Expected: 4 FAIL (README mentions `MapEditor.html`; no 2026.10 entry; guides lack `<kbd>G</kbd>` etc.; no `#menu-help`).

- [ ] **Step 3: Implement**

Help menu: insert before `<div class="menu-item" id="menu-dev">Dev`:

```html
    <div class="menu-item" id="menu-help">Help
      <div class="menu-dropdown">
        <a class="menu-link" href="docs/guide_en.html" target="_blank" rel="noopener">User guide (English)</a>
        <a class="menu-link" href="docs/guide_ua.html" target="_blank" rel="noopener">Посібник (українською)</a>
        <a class="menu-link" href="docs/guides/content-packages-editor-guide.pdf" target="_blank" rel="noopener">Content packages guide (PDF)</a>
        <div class="separator"></div>
        <button onclick="Shortcuts.showHelp()">Keyboard Shortcuts <span class="menu-shortcut">?</span></button>
      </div>
    </div>
```

CSS:

```css
.menu-dropdown a.menu-link { display: block; padding: 6px 14px; color: var(--text); text-decoration: none; font-size: 12px; }
.menu-dropdown a.menu-link:hover { background: var(--hover); }
```

`README.md` (replace whole file):

```markdown
# Post-Apocalyptic Map Editor

Browser-based hex map editor for the game: terrain painting, settlements, zones, procedural generation, content packages and the Hex/Building/Settlement/Upgrade databases. Everything lives in `MapEditorPro.html` plus `zone-painter.js` and `js/`.

## Run
Serve the repository root (`python3 -m http.server`) and open `MapEditorPro.html`. Opening the file directly also works but package and GitHub features need a server origin.

## Layout
```
MapEditorPro.html       editor (single page, IIFE modules)
js/                     extracted modules (map-format.js, brush.js)
zone-painter.js         zone painting
packages/<id>/          content packages (postapoc is the built-in one)
maps/                   published maps
docs/                   user guides (EN/UA), plans, decisions
tests/                  Playwright tests
```

## Everyday use
Paint with P/F/R/E, press `?` for every shortcut, `G` to go to coordinates, `V` to validate the map, File > Export PNG for an overview image. See `docs/guide_en.html` (English) and `docs/guide_ua.html` (Ukrainian).

## Tests
`npm install` then `npx playwright test`. Network access (GitHub, jsDelivr) is mocked in tests.

## Deploy
`deploy.sh` stamps the version and merges `dev` into `gh-pages`. Pushes to `dev` deploy a preview to `dev/MapEditorPro.html`.
```

`CHANGELOG.md`: insert directly under the header block (before `## 2026.06 — 2026-06-30`):

```markdown
## 2026.10 — 2026-10-02

### Navigation and feedback
- Go-to coordinates (`col,row` or `app:x,y`), bookmarks, enlargeable minimap with zone and settlement overlays.
- Keyboard shortcuts for zoom, brush size and overlays, with a `?` help panel and a Help menu.
- Map validator (unknown ids, missing city, unreachable settlements, orphan roads, missing sprites) with a clickable results list; save, CSV export and map publish ask for confirmation when errors exist.
- PNG export (whole map or current view); history panel with labelled steps.

### Packages
- PACKAGES tab explains itself (help, counts, active marker, notices), active-package selector in HEX DB and BUILDINGS, per-package sprites with collision check and PNG conversion, searchable reskin picker, publish dialog (missing sprites, version bump, changelog), validated ZIP import with rollback, export from local state, dependencies and 512×512 preview, palette grouped by package, local-only mode without a GitHub token.

### Quality
- Map format versioning and validation on load (`js/map-format.js`); `Brush` extracted to `js/brush.js`; Playwright test suite.
```

Guides: in each guide, update the shortcuts table by adding a "View and navigation" table inside `<section id="shortcuts">` listing every bound key from `Shortcuts.getAll()` (`+`, `-`, `0`, `C`, `[`, `]`, `1`, `2`, `3`, `G`, `M`, `Shift+B`, `?`, `V`, `Shift+H`) in `<kbd>` tags, and append three sections before `</body>`'s final wrapper (after section 7, same markup style):

English (`docs/guide_en.html`):

```html
  <section id="navigation">
    <h2>8. Navigation</h2>
    <p>Type <code>col,row</code> or <code>app:x,y</code> in <b>Go to</b> (key <kbd>G</kbd>) to centre the view. <kbd>Shift+B</kbd> saves a bookmark (per browser). <kbd>M</kbd> enlarges the minimap, which can show zones and settlements. The <b>History</b> panel lists labelled steps; click one to jump to it.</p>
  </section>
  <section id="validator">
    <h2>9. Map validation and export</h2>
    <p>Press <kbd>V</kbd> (Edit &gt; Validate Map) to check for unknown tile ids, a missing city, unreachable settlements, orphan roads and missing sprites. Click a result to jump to the cell. Save, CSV export and Publish Map warn when errors exist. File &gt; Export PNG saves an overview image.</p>
  </section>
  <section id="packages-ux">
    <h2>10. Content packages</h2>
    <p>The PACKAGES tab lists packages with entry counts and the active package (also selectable in HEX DB and BUILDINGS). Without a GitHub token packages stay local; publishing needs a token. Publish shows missing sprites and lets you bump the version and add a changelog note. Import validates the ZIP first and rolls back on failure. The game does not load non-default packages yet. See the <a href="guides/content-packages-editor-guide.pdf">packages guide (PDF)</a>.</p>
  </section>
```

Ukrainian (`docs/guide_ua.html`):

```html
  <section id="navigation">
    <h2>8. Навігація</h2>
    <p>Введіть <code>col,row</code> або <code>app:x,y</code> у полі <b>Go to</b> (клавіша <kbd>G</kbd>), щоб центрувати вигляд. <kbd>Shift+B</kbd> зберігає закладку (для цього браузера). <kbd>M</kbd> збільшує мінікарту, яка може показувати зони та поселення. Панель <b>History</b> показує підписані кроки; клік переходить до кроку.</p>
  </section>
  <section id="validator">
    <h2>9. Перевірка карти та експорт</h2>
    <p>Натисніть <kbd>V</kbd> (Edit &gt; Validate Map), щоб знайти невідомі id тайлів, відсутнє місто, недосяжні поселення, дороги без зв'язку та відсутні спрайти. Клік по результату переходить до клітинки. Збереження, експорт CSV і Publish Map попереджають про помилки. File &gt; Export PNG зберігає оглядове зображення.</p>
  </section>
  <section id="packages-ux">
    <h2>10. Пакети контенту</h2>
    <p>Вкладка PACKAGES показує пакети з кількістю записів та активний пакет (його також можна вибрати у HEX DB і BUILDINGS). Без токена GitHub пакети залишаються локальними; для публікації токен потрібен. Публікація показує відсутні спрайти та дає змінити версію й додати нотатку до changelog. Імпорт спершу перевіряє ZIP і відкочує зміни при помилці. Гра ще не завантажує пакети, окрім типового. Див. <a href="guides/content-packages-editor-guide.pdf">посібник з пакетів (PDF)</a>.</p>
  </section>
```

Insert each block right after the `</section>` that closes `<section id="shortcuts">` in the respective file (`grep -n 'id="shortcuts"' docs/guide_*.html`). The relative link `guides/...` resolves from `docs/`.

- [ ] **Step 4: Run, expect pass**

Run: `npx playwright test tests/docs.spec.ts --reporter=line`
Expected: 4 passed. If the guide test reports a missing `<kbd>…</kbd>`, add that key to the new table in both guides.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/guide_en.html docs/guide_ua.html MapEditorPro.html tests/docs.spec.ts
git commit -m "docs: refresh README, CHANGELOG and EN/UA guides; add Help menu" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the test ties the guides to `Shortcuts.getAll()` so new shortcuts cannot ship undocumented; UA text reviewed by a Ukrainian speaker.

---

### Task T6.6: Remove unused assets and dead code (only after grep verification)

Verified at plan time (commit `efc9f5a`):
- `selectCustomTerrain`, `getSelectedCustomId` (UI) and `getCustomSprite` (Terrain) each appear exactly twice in `MapEditorPro.html` (definition plus export) and nowhere else: dead.
- `sprites/hex_atlas.png`, `sprites/hex_atlas.json`, `build_atlas.py` are referenced only by each other and by historical docs: unused by the editor. The game may still read the atlas from the server, so deleting it is gated on the owner.
- Root `sprites/` duplicates `packages/postapoc/sprites/`, BUT the editor still writes to it on purpose (`GitHubSync.pushSprite`, `_cmUploadSprite`, `_cmDeleteSprite` all touch `sprites/${category}/...` with a "(compat)" message). It is referenced, so it is NOT removed here.
- `MapEditorPro.html.bak` is git-ignored and untracked: delete locally, nothing to commit.

**Files:**
- Create: `scripts/unreferenced.sh`, `tests/dead-code.spec.ts`
- Modify: `MapEditorPro.html` (remove the three dead functions and their export entries)
- Conditional delete (owner gate): `sprites/hex_atlas.png`, `sprites/hex_atlas.json`, `build_atlas.py`

**Interfaces:**
- Produces: `scripts/unreferenced.sh <fixed-string> [allowed-path ...]` exits 1 and prints hits when the string is referenced outside the allowed paths, `node_modules`, `.git`, test output and `docs/superpowers` history.

- [ ] **Step 1: Write the verification script and the failing test**

Create `scripts/unreferenced.sh` (then `chmod +x scripts/unreferenced.sh`):

```bash
#!/usr/bin/env bash
# usage: scripts/unreferenced.sh <fixed-string> [allowed-path ...]
set -u
needle="$1"; shift
hits=$(grep -rIn -F -- "$needle" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=playwright-report \
  --exclude-dir=test-results --exclude-dir=superpowers --exclude='*.bak' | grep -v '^./scripts/unreferenced.sh' | grep -v '^./tests/dead-code.spec.ts')
for allowed in "$@"; do hits=$(printf '%s\n' "$hits" | grep -v "^./$allowed:"); done
hits=$(printf '%s\n' "$hits" | sed '/^$/d')
if [ -n "$hits" ]; then echo "STILL REFERENCED: $needle"; echo "$hits"; exit 1; fi
echo "unreferenced: $needle"
```

Create `tests/dead-code.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test('dead helpers are gone and the editor still builds its palette', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openEditor(page);
  const r = await page.evaluate(() => ({
    sel: typeof UI.selectCustomTerrain, id: typeof UI.getSelectedCustomId, spr: typeof Terrain.getCustomSprite,
    buttons: document.querySelectorAll('#palette-scroll .tile-btn').length,
  }));
  expect(r).toMatchObject({ sel: 'undefined', id: 'undefined', spr: 'undefined' });
  expect(r.buttons).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run, expect failure; verify references**

Run: `npx playwright test tests/dead-code.spec.ts --reporter=line`
Expected: FAIL (`sel` is `'function'`).
Verify nothing calls them (each command must print `unreferenced:` ...):

```bash
for n in selectCustomTerrain getSelectedCustomId getCustomSprite; do
  test "$(grep -c "$n" MapEditorPro.html)" = 2 || { echo "unexpected count for $n"; break; }
  scripts/unreferenced.sh "$n" MapEditorPro.html
done
```

Expected: three `unreferenced:` lines and no `unexpected count`. If any count is not 2 (Phase 2 may have started using one), STOP and leave that function in place.

- [ ] **Step 3: Remove the dead code**

In `MapEditorPro.html`:
- Delete the comment line `// Kept for backward compatibility — now just delegates to selectTerrain.`, the function `selectCustomTerrain(baseIntOrHexId, customId) { ... }`, the comment `// Returns empty string — all terrain types are now unified in getSelectedTerrain().` and `function getSelectedCustomId() { return ''; }`.
- In the `UI` return list change `selectCustomTerrain, getSelectedCustomId,` to nothing (remove that line's two names, keeping the surrounding commas valid).
- Delete `function getCustomSprite(id) { return getSprite(id); }  // unified — all sprites in sprites{}` and remove `getCustomSprite,` from the `Terrain` return.
- Delete the local backup: `rm -f MapEditorPro.html.bak` (ignored by git, nothing to stage).

- [ ] **Step 4: Run the whole suite**

Run: `npx playwright test --reporter=line`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html scripts/unreferenced.sh tests/dead-code.spec.ts
git commit -m "chore: remove dead UI/Terrain helpers verified unreferenced" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- **Review focus:** the 2-occurrence check is re-run at execution time because other phases may have added callers.

#### T6.6b (gated): remove the unused hex atlas

**Gate: do not run until the owner confirms the game does not load `hex_atlas.png/json` from the server** (for example `grep -rn hex_atlas <game-repo>` returns nothing). `deploy.sh` merges `dev` into `gh-pages`, so deleting the files on `dev` also removes them from the published site.

- [ ] **Step 1: Verify in this repo**

Run: `for n in hex_atlas build_atlas; do scripts/unreferenced.sh "$n" build_atlas.py sprites/hex_atlas.json; done`
Expected: two `unreferenced:` lines (only the atlas builder and its output mention each other). Any other hit: stop.

- [ ] **Step 2: Delete and verify the editor is unaffected**

```bash
git rm sprites/hex_atlas.png sprites/hex_atlas.json build_atlas.py
npx playwright test --reporter=line
```

Expected: all passed.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove unused hex atlas and its builder (confirmed unused by the game)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

#### Not removed on purpose

Root `sprites/` stays: the editor still writes compat copies there (`grep -n '(compat)' MapEditorPro.html` shows the writers). Removing it requires (a) owner confirmation that no game or tool reads `sprites/...`, then (b) deleting those three writers with a test asserting no PUT to a `sprites/` path (use `mockGitHub` from T5.0), then (c) `git rm -r sprites/`. Track as a separate decision.

---


---

