// Undo-history memory/latency measurement (T1.6 decision gate for T1.7; reused as the T1.7 after-measurement).
// MEASUREMENT ONLY, skipped (no browser launched) unless MEASURE_UNDO=1:
//   MEASURE_UNDO=1 [MEASURE_LABEL=before|after] npx playwright test tests/perf-undo-measure.spec.ts --workers=1
// Writes tests/perf-undo-measure.json under results[MEASURE_LABEL] (default "current"; every run replaces that
// label's section completely, so numbers from different runs are never mixed) and prints `T1.7 VERDICT: ...`.
// Never asserts absolute ms or MB, so a noisy machine cannot turn the suite red; it only asserts that the
// scenario content matches the intended sizes (a mis-built scenario would silently measure the wrong thing).
//
// Method: History.push() runs BEFORE an edit, so snapshot k is the state before edit k. Each repetition runs 50
// steps of (real edit, push) in a freshly opened editor. Retained size = usedJSHeapSize(after forced GC) -
// usedJSHeapSize(before, forced GC) around the 50 pushes; per-snapshot = total / 50. Every scenario is repeated
// REPS times; the verdict uses the MEDIAN. The heap delta is not an exact sizeof, so a structural estimate
// (see estimate in the page code) is recorded as a cross-check.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene } from './perf-scene';

declare const History: any, mapData: string[], tileExtras: any, roadsData: any, objectsData: any, settlements: any[],
  settlementSlots: any[], bridgesData: any[], ZonePainter: any, Generator: any, MAP_WIDTH: number, MAP_HEIGHT: number;

const THRESHOLD_MB = 64;    // keep in sync with task-T1.6-brief.md / T1.7
const THRESHOLD_P95_MS = 8;
const REPS = 3;
const STEPS = 50;
const LABEL = process.env.MEASURE_LABEL || 'current';
const OUT = path.join(__dirname, 'perf-undo-measure.json');
const SCENARIOS = ['scene', 'rich', 'worst'] as const;
type Scenario = typeof SCENARIOS[number];

// Intended content on top of the T1.1 scene (101 roads, 57 objects, 1 settlement, 1 bridge).
const SCENE = { roads: 101, objects: 57, settlements: 1, bridges: 1 };
const PLAN: Record<Scenario, { roads: number; objects: number; extras: number; zones: number; fill: number; settle: number }> = {
  scene: { roads: 0,     objects: 0,     extras: 0,     zones: 0,  fill: 0,   settle: 0 },
  rich:  { roads: 5000,  objects: 1500,  extras: 2000,  zones: 8,  fill: 0.2, settle: 30 },
  worst: { roads: 30000, objects: 15000, extras: 20000, zones: 40, fill: 1,   settle: 200 },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stat = (a: number[]) => ({ median: r2(median(a)), min: r2(Math.min(...a)), max: r2(Math.max(...a)), runs: a.map(r2) });

test.use({ viewport: VIEWPORT, launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } });

