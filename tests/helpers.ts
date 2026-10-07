import { expect, Page, Route, test } from '@playwright/test';
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
  /** Contents API GETs for which this returns true answer HTTP 500 (Pages reads are unaffected). */
  failGet: (p: string) => boolean = () => false;
  private pagesSnapshot: Map<string, Buffer> | null = null;
  /** Paths removed through the Contents API DELETE (hides the repo copy on disk too). */
  private deleted = new Set<string>();
  private pagesDeleted = new Set<string>();
  /** Paths of accepted DELETEs, in order. */
  deletes: string[] = [];
  /** Accepted writes (PUT and DELETE) in the order the server applied them: wait on the LAST one (waitForLastWrite). */
  writeLog: { op: 'PUT' | 'DELETE'; path: string }[] = [];
  /** Every Contents API request the page made (GET, PUT, DELETE), in order, accepted or refused. */
  requests: { method: string; path: string; status: number }[] = [];
  failDelete: (p: string) => boolean = () => false;
  /** Contents API GETs for which this returns true answer like GitHub does for files over 1 MB: the sha but no inline content. */
  hideContent: (p: string) => boolean = () => false;

  /**
   * GitHub Pages lags commits by 30 s to minutes. While pagesLag is on, Pages URLs keep serving
   * the content as of the moment it was switched on; the Contents API keeps serving the live store.
   */
  get pagesLag() { return this.pagesSnapshot !== null; }
  set pagesLag(on: boolean) {
    this.pagesSnapshot = on ? new Map(this.overrides) : null;
    this.pagesDeleted = new Set(this.deleted);
  }

  read(p: string): Buffer | null {
    return this.readFrom(this.overrides, p);
  }
  /** What the GitHub Pages site serves (lagging behind the store while pagesLag is on). */
  readPages(p: string): Buffer | null {
    return this.readFrom(this.pagesSnapshot ?? this.overrides, p, this.pagesSnapshot ? this.pagesDeleted : this.deleted);
  }
  private readFrom(store: Map<string, Buffer>, p: string, gone: Set<string> = this.deleted): Buffer | null {
    if (store.has(p)) return store.get(p)!;
    if (gone.has(p)) return null;
    const f = path.join(ROOT, p);
    return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
  }
  write(p: string, data: Buffer | string) {
    this.overrides.set(p, Buffer.from(data));
    this.deleted.delete(p);
    this.shas.set(p, `sha${++this.n}`);
  }
  /** What the Contents API DELETE does: the file is gone from the store and from the disk fallback. */
  remove(p: string) {
    this.overrides.delete(p);
    this.deleted.add(p);
    this.shas.delete(p);
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
    for (const k of this.deleted) names.delete(k.startsWith(dir + '/') ? k.slice(dir.length + 1) : '');
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

export const readZip = (buf: Buffer) => JSZip.loadAsync(buf);

export const dataUrl = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64');
export const hexRec = (id: string, pkg: string, extra: object = {}) =>
  ({ id, type: 'Plains', spriteName: id, package: pkg, ...extra });
export const bldRec = (id: string, pkg: string, extra: object = {}) =>
  ({ id, spriteName: id, package: pkg, ...extra });

export interface PackageFiles {
  hexes?: object[];
  buildings?: object[];
  /** '<category>/<name>.png' -> bytes */
  sprites?: Record<string, Buffer>;
  version?: string;
  description?: string;
}

/** A package ZIP in the layout Packages.exportPackage writes. */
export async function packageZip(id: string, name: string, f: PackageFiles = {}): Promise<Buffer> {
  const files: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({ id, name, version: f.version ?? '1.0.0', description: f.description ?? '' }),
    'hex_database.json': JSON.stringify({ version: 1, package: id, hexes: f.hexes ?? [] }),
    'building_database.json': JSON.stringify({ version: 1, package: id, buildings: f.buildings ?? [] }),
  };
  for (const [p, b] of Object.entries(f.sprites ?? {})) files['sprites/' + p] = b;
  return buildZip(files);
}

