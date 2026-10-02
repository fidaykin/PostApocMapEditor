// T1.6 decision gate for T1.7 (structural-sharing history). MEASUREMENT ONLY, skipped unless MEASURE_UNDO=1:
//   MEASURE_UNDO=1 npx playwright test tests/perf-undo-measure.spec.ts --workers=1
// Records tests/perf-undo-measure.json and prints `T1.7 VERDICT: ...`. Never asserts absolute ms or MB,
// so a noisy machine cannot turn the default suite red.
//
// Method: History.push() runs BEFORE an edit, so snapshot k is the state before edit k. We run 50 steps of
// (real edit, push) per scenario. Retained size = usedJSHeapSize(after forced GC) - usedJSHeapSize(before,
// forced GC) around the 50 pushes; per-snapshot = total / 50. Because mapData edits themselves allocate
// almost nothing, the delta is essentially the snapshots. The sizing is a heap delta (not an exact sizeof),
// so it also reports a structural estimate (see estimateSnapshotBytes) as a cross-check.
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene } from './perf-scene';

declare const History: any, mapData: string[], tileExtras: any, roadsData: any, objectsData: any, settlements: any[],
  settlementSlots: any[], bridgesData: any[], ZonePainter: any, Generator: any, MAP_WIDTH: number, MAP_HEIGHT: number;

const THRESHOLD_MB = 64;    // keep in sync with task-T1.6-brief.md / T1.7
const THRESHOLD_P95_MS = 8;
const OUT = path.join(__dirname, 'perf-undo-measure.json');

test.use({ viewport: VIEWPORT, launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } });

