import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, hashMapData, checkBaseline } from './perf-scene';

declare const Satellite: any, WorkerJobs: any, MapJobs: any, IO: any, UI: any, mapData: string[];
test.use({ viewport: VIEWPORT });

const ROOT = path.join(__dirname, '..');

async function loadSyntheticSatellite(page: Page, size = 320) {
  const dataUrl = await page.evaluate((size) => {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const x = c.getContext('2d')!;
    for (let j = 0; j < size; j += 16)
      for (let i = 0; i < size; i += 16) {
        x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},${30 + (i % 5) * 12}%,${15 + (j % 7) * 10}%)`;
        x.fillRect(i, j, 16, 16);
      }
    return c.toDataURL('image/png');
  }, size);
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

test('satellite synchronous fallback (forced) equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => WorkerJobs.forceSync(true));
  await loadSyntheticSatellite(page);
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(false);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});

test('Worker constructor throwing falls back with identical output', async ({ page }) => {
  await page.addInitScript(() => { (window as any).Worker = function () { throw new DOMException('blocked', 'SecurityError'); }; });
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(false);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});

test('worker script failing to load (onerror) falls back with identical output', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).Worker = function (this: any) {
      const w: any = this;
      w.postMessage = () => {}; w.terminate = () => {};
      setTimeout(() => w.onerror && w.onerror(new Event('error')), 10);
    };
  });
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(false);
  await page.evaluate(() => Satellite.apply());
  checkBaseline('satellite_synth', await hashMapData(page));
});

test('worker and sync produce byte-identical MapJobs output', async ({ page }) => {
  await openEditor(page);
  const same = await page.evaluate(async () => {
    const w = 64, h = 64, W = 40, H = 40;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761 >>> 7) & 255;
    const T = (Satellite as any)._getT();
    const job = { pixels, w, h, W, H, T, sampleR: 2, sens: 0.5, flipY: true };
    const viaWorker = await WorkerJobs.run('satellite', job);
    const used = WorkerJobs.usingWorker();
    const direct = MapJobs.satellite({ ...job }, undefined);
    return used && JSON.stringify(viaWorker.names) === JSON.stringify(direct.names) &&
      viaWorker.out.length === direct.out.length && viaWorker.out.every((v: number, i: number) => v === direct.out[i]);
  });
  expect(same).toBe(true);
});

test('result for a different map SIZE is discarded and classification re-runs; same-size map keeps the result', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  const r = await page.evaluate(async () => {
    const p = Satellite.reclassify();
    (window as any).MAP_WIDTH = 100; (window as any).MAP_HEIGHT = 100;      // map size changes while the job runs
    (0, eval)('MAP_WIDTH = 100; MAP_HEIGHT = 100; mapData = new Array(10000).fill("Plain_1");');
    await p;
    return (document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled;
  });
  expect(r).toBe(true);                                // stale result not offered
  await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);   // re-classified for 100x100
  await page.evaluate(() => Satellite.apply());
  expect(await page.evaluate(() => mapData.length)).toBe(10000);
  expect(await page.evaluate(() => mapData.some(id => id !== 'Plain_1'))).toBe(true);
  // same size, new map identity: classification completes and is offered
  await setupScene(page);
  await loadSyntheticSatellite(page);
  const ok = await page.evaluate(async () => {
    const p = Satellite.reclassify();
    IO.newMap(true);
    await p;
    return !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled;
  });
  expect(ok).toBe(true);
});

test('closing the modal mid-job terminates the worker and applies nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.Worker; (window as any).__terminated = 0;
    (window as any).Worker = class extends Real { terminate() { (window as any).__terminated++; super.terminate(); } };
  });
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  const before = await hashMapData(page);
  const r = await page.evaluate(async () => {
    const p = Satellite.reclassify();
    Satellite.close();
    await p;
    return { term: (window as any).__terminated, disabled: (document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled };
  });
  expect(r.term).toBeGreaterThanOrEqual(1);
  expect(r.disabled).toBe(true);
  await page.evaluate(() => Satellite.apply());
  expect(await hashMapData(page)).toBe(before);
  // the next job still works (a fresh worker is created)
  await loadSyntheticSatellite(page);
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(true);
});

test('UI stays responsive during a large classification (worker) and progress is cleaned up', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page, 1024);
  const r = await page.evaluate(async () => {
    let ticks = 0, last = performance.now(), maxGap = 0;
    const t = setInterval(() => { ticks++; const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 5);
    const t0 = performance.now();
    await Satellite.reclassify();
    const during = ticks, gap = maxGap, dur = performance.now() - t0;   // read immediately after the job resolves
    clearInterval(t);
    return { during, gap, dur, worker: WorkerJobs.usingWorker() };
  });
  console.log('worker path: job=' + r.dur.toFixed(0) + 'ms ticks=' + r.during + ' longest main-thread gap=' + r.gap.toFixed(1) + 'ms');
  expect(r.worker).toBe(true);
  expect(r.during).toBeGreaterThanOrEqual(3);
  expect(r.gap).toBeLessThan(r.dur / 2);          // the job never blocked the main thread for most of its duration
  await page.waitForFunction(() => !document.getElementById('progress-wrap')!.classList.contains('active'));
});

test('longest main-thread block of the synchronous path (reference measurement)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);                              // 450x450 map
  await page.evaluate(() => WorkerJobs.forceSync(true));
  await loadSyntheticSatellite(page, 1024);
  // The sync classification is one uninterrupted block, so its duration IS the longest main-thread block
  // (a timer cannot tick while it runs).
  const gap = await page.evaluate(async () => {
    const t0 = performance.now();
    await Satellite.reclassify();
    return performance.now() - t0;
  });
  console.log('sync path: longest main-thread gap=' + gap.toFixed(1) + 'ms');
  test.info().annotations.push({ type: 'sync-longest-block-ms', description: gap.toFixed(1) });
});

// Small job on a 30x30 map used by the stub-worker tests.
const SMALL_JOB = `(() => {
  const w = 64, h = 64, W = 30, H = 30;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761 >>> 7) & 255;
  return { pixels, w, h, W, H, T: Satellite._getT(), sampleR: 1, sens: 0.5, flipY: false };
})()`;
const SAME = `(a, b) => a.out.length === b.out.length && a.out.every((v, i) => v === b.out[i]) && JSON.stringify(a.names) === JSON.stringify(b.names)`;

test('version mismatch from the worker falls back to the main thread with identical output', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).Worker = function (this: any) {
      const w: any = this; w.terminate = () => {};
      w.postMessage = (m: any) => setTimeout(() => w.onmessage && w.onmessage({ data: { id: m.id, kind: 'version-mismatch' } }), 5);
    };
  });
  await openEditor(page);
  const ok = await page.evaluate(`(async () => {
    const job = ${SMALL_JOB};
    const viaRun = await WorkerJobs.run('satellite', job);
    return (${SAME})(viaRun, MapJobs.satellite({ ...job })) && !WorkerJobs.usingWorker();
  })()`);
  expect(ok).toBe(true);
});

test('real worker receives the page MapJobs.VERSION and accepts it', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(`(async () => {
    const job = ${SMALL_JOB};
    await WorkerJobs.run('satellite', job);
    const used = WorkerJobs.usingWorker();
    return { used, v: MapJobs.VERSION };
  })()`) as any;
  expect(r.used).toBe(true);
  expect(Number.isInteger(r.v)).toBe(true);
});

test('messageerror falls back to the main thread', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).Worker = function (this: any) {
      const w: any = this; w.terminate = () => {}; w.postMessage = () => setTimeout(() => w.onmessageerror && w.onmessageerror(new Event('messageerror')), 5);
    };
  });
  await openEditor(page);
  const ok = await page.evaluate(`(async () => {
    const job = ${SMALL_JOB};
    return (${SAME})(await WorkerJobs.run('satellite', job), MapJobs.satellite({ ...job })) && !WorkerJobs.usingWorker();
  })()`);
  expect(ok).toBe(true);
});

test('watchdog: a worker that never replies falls back with a toast', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__term = 0;
    (window as any).Worker = function (this: any) { const w: any = this; w.postMessage = () => {}; w.terminate = () => { (window as any).__term++; }; };
  });
  await openEditor(page);
  const r = await page.evaluate(`(async () => {
    const toasts = []; const o = UI.toast; UI.toast = m => { toasts.push(m); };
    WorkerJobs._watchdogMs = 100;
    const job = ${SMALL_JOB};
    const res = await WorkerJobs.run('satellite', job);
    UI.toast = o; WorkerJobs._watchdogMs = 20000;
    return { same: (${SAME})(res, MapJobs.satellite({ ...job })), toasts, term: window.__term };
  })()`) as any;
  expect(r.same).toBe(true);
  expect(r.toasts.join('|')).toMatch(/did not respond/);
  expect(r.term).toBeGreaterThanOrEqual(1);
});

test('cancel(owner) only cancels that owner\'s jobs', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__term = 0;
    (window as any).Worker = function (this: any) { const w: any = this; w.postMessage = () => {}; w.terminate = () => { (window as any).__term++; }; };
  });
  await openEditor(page);
  const r = await page.evaluate(`(async () => {
    const job = ${SMALL_JOB};
    const out = { a: 'pending', b: 'pending' };
    const pa = WorkerJobs.run('satellite', job, { owner: 'a' }).then(() => out.a = 'ok', e => out.a = e.cancelled ? 'cancelled' : 'err');
    const pb = WorkerJobs.run('satellite', job, { owner: 'b' }).then(() => out.b = 'ok', e => out.b = e.cancelled ? 'cancelled' : 'err');
    WorkerJobs.cancel('a');
    await pa;
    await new Promise(r => setTimeout(r, 20));
    const afterA = { ...out, term: window.__term };
    WorkerJobs.cancel('b'); await pb;
    return { afterA, final: out, term: window.__term };
  })()`) as any;
  expect(r.afterA).toEqual({ a: 'cancelled', b: 'pending', term: 1 });
  expect(r.final.b).toBe('cancelled');
  expect(r.term).toBe(2);
});

test('non-default parameters match the pre-worker (legacy, verbatim) classifier', async ({ page }) => {
  await openEditor(page);
  const same = await page.evaluate(`(() => {
    // ---- verbatim copy of the removed Satellite code (git show 7ceb3a0^:MapEditorPro.html; 7ceb3a0 is the commit that removed it), bound to local state ----
    let _pixels, _w, _h; const MAP_WIDTH = 37, MAP_HEIGHT = 29; let _T;
    const _getT = () => _T;
  function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s, l];
  }

  function _sample(col, row, sampleR) {
    const cx = (col / MAP_WIDTH)  * _w;
    const cy = (row / MAP_HEIGHT) * _h;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let dy = -sampleR; dy <= sampleR; dy++) {
      for (let dx = -sampleR; dx <= sampleR; dx++) {
        if (dx * dx + dy * dy > sampleR * sampleR) continue;
        const ix = Math.max(0, Math.min(_w - 1, Math.round(cx + dx)));
        const iy = Math.max(0, Math.min(_h - 1, Math.round(cy + dy)));
        const i  = (iy * _w + ix) * 4;
        sr += _pixels.data[i]; sg += _pixels.data[i+1]; sb += _pixels.data[i+2];
        n++;
      }
    }
    return [sr / n, sg / n, sb / n];
  }

  function _classifyColor(r, g, b, sens) {
    const [h, s, l] = _rgbToHsl(r, g, b);
    const T = _getT();

    if (l < 0.09) return T.RIFT;
    if ((h < 25 || h > 335) && s > 0.50 && l > 0.12 && l < 0.55) return T.LAVA;

    const wSatMin = 0.42 - sens * 0.32;
    if (h >= 170 && h <= 268 && s > wSatMin && l < 0.70) return l < 0.32 ? T.WATER_DARK : T.WATER_LIGHT;

    if (s < 0.18 && l > 0.74 - (1 - sens) * 0.12) return T.MOUNTAIN;
    if (s < 0.20) {
      if (l > 0.56) return T.HILLS;
      if (l > 0.30) return T.RUBBLE_1;
      return T.RIFT;
    }

    const fSatMin = 0.28 - sens * 0.20;
    if (h >= 78 && h <= 168) {
      if (s > fSatMin) {
        if (l < 0.22) return T.SWAMP;
        if (l < 0.37) return T.FOREST_2;
        if (l < 0.53) return T.FOREST_1;
        return T.PLAIN_1;
      }
      if (l < 0.30) return T.SWAMP;
      if (l < 0.50) return T.PLAIN_2;
      return T.PLAIN_1;
    }
    if (h >= 50 && h < 78) {
      if (s > 0.30 && l > 0.52) return T.PLAIN_1;
      if (s > 0.22 && l > 0.38) return T.PLAIN_2;
      return T.BARREN;
    }
    if (h >= 30 && h < 60 && s > 0.28 && l > 0.56) return T.DESERT;
    if (h >= 12 && h < 50) {
      if (l > 0.52 && s > 0.22) return T.BARREN;
      if (l > 0.36 && s > 0.18) return T.RUBBLE_1;
      return T.RUBBLE_2;
    }
    return T.PLAIN_1;
  }

    // ------------------------------------------------------------------------------------------
    _w = 90; _h = 70; _T = Satellite._getT();
    const data = new Uint8ClampedArray(_w * _h * 4);
    for (let y = 0; y < _h; y++) for (let x = 0; x < _w; x++) {     // 6px blocks of pseudo-random colour
      const k = ((x / 6 | 0) * 73856093) ^ ((y / 6 | 0) * 19349663), i = (y * _w + x) * 4;
      data[i] = (k >>> 3) & 255; data[i + 1] = (k >>> 11) & 255; data[i + 2] = (k >>> 19) & 255; data[i + 3] = 255;
    }
    _pixels = { data };
    const sampleR = 4, sens = 0.2, flipY = true, W = MAP_WIDTH, H = MAP_HEIGHT;
    const legacy = new Array(W * H);
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const srcRow = flipY ? H - 1 - row : row;
      const [r, g, b] = _sample(col, srcRow, sampleR);
      legacy[row * W + col] = _classifyColor(r, g, b, sens);
    }
    const res = MapJobs.satellite({ pixels: data, w: _w, h: _h, W, H, T: _T, sampleR, sens, flipY });
    return legacy.every((id, i) => id === res.names[res.out[i]]) && new Set(legacy).size > 3;
  })()`);
  expect(same).toBe(true);
});

test('map-jobs.js is DOM-free and loaded by the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  expect(html).toMatch(/<script src="map-jobs\.js(\?[^"]*)?"><\/script>/);
  expect(html.indexOf('map-jobs.js')).toBeLessThan(html.indexOf('const WorkerJobs'));
  const jobs = fs.readFileSync(path.join(ROOT, 'map-jobs.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const bad of [/\bdocument\./, /\bwindow\./, /\bTerrain\./, /\bHexDB\./]) expect(jobs).not.toMatch(bad);
  expect(fs.readFileSync(path.join(ROOT, 'map-worker.js'), 'utf8')).toContain("importScripts('map-jobs.js");
});

// Every local <script src> must be published into dev/ by deploy-dev.yml (no allowlist: a script dev does not publish
// would be served stale from the gh-pages root via <base href="../">).

test('deploy-dev.yml publishes map-jobs.js/map-worker.js into dev/ and rewrites their references', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-dev.yml'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  const pathsLine = (yml.match(/paths:\s*\[([^\]]*)\]/) || [])[1] || '';
  for (const f of ['map-jobs.js', 'map-worker.js', 'hex-utils.js', 'gen-utils.js', 'zone-painter.js']) {
    expect(pathsLine, f + ' must trigger the workflow').toContain(f);
    expect(yml, f + ' copied into dev/').toMatch(new RegExp('cp\\s+\\S*' + f.replace('.', '\\.') + '\\s+dev/' + f.replace('.', '\\.')));
    expect(yml, f + ' committed').toContain('dev/' + f);
  }
  expect(yml).toContain('src="dev/map-jobs.js');           // script tag rewritten
  expect(yml).toContain('<script src="dev/hex-utils.js');
  expect(html).toContain('<script src="hex-utils.js');
  expect(yml).toContain('<script src="dev/gen-utils.js');
  expect(html).toContain('<script src="gen-utils.js');
  // zone-painter.js: tag rewritten into dev/, and the tag keeps its ?v= cache-buster, which the workflow verifies after the rewrite
  expect(yml).toContain('<script src="dev/zone-painter.js');
  expect(html).toMatch(/<script src="zone-painter\.js\?v=\d+"><\/script>/);
  expect(yml).toContain('src="dev/zone-painter.js\\?v=[0-9]+"');
  expect(yml).toContain("new Worker('dev/map-worker.js");  // Worker URL rewritten
  // the rewrite patterns must actually match the HTML
  expect(html).toContain('<script src="map-jobs.js');
  expect(html).toContain("new Worker('map-worker.js");
  // every local <script src> is published into dev/ by the workflow
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s)).map(s => s.split('?')[0]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) {
    const published = yml.includes('dev/' + s);
    expect(published, `local script ${s} is not published into dev/ by deploy-dev.yml`).toBe(true);
  }
});

// ───────────────────────── T1.10: Generator in the worker ─────────────────────────
declare const Generator: any, MAP_WIDTH: number;

async function setSeed(page: Page, seed: number) {
  await page.evaluate((seed) => { (document.getElementById('gen-seed') as HTMLInputElement).value = String(seed); }, seed);
}
// Count tiles whose id belongs to a River/Lake edge tile (HexDB type Rivers or Water with edge faces).
const RIVER_COUNT = `(() => { let n = 0; for (const id of mapData) { const e = Terrain.byHexId(id); if (e && e.type === 'Rivers') n++; } return n; })()`;

test('generator via worker equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await setSeed(page, 42);
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(true);
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('generator synchronous fallback equals baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => WorkerJobs.forceSync(true));
  await setSeed(page, 42);
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(false);
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('Worker constructor throwing: generator falls back with the baseline result', async ({ page }) => {
  await page.addInitScript(() => { (window as any).Worker = function () { throw new DOMException('blocked', 'SecurityError'); }; });
  await openEditor(page);
  await setupScene(page);
  await setSeed(page, 42);
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => WorkerJobs.usingWorker())).toBe(false);
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('worker version mismatch: generator falls back with the baseline result', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).Worker = function (this: any) {
      const w: any = this; w.terminate = () => {};
      w.postMessage = (m: any) => setTimeout(() => w.onmessage && w.onmessage({ data: { id: m.id, kind: 'version-mismatch' } }), 5);
    };
  });
  await openEditor(page);
  await setupScene(page);
  await setSeed(page, 42);
  await page.evaluate(async () => { await Generator.apply(); });
  checkBaseline('generator_seed42', await hashMapData(page));
});

test('river tiles and the whole map are identical between worker and fallback (non-default seed, rivers on)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(() => { (document.getElementById('gen-rivers') as HTMLInputElement).value = '6'; });
  await setSeed(page, 9137);
  await page.evaluate(async () => { await Generator.apply(); });
  const viaWorker = { hash: await hashMapData(page), rivers: await page.evaluate(RIVER_COUNT) as number, used: await page.evaluate(() => WorkerJobs.usingWorker()) };
  await setupScene(page);
  await page.evaluate(() => WorkerJobs.forceSync(true));
  await page.evaluate(() => { (document.getElementById('gen-rivers') as HTMLInputElement).value = '6'; });
  await setSeed(page, 9137);
  await page.evaluate(async () => { await Generator.apply(); });
  const viaSync = { hash: await hashMapData(page), rivers: await page.evaluate(RIVER_COUNT) as number, used: await page.evaluate(() => WorkerJobs.usingWorker()) };
  expect(viaWorker.used).toBe(true);
  expect(viaSync.used).toBe(false);
  expect(viaWorker.rivers).toBeGreaterThan(20);        // rivers were really carved and edge-resolved
  expect(viaSync).toEqual({ ...viaWorker, used: false });
});

test('preview job output is identical between worker and the direct MapJobs call (also debug maps)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await setSeed(page, 5);
  const ok = await page.evaluate(async () => {
    const same = (a: any, b: any) =>
      JSON.stringify(a.names) === JSON.stringify(b.names) && a.grid.length === b.grid.length &&
      a.grid.every((v: number, i: number) => v === b.grid[i]) &&
      (!a.elev || (a.elev.every((v: number, i: number) => v === b.elev[i]) && a.moist.every((v: number, i: number) => v === b.moist[i])));
    const out: boolean[] = [];
    for (const debug of [false, true]) {
      const job = Generator._buildJob({ skipExpensive: true, debug });
      const w = await WorkerJobs.run('generate', job, { owner: 'generator' });
      const usedWorker = WorkerJobs.usingWorker();
      const d = MapJobs.generate(Generator._buildJob({ skipExpensive: true, debug }));
      out.push(usedWorker && same(w, d));
    }
    return out;
  });
  expect(ok).toEqual([true, true]);
});

test('main thread stays responsive and progress shows during Generate', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    let last = performance.now(), gap = 0, on = true, ticks = 0;
    const tick = () => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; ticks++; if (on) setTimeout(tick, 1); };
    setTimeout(tick, 1);
    const p = Generator.apply();
    const progressShown = document.getElementById('progress-wrap')!.classList.contains('active');
    await p;
    const ticksAtResolve = ticks;
    on = false;
    return { gap, progressShown, ticksAtResolve };
  });
  expect(r.progressShown).toBe(true);
  expect(r.ticksAtResolve).toBeGreaterThan(5);     // the ticker kept running DURING the job
  expect(r.gap).toBeLessThan(150);
});

test('longest main-thread block: Generate apply (worker vs forced sync) and a preview refresh', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const measure = async (sync: boolean, fn: string) => page.evaluate(async ({ sync, fn }) => {
    WorkerJobs.forceSync(sync);
    let last = performance.now(), gap = 0, on = true;
    const tick = () => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; if (on) setTimeout(tick, 0); };
    setTimeout(tick, 0);
    const t0 = performance.now();
    await (0, eval)(fn);
    const wall = performance.now() - t0;
    await new Promise(r => setTimeout(r, 30));
    on = false; WorkerJobs.forceSync(false);
    return { gap: Math.round(gap), wall: Math.round(wall) };
  }, { sync, fn });
  const apply = '(async()=>{ await Generator.apply(); })()';
  const preview = '(async()=>{ Generator.open(); Generator.schedule(); await new Promise(r=>setTimeout(r,1200)); Generator.close(); })()';
  const applySync = await measure(true, apply);
  await setupScene(page);
  const applyWorker = await measure(false, apply);
  const prevSync = await measure(true, preview);
  const prevWorker = await measure(false, preview);
  test.info().annotations.push({ type: 'blocks-ms', description: JSON.stringify({ applySync, applyWorker, prevSync, prevWorker }) });
  console.log('BLOCKS ' + JSON.stringify({ applySync, applyWorker, prevSync, prevWorker }));
  expect(applyWorker.gap).toBeLessThan(100);
});

test('rapid preview changes cancel earlier jobs; latest request wins and does not pile up workers', async ({ page }) => {
  await page.addInitScript(() => {
    const Real = (window as any).Worker; (window as any).__made = 0; (window as any).__term = 0;
    (window as any).Worker = function (...a: any[]) { (window as any).__made++; const w = new Real(...a); const t = w.terminate.bind(w); w.terminate = () => { (window as any).__term++; t(); }; return w; };
  });
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    const cv = document.getElementById('gen-preview') as HTMLCanvasElement;
    const sig = () => { const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; };
    Generator.open();
    await new Promise(r => setTimeout(r, 1200));         // settle the initial preview
    const base = { made: (window as any).__made, term: (window as any).__term };
    const sigs: number[] = [];
    // two requests that reach _renderPreview back to back (debounce bypassed through the public job path)
    const seed = document.getElementById('gen-seed') as HTMLInputElement;
    const calls: Promise<any>[] = [];
    for (const v of ['11', '12', '13']) {
      seed.value = v;
      calls.push(WorkerJobs.run('generate', Generator._buildJob({ skipExpensive: true }), { owner: 'generator' }).then(() => 'ok', (e: any) => e.cancelled ? 'cancelled' : 'err'));
      WorkerJobs.cancel('generator');                       // what _renderPreview does before starting the next job
    }
    const res = await Promise.all(calls);
    seed.value = '20'; Generator.schedule();
    const before = sig();
    seed.value = '21'; Generator.schedule();                // debounced: only the last one runs
    await new Promise(r => setTimeout(r, 1500));
    return { res, made: (window as any).__made - base.made, changed: sig() !== before, live: (WorkerJobs as any).usingWorker() };
  });
  expect(r.res).toEqual(['cancelled', 'cancelled', 'cancelled']);
  expect(r.changed).toBe(true);
});

test('preview: a newer request terminates the older in-flight generator job', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__term = 0; (window as any).__made = 0;
    (window as any).Worker = function (this: any) { const w: any = this; (window as any).__made++; w.postMessage = () => {}; w.terminate = () => { (window as any).__term++; }; };
  });
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    Generator.open();                      // schedules preview 1 (debounced 150 ms)
    await new Promise(r => setTimeout(r, 400));
    const afterOne = { made: (window as any).__made, term: (window as any).__term };   // job 1 hangs (fake worker)
    Generator.schedule();
    await new Promise(r => setTimeout(r, 400));
    const afterTwo = { made: (window as any).__made, term: (window as any).__term };
    Generator.close();
    return { afterOne, afterTwo, final: (window as any).__term };
  });
  expect(r.afterOne).toEqual({ made: 1, term: 0 });
  expect(r.afterTwo).toEqual({ made: 2, term: 1 });   // older job terminated when the newer started
  expect(r.final).toBe(2);                            // closing the modal terminates the last one
});

test('owner-scoped cancellation: cancelling the satellite job leaves a generator job running, and vice versa', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page, 320);
  const r = await page.evaluate(async () => {
    const out: any = { sat: 'pending', gen: 'pending' };
    const sat = WorkerJobs.run('satellite', { pixels: new Uint8ClampedArray(64 * 64 * 4), w: 64, h: 64, W: 450, H: 450, T: Satellite._getT(), sampleR: 6, sens: 0.5, flipY: false }, { owner: 'satellite' })
      .then(() => out.sat = 'ok', (e: any) => out.sat = e.cancelled ? 'cancelled' : 'err');
    const gen = WorkerJobs.run('generate', Generator._buildJob({}), { owner: 'generator' })
      .then(() => out.gen = 'ok', (e: any) => out.gen = e.cancelled ? 'cancelled' : 'err');
    WorkerJobs.cancel('satellite');
    await sat;
    const afterCancel = { ...out };
    await gen;
    // vice versa
    const out2: any = {};
    const sat2 = WorkerJobs.run('satellite', { pixels: new Uint8ClampedArray(64 * 64 * 4), w: 64, h: 64, W: 450, H: 450, T: Satellite._getT(), sampleR: 6, sens: 0.5, flipY: false }, { owner: 'satellite' })
      .then(() => out2.sat = 'ok', (e: any) => out2.sat = e.cancelled ? 'cancelled' : 'err');
    const gen2 = WorkerJobs.run('generate', Generator._buildJob({}), { owner: 'generator' })
      .then(() => out2.gen = 'ok', (e: any) => out2.gen = e.cancelled ? 'cancelled' : 'err');
    WorkerJobs.cancel('generator');
    await gen2; await sat2;
    return { afterCancel, final: out, out2 };
  });
  expect(r.afterCancel).toEqual({ sat: 'cancelled', gen: 'pending' });
  expect(r.final).toEqual({ sat: 'cancelled', gen: 'ok' });
  expect(r.out2).toEqual({ gen: 'cancelled', sat: 'ok' });
});

test('Generate result for a different map size is discarded (nothing written, no undo entry)', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    const toasts: string[] = []; const o = UI.toast; UI.toast = (m: string) => { toasts.push(String(m)); };
    const before = mapData.slice(); const undo0 = History.undoSize();
    const p = Generator.apply();
    (0, eval)('MAP_WIDTH = 100; MAP_HEIGHT = 100; mapData = new Array(10000).fill("Plain_1");');
    await p;
    UI.toast = o;
    return { allPlain: mapData.every((id: string) => id === 'Plain_1'), len: mapData.length, undo: History.undoSize() - undo0, toasts, btn: (document.querySelector('#gen-modal .btn-primary') as HTMLButtonElement).disabled };
  });
  expect(r.allPlain).toBe(true);
  expect(r.len).toBe(10000);
  expect(r.undo).toBe(0);
  expect(r.toasts.join('|')).toMatch(/discarded/);
  expect(r.btn).toBe(false);                             // modal not stuck
});

test('Generate pushes exactly one undo entry and undo restores the map', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const h0 = await hashMapData(page);
  const u0 = await page.evaluate(() => History.undoSize());
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => History.undoSize())).toBe(u0 + 1);
  await page.evaluate(() => History.undo());
  expect(await hashMapData(page)).toBe(h0);
});

test('Generate: worker error toasts, progress is cleaned up and the button is re-enabled', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  const r = await page.evaluate(async () => {
    const toasts: string[] = []; const o = UI.toast; UI.toast = (m: string) => { toasts.push(String(m)); };
    const orig = MapJobs.generate; MapJobs.generate = () => { throw new Error('boom'); };
    WorkerJobs.forceSync(true);
    await Generator.apply();
    MapJobs.generate = orig; WorkerJobs.forceSync(false); UI.toast = o;
    await new Promise(r => setTimeout(r, 700));
    return { toasts, btn: (document.querySelector('#gen-modal .btn-primary') as HTMLButtonElement).disabled, active: document.getElementById('progress-wrap')!.classList.contains('active') };
  });
  expect(r.toasts.join('|')).toMatch(/Generation failed: boom/);
  expect(r.btn).toBe(false);
  expect(r.active).toBe(false);
});

test('page refuses a map-jobs.js whose VERSION differs from the page constant', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    const v = MapJobs.VERSION; MapJobs.VERSION = v + 100;
    let msg = ''; try { await WorkerJobs.run('satellite', {}); } catch (e: any) { msg = e.message; }
    MapJobs.VERSION = v;
    return { msg, v, page: (0, eval)('MAP_JOBS_VERSION') };
  });
  expect(r.msg).toMatch(/does not match this page/);
  expect(r.v).toBe(r.page);
  expect(r.v).toBe(4);
});

test('version, ?v= query, worker importScripts and deploy-dev.yml agree', () => {
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  const jobs = fs.readFileSync(path.join(ROOT, 'map-jobs.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'map-worker.js'), 'utf8');
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-dev.yml'), 'utf8');
  const v = Number(/MapJobs\.VERSION = (\d+);/.exec(jobs)![1]);
  expect(Number(/const MAP_JOBS_VERSION = (\d+);/.exec(html)![1])).toBe(v);
  expect(html).toContain(`<script src="map-jobs.js?v=${v}"></script>`);
  expect(html).toContain(`new Worker('map-worker.js?v=${v}')`);
  expect(worker).toContain(`importScripts('map-jobs.js?v=${v}')`);
  expect(yml).toContain(`src="dev/map-jobs.js?v=${v}"`);
  expect(yml).toContain(`new Worker('dev/map-worker.js?v=${v}'`);
  // the workflow's own grep for hex-utils.js ?v= must equal the ?v= in the HTML (bump both together)
  const hv = /<script src="hex-utils\.js\?v=(\d+)"/.exec(html)![1];
  expect(yml).toContain(`src="dev/hex-utils.js?v=${hv}"`);
  const gv = /<script src="gen-utils\.js\?v=(\d+)"/.exec(html)![1];
  expect(yml).toContain(`src="dev/gen-utils.js?v=${gv}"`);
});

test('generator core lives only in map-jobs.js (no duplicate in the page)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  for (const fn of ['_makeNoise2D', '_multiOctave', '_smoothTerrain', '_generateInto', '_lcg']) expect(html).not.toContain('function ' + fn);
  expect(fs.readFileSync(path.join(ROOT, 'map-jobs.js'), 'utf8')).toContain('MapJobs.generate = ');
});