/** Put a published package on the fake server (registry entry + package.json + DBs + sprites). */
export function seedServerPackage(gh: FakeGitHub, id: string, f: PackageFiles & { name?: string } = {}) {
  const name = f.name ?? id;
  const version = f.version ?? '1.0.0';
  gh.setRegistry([{ id, name, version }]);
  gh.setJson(`packages/${id}/package.json`, { id, name, version, description: f.description ?? '', isDefault: false });
  gh.setJson(`packages/${id}/hex_database.json`, { version: 1, package: id, hexes: f.hexes ?? [] });
  gh.setJson(`packages/${id}/building_database.json`, { version: 1, package: id, buildings: f.buildings ?? [] });
  for (const [p, b] of Object.entries(f.sprites ?? {})) gh.write(`packages/${id}/sprites/${p}`, b);
}

/** Local entries, through the real addEntries (replaces same package+id). */
export async function seedHexes(page: Page, hexes: object[]) {
  await page.evaluate(h => { HexDB.addEntries(h); }, hexes);
}
export async function seedBuildings(page: Page, blds: object[]) {
  await page.evaluate(b => { BldDB.addEntries(b); }, blds);
}
/** Local sprites: stored in the SpriteStore and registered so tiles render at once. */
export async function seedSprites(page: Page, sprites: { name: string; category: string; dataUrl: string }[]) {
  await page.evaluate(async list => {
    const urls: Record<string, string> = {};
    for (const s of list) { await SpriteStore.save(s.name, s.dataUrl, s.category); urls[s.name] = s.dataUrl; }
    Terrain.registerUploadedUrls(urls);
  }, sprites);
}

/**
 * Waits until the fake server applied `lastPath` as a write. Pass the path the operation writes LAST
 * (publish = package.json, import = registry.json) so every earlier write is already in the log.
 */
export async function waitForLastWrite(gh: FakeGitHub, lastPath: string, timeout = 10_000) {
  await expect.poll(() => gh.writeLog.some(w => w.path === lastPath), { timeout, message: `write to ${lastPath}` }).toBe(true);
}

export async function installFakeGitHub(page: Page, gh: FakeGitHub) {
  // Registered first = lowest priority: anything that is not localhost fails fast.
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', headers: CORS, body: jszipEsm() }));

  await page.route(PAGES_RE, (route: Route) => {
    const p = decodeURIComponent(PAGES_RE.exec(route.request().url())![1]);
    const body = gh.readPages(p);
    if (!body) return route.fulfill({ status: 404, headers: CORS, body: 'not found' });
    return route.fulfill({ status: 200, contentType: mime(p), headers: CORS, body });
  });

  const json = (route: Route, status: number, obj: unknown) =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });

  await page.route(API_RE, (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = decodeURIComponent(API_RE.exec(req.url())![1]);
    const reply = (status: number, obj: unknown) => {
      gh.requests.push({ method: req.method(), path: p, status });
      return json(route, status, obj);
    };
    if (req.method() === 'GET') {
      if (gh.failGet(p)) return reply(500, { message: 'forced failure' });
      const body = gh.read(p);
      if (body && gh.hideContent(p)) return reply(200, { name: path.basename(p), path: p, sha: gh.sha(p), size: body.length, content: '', encoding: 'none' });
      if (body) return reply(200, { name: path.basename(p), path: p, sha: gh.sha(p), content: body.toString('base64') });
      const list = gh.list(p);
      return list ? reply(200, list) : reply(404, { message: 'Not Found' });
    }
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData() || '{}');
      if (gh.failPut(p)) return reply(500, { message: 'forced failure' });
      if (gh.read(p) !== null && b.sha !== gh.sha(p)) return reply(409, { message: 'sha mismatch' });
      const buf = Buffer.from(b.content, 'base64');
      gh.puts.push({ path: p, text: buf.toString('utf8'), message: b.message });
      gh.write(p, buf);
      gh.writeLog.push({ op: 'PUT', path: p });
      return reply(200, { content: { sha: gh.sha(p) } });
    }
    if (req.method() === 'DELETE') {
      const b = JSON.parse(req.postData() || '{}');
      if (gh.failDelete(p)) return reply(500, { message: 'forced failure' });
      if (gh.read(p) === null) return reply(404, { message: 'Not Found' });
      if (b.sha !== gh.sha(p)) return reply(409, { message: 'sha mismatch' });
      gh.remove(p);
      gh.deletes.push(p);
      gh.writeLog.push({ op: 'DELETE', path: p });
      return reply(200, { commit: { sha: 'c' + gh.writeLog.length } });
    }
    return reply(405, { message: 'not supported by FakeGitHub' });
  });
}

