// T6.4: Brush lives in the root script brush.js (classic script, loaded before the inline editor script).
// Characterization tests (PASS-first, they must pass before AND after the extraction), plus the placement checks.
// Manual sanity mutation (done once, recorded in task-T6.4-report.md): changing the pattern parity fold in getAffectedTiles
// ((q % 2) + 2) % 2 -> 0, and the clip `c < MAP_WIDTH` -> `c <= MAP_WIDTH`, each fail the footprint test below.
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { freshEditor } from '../editor-helpers';
import '../editor-globals.d';

test('Brush footprints: size, parity and clipping, checked against pixel geometry', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    const out: any = { counts: {}, geomOk: true, bad: [] as string[] };
    // independent reference: a cell is in the radius-n disc iff its world-space centre is within n * (neighbour spacing)
    // of the centre cell (valid for n <= 5 with 2% slack: ring n+1 is at least (n+1)*0.866 spacings away)
    const d = (() => { const a = Canvas.hexCenterWorld(100, 100), b = Canvas.hexCenterWorld(100, 101); return Math.hypot(a.x - b.x, a.y - b.y); })();
    for (const [c0, r0] of [[100, 100], [100, 101], [201, 300], [202, 301]]) {      // both row parities, both column parities
      for (let n = 0; n <= 5; n++) {
        Brush.setSize(n);
        const got = Brush.getAffectedTiles(c0, r0);
        const ctr = Canvas.hexCenterWorld(c0, r0);
        const want = new Set<string>();
        for (let rr = r0 - n - 2; rr <= r0 + n + 2; rr++) for (let cc = c0 - n - 2; cc <= c0 + n + 2; cc++) {
          const w = Canvas.hexCenterWorld(cc, rr);
          if (Math.hypot(w.x - ctr.x, w.y - ctr.y) <= n * d * 1.02) want.add(cc + ',' + rr);
        }
        const have = new Set(got.map((t: any) => t.col + ',' + t.row));
        if (have.size !== got.length || have.size !== want.size || [...want].some(k => !have.has(k))) out.bad.push(`${c0},${r0} n=${n}`);
        if (c0 === 100 && r0 === 100) out.counts[n] = got.length;
      }
    }
    Brush.setSize(12); out.max = Brush.getAffectedTiles(225, 225).length; Brush.setSize(99); out.clamped = Brush.getSize();
    Brush.setSize(2);
    const corner = Brush.getAffectedTiles(0, 0);
    out.corner = { len: corner.length, inBounds: corner.every((t: any) => t.col >= 0 && t.row >= 0 && t.col < MAP_WIDTH && t.row < MAP_HEIGHT) };
    out.off = [Brush.getAffectedTiles(-1, 5).length, Brush.getAffectedTiles(MAP_WIDTH, 5).length, Brush.getAffectedTiles(5, MAP_HEIGHT).length];
    Brush.setSize(0); out.single = Brush.getAffectedTiles(-5, 700);      // size 0 never clips (callers check bounds)
    return out;
  });
  expect(r.bad).toEqual([]);
  expect(r.counts).toEqual({ 0: 1, 1: 7, 2: 19, 3: 37, 4: 61, 5: 91 });
  expect(r.max).toBe(3 * 12 * 13 + 1);
  expect(r.clamped).toBe(12);
  expect(r.corner.inBounds).toBe(true);
  expect(r.corner.len).toBeGreaterThan(0);
  expect(r.corner.len).toBeLessThan(19);                       // positive control: the corner really is clipped
  expect(r.off).toEqual([0, 0, 0]);
  expect(r.single).toEqual([{ col: -5, row: 700 }]);
});

test('Brush sizing API: grow/shrink, UI sync, pattern cache', async ({ page }) => {
  await freshEditor(page);
  const r = await page.evaluate(() => {
    Brush.setSize(0);
    const b0 = Brush.patternBuilds();
    Brush.getAffectedTiles(50, 50); Brush.getAffectedTiles(50, 50); Brush.getAffectedTiles(60, 60);   // size 0: no pattern
    const zeroBuilds = Brush.patternBuilds() - b0;
    Brush.grow(); Brush.grow();
    const active = Array.from(document.querySelectorAll('.brush-btn.active')).map(b => (b as HTMLElement).dataset.brush);
    const range = (document.getElementById('brush-size-range') as HTMLInputElement).value;
    const label = document.getElementById('brush-size-label')!.textContent;
    Brush.shrink(); const s1 = Brush.getSize(); Brush.shrink(); Brush.shrink(); const s0 = Brush.getSize();
    return { zeroBuilds, size2: [active, range, label], s1, s0, max: Brush.MAX_SIZE };
  });
  expect(r.zeroBuilds).toBe(0);
  expect(r.size2).toEqual([['2'], '2', 'Radius 2 (19 tiles)']);
  expect([r.s1, r.s0, r.max]).toEqual([1, 0, 12]);
});

test('brush.js is a root classic script loaded before every consumer and defines the global Brush', async ({ page }) => {
  const res = await page.request.get('/brush.js?v=1');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('const Brush = (() => {');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'MapEditorPro.html'), 'utf8');
  expect(html).not.toContain('const Brush = (() => {');      // moved, not copied
  const tag = html.indexOf('<script src="brush.js?v=1"></script>');
  expect(tag).toBeGreaterThan(0);
  expect(tag).toBeLessThan(html.indexOf('<script>', tag));    // before the first inline script (Canvas, Tools, UI use it)
  await freshEditor(page);
  // a classic-script `const` is a global lexical binding: visible to inline handlers and other scripts, not a window property
  expect(await page.evaluate(() => [typeof Brush, typeof (window as any).Brush, (0, eval)('typeof Brush')])).toEqual(['object', 'undefined', 'object']);
});
