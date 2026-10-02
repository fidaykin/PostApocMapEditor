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

test('stale result is discarded when the map changes mid-job', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await loadSyntheticSatellite(page);
  const r = await page.evaluate(async () => {
    const p = Satellite.reclassify();
    IO.newMap(true);                                  // new map identity while the job runs
    await p;
    return { disabled: (document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled, active: document.getElementById('progress-wrap')!.classList.contains('active') };
  });
  expect(r.disabled).toBe(true);                      // stale classification is not offered for apply
  await page.evaluate(() => Satellite.apply());       // and applying does nothing
  expect(await page.evaluate(() => mapData.every(id => id === 'Plain_1'))).toBe(true);
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
  expect(gap).toBeGreaterThan(0);
});

test('map-jobs.js is DOM-free, loaded by the page, and deployed alongside zone-painter.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'MapEditorPro.html'), 'utf8');
  expect(html).toMatch(/<script src="map-jobs\.js(\?[^"]*)?"><\/script>/);
  expect(html.indexOf('map-jobs.js')).toBeLessThan(html.indexOf('const WorkerJobs'));
  const jobs = fs.readFileSync(path.join(ROOT, 'map-jobs.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const bad of [/\bdocument\./, /\bwindow\./, /\bTerrain\./, /\bHexDB\./]) expect(jobs).not.toMatch(bad);
  const worker = fs.readFileSync(path.join(ROOT, 'map-worker.js'), 'utf8');
  expect(worker).toContain("importScripts('map-jobs.js");
  // Deploy publishes whole branch trees (deploy.sh merges the branch into gh-pages) and the dev workflow only
  // re-copies the HTML with <base href="../">: neither may list zone-painter.js explicitly, so the new files ride along.
  const sh = fs.readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-dev.yml'), 'utf8');
  for (const f of [sh, yml]) {
    if (f.includes('zone-painter.js')) { expect(f).toContain('map-jobs.js'); expect(f).toContain('map-worker.js'); }
  }
  expect(yml).toContain('<base href="../">');
});
