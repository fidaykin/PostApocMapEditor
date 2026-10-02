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
    const axis = 0;   // UI._bridgeSprites is an array indexed by axis
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