for (const scenario of ['scene', 'rich', 'worst'] as const) {
  test(`measure undo history: ${scenario}`, async ({ page }, testInfo) => {
    test.skip(!process.env.MEASURE_UNDO, 'measurement only: run with MEASURE_UNDO=1');
    test.setTimeout(180_000);
    await openEditor(page);
    await setupScene(page);   // T1.1 scene: terrain mix, ~50 roads, 7 objects, 1 bridge
    const res = await page.evaluate(async (scenario) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const gc = (window as any).gc as (() => void) | undefined;
      const settle = async () => { if (gc) { gc(); await new Promise(r => setTimeout(r, 100)); gc(); await new Promise(r => setTimeout(r, 50)); gc(); } };
      const zl = ZonePainter.getZoneLayer();
      const ids = Object.keys(objectsData).length ? Object.values(objectsData) as string[] : [];
      const objId = ids[0] as string;
      const rich = scenario !== 'scene';
      const key = (i: number, mul: number) => { const j = (i * mul) % (W * H); return (j % W) + ',' + (j / W | 0); };   // distinct cells (mul coprime with 450*450)
      if (rich) {
        const nRoads = scenario === 'worst' ? 30000 : 5000;
        const nObjs = scenario === 'worst' ? 15000 : 1500;
        const nExtras = scenario === 'worst' ? 20000 : 2000;
        if (scenario === 'worst') { History.clear(); Generator.apply(); }   // default seed 42 (apply() pushes once; cleared below)
        for (let i = 0; i < nRoads; i++) roadsData[key(i, 7919)] = { type: 'road_hex' };
        for (let i = 0; i < nObjs; i++) objectsData[key(i, 6007)] = objId;
        for (let i = 0; i < nExtras; i++) tileExtras[key(i, 4001)] = { underTerrainId: 'Water_1', note: 'x' + (i % 50) };
        const nz = scenario === 'worst' ? 40 : 8;
        for (let i = 0; i < nz; i++) { try { ZonePainter.addZone('Z' + i, '#' + ((i * 99991) & 0xffffff).toString(16).padStart(6, '0')); } catch {} }
        const zoneCount = (ZonePainter.getZones ? ZonePainter.getZones().length : 0) || nz;
        const fill = scenario === 'worst' ? 1 : 0.2;
        for (let i = 0; i < zl.length; i++) if (((i * 2654435761) >>> 0) / 4294967296 < fill) zl[i] = 1 + (i % zoneCount);
        const nSet = scenario === 'worst' ? 200 : 30;
        for (let i = 0; i < nSet; i++) settlements.push({ col: (i * 37) % W, row: (i * 53) % H, type: 'village' });
        for (let i = 0; i < nSet; i++) bridgesData.push({ col: (i * 41) % W, row: (i * 29) % H, axis: i % 3 });
      }
      History.clear();
      await settle();
      const mem = () => (performance as any).memory.usedJSHeapSize as number;
      const before = mem();
      const times: number[] = [];
      for (let i = 0; i < 50; i++) {
        // a real edit between pushes: terrain tile, a road, and an object
        mapData[(i * 7919) % mapData.length] = i % 2 ? 'Water_1' : 'Plain_1';
        roadsData[(300 + i % 50) + ',' + (100 + i)] = { type: 'road_hex' };
        objectsData[(100 + i) + ',' + (350 + i % 40)] = objId;
        const s = performance.now();
        History.push();
        times.push(performance.now() - s);
      }
      await settle();
      const after = mem();
      // Structural estimate of ONE snapshot (JS has no sizeof). Pointer slots counted at 8 B (4 B if pointer
      // compression is on, so this is an upper bound); dictionary entries ~40 B (key ptr, value ptr, details,
      // hash-table slack); shared strings (ids, key strings copied by reference) are NOT counted, but the
      // tileExtras JSON deep copy allocates fresh key/value strings and objects, counted below.
      const ptr = 8, dictEntry = 40;
      const strB = (s: string) => 16 + Math.ceil(s.length / 8) * 8;
      let tx = 0;
      for (const k of Object.keys(tileExtras)) {
        tx += dictEntry + strB(k) + 32;                       // key copy + object header
        for (const [pk, pv] of Object.entries(tileExtras[k])) tx += 16 + (typeof pv === 'string' ? strB(pv as string) : 8);
      }
      const est =
        mapData.length * ptr + (zl ? zl.length : 0) +
        (Object.keys(roadsData).length + Object.keys(objectsData).length) * dictEntry +
        (settlements.length + settlementSlots.length + bridgesData.length) * 80 + tx;
      const sorted = [...times].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      let uam: any = null;
      try { if ((performance as any).measureUserAgentSpecificMemory && (window as any).crossOriginIsolated) uam = 'available'; } catch {}
      return {
        gcAvailable: !!gc, uamAvailable: uam,
        counts: { roads: Object.keys(roadsData).length, objects: Object.keys(objectsData).length, tileExtras: Object.keys(tileExtras).length,
          settlements: settlements.length, bridges: bridgesData.length, zoneTiles: zl ? zl.reduce((a: number, v: number) => a + (v ? 1 : 0), 0) : 0 },
        heapDeltaMB: (after - before) / 1048576,
        perSnapshotMB: (after - before) / 1048576 / 50,
        structuralEstimatePerSnapshotMB: est / 1048576,
        structuralEstimateTotalMB: est * 50 / 1048576,
        pushMs: { p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] },
      };
    }, scenario);
    let all: any = {};
    try { all = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
    all._meta = { thresholds: { totalMB: THRESHOLD_MB, p95PushMs: THRESHOLD_P95_MS }, steps: 50, map: '450x450', recorded: new Date().toISOString().slice(0, 10), chrome: page.context().browser()?.version() };
    all[scenario] = res;
    // verdict rests on the heap delta (forced GC) and the p95 of the worst scenario recorded so far
    const names = ['scene', 'rich', 'worst'].filter(n => all[n]);
    const totalMB = Math.max(...names.map(n => all[n].heapDeltaMB));
    const p95 = Math.max(...names.map(n => all[n].pushMs.p95));
    const justified = totalMB >= THRESHOLD_MB || p95 >= THRESHOLD_P95_MS;
    all.verdict = `T1.7 VERDICT: ${justified ? 'JUSTIFIED' : 'NOT JUSTIFIED'} (total=${totalMB.toFixed(1)} MB, p95=${p95.toFixed(2)} ms)`;
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n');
    console.log(`[${scenario}] ${JSON.stringify(res)}`);
    console.log(all.verdict);
  });
}
