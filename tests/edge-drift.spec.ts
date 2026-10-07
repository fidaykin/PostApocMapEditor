import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

declare const HexDB: any, EdgeTiling: any, MapJobs: any, Generator: any;

// Keep in sync: EdgeTiling.resolveEdgeTile (page, used by painting) and MapJobs._resolveEdgeTile (map-jobs.js port,
// used by the Generator worker/fallback) must resolve every neighbourhood identically, including rng consumption.
test('EdgeTiling.resolveEdgeTile and the map-jobs.js port agree on randomized grids', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const lcg = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const all: any[] = HexDB.getAll();
    const byType = (t: string) => all.filter(h => h.type === t).map(h => h.id);
    const water = byType('Water'), rivers = byType('Rivers');
    const land = all.filter(h => h.type !== 'Water' && h.type !== 'Rivers').map(h => h.id);
    // The context the page hands the generator job (same tables, same direction data).
    const edge = (Generator as any)._buildJob({}).edge;
    const fam = ['Water', 'Rivers'];
    const fallback = water.slice(0, 3);
    const sizes: [number, number][] = [[1, 1], [2, 3], [5, 4], [7, 7], [8, 5], [9, 12], [16, 11], [13, 6]];
    const bias = [0, 0.15, 0.5, 0.85, 1];                  // land-only .. water-only .. mixed
    const pick = (a: any[], rnd: () => number) => a[Math.floor(rnd() * a.length)];
    let compared = 0, edgeCells = 0;
    const mismatches: any[] = [];
    const resolved = new Set<string>();
    for (const [W, H] of sizes) for (const b of bias) for (let rep = 0; rep < 3; rep++) {
      const g = lcg(W * 1000 + H * 31 + Math.floor(b * 100) + rep * 7919);
      const grid: any[] = [];
      for (let i = 0; i < W * H; i++) {
        const u = g();
        if (u < 0.03) grid.push(i % 2 ? '' : undefined);                 // empty/unset cells
        else if (u < 0.05) grid.push('NoSuchTile_9');                    // id unknown to HexDB
        else if (g() < b) grid.push(pick(g() < 0.7 ? water : rivers, g));
        else grid.push(pick(land, g));
        if (g() < 0.05 && typeof grid[i] === 'string' && grid[i]) grid[i] = grid[i].toUpperCase();   // case variants
      }
      const seed = W * 97 + H * 13 + rep;
      for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
        let n1 = 0, n2 = 0;
        const r1 = lcg(seed + row * W + col), r2 = lcg(seed + row * W + col);
        const a = EdgeTiling.resolveEdgeTile(col, row, W, H, grid, fam, () => { n1++; return r1(); }, fallback);
        const c = MapJobs._resolveEdgeTile(col, row, W, H, grid, edge, () => { n2++; return r2(); }, fallback);
        compared++;
        if (col === 0 || row === 0 || col === W - 1 || row === H - 1) edgeCells++;
        resolved.add(String(a));
        if (a !== c || n1 !== n2) mismatches.push({ W, H, col, row, a, c, n1, n2 });
      }
    }
    return { compared, edgeCells, mismatches: mismatches.slice(0, 5), nMismatch: mismatches.length, distinct: resolved.size,
      counts: { water: water.length, rivers: rivers.length, land: land.length } };
  });
  expect(r.counts.water).toBeGreaterThan(0);
  expect(r.counts.rivers).toBeGreaterThan(0);
  expect(r.compared).toBeGreaterThan(2000);
  expect(r.distinct).toBeGreaterThan(5);   // many different masks hit, not just the fallback
  expect(r.edgeCells).toBeGreaterThan(300);
  expect(r.mismatches).toEqual([]);
  expect(r.nMismatch).toBe(0);
});
