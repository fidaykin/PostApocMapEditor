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
  /** Contents API GETs for which this returns true answer HTTP 500 (Pages reads are unaffected). */
  failGet: (p: string) => boolean = () => false;
  private pagesSnapshot: Map<string, Buffer> | null = null;

  /**
   * GitHub Pages lags commits by 30 s to minutes. While pagesLag is on, Pages URLs keep serving
   * the content as of the moment it was switched on; the Contents API keeps serving the live store.
   */
  get pagesLag() { return this.pagesSnapshot !== null; }
  set pagesLag(on: boolean) { this.pagesSnapshot = on ? new Map(this.overrides) : null; }

  read(p: string): Buffer | null {
    return this.readFrom(this.overrides, p);
  }
  /** What the GitHub Pages site serves (lagging behind the store while pagesLag is on). */
  readPages(p: string): Buffer | null {
    return this.readFrom(this.pagesSnapshot ?? this.overrides, p);
  }
  private readFrom(store: Map<string, Buffer>, p: string): Buffer | null {
    if (store.has(p)) return store.get(p)!;
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
    if (req.method() === 'GET') {
      if (gh.failGet(p)) return json(route, 500, { message: 'forced failure' });
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
  // Signal-based waits with a generous explicit cap (slow startup under load must not trip the 30 s default).
  const cap = { timeout: 90_000 };
  await page.waitForFunction(() =>
    typeof HexDB !== 'undefined' && typeof mapData !== 'undefined' && !!mapData && HexDB.getAll().length > 0, undefined, cap);
  await page.waitForFunction(() => !!(window as any).__startupSyncDone, undefined, cap);
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.waitForLoadState('networkidle', cap);
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
