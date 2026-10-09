// Perf baselines (hashes + timings) are pinned to the PRE-optimisation editor and to one Chrome build.
// After a Chrome update (see `_meta` in perf-baseline.json) regenerate them from the pre-optimisation editor, in a
// SCRATCH worktree (never on HEAD: that would record the optimised output and drop the pixel-identical guarantee):
//   git worktree add ../baseline-scratch 79a4bf9 && cd ../baseline-scratch && npm install
//   UPDATE_BASELINE=1 npx playwright test tests/perf-equivalence.spec.ts tests/perf-timing.spec.ts --workers=1
//   cp tests/perf-baseline.json <this worktree>/tests/perf-baseline.json && cd - && git worktree remove --force ../baseline-scratch
// 79a4bf9 has the same editor HTML as 8311164 (apart from the COMMIT stamp) and already contains the recorder specs.
// Only those two recorder specs may run with UPDATE_BASELINE; writes are refused unless the page's COMMIT stamp
// is one of the two pre-optimisation stamps below (see assertBaselineWriteAllowed).
import { expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

declare const COMMIT: string, IO: any, MAP_WIDTH: number, MAP_HEIGHT: number, mapData: string[], roadsData: any,
  objectsData: any, bridgesData: any[], BldDB: any, UI: any, Terrain: any, Canvas: any, Tools: any, Roads: any, Coastline: any;

// 1400 is below the responsive layout's 1920 threshold; every perf spec opens the editor through openEditor/freshEditor, which
// seed `rightPanelMode: 'classic'` (see tests/helpers.ts) so the canvas stays 1491x808 and the pixel-hash baselines stay valid.
export const VIEWPORT = { width: 1400, height: 900 };
const BASELINE_FILE = path.join(__dirname, 'perf-baseline.json');

/** COMMIT stamps (parent hash, written by the pre-commit hook) of the pre-optimisation editor: at 79a4bf9 and at 8311164. */
export const PRE_OPT_COMMIT_STAMPS = ['4ac8bec', 'c3060d1'];
let pageCommitStamp: string | undefined;
/** Throws unless the editor under test is a pre-optimisation build, so UPDATE_BASELINE on HEAD fails loudly. */
export function assertBaselineWriteAllowed(stamp: string | undefined) {
  if (!stamp || !PRE_OPT_COMMIT_STAMPS.includes(stamp))
    throw new Error(`Refusing to write perf baselines: editor COMMIT stamp is ${stamp ? `"${stamp}"` : 'unknown (setupScene not run yet)'}, `
      + `expected a pre-optimisation build (${PRE_OPT_COMMIT_STAMPS.join(' or ')}). Record baselines in a scratch worktree at 79a4bf9; see the top of perf-scene.ts.`);
}

export function readBaseline(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { return {}; }
}
export function saveBaselineKey(key: string, value: any) {
  assertBaselineWriteAllowed(pageCommitStamp);
  const b = readBaseline();
  b[key] = value;
  const tmp = BASELINE_FILE + '.' + process.pid + '.tmp';   // atomic: write temp file then rename
  fs.writeFileSync(tmp, JSON.stringify(b, null, 2) + '\n');
  fs.renameSync(tmp, BASELINE_FILE);
}
/** Hash baselines: UPDATE_BASELINE=1 (on UNMODIFIED code only) writes, otherwise compares. */
export function checkBaseline(key: string, actual: string) {
  if (key === '_meta') throw new Error('_meta is reserved');
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
  pageCommitStamp = await page.evaluate(() => (typeof COMMIT === 'string' ? COMMIT : undefined));
  await page.evaluate(async () => {
    const ids = ['Plain_1', 'Plain_2', 'Forest_1', 'Water_1', 'Hills_1', 'Rubble_1', 'Mountain_1', 'Water_Dirty_1'];
    IO.newMap(true);
    for (let r = 0; r < MAP_HEIGHT; r++)
      for (let c = 0; c < MAP_WIDTH; c++)
        mapData[r * MAP_WIDTH + c] = ids[(c * 31 + r * 17 + ((c >> 3) ^ (r >> 3))) % ids.length];
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor((MAP_HEIGHT - 1) / 2);
    for (let i = -20; i <= 20; i++) roadsData[(cc + i) + ',' + cr] = { type: 'road_hex' };
    for (let i = -20; i <= 20; i += 4) roadsData[cc + ',' + (cr + i)] = { type: 'road_hex' };
    const bld = BldDB.getAll().find((b: any) => b.id && Terrain.getSprite(b.id));
    if (!bld) throw new Error('scene needs a building that has a sprite');
    for (let i = 5; i < 40; i += 5) objectsData[(cc + i) + ',' + (cr + 8)] = bld.id;
    const axis = 0;   // UI._bridgeSprites is an array indexed by axis
    bridgesData.push({ col: cc - 10, row: cr - 6, axis });
    // Wait until every sprite the scene draws has decoded, so hashes are stable: terrain, building,
    // and the road / coastline sprites (their loadSprites() are idempotent promises).
    const deadline = Date.now() + 10000;
    const loaded = (s: any) => s && s.complete && s.naturalWidth > 0;
    const watched: HTMLImageElement[] = [];
    const RealImage = window.Image;
    (window as any).Image = function (this: any, ...a: any[]) { const im = new RealImage(...(a as [])); watched.push(im); return im; };
    (window as any).Image.prototype = RealImage.prototype;
    try {
      await Promise.race([
        Promise.all([Roads.loadSprites(), Coastline.loadSprites()]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('road/coastline sprite load timed out')), 10000)),
      ]);
    } finally { window.Image = RealImage; }
    const bad = watched.filter(im => !loaded(im)).map(im => im.src);
    if (!watched.length || bad.length) throw new Error('road/coastline sprites missing: ' + (bad.join(', ') || 'none requested'));
    const need = [...ids, bld.id];
    await new Promise<void>((resolve, reject) => {
      const t = setInterval(() => {
        const missing = need.filter(id => !loaded(Terrain.getSprite(id)));
        if (!missing.length) { clearInterval(t); resolve(); }
        else if (Date.now() > deadline) { clearInterval(t); reject(new Error('sprites not loaded: ' + missing.join(', '))); }
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