// ── Editor startup (task T2.H) ──────────────────────────────────────────────────────────────────────────────────────
// Root cause of the old "intermittent startup stall" was macOS idle/maintenance sleep, not the editor: with the user
// away the machine runs in ~45 s dark-wake windows every ~9 min, so any wait that spans a sleep ends ~8 min later
// (tests/global-setup.ts now keeps the machine awake during a run). What stays here is a bounded, diagnosable startup:
// every attempt has one deadline (STARTUP_CAP_MS); a failed attempt names the step it was waiting for, the page state,
// the requests still in flight and whether the test process was frozen (asleep); openEditor retries a failed launch once and records it.

/** Per-attempt startup cap. A launch takes ~1 s (p95 1.1 s at load average ~40, 5 s with the renderer throttled 30x),
 *  so 20 s is generous yet leaves room for one retry inside the 60 s default test timeout. */
export const STARTUP_CAP_MS = Number(process.env.HARNESS_STARTUP_CAP_MS || 20_000);

export class EditorStartupError extends Error {
  constructor(message: string) { super(message); this.name = 'EditorStartupError'; }
}

type Tracker = { inflight: Map<any, { url: string; t: number }>; failed: string[]; errors: string[] };
const trackers = new WeakMap<Page, Tracker>();
/** Records in-flight requests and console/page errors so a startup failure can say what it was waiting for. */
function track(page: Page): Tracker {
  startHeartbeat();
  let t = trackers.get(page);
  if (t) return t;
  const tr: Tracker = { inflight: new Map(), failed: [], errors: [] };
  page.on('request', r => tr.inflight.set(r, { url: r.url(), t: Date.now() }));
  page.on('requestfinished', r => tr.inflight.delete(r));
  page.on('requestfailed', r => { tr.inflight.delete(r); tr.failed.push(`${r.url()} (${r.failure()?.errorText})`); });
  page.on('console', m => { if (m.type() === 'error') tr.errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => tr.errors.push('pageerror: ' + e.message.slice(0, 200)));
  // A new document: whatever the previous one left pending (e.g. a request the navigation cancelled) is not its business.
  page.on('framenavigated', f => { if (f === page.mainFrame()) { tr.inflight.clear(); tr.failed.length = 0; tr.errors.length = 0; } });
  trackers.set(page, tr);
  return tr;
}

function raceDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what}: no answer within ${ms} ms`)), ms); }),
  ]);
}

// Freeze detector: a 1 s heartbeat; a gap far longer than 1 s means this process did not run (machine asleep, process
// suspended or a fully starved event loop). Wall-clock based on purpose: Node's timers keep counting through a sleep.
const gaps: { end: number; ms: number }[] = [];
let lastBeat = 0;
function startHeartbeat() {
  if (lastBeat) return;
  lastBeat = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - lastBeat > 5000) { gaps.push({ end: now, ms: now - lastBeat - 1000 }); if (gaps.length > 50) gaps.shift(); }
    lastBeat = now;
  }, 1000).unref();
}
/** Milliseconds this process was frozen since `since` (wall clock); includes a freeze still in progress. */
function frozenMsSince(since: number) {
  const now = Date.now();
  return gaps.filter(g => g.end > since).reduce((a, g) => a + g.ms, 0) + Math.max(0, now - lastBeat - 1000);
}

/** First line of a startup diagnostic (the one the retry log prints). A wait that spanned a freeze says so here:
 *  Node timers stop while the machine sleeps, so the cap holds in awake time and the wall-clock excess is the freeze. */
export function startupHeadline(elapsedMs: number, capMs: number, step: string, frozenMs: number) {
  const frozen = frozenMs > 4000 ? `; test process frozen ~${Math.round(frozenMs / 1000)} s (machine asleep?)` : '';
  return `editor startup not ready after ${(elapsedMs / 1000).toFixed(1)} s (cap ${(capMs / 1000).toFixed(1)} s)${frozen}; waiting for: ${step}`;
}

async function startupDiagnostic(page: Page, step: string, start: number, cap: number, cause: unknown) {
  const tr = trackers.get(page);
  const state = await raceDeadline(page.evaluate(() => {
    const w = window as any;
    return {
      url: location.pathname, readyState: document.readyState,
      HexDB: typeof HexDB === 'undefined' ? 'undefined' : HexDB.getAll().length + ' rows',
      mapData: typeof mapData === 'undefined' ? 'undefined' : mapData ? mapData.length + ' cells' : String(mapData),
      startupSyncDone: !!w.__startupSyncDone, lastSyncSummary: !!w.__lastSyncSummary,
      openModals: [...document.querySelectorAll('.modal.open, [id$="-modal"].open')].map(e => e.id),
    };
  }), 3000, 'page.evaluate').catch(e => `unavailable (${String(e).split('\n')[0]})`);
  const now = Date.now();
  const frozen = frozenMsSince(start);
  const lines = [
    startupHeadline(now - start, cap, step, frozen),
    `  page: ${typeof state === 'string' ? state : JSON.stringify(state)}`,
    `  requests in flight: ${tr ? JSON.stringify([...tr.inflight.values()].map(r => `${r.url} (${now - r.t} ms)`).slice(0, 15)) : 'not tracked'}`,
    `  failed requests: ${tr ? JSON.stringify(tr.failed.slice(-10)) : 'not tracked'}`,
    `  console/page errors: ${tr ? JSON.stringify(tr.errors.slice(-10)) : 'not tracked'}`,
    `  cause: ${String(cause).split('\n')[0]}`,
  ];
  if (frozen > 4000)
    lines.push(`  NOTE: the test process was frozen for ~${Math.round(frozen / 1000)} s during this wait (machine asleep, process suspended `
      + `or a starved event loop), so the timeout is not evidence of an editor problem`);
  return lines.join('\n');
}

/**
 * Waits until the editor finished starting: modules + HexDB loaded, the load handler ran to its end
 * (window.__startupSyncDone is assigned there), the startup content sync resolved, and the startup sprite/data
 * requests settled (network idle). Throws EditorStartupError with a diagnostic after `cap` ms.
 */
export async function waitForEditor(page: Page, cap = STARTUP_CAP_MS) {
  track(page);
  const start = Date.now();
  const left = () => Math.max(1, cap - (Date.now() - start));
  // polling: 100 → re-checked on a timer, independent of the page producing animation frames.
  let step = 'editor modules loaded (HexDB with rows, mapData)';
  try {
    await page.waitForFunction(() =>
      typeof HexDB !== 'undefined' && typeof mapData !== 'undefined' && !!mapData && HexDB.getAll().length > 0,
      undefined, { timeout: left(), polling: 100 });
    step = 'load handler finished (window.__startupSyncDone assigned)';
    await page.waitForFunction(() => !!(window as any).__startupSyncDone, undefined, { timeout: left(), polling: 100 });
    step = 'startup content sync resolved (await window.__startupSyncDone)';
    await raceDeadline(page.evaluate(() => (window as any).__startupSyncDone.then(() => true)), left(), 'startup sync');
    step = 'startup requests settled (network idle for 500 ms)';
    await page.waitForLoadState('networkidle', { timeout: left() });
  } catch (e) {
    if (page.isClosed()) throw e;
    throw new EditorStartupError(await startupDiagnostic(page, step, start, cap, e));
  }
}

export interface OpenOptions {
  gh?: FakeGitHub;
  pat?: boolean;
  blankMap?: boolean;
  storage?: Record<string, string>;
}

/** Navigates and waits for startup within one STARTUP_CAP_MS deadline. */
async function launch(page: Page) {
  const start = Date.now();
  try {
    await page.goto('/MapEditorPro.html', { timeout: STARTUP_CAP_MS });
  } catch (e) {
    if (page.isClosed()) throw e;
    throw new EditorStartupError(await startupDiagnostic(page, 'page.goto (document load)', start, STARTUP_CAP_MS, e));
  }
  await waitForEditor(page, Math.max(1000, STARTUP_CAP_MS - (Date.now() - start)));
}

export async function openEditor(page: Page, opts: OpenOptions = {}) {
  const gh = opts.gh ?? new FakeGitHub();
  const nativeDialogs: string[] = [];
  const pageErrors: string[] = [];
  page.on('dialog', d => { nativeDialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  page.on('pageerror', e => pageErrors.push(e.message));
  track(page);
  await installFakeGitHub(page, gh);
  // `rightPanelMode: 'classic'` keeps the old fixed layout (canvas 1491x808 at 1400x900, panel inline, page widened by the
  // toolbar) so the perf hashes and every pre-existing canvas-size assertion stay valid. A spec that tests the responsive
  // layout passes its own value in `storage`.
  const seed = { rightPanelMode: 'classic', ...(opts.pat ? { gh_sync_pat: 'test-token' } : {}), ...(opts.storage ?? {}) };
  // Seed localStorage once per browser context so reloads keep whatever the test changed.
  await page.addInitScript((s: Record<string, string>) => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const fresh = page.url() === 'about:blank';
  try {
    await launch(page);
  } catch (e) {
    // Startup-only retry, once, and only for a launch on a fresh page: the origin's storage is wiped so the second
    // attempt starts exactly like the first (the seed init script re-seeds localStorage). A second failure fails the
    // test with its diagnostic. Every retry is recorded as a 'startup-retry' annotation and a [harness] log line.
    // HARNESS_NO_STARTUP_RETRY=1 (stall hunting): the first failure fails the test with its diagnostic.
    if (!(e instanceof EditorStartupError) || !fresh || process.env.HARNESS_NO_STARTUP_RETRY === '1') throw e;
    const first = e.message;
    try { test.info().annotations.push({ type: 'startup-retry', description: first.slice(0, 2000) }); } catch (_) { /* outside a test */ }
    console.warn(`[harness] startup retry: ${first.split('\n')[0]}`);
    // Always the project's origin: after a refused connection page.url() is chrome-error://chromewebdata/.
    const origin = new URL(test.info().project.use.baseURL!).origin;
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    const cdp = await raceDeadline(page.context().newCDPSession(page), 5000, 'newCDPSession');
    await raceDeadline(cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }), 5000, 'Storage.clearDataForOrigin');
    await cdp.detach().catch(() => {});
    nativeDialogs.length = 0;
    pageErrors.length = 0;
    try { await launch(page); }
    catch (e2) {
      if (e2 instanceof EditorStartupError) e2.message = `${e2.message}\n(retried once; first attempt: ${first})`;
      throw e2;
    }
  }
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
  // No retry here: a reload is part of what the test checks (state across sessions), so a stall fails it, with the
  // same bounded diagnostic.
  const start = Date.now();
  try {
    await page.reload({ timeout: STARTUP_CAP_MS });
  } catch (e) {
    if (page.isClosed()) throw e;
    throw new EditorStartupError(await startupDiagnostic(page, 'page.reload (document load)', start, STARTUP_CAP_MS, e));
  }
  await waitForEditor(page, Math.max(1000, STARTUP_CAP_MS - (Date.now() - start)));
}

/**
 * Ordering barrier for "nothing was written" assertions (replaces a fixed sleep): waits for the dialog to be closed,
 * then lets two animation frames pass and one mocked network round trip complete, so any request the closing
 * handler started has been issued and routed before the caller looks at what was recorded. Counts events, not time.
 * It orders requests that the close handler issued SYNCHRONOUSLY; a request or write the handler makes after an
 * `await` is not covered (wait for that effect itself with `expect.poll`).
 */
export async function quiesceAfterDialog(page: Page) {
  await page.locator('#dialog-modal.open').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
    await page.locator('#dialog-modal.open').waitFor({ state: 'hidden', timeout: 5000 });
  });
  await page.evaluate(async () => {
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    await fetch('zone-painter.js', { cache: 'no-store' }).then(r => r.text());
  });
}