test.describe('undo history measurement', () => {
  test.skip(!process.env.MEASURE_UNDO, 'measurement only: run with MEASURE_UNDO=1');
  test.describe.configure({ mode: 'serial' });

  const results: Record<string, any> = {};
  let meta: any = null;

  for (const scenario of SCENARIOS) {
    test(`measure undo history: ${scenario}`, async ({ page }) => {
      test.setTimeout(600_000);
      const plan = PLAN[scenario];
      const runs: any[] = [];
      for (let rep = 0; rep < REPS; rep++) {
        await openEditor(page);
        await setupScene(page);   // T1.1 scene: terrain mix, 101 roads, 57 objects, 1 settlement, 1 bridge
        const run = await page.evaluate(async ({ scenario, plan, STEPS }) => {
          const W = MAP_WIDTH, H = MAP_HEIGHT;
          const gc = (window as any).gc as (() => void) | undefined;
          const settle = async () => { if (gc) { gc(); await new Promise(r => setTimeout(r, 100)); gc(); await new Promise(r => setTimeout(r, 50)); gc(); } };
          const zl = ZonePainter.getZoneLayer();
          const objId = Object.values(objectsData)[0] as string;
          const key = (i: number, mul: number) => { const j = (i * mul) % (W * H); return (j % W) + ',' + (j / W | 0); };   // distinct cells (mul coprime with 450*450)
          let generatorChangedTiles = 0;
          if (scenario === 'worst') {
            const before = mapData.slice();
            History.clear(); Generator.apply();   // default seed 42 (apply() pushes once; cleared below)
            for (let i = 0; i < mapData.length; i++) if (mapData[i] !== before[i]) generatorChangedTiles++;
          }
          for (let i = 0; i < plan.roads; i++) roadsData[key(i, 7919)] = { type: 'road_hex' };
          for (let i = 0; i < plan.objects; i++) objectsData[key(i, 6007)] = objId;
          for (let i = 0; i < plan.extras; i++) tileExtras[key(i, 4001)] = { underTerrainId: 'Water_1', note: 'x' + (i % 50) };
          const zoneIds: number[] = [];
          for (let i = 0; i < plan.zones; i++) zoneIds.push(ZonePainter.addZone('Z' + i, '#' + ((i * 99991) & 0xffffff).toString(16).padStart(6, '0')));   // errors propagate
          if (plan.zones) for (let i = 0; i < zl.length; i++) if (((i * 2654435761) >>> 0) / 4294967296 < plan.fill) zl[i] = zoneIds[i % zoneIds.length];
          for (let i = 0; i < plan.settle; i++) settlements.push({ col: (i * 37) % W, row: (i * 53) % H, type: 'village' });
          for (let i = 0; i < plan.settle; i++) bridgesData.push({ col: (i * 41) % W, row: (i * 29) % H, axis: i % 3 });
          const counts = { roads: Object.keys(roadsData).length, objects: Object.keys(objectsData).length, tileExtras: Object.keys(tileExtras).length,
            settlements: settlements.length, bridges: bridgesData.length, zones: ZonePainter.getZones().length,
            zoneTiles: zl.reduce((a: number, v: number) => a + (v ? 1 : 0), 0), generatorChangedTiles };
          History.clear();
          await settle();
          // Pointer compression: heap cost of one array slot (about 4 B compressed, 8 B uncompressed)
          const probeBefore = (performance as any).memory.usedJSHeapSize;
          const probe = new Array(2_000_000).fill(null);
          const slotBytes = ((performance as any).memory.usedJSHeapSize - probeBefore) / probe.length;
          await settle();
          const mem = () => (performance as any).memory.usedJSHeapSize as number;
          const before = mem();
          const times: number[] = [];
          for (let i = 0; i < STEPS; i++) {
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
          // compression is on, so this is an upper bound); dictionary entries ~40 B; shared strings are not counted,
          // but the tileExtras JSON deep copy allocates fresh key/value strings and objects, counted below.
          const ptr = 8, dictEntry = 40;
          const strB = (s: string) => 16 + Math.ceil(s.length / 8) * 8;
          let tx = 0;
          for (const k of Object.keys(tileExtras)) {
            tx += dictEntry + strB(k) + 32;
            for (const pv of Object.values(tileExtras[k])) tx += 16 + (typeof pv === 'string' ? strB(pv as string) : 8);
          }
          const est = mapData.length * ptr + (zl ? zl.length : 0) +
            (Object.keys(roadsData).length + Object.keys(objectsData).length) * dictEntry +
            (settlements.length + settlementSlots.length + bridgesData.length) * 80 + tx;
          const sorted = [...times].sort((a, b) => a - b);
          const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
          return {
            gcAvailable: !!gc, counts, slotBytes,
            heapDeltaMB: (after - before) / 1048576,
            structuralEstimateTotalMB: est * STEPS / 1048576,
            pushMs: { p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] },
            debugRowCount: typeof History.debugRowCount === 'function' ? History.debugRowCount() : null,
          };
        }, { scenario, plan, STEPS });
        // Content must match the intended sizes BEFORE the numbers mean anything (small slack: scene cells may collide).
        const c = run.counts;
        expect(run.gcAvailable, 'forced GC needed').toBe(true);
        expect(c.roads).toBeGreaterThanOrEqual(plan.roads);               expect(c.roads).toBeLessThanOrEqual(SCENE.roads + plan.roads);
        expect(c.objects).toBeGreaterThanOrEqual(plan.objects);           expect(c.objects).toBeLessThanOrEqual(SCENE.objects + plan.objects);
        expect(c.tileExtras).toBe(plan.extras);
        expect(c.settlements).toBe(SCENE.settlements + plan.settle);
        expect(c.bridges).toBe(SCENE.bridges + plan.settle);
        expect(c.zones).toBeGreaterThanOrEqual(plan.zones);
        if (plan.zones) expect(c.zoneTiles).toBeGreaterThan(plan.fill * 450 * 450 * 0.9);
        else expect(c.zoneTiles).toBe(0);
        if (scenario === 'worst') expect(c.generatorChangedTiles, 'Generator.apply() must have changed terrain').toBeGreaterThan(1000);
        runs.push(run);
      }
      const heap = runs.map(r => r.heapDeltaMB), p95 = runs.map(r => r.pushMs.p95);
      results[scenario] = {
        counts: runs[0].counts,
        heapDeltaMB: stat(heap),
        perSnapshotMB: stat(heap.map(h => h / STEPS)),
        structuralEstimateTotalMB: r2(runs[0].structuralEstimateTotalMB),
        pushP50Ms: stat(runs.map(r => r.pushMs.p50)),
        pushP95Ms: stat(p95),
        pushMaxMs: stat(runs.map(r => r.pushMs.max)),
        debugRowCount: runs[0].debugRowCount,
      };
      meta = { slotBytes: r2(runs[0].slotBytes), pointerCompression: runs[0].slotBytes < 6 };
      console.log(`[${LABEL}/${scenario}] ${JSON.stringify(results[scenario])}`);
    });
  }

  test.afterAll(async ({ browser }) => {
    const names = SCENARIOS.filter(n => results[n]);
    if (!names.length) return;
    // verdict: median heap delta / median p95 of the worst of the scenarios measured IN THIS RUN
    const totalMB = Math.max(...names.map(n => results[n].heapDeltaMB.median));
    const p95 = Math.max(...names.map(n => results[n].pushP95Ms.median));
    const justified = totalMB >= THRESHOLD_MB || p95 >= THRESHOLD_P95_MS;
    const verdict = `T1.7 VERDICT [${LABEL}; scenarios: ${names.join(', ')}; median of ${REPS}]: ${justified ? 'JUSTIFIED' : 'NOT JUSTIFIED'} (total=${totalMB.toFixed(1)} MB, p95=${p95.toFixed(2)} ms)`;
    let all: any = {};
    try { all = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
    if (!all.results) all = {};      // drop the old flat T1.6 layout rather than mixing it with new data
    all._meta = {
      thresholds: { totalMB: THRESHOLD_MB, p95PushMs: THRESHOLD_P95_MS }, steps: STEPS, reps: REPS, map: '450x450',
      recorded: new Date().toISOString().slice(0, 10), chrome: browser.version(),
      os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: `${os.cpus()[0]?.model} x${os.cpus().length}`,
      node: process.version, ...meta,
    };
    all.results = all.results || {};
    all.results[LABEL] = { verdict, scenarios: results };
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n');
    console.log(verdict);
  });
});
