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
    // ---- verbatim copy of the removed Satellite code (git show 7ceb3a0), bound to local state ----
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

// Local scripts the dev workflow does NOT publish into dev/. zone-painter.js is a known pre-existing exception
// (dev resolves it from the gh-pages root via <base href="../">, so it can be stale: follow-up). A new local script
// must either be published by deploy-dev.yml or be added here deliberately.
const DEV_DEPLOY_ALLOWLIST = ['zone-painter.js'];

test('deploy-dev.yml publishes map-jobs.js/map-worker.js into dev/ and rewrites their references', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-dev.yml'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  const pathsLine = (yml.match(/paths:\s*\[([^\]]*)\]/) || [])[1] || '';
  for (const f of ['map-jobs.js', 'map-worker.js']) {
    expect(pathsLine, f + ' must trigger the workflow').toContain(f);
    expect(yml, f + ' copied into dev/').toMatch(new RegExp('cp\\s+\\S*' + f.replace('.', '\\.') + '\\s+dev/' + f.replace('.', '\\.')));
    expect(yml, f + ' committed').toContain('dev/' + f);
  }
  expect(yml).toContain('src="dev/map-jobs.js');           // script tag rewritten
  expect(yml).toContain("new Worker('dev/map-worker.js");  // Worker URL rewritten
  // the rewrite patterns must actually match the HTML
  expect(html).toContain('<script src="map-jobs.js');
  expect(html).toContain("new Worker('map-worker.js");
  // every local <script src> is published into dev/ by the workflow or explicitly allowlisted
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s)).map(s => s.split('?')[0]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) {
    const published = yml.includes('dev/' + s);
    expect(published || DEV_DEPLOY_ALLOWLIST.includes(s), `local script ${s} is neither published into dev/ nor allowlisted`).toBe(true);
  }
});
