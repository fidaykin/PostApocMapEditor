import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, medianMs, expectFasterThan } from './perf-scene';

declare const Canvas: any, Terrain: any, HexDB: any, mapData: string[], MAP_WIDTH: number, MAP_HEIGHT: number;
test.use({ viewport: VIEWPORT });
test.setTimeout(900000);   // full-scan reference renders are slow (several minutes on a loaded machine)

// Reference implementation: Canvas._test.setFullScan(true) makes render() visit every tile exactly like the
// pre-T1.3 loop; the exact per-tile cull test is shared, so any difference is a range bug.
const HELPERS = `
  window.__hash = () => {
    const cv = document.getElementById('map-canvas');
    const u = new Uint32Array(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.buffer);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h;
  };
  window.__both = (x, y) => {
    Canvas._test.setCamera(x, y);
    const once = () => {
      Canvas._test.setFullScan(false); Canvas.render();
      const stats = Canvas.getStats(), a = window.__hash();
      Canvas._test.setFullScan(true); Canvas.render();
      const full = Canvas.getStats(), b = window.__hash();
      Canvas._test.setFullScan(false);
      return { same: a === b, a, b, drawn: stats.tilesDrawn, fullDrawn: full.tilesDrawn, visited: stats.tilesVisited };
    };
    // The first render after a camera jump can differ from later ones (lazy sprite decode) regardless of culling,
    // so render once to settle. A genuine range bug is deterministic and still fails the second comparison.
    Canvas.render();
    let r = once();
    if (!r.same) r = once();
    return r;
  };
`;

test('only on-screen tiles are visited', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  for (const [z, maxVisited] of [[100, 2500], [25, 12000]] as const) {
    await frame(page, z);
    const s = await page.evaluate(() => Canvas.getStats());
    expect(s.tilesVisited, `zoom ${z}`).toBeLessThan(maxVisited);
    expect(s.tilesDrawn).toBeGreaterThan(100);
    expect(s.tilesDrawn).toBeLessThanOrEqual(s.tilesVisited);
  }
});

test('ranged render equals full scan for random cameras, edges and corners', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(HELPERS);
  const bad = await page.evaluate(() => {
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const fails: any[] = [];
    let drawnTotal = 0, cases = 0;
    const zooms = [25, 30, 60, 100, 137, 200];
    for (const z of zooms) {
      Canvas.setZoom(z);
      const sc = z / 100;
      const mapW = ((MAP_HEIGHT - 1) * 1.5 + 2) * 30 * sc;   // generous (HEX_SIZE-independent upper bound used only for ranges)
      const cams: number[][] = [];
      // map corners/edges incl. beyond-clamp (partly/fully off-map) cameras
      const xs = [-3000, -50, 0, 1e9, -1e9], ys = [-3000, -50, 0, 1e9, -1e9];
      for (const x of xs) for (const y of ys) cams.push([x, y]);
      for (let i = 0; i < 8; i++) cams.push([(rnd() * 1.1 - 0.05) * mapW, (rnd() * 1.1 - 0.05) * mapW]);
      for (const [x, y] of cams) {
        Canvas._test.setCamera(x, y);
        // clamp to real map extents so "corner" cameras are the true corners
        Canvas.clampCamera();
        const c = Canvas.getCamera();
        for (const [cx, cy] of [[x, y], [c.x, c.y], [c.x + rnd() * 400 - 200, c.y + rnd() * 400 - 200]]) {
          const r = (window as any).__both(cx, cy);
          cases++; drawnTotal += r.drawn;
          if (!r.same || r.drawn !== r.fullDrawn) fails.push({ z, cx, cy, ...r });
        }
      }
    }
    return { fails: fails.slice(0, 5), nFails: fails.length, drawnTotal, cases };
  });
  expect(bad.nFails, JSON.stringify(bad.fails)).toBe(0);
  expect(bad.cases).toBeGreaterThan(300);
  expect(bad.drawnTotal).toBeGreaterThan(0);
});

test('multi-tile anchors/satellites at the viewport edge match the full scan', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await page.evaluate(HELPERS);
  const res = await page.evaluate(() => {
    // Guarantee a multi-tile entry exists (use a real one if the DB has one) and place anchors on the map.
    const real = HexDB.getAll().find((h: any) => h.id && Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0 && Terrain.getSprite(h.id));
    const entry = real || Terrain.byHexId('Hills_1');
    const saved = entry.occupiedOffsets;
    if (!real) entry.occupiedOffsets = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
    const cc = Math.floor(MAP_WIDTH / 2), cr = Math.floor(MAP_HEIGHT / 2);
    const anchors = [[cc, cr], [3, 3], [MAP_WIDTH - 4, MAP_HEIGHT - 4], [3, MAP_HEIGHT - 4], [MAP_WIDTH - 4, 3]];
    for (const [c, r] of anchors) mapData[r * MAP_WIDTH + c] = entry.id;
    const fails: any[] = [];
    let anchorFrames = 0, frames = 0;
    for (const z of [25, 100, 200]) {
      Canvas.setZoom(z);
      const radius = 30 * z / 100;   // only used as a sweep step; correctness is judged against the full scan
      for (const [c, r] of anchors) {
        const w = Canvas.hexCenterWorld(c, r), sc = z / 100;
        const ax = w.x * sc, ay = w.y * sc;
        // slide the anchor centre across each viewport edge, from well outside to well inside, in sub-cell steps
        for (let d = -6 * radius; d <= 6 * radius; d += radius / 3) {
          const cams = [
            [ax - d, ay - 450],                    // left edge
            [ax - 1400 + d, ay - 450],             // right edge
            [ax - 700, ay - d],                    // top edge
            [ax - 700, ay - 900 + d],              // bottom edge
          ];
          for (const [x, y] of cams) {
            const r2 = (window as any).__both(x, y);
            frames++;
            if (r2.drawn > 0) anchorFrames++;
            if (!r2.same || r2.drawn !== r2.fullDrawn) fails.push({ z, c, r, x, y, d });
          }
        }
      }
    }
    entry.occupiedOffsets = saved;
    if (saved === undefined) delete entry.occupiedOffsets;
    return { fails: fails.slice(0, 5), nFails: fails.length, frames, anchorFrames, usedReal: !!real };
  });
  expect(res.nFails, JSON.stringify(res.fails)).toBe(0);
  expect(res.frames).toBeGreaterThan(500);
  expect(res.anchorFrames).toBeGreaterThan(100);
});

test('render time at 25% drops vs baseline', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 25);
  expectFasterThan('t_render_25', await medianMs(page, 'render'), 0.7);
});
