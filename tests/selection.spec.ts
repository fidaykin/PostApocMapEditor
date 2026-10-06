import { test, expect, Page } from '@playwright/test';
import { freshEditor, clickCell, dragCells, cellPoint } from './editor-helpers';

const sel = (page: Page) => page.evaluate(() => Selection.size());
const toastsOn = (page: Page) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });

/** Replaces the map with a fresh blank W x H one (new array: a real map replacement, as New/Load do). */
const replaceMap = (page: Page, W: number, H: number) => page.evaluate(([W, H]) => {
  MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
  mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
  Canvas.render();
}, [W, H]);

test.describe('region selection (T2.8)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('M + drag selects the rectangle, Shift adds, Alt subtracts, Esc clears', async ({ page }) => {
    await page.keyboard.press('m');
    expect(await page.evaluate(() => Tools.getActive())).toBe('marquee');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    expect(await sel(page)).toBe(25);
    await dragCells(page, { col: 228, row: 220 }, { col: 228, row: 222 }, { shift: true });
    expect(await sel(page)).toBe(28);
    await dragCells(page, { col: 222, row: 220 }, { col: 222, row: 221 }, { alt: true });
    expect(await sel(page)).toBe(26);
    expect(await page.evaluate(() => [Selection.has(222, 220), Selection.has(222, 222), Selection.has(228, 221), Selection.has(229, 221)])).toEqual([false, true, true, false]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Selection.isEmpty())).toBe(true);
  });

  test('a plain drag REPLACES the selection; selection steps are not History steps; the map is never written', async ({ page }) => {
    await page.keyboard.press('m');
    const before = await page.evaluate(() => [History.undoSize(), mapData.join('|').length, mapData.filter((x: string) => x !== 'Plain_1').length]);
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    await dragCells(page, { col: 230, row: 230 }, { col: 231, row: 231 });
    expect(await sel(page)).toBe(4);
    expect(await page.evaluate(() => Selection.has(222, 220))).toBe(false);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Escape');
    expect(await page.evaluate(() => [History.undoSize(), mapData.join('|').length, mapData.filter((x: string) => x !== 'Plain_1').length])).toEqual(before);
  });

  // ---------- geometry -------------------------------------------------------------------------
  // Independent pixel reference for a grid-cell rectangle, derived only from Canvas.hexCenterWorld: every cell of a
  // row shares one centre x, and the y centres of a column fill a band (both stagger parities) that does not overlap
  // the next column's band, so the rectangle is the box [x of its rows] x [y bands of its columns].
  for (const [W, H] of [[450, 450], [451, 451], [450, 451], [451, 450], [21, 20], [20, 21]]) {
    test(`rectangle membership equals the pixel-geometry reference on ${W}x${H}`, async ({ page }) => {
      const r = await page.evaluate(([W, H]) => {
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
        const eps = 1e-6;
        const band = (c: number) => { const a = Canvas.hexCenterWorld(c, 0).y, b = Canvas.hexCenterWorld(c, 1).y; return [Math.min(a, b), Math.max(a, b)]; };
        const bad: string[] = [];
        const rects = [[3, 4, 9, 7], [9, 7, 3, 4], [0, 0, 0, 0], [5, 0, 5, 14], [0, 3, 14, 3], [MAP_WIDTH - 6, MAP_HEIGHT - 5, MAP_WIDTH - 1, MAP_HEIGHT - 1], [-5, -5, 2, 2], [MAP_WIDTH - 2, MAP_HEIGHT - 2, MAP_WIDTH + 9, MAP_HEIGHT + 9]];
        for (const [c1, r1, c2, r2] of rects) {
          Selection.clear();
          Selection.setCells(Tools._rectCells(c1, r1, c2, r2));
          // corner pixels come from the (clipped) corner cells
          const cLo = Math.max(0, Math.min(c1, c2)), cHi = Math.min(MAP_WIDTH - 1, Math.max(c1, c2));
          const rLo = Math.max(0, Math.min(r1, r2)), rHi = Math.min(MAP_HEIGHT - 1, Math.max(r1, r2));
          const xA = Canvas.hexCenterWorld(0, rHi).x, xB = Canvas.hexCenterWorld(0, rLo).x;
          const yTop = band(cHi)[0], yBot = band(cLo)[1];
          let n = 0, got = 0;
          for (let c = 0; c < MAP_WIDTH; c++) for (let r = 0; r < MAP_HEIGHT; r++) {
            const p = Canvas.hexCenterWorld(c, r);
            const inside = p.x >= xA - eps && p.x <= xB + eps && p.y >= yTop - eps && p.y <= yBot + eps;
            if (inside) n++;
            if (Selection.has(c, r)) got++;
            if (inside !== Selection.has(c, r)) { bad.push(`${c1},${r1},${c2},${r2}@${c},${r}`); if (bad.length > 8) return { bad }; }
          }
          if (n !== got || got !== Selection.size() || got !== (cHi - cLo + 1) * (rHi - rLo + 1)) bad.push('count ' + [c1, r1, c2, r2].join(',') + ' ' + n + '/' + got + '/' + Selection.size());
        }
        return { bad };
      }, [W, H]);
      expect(r.bad).toEqual([]);
    });
  }

  test('a real drag between two pixel positions selects the cells under those pixels (screenToHex corners)', async ({ page }) => {
    await page.keyboard.press('m');
    const a = await cellPoint(page, 220, 218), b = await cellPoint(page, 229, 227);
    await page.mouse.move(a.x + 3, a.y - 2); await page.mouse.down(); await page.mouse.move(b.x - 2, b.y + 3, { steps: 5 }); await page.mouse.up();
    expect(await sel(page)).toBe(10 * 10);
    expect(await page.evaluate(() => [Selection.has(220, 218), Selection.has(229, 227), Selection.has(219, 218), Selection.has(230, 227), Selection.has(229, 228)])).toEqual([true, true, false, false, false]);
    expect(await page.evaluate(() => Selection.getBounds())).toEqual({ minCol: 220, maxCol: 229, minRow: 218, maxRow: 227, width: 10, height: 10 });
  });

  // ---------- API ------------------------------------------------------------------------------
  test('setCells replace/add/subtract, has, size, bounds, getCells order, bounds clipping, invert, selectAll', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out: any = {};
      const sq = (c1: number, r1: number, c2: number, r2: number) => Tools._rectCells(c1, r1, c2, r2);
      out.empty = [Selection.isEmpty(), Selection.size(), Selection.getBounds(), Selection.getCells().length, Selection.getMask(), Selection.has(0, 0)];
      Selection.setCells(sq(10, 10, 12, 11));
      out.a = [Selection.size(), Selection.getBounds(), Selection.getCells().map((c: any) => c.col + ',' + c.row).join(' ')];
      Selection.setCells(sq(12, 11, 14, 11), 'add');
      out.add = [Selection.size(), Selection.getBounds()];
      Selection.setCells(sq(10, 10, 10, 11), 'subtract');
      out.sub = [Selection.size(), Selection.getBounds(), Selection.has(10, 10), Selection.has(11, 10)];
      Selection.setCells([{ col: -1, row: 0 }, { col: MAP_WIDTH, row: 0 }, { col: 0, row: MAP_HEIGHT }, { col: 1.5, row: 2 }, { col: 3, row: 3 }, { col: 3, row: 3 }], 'replace');
      out.clip = [Selection.size(), Selection.getCells()];
      Selection.setCells(sq(0, 0, 1, 1)); const maskBefore = Selection.getMask();
      Selection.setCells(sq(5, 5, 5, 5), 'add');
      out.snapshotImmutable = [maskBefore.reduce((a: number, b: number) => a + b, 0), Selection.getMask().reduce((a: number, b: number) => a + b, 0)];
      Selection.setCells(sq(0, 0, 3, 3)); Selection.invert();
      out.inv = [Selection.size(), Selection.has(0, 0), Selection.has(4, 4), MAP_WIDTH * MAP_HEIGHT - 16];
      Selection.invert();
      out.inv2 = [Selection.size(), Selection.has(0, 0), Selection.has(4, 4)];
      Selection.selectAll(); out.all = [Selection.size(), Selection.getBounds()]; Selection.invert(); out.invAll = Selection.isEmpty();
      Selection.setCells(sq(1, 1, 2, 2)); Selection.setCells([], 'subtract'); out.noopSub = Selection.size();
      Selection.setCells(sq(1, 1, 2, 2)); Selection.setCells(sq(1, 1, 2, 2), 'subtract'); out.allGone = [Selection.isEmpty(), Selection.getBounds()];
      let seen = 0; Selection.setCells(sq(7, 7, 9, 8)); Selection.forEach((c: number, rw: number) => { if (Selection.has(c, rw)) seen++; }); out.forEach = seen;
      Selection.clear(); out.cleared = [Selection.isEmpty(), Selection.size(), Selection.getBounds()];
      return out;
    });
    expect(r.empty).toEqual([true, 0, null, 0, null, false]);
    expect(r.a).toEqual([6, { minCol: 10, maxCol: 12, minRow: 10, maxRow: 11, width: 3, height: 2 }, '10,10 11,10 12,10 10,11 11,11 12,11']);
    expect(r.add).toEqual([8, { minCol: 10, maxCol: 14, minRow: 10, maxRow: 11, width: 5, height: 2 }]);
    expect(r.sub).toEqual([6, { minCol: 11, maxCol: 14, minRow: 10, maxRow: 11, width: 4, height: 2 }, false, true]);
    expect(r.clip).toEqual([1, [{ col: 3, row: 3 }]]);
    expect(r.snapshotImmutable).toEqual([4, 5]);
    expect(r.inv).toEqual([r.inv[3], false, true, r.inv[3]]);
    expect(r.inv2).toEqual([16, true, false]);
    expect(r.all).toEqual([450 * 450, { minCol: 0, maxCol: 449, minRow: 0, maxRow: 449, width: 450, height: 450 }]);
    expect(r.invAll).toBe(true);
    expect(r.noopSub).toBe(4);
    expect(r.allGone).toEqual([true, null]);
    expect(r.forEach).toBe(6);
    expect(r.cleared).toEqual([true, 0, null]);
  });

  // ---------- outline --------------------------------------------------------------------------
  for (const [W, H] of [[450, 450], [451, 451], [24, 25], [25, 24]]) {
    test(`outline equals the boundary edges of the cell set (independent pixel reference) on ${W}x${H}`, async ({ page }) => {
      const r = await page.evaluate(([W, H]) => {
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
        const S = HEX_SIZE;
        const k = (x: number, y: number) => Math.round(x * 10) + ',' + Math.round(y * 10);
        const centres = new Map<string, number[]>();
        const reference = () => {
          const have = new Set<string>(), edges = new Set<string>();
          Selection.forEach((c: number, rw: number) => { const p = Canvas.hexCenterWorld(c, rw); have.add(k(p.x, p.y)); });
          Selection.forEach((c: number, rw: number) => {
            const p = Canvas.hexCenterWorld(c, rw);
            for (let j = 0; j < 6; j++) {
              const a = Math.PI / 3 * j + Math.PI / 6;
              if (have.has(k(p.x + ROW_PITCH * Math.cos(a), p.y + ROW_PITCH * Math.sin(a)))) continue;
              const A = [p.x + S * Math.cos(Math.PI / 3 * j), p.y + S * Math.sin(Math.PI / 3 * j)], B = [p.x + S * Math.cos(Math.PI / 3 * (j + 1)), p.y + S * Math.sin(Math.PI / 3 * (j + 1))];
              edges.add([k(A[0], A[1]), k(B[0], B[1])].sort().join('|'));
            }
          });
          return edges;
        };
        const actual = () => {
          const o = Selection.getOutline(), out = new Set<string>();
          for (let i = 0; i < o.length; i += 4) out.add([k(o[i], o[i + 1]), k(o[i + 2], o[i + 3])].sort().join('|'));
          return { set: out, n: o.length / 4 };
        };
        const cases: [string, () => void][] = [
          ['single', () => Selection.setCells([{ col: 5, row: 5 }])],
          ['rect', () => Selection.setCells(Tools._rectCells(3, 3, 9, 8))],
          ['corner', () => Selection.setCells(Tools._rectCells(0, 0, 3, 3))],
          ['far-corner', () => Selection.setCells(Tools._rectCells(MAP_WIDTH - 4, MAP_HEIGHT - 4, MAP_WIDTH - 1, MAP_HEIGHT - 1))],
          ['hole', () => { Selection.setCells(Tools._rectCells(2, 2, 12, 12)); Selection.setCells(Tools._rectCells(6, 6, 7, 7), 'subtract'); }],
          ['two blobs', () => { Selection.setCells(Tools._rectCells(2, 2, 4, 4)); Selection.setCells(Tools._rectCells(10, 10, 11, 12), 'add'); }],
          ['checker', () => { const cs: any[] = []; for (let c = 3; c < 12; c++) for (let rw = 3; rw < 12; rw++) if ((c + rw) % 2 === 0) cs.push({ col: c, row: rw }); Selection.setCells(cs); }],
          ['all', () => Selection.selectAll()],
        ];
        const out: any[] = [];
        for (const [name, fn] of cases) {
          fn();
          const want = reference(), got = actual();
          let missing = 0, extra = 0;
          want.forEach(e => { if (!got.set.has(e)) missing++; });
          got.set.forEach(e => { if (!want.has(e)) extra++; });
          out.push({ name, missing, extra, dup: got.n - got.set.size, n: got.n, want: want.size });
        }
        return out;
      }, [W, H]);
      for (const x of r) { expect(x, JSON.stringify(x)).toMatchObject({ missing: 0, extra: 0, dup: 0 }); expect(x.n).toBe(x.want); }
      // sanity: the single cell has 6 edges, a full map has fewer boundary edges than cells
      expect(r[0].n).toBe(6);
      expect(r[r.length - 1].n).toBeLessThan(W * H);
    });
  }

  // ---------- drawing --------------------------------------------------------------------------
  test('few visible cells: ONE fill + ONE stroke at LOD 0; LOD 1/2 and many visible cells: one stroke + one bitmap blit and no fill', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ctx = Canvas.getCtx(); const out: any = {};
      const os = ctx.stroke.bind(ctx), of = ctx.fill.bind(ctx), od = ctx.drawImage.bind(ctx);
      const count = () => {
        let strokes = 0, fills = 0, blits = 0;
        ctx.stroke = () => { strokes++; os(); }; ctx.fill = () => { fills++; of(); }; ctx.drawImage = (...a: any[]) => { blits++; (od as any)(...a); };
        Canvas.render();
        ctx.stroke = os; ctx.fill = of; ctx.drawImage = od;
        return { strokes, fills, blits, mode: Canvas.getStats().selMode };
      };
      for (const [name, build] of [['small', () => Selection.setCells(Tools._rectCells(220, 218, 229, 227))], ['all', () => Selection.selectAll()]] as [string, () => void][]) {
        for (const lod of [0, 1, 2]) {
          Canvas._test.setLod(lod);
          Canvas.setZoom(lod === 2 ? 5 : lod === 1 ? 15 : 100);
          Selection.clear(); Canvas.render();
          const base = count();
          build();
          const withSel = count();
          out[name + lod] = { dStrokes: withSel.strokes - base.strokes, dFills: withSel.fills - base.fills, dBlits: withSel.blits - base.blits, mode: withSel.mode };
          Selection.clear();
        }
      }
      Canvas._test.setLod(null);
      return out;
    });
    for (const n of ['small', 'all']) {
      expect(r[n + '0']).toEqual({ dStrokes: 1, dFills: 1, dBlits: 0, mode: 'hex' });      // < 1,500 visible cells at 100%
      expect(r[n + '1']).toEqual({ dStrokes: 1, dFills: 0, dBlits: 1, mode: 'bitmap' });
      expect(r[n + '2']).toEqual({ dStrokes: 1, dFills: 0, dBlits: 1, mode: 'bitmap' });
    }
  });

  // Work-count (no wall clock): path operations per frame are bounded by the OUTLINE, not by the selected cells.
  for (const zoom of [15, 25]) {
    test(`select-all at ${zoom}% zoom: per-frame path ops are bounded by the outline segments, not by the cells`, async ({ page }) => {
      const r = await page.evaluate((zoom) => {
        Canvas.setZoom(zoom); Canvas.centerOnCity();
        const ctx = Canvas.getCtx();
        const ops = () => {
          let n = 0; const names = ['moveTo', 'lineTo', 'rect', 'arc', 'closePath']; const orig: any = {};
          for (const k of names) { orig[k] = (ctx as any)[k].bind(ctx); (ctx as any)[k] = (...a: any[]) => { n++; return orig[k](...a); }; }
          Canvas.render();
          for (const k of names) (ctx as any)[k] = orig[k];
          return n;
        };
        Selection.clear(); Canvas.render(); Canvas.render(); const base = ops();
        const out: any = {};
        for (const [name, build] of [['all', () => Selection.selectAll()], ['block', () => Selection.setCells(Tools._rectCells(205, 175, 240, 275))]] as [string, () => void][]) {
          build();
          const withSel = ops(), st = Canvas.getStats();
          out[name] = { delta: withSel - base, segs: Selection.getOutline().length / 4, mode: st.selMode };
        }
        return out;
      }, zoom);
      expect(r.all.mode).toBe('bitmap'); expect(r.block.mode).toBe('bitmap');
      expect(r.all.segs).toBeGreaterThan(1000);
      for (const k of ['all', 'block']) expect(r[k].delta, k).toBeLessThanOrEqual(2 * r[k].segs + 64);   // one moveTo+lineTo per boundary segment at most
      expect(r.block.delta).toBeGreaterThan(0);                 // the visible boundary of the block is drawn (select-all's border is off screen)
    });
  }

  test('the scaled bitmap lands on the same cells as the exact hex path (zoom 25, odd and even columns and rows, both sides of the border)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      Canvas.setZoom(25); Canvas.centerOnCity();
      const sample: [number, number, number][] = [];      // [col, row, dy px]: cell centres, plus probes 6 px from the centre TOWARDS the border (cell apothem is 8.7 px)
      for (let c = 208; c <= 222; c++) for (let rw = 200; rw <= 233; rw++) sample.push([c, rw, 0]);
      for (let rw = 200; rw <= 233; rw++) { sample.push([214, rw, -6]); sample.push([215, rw, 6]); }   // col grows UP the screen: 215 lies above 214
      const read = () => sample.map(([c, rw, dy]) => { const p = Canvas.hexScreenPos(c, rw), d = Canvas.getCtx().getImageData(Math.round(p.x), Math.round(p.y + dy), 1, 1).data; return [d[0], d[1], d[2]]; });
      // sprites load asynchronously and some pixels sit on an animated stroke, so the reference is the NEXT frame with
      // only the bitmap blit suppressed (same state, same instant), not an earlier frame
      Selection.clear(); let prev = JSON.stringify(read()), same = 0;
      for (let i = 0; i < 150 && same < 4; i++) { await new Promise(r => setTimeout(r, 100)); Canvas.render(); const cur = JSON.stringify(read()); same = cur === prev ? same + 1 : 0; prev = cur; }
      Selection.setCells(Tools._rectCells(215, 100, 299, 349));      // 85 x 250 cells: thousands visible -> bitmap mode
      const st = Canvas.getStats(); const got = read();
      const ctx = Canvas.getCtx(), od = ctx.drawImage.bind(ctx), bm = Canvas._test.selBitmap();
      ctx.drawImage = (...a: any[]) => { if (a[0] === bm) return; (od as any)(...a); };
      Canvas.render(); const base = read(); ctx.drawImage = od;
      // cells whose centre pixel lies on an overlay line (rings) are not flat terrain: keep only cells close to the modal terrain colour
      const freq = new Map<string, number>(); base.forEach((b: number[]) => freq.set(b.join(','), (freq.get(b.join(',')) || 0) + 1));
      const modal = [...freq.entries()].sort((p, q) => q[1] - p[1])[0][0].split(',').map(Number);
      const stable = base.map((b: number[], i: number) => sample[i][2] !== 0 || Math.max(...b.map((v, k) => Math.abs(v - modal[k]))) <= 4);   // probes sit on textured sprite pixels: judged by the frame difference only
      return { mode: st.selMode, sample, base, got, stable };
    });
    expect(r.mode).toBe('bitmap');
    let tinted = 0, plain = 0; const bad: string[] = [];
    r.sample.forEach(([c, rw]: number[], i: number) => {
      if (!r.stable[i]) return;
      const dist = Math.max(...r.got[i].map((v: number, k: number) => Math.abs(v - r.base[i][k])));
      const selected = c >= 215 && rw >= 100 && rw <= 349;
      if (selected) { tinted++; if (!(dist > 8 && r.got[i][0] > r.base[i][0] && r.got[i][1] > r.base[i][1])) bad.push(`in ${c},${rw}`); }
      else { plain++; if (dist > 2) bad.push(`out ${c},${rw} ${JSON.stringify(r.base[i])}->${JSON.stringify(r.got[i])}`); }
    });
    expect(bad).toEqual([]);
    expect(tinted).toBeGreaterThan(100); expect(plain).toBeGreaterThan(100);
    expect(r.stable.filter(Boolean).length).toBeGreaterThan(r.sample.length * 0.9);
    const probes = r.sample.map((s: number[], i: number) => s[2] !== 0 && r.stable[i]).filter(Boolean).length;
    expect(probes).toBeGreaterThan(30);                        // the border probes (cells 214 / 215, 6 px towards the border) really ran
    expect(new Set(r.sample.filter(([c]: number[]) => c >= 215).map(([c]: number[]) => c % 2)).size).toBe(2);
  });

  test('a 202,500-cell selection is culled to the viewport and a frame allocates no typed arrays', async ({ page }) => {
    const r = await page.evaluate(() => {
      Canvas.setZoom(100); Canvas.centerOnCity(); Canvas._test.setLod(0);
      const ctx = Canvas.getCtx(), cv = document.getElementById('map-canvas') as HTMLCanvasElement;
      const lines = () => { let n = 0; const ol = ctx.lineTo.bind(ctx), om = ctx.moveTo.bind(ctx); ctx.lineTo = (x: number, y: number) => { n++; ol(x, y); }; ctx.moveTo = (x: number, y: number) => { n++; om(x, y); }; Canvas.render(); ctx.lineTo = ol; ctx.moveTo = om; return n; };
      Selection.clear(); Canvas.render(); const base = lines();
      Selection.selectAll();
      // allocation spy
      const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Int32Array', 'Uint32Array', 'Array'];
      const counts: Record<string, number> = {}; const orig: Record<string, any> = {};
      for (const n of names) { orig[n] = (window as any)[n]; counts[n] = 0; (window as any)[n] = new Proxy(orig[n], { construct(t, a, nt) { counts[n]++; return Reflect.construct(t, a, nt); } }); }
      let withAll = 0;
      try { withAll = lines(); } finally { for (const n of names) (window as any)[n] = orig[n]; }
      // cells whose centre lies in the canvas widened by one hex (independent count)
      const s = Canvas.getZoom() / 100, cam = Canvas.getCamera(), pad = HEX_SIZE * s * 2;
      let visible = 0;
      for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) {
        const p = Canvas.hexCenterWorld(c, rw), x = p.x * s - cam.x, y = p.y * s - cam.y;
        if (x >= -pad && x <= cv.width + pad && y >= -pad && y <= cv.height + pad) visible++;
      }
      Canvas._test.setLod(null);
      const stats = Canvas.getStats();
      const rowsSeen = new Set<number>(), colsSeen = new Set<number>();
      for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) {
        const p = Canvas.hexCenterWorld(c, rw), x = p.x * s - cam.x, y = p.y * s - cam.y;
        if (x >= -pad && x <= cv.width + pad && y >= -pad && y <= cv.height + pad) { rowsSeen.add(rw); colsSeen.add(c); }
      }
      return { delta: withAll - base, visible, counts, tested: stats.selCellsTested, drawn: stats.selCellsDrawn, rows: rowsSeen.size, cols: colsSeen.size };
    });
    expect(r.visible).toBeGreaterThan(200);
    expect(r.visible).toBeLessThan(202500 / 4);
    expect(r.delta).toBeGreaterThanOrEqual(6 * (r.visible * 0.5));            // the visible cells really are drawn
    expect(r.delta).toBeLessThanOrEqual(6 * (r.visible + 400));               // ... and only those (+ one widened ring)
    expect(r.tested).toBeGreaterThan(0);
    expect(r.tested).toBeLessThanOrEqual((r.rows + 2) * (r.cols + 2));       // the fill pass only tests the visible row/col range
    expect(r.drawn).toBeGreaterThan(0);
    expect(r.drawn).toBeLessThanOrEqual(r.visible);
    expect(r.counts).toEqual({ Float64Array: 0, Float32Array: 0, Uint8Array: 0, Int32Array: 0, Uint32Array: 0, Array: 0 });
  });

  test('the fill covers exactly the visible selected cells (pixel check of a hex centre in / out of the selection)', async ({ page }) => {
    const px = async (c: number, rw: number) => page.evaluate(([c, rw]) => {
      const p = Canvas.hexScreenPos(c, rw), d = Canvas.getCtx().getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data; return [d[0], d[1], d[2]];
    }, [c, rw]);
    await page.evaluate(() => { Canvas.setZoom(100); Canvas.centerOnCity(); Selection.clear(); });
    const baseIn = await px(224, 222), baseOut = await px(224, 230);
    await page.evaluate(() => Selection.setCells(Tools._rectCells(222, 220, 226, 224)));
    const inside = await px(224, 222), outside = await px(224, 230);
    const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    expect(dist(outside, baseOut)).toBeLessThanOrEqual(2);     // unselected cells are untouched (sprite filtering may differ by 1)
    expect(dist(inside, baseIn)).toBeGreaterThan(8);           // the yellow tint is clearly visible
    expect(inside[0]).toBeGreaterThan(baseIn[0]);              // and raises red and green
    expect(inside[1]).toBeGreaterThan(baseIn[1]);
  });

  test('the selection is cell-based: zoom and pan change nothing about it', async ({ page }) => {
    await page.keyboard.press('m');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    const before = await page.evaluate(() => JSON.stringify([Selection.getCells(), Selection.getBounds(), Array.from(Selection.getOutline())]));
    await page.evaluate(() => { Canvas.setZoom(30); Canvas.render(); Canvas.setZoom(150); Canvas._test.setCamera(500, 600); Canvas.render(); });
    expect(await page.evaluate(() => JSON.stringify([Selection.getCells(), Selection.getBounds(), Array.from(Selection.getOutline())]))).toBe(before);
  });

  test('the readout in the left palette shows size and bounds, hides when empty, and the canvas width is unchanged', async ({ page }) => {
    const dims = () => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height, document.getElementById('palette-panel')!.getBoundingClientRect().width]; });
    expect(await dims()).toEqual([1491, 908, 220]);
    const info = page.locator('#selection-info');
    await expect(page.locator('#selection-row')).toBeHidden();
    await page.keyboard.press('m');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    await expect(page.locator('#selection-row')).toBeVisible();
    await expect(info).toHaveText('25 cells, 5 × 5 (cols 222-226, rows 220-224)');
    expect(await dims()).toEqual([1491, 908, 220]);
    expect(await page.evaluate(() => document.querySelector('#toolbar .tool-btn[data-tool="marquee"], #topbar .tool-btn[data-tool="marquee"]') === null && !!document.querySelector('#palette-panel .tool-btn[data-tool="marquee"]'))).toBe(true);
    await page.evaluate(() => Selection.setCells([{ col: 4, row: 7 }]));
    await expect(info).toHaveText('1 cell (col 4, row 7)');
    await page.click('#selection-clear');
    await expect(page.locator('#selection-row')).toBeHidden();
    expect(await sel(page)).toBe(0);
    expect(await dims()).toEqual([1491, 908, 220]);
  });

  // ---------- shortcuts ------------------------------------------------------------------------
  test('Ctrl+A selects the whole map and is default-prevented (no page text selection); Ctrl+D deselects', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ev = (code: string, o: any = {}) => { const e = new KeyboardEvent('keydown', { code, key: o.key || code.slice(3).toLowerCase(), ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift, altKey: !!o.alt, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
      const out: any = {};
      out.prevA = ev('KeyA', { ctrl: true }); out.all = Selection.size();
      out.prevD = ev('KeyD', { ctrl: true }); out.afterD = Selection.size();
      out.prevMeta = ev('KeyA', { meta: true }); out.metaAll = Selection.size();
      Selection.clear();
      out.shiftA = [ev('KeyA', { ctrl: true, shift: true }), Selection.size()];
      out.altA = [ev('KeyA', { ctrl: true, alt: true }), Selection.size()];
      out.plainA = [ev('KeyA'), Selection.size(), Tools.getActive()];
      return out;
    });
    expect(r.prevA).toBe(true); expect(r.all).toBe(450 * 450);
    expect(r.prevD).toBe(true); expect(r.afterD).toBe(0);
    expect(r.prevMeta).toBe(true); expect(r.metaAll).toBe(450 * 450);
    expect(r.shiftA).toEqual([false, 0]); expect(r.altA).toEqual([false, 0]);
    expect(r.plainA).toEqual([false, 0, 'scatter']);   // plain A is still Scatter
  });

  test('Ctrl+A and Ctrl+D leave text fields, modals and non-map modes alone', async ({ page }) => {
    const press = (code: string) => page.evaluate((code) => { const e = new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }, code);
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    expect(await press('KeyA')).toBe(false); expect(await sel(page)).toBe(0);
    await page.evaluate(() => { document.getElementById('tmp-in')!.remove(); (document.activeElement as HTMLElement)?.blur?.(); document.getElementById('newmap-modal')!.classList.add('open'); });
    expect(await press('KeyA')).toBe(false); expect(await sel(page)).toBe(0);
    await page.evaluate(() => { document.getElementById('newmap-modal')!.classList.remove('open'); document.body.classList.remove('mode-map'); });
    expect(await press('KeyA')).toBe(false); expect(await sel(page)).toBe(0);
    await page.evaluate(() => document.body.classList.add('mode-map'));
    expect(await press('KeyA')).toBe(true); expect(await sel(page)).toBe(450 * 450);
    // Ctrl+D inside a field must not deselect either
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    expect(await press('KeyD')).toBe(false); expect(await sel(page)).toBe(450 * 450);
    await page.evaluate(() => document.getElementById('tmp-in')!.remove());
  });

  test('M selects the tool by physical key; guards for Ctrl/Alt/Shift, text fields and modals; no collisions', async ({ page }) => {
    const press = (o: any) => page.evaluate((o) => { window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ code: 'KeyM', key: 'm', bubbles: true, cancelable: true }, o))); return Tools.getActive(); }, o);
    expect(await press({ key: 'ь' })).toBe('marquee');                      // other layout, same physical key
    await page.evaluate(() => Tools.setActive('paint'));
    for (const o of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) expect(await press(o)).toBe('paint');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    expect(await press({})).toBe('paint');
    await page.evaluate(() => { document.getElementById('tmp-in')!.remove(); (document.activeElement as HTMLElement)?.blur?.(); document.getElementById('newmap-modal')!.classList.add('open'); });
    expect(await press({})).toBe('paint');
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.remove('open'));
    expect(await press({})).toBe('marquee');
    // every other tool key still works
    const keys: Record<string, string> = { KeyP: 'paint', KeyF: 'fill', KeyR: 'rect', KeyE: 'eye', KeyS: 'select', KeyT: 'settlement', KeyD: 'erase', KeyZ: 'zone', KeyL: 'line', KeyO: 'circle', KeyG: 'polygon', KeyX: 'eraser', KeyA: 'scatter' };
    for (const [code, tool] of Object.entries(keys)) {
      const got = await page.evaluate(([code]) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true })); return Tools.getActive(); }, [code]);
      expect(got, code).toBe(tool);
    }
    // the toolbar button and its tooltip
    expect(await page.evaluate(() => { const b = document.querySelector('.tool-btn[data-tool="marquee"]') as HTMLElement; return [!!b, /\(M\)/.test(b.title), /Shift/.test(b.title), /Alt/.test(b.title)]; })).toEqual([true, true, true, true]);
    await page.click('.tool-btn[data-tool="marquee"]');
    expect(await page.evaluate(() => [Tools.getActive(), document.getElementById('st-tool')!.textContent])).toEqual(['marquee', 'Select Region']);
  });

  // ---------- lifecycle ------------------------------------------------------------------------
  test('New / Load-style replacement and a resize clear the selection, with no stale overlay or readout', async ({ page }) => {
    const strokesOnRender = () => page.evaluate(() => { const ctx = Canvas.getCtx(), os = ctx.stroke.bind(ctx); let n = 0; ctx.stroke = () => { n++; os(); }; Canvas.render(); ctx.stroke = os; return n; });
    for (const how of ['newMap', 'new array same size', 'resize']) {
      await page.evaluate(() => { IO.newMap(true); Selection.setCells(Tools._rectCells(10, 10, 14, 14)); });
      const withSel = await strokesOnRender();
      expect(await sel(page)).toBe(25);
      if (how === 'newMap') await page.evaluate(() => IO.newMap(true));
      else if (how === 'new array same size') await page.evaluate(() => { mapData = mapData.slice(); });
      else await replaceMap(page, 300, 310);
      // no render in between: the accessors must already see the empty selection
      expect(await page.evaluate(() => [Selection.size(), Selection.isEmpty(), Selection.has(10, 10), Selection.getBounds(), Selection.getCells().length])).toEqual([0, true, false, null, 0]);
      expect(await strokesOnRender(), how).toBeLessThan(withSel);
      await expect(page.locator('#selection-row'), how).toBeHidden();
    }
  });

  test('a new array of the same size and a wider map both drop the old cells, and the new bounds are honoured', async ({ page }) => {
    await page.evaluate(() => Selection.setCells(Tools._rectCells(2, 2, 4, 4)));
    await replaceMap(page, 450, 450);                                          // identity change only
    expect(await sel(page)).toBe(0);
    await page.evaluate(() => Selection.setCells(Tools._rectCells(2, 2, 4, 4)));
    await page.evaluate(() => { MAP_WIDTH = 451; mapData = new Array(451 * 450).fill('Plain_1'); });
    expect(await sel(page)).toBe(0);
    await page.evaluate(() => { Selection.setCells([{ col: 450, row: 449 }]); });
    expect(await page.evaluate(() => [Selection.size(), Selection.has(450, 449)])).toEqual([1, true]);   // new bounds are honoured
  });

  test('in-place undo / redo of terrain keeps the selection; the selection is not in History', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells(Tools._rectCells(222, 220, 226, 224)); });
    const steps = await page.evaluate(() => History.undoSize());
    await clickCell(page, 230, 230);                         // paint (Paint tool)
    expect(await page.evaluate(() => History.undoSize())).toBe(steps + 1);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => [History.undoSize(), Selection.size(), Selection.has(224, 222)])).toEqual([steps, 25, true]);
    await page.keyboard.press('Control+y');
    expect(await page.evaluate(() => [History.redoSize(), Selection.size()])).toEqual([0, 25]);
    await page.evaluate(() => Selection.clear());
    await page.keyboard.press('Control+z');                  // undo does not resurrect or touch the (cleared) selection
    expect(await sel(page)).toBe(0);
  });

  test('the selection survives tool switches and painting; Esc clears it in any tool', async ({ page }) => {
    await page.keyboard.press('m');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    for (const k of ['p', 'f', 'r', 's', 'l']) { await page.keyboard.press(k); expect(await sel(page)).toBe(25); }
    await page.keyboard.press('p');
    await clickCell(page, 240, 240);
    expect(await sel(page)).toBe(25);
    await page.keyboard.press('Escape');
    expect(await sel(page)).toBe(0);
  });

  test('Esc during a marquee drag cancels only the drag; the existing selection stays; a second Esc clears it', async ({ page }) => {
    await page.keyboard.press('m');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    const pa = await cellPoint(page, 230, 230), pb = await cellPoint(page, 236, 236);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.move(pb.x + 20, pb.y + 5, { steps: 3 }); await page.mouse.up();
    expect(await sel(page)).toBe(25);
    expect(await page.evaluate(() => Selection.has(230, 230))).toBe(false);
    await page.keyboard.press('Escape');
    expect(await sel(page)).toBe(0);
  });

  test('Esc is ignored while typing or with a modal open', async ({ page }) => {
    await page.evaluate(() => Selection.setCells(Tools._rectCells(1, 1, 3, 3)));
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('Escape');
    expect(await sel(page)).toBe(9);
    await page.evaluate(() => { document.getElementById('tmp-in')!.remove(); (document.activeElement as HTMLElement)?.blur?.(); document.getElementById('newmap-modal')!.classList.add('open'); });
    await page.keyboard.press('Escape');
    expect(await sel(page)).toBe(9);
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.remove('open'));
  });

  // ---------- input handling -------------------------------------------------------------------
  const mouse = (page: Page) => page.evaluate(() => {
    const cv = document.getElementById('map-canvas')!;
    (window as any).__ev = (type: string, c: number, rw: number, o: any = {}) => {
      const rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(c, rw);
      (o.target || cv).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true }, o.init || {})));
    };
  });

  test('right / middle / side buttons never start a marquee; a right release does not end a left drag', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page);
    const n = await page.evaluate(() => {
      const ev = (window as any).__ev;
      for (const b of [1, 2, 3, 4]) { ev('mousedown', 222, 220, { init: { button: b, buttons: 1 << b } }); ev('mousemove', 226, 224, { init: { button: b, buttons: 1 << b } }); ev('mouseup', 226, 224, { init: { button: b } }); }
      Canvas.centerOnCity();                                        // the synthetic middle/right drags panned the view
      return Selection.size();
    });
    expect(n).toBe(0);
    const pa = await cellPoint(page, 222, 220), pb = await cellPoint(page, 226, 224);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
    expect(await sel(page)).toBe(0);                               // not committed by the foreign release
    await page.mouse.up();
    expect(await sel(page)).toBe(25);
  });

  test('a lost mouseup (move with no button held) commits the drag once and nothing follows', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page);
    const r = await page.evaluate(() => {
      const ev = (window as any).__ev;
      ev('mousedown', 222, 220); ev('mousemove', 226, 224);
      ev('mousemove', 228, 226, { init: { buttons: 0 } });         // released elsewhere
      const after = Selection.size();
      ev('mousemove', 240, 240); ev('mousemove', 245, 245);        // no drag any more
      return [after, Selection.size()];
    });
    expect(r).toEqual([25, 25]);          // the last position with a button held decided the rectangle (222..226 / 220..224)
  });

  test('mouseup outside the canvas (window mouseup) finishes the marquee; leaving the canvas does not end it', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page);
    const r = await page.evaluate(() => {
      const ev = (window as any).__ev;
      ev('mousedown', 222, 220); ev('mousemove', 226, 224);
      document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      const mid = Selection.size();
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 0, bubbles: true }));
      return [mid, Selection.size()];
    });
    expect(r).toEqual([0, 25]);
  });

  test('window blur cancels the marquee and keeps the existing selection', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page);
    await page.evaluate(() => Selection.setCells(Tools._rectCells(1, 1, 2, 2)));
    const r = await page.evaluate(() => {
      const ev = (window as any).__ev;
      ev('mousedown', 222, 220); ev('mousemove', 226, 224);
      window.dispatchEvent(new Event('blur'));
      ev('mousemove', 230, 230); ev('mouseup', 230, 230);
      return Selection.size();
    });
    expect(r).toBe(4);
  });

  test('switching tool mid-drag leaves no stuck drag; the existing selection is untouched', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page);
    await page.evaluate(() => Selection.setCells(Tools._rectCells(1, 1, 2, 2)));
    const pa = await cellPoint(page, 222, 220), pb = await cellPoint(page, 228, 226);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    await page.keyboard.press('KeyP');
    await page.mouse.move(pb.x + 30, pb.y, { steps: 3 }); await page.mouse.up();
    expect(await sel(page)).toBe(4);
    expect(await page.evaluate(() => [Tools.getActive(), mapData.filter((x: string) => x !== 'Plain_1').length, History.undoSize()])).toEqual(['paint', 0, 1]);
  });

  test('a map replaced mid-drag cancels the marquee with a toast and selects nothing', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page); await toastsOn(page);
    const pa = await cellPoint(page, 222, 220), pb = await cellPoint(page, 228, 226);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    await page.evaluate(() => { IO.newMap(true); Canvas.render(); });
    await page.mouse.move(pb.x + 10, pb.y + 4, { steps: 3 }); await page.mouse.up();
    expect(await sel(page)).toBe(0);
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Shape cancelled — the map changed');
    expect(await page.evaluate(() => Canvas.getHighlightPoints('shape'))).toBeNull();
  });

  test('a map replaced between mousemove and mouseup cancels instead of selecting', async ({ page }) => {
    await page.keyboard.press('m'); await mouse(page); await toastsOn(page);
    const r = await page.evaluate(() => {
      const ev = (window as any).__ev;
      ev('mousedown', 222, 220); ev('mousemove', 226, 224);
      mapData = mapData.slice();
      ev('mouseup', 226, 224);
      return Selection.size();
    });
    expect(r).toBe(0);
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Shape cancelled — the map changed');
  });

  test('marquee input is ignored while a fill runs', async ({ page }) => {
    await mouse(page);
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const p = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      Tools.setActive('marquee');
      const ev = (window as any).__ev;
      ev('mousedown', 222, 220); ev('mousemove', 226, 224); ev('mouseup', 226, 224);
      const during = Selection.size();
      await p;
      return { busy, during, after: Selection.size() };
    });
    expect(r).toEqual({ busy: true, during: 0, after: 0 });
  });

  test('a click without drag selects the single cell under it; clicks outside the map select nothing', async ({ page }) => {
    await page.keyboard.press('m');
    await clickCell(page, 225, 224);
    expect(await page.evaluate(() => [Selection.size(), Selection.has(225, 224)])).toEqual([1, true]);
    const cv = await page.evaluate(() => { const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left, y: b.top }; });
    await page.evaluate(() => { Canvas.setZoom(30); Canvas._test.setCamera(-2000, -2000); Canvas.render(); });   // map far from the pointer
    await page.mouse.click(cv.x + 40, cv.y + 40);
    expect(await sel(page)).toBe(1);                                   // off-map click: nothing replaced
  });

  test('symmetry does not produce mirrored marquee previews', async ({ page }) => {
    await page.evaluate(() => Tools.setSymmetry('hv'));
    await page.keyboard.press('m');
    const pa = await cellPoint(page, 222, 220), pb = await cellPoint(page, 226, 224);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await page.evaluate(() => Canvas.hasHighlight('shape'))).toBe(false);
    await page.mouse.up();
    expect(await sel(page)).toBe(25);                                  // not mirrored
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  test('the Rectangle tool still paints the same cells as before the _rectCells refactor', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); });
    await page.keyboard.press('r');
    await dragCells(page, { col: 222, row: 220 }, { col: 226, row: 224 });
    expect(await page.evaluate(() => mapData.filter((x: string) => x === 'Forest_1').length)).toBe(25);
    expect(await sel(page)).toBe(0);
  });

  // ---------- fix round 1 -----------------------------------------------------------------------
  test('getMask returns a snapshot: writing to it cannot corrupt the selection', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(5, 5, 6, 6));
      const m = Selection.getMask(); m[0] = 1; m.fill(1);
      return [Selection.has(0, 0), Selection.size(), Selection.getMask()![0], Selection.getMask() !== Selection.getMask()];
    });
    expect(r).toEqual([false, 4, 0, true]);
  });

  test('setCells accepts any iterable and throws TypeError (selection untouched) on bad mode or input', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out: any = {};
      const cell = (c: number, rw: number) => ({ col: c, row: rw });
      Selection.setCells(new Set([cell(1, 1), cell(2, 1)])); out.set = Selection.size();
      function* g() { yield cell(5, 5); yield cell(6, 5); yield cell(7, 5); }
      Selection.setCells(g(), 'add'); out.gen = Selection.size();
      Selection.setCells(new Map([[1, cell(9, 9)]]).values(), 'add'); out.mapValues = Selection.size();
      const tries: any[] = [[[cell(1, 1)], 'union'], [[cell(1, 1)], 'Add'], [[cell(1, 1)], null], [null, 'replace'], [undefined, undefined], [5, 'replace'], [{ length: 2, 0: cell(1, 1) }, 'replace'], ['ab', 'replace']];
      out.throws = tries.map(([c, m]) => { try { Selection.setCells(c, m); return 'no throw'; } catch (e: any) { return e instanceof TypeError ? 'TypeError' : String(e); } });
      out.after = [Selection.size(), Selection.has(9, 9)];
      return out;
    });
    expect(r.set).toBe(2); expect(r.gen).toBe(5); expect(r.mapValues).toBe(6);
    // 'ab' is iterable but its items are not cells: it must not throw, and it replaces with nothing valid -> empty
    expect(r.throws.slice(0, 7)).toEqual(Array(7).fill('TypeError'));
    expect(r.throws[7]).toBe('no throw');
  });

  test('Esc that closes an open menu or the sprite picker does not clear the selection; the next Esc does', async ({ page }) => {
    await page.evaluate(() => Selection.setCells(Tools._rectCells(222, 220, 226, 224)));
    await page.evaluate(() => document.querySelector('.menu-item')!.classList.add('open'));
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => [document.querySelectorAll('.menu-item.open').length, Selection.size()])).toEqual([0, 25]);
    await page.evaluate(() => document.getElementById('sprite-picker-modal')!.classList.add('open'));
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => [document.getElementById('sprite-picker-modal')!.classList.contains('open'), Selection.size()])).toEqual([false, 25]);
    await page.keyboard.press('Escape');
    expect(await sel(page)).toBe(0);
  });

  // Pointer dragged past each edge / corner of the map, for both drag-rectangle tools: expectation by brute force
  // (nearest cell centre to the pointer clamped into the box of centres), and the border must be reached (no flip).
  // Run on the default 450x450 map and on odd-H maps (31x31, 30x31): floor(H/2) parity moves the odd-q stagger, which
  // is what _clampedCell's row estimate and per-row stagger depend on.
  for (const tool of ['marquee', 'rect']) for (const [MW, MH] of [[450, 450], [31, 31], [30, 31]]) {
    test(`${tool}: dragging past every edge and corner stops at the border (no flip to the opposite edge) on ${MW}x${MH}`, async ({ page }) => {
      await page.keyboard.press(tool === 'marquee' ? 'm' : 'r');
      await page.evaluate(() => UI.selectTerrain('Forest_1'));
      const dirs: [string, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0], ['upleft', -1, -1], ['upright', 1, -1], ['downleft', -1, 1], ['downright', 1, 1]];
      for (const [name, dx, dy] of dirs) {
        const setup = await page.evaluate(([dx, dy, MW, MH]) => {
          IO.newMap(true); Selection.clear();
          if (MW !== 450 || MH !== 450) { MAP_WIDTH = MW as number; MAP_HEIGHT = MH as number; mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1'); }
          const Z = 0.5; Canvas.setZoom(50);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) { const p = Canvas.hexCenterWorld(c, rw); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
          const ex = (dx as number) < 0 ? x0 : (dx as number) > 0 ? x1 : (x0 + x1) / 2, ey = (dy as number) < 0 ? y0 : (dy as number) > 0 ? y1 : (y0 + y1) / 2;
          const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
          Canvas._test.setCamera(ex * Z - cv.width / 2, ey * Z - cv.height / 2); Canvas.render();
          const b = cv.getBoundingClientRect();
          return { Z, x0, x1, y0, y1, left: b.left, top: b.top, cx: cv.width / 2, cy: cv.height / 2, ex, ey };
        }, [dx, dy, MW, MH]);
        const start = { x: setup.left + setup.cx - dx * 160, y: setup.top + setup.cy - dy * 160 };
        const end = { x: setup.left + setup.cx + dx * 220, y: setup.top + setup.cy + dy * 220 };
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 3 }); await page.mouse.move(end.x, end.y, { steps: 3 }); await page.mouse.up();
        const r = await page.evaluate(([sx, sy, ex, ey, tool]) => {
          const cam = Canvas.getCamera(), Z = Canvas.getZoom() / 100;
          const cv = document.getElementById('map-canvas')!.getBoundingClientRect();
          const world = (px: number, py: number) => ({ x: (px - cv.left + cam.x) / Z, y: (py - cv.top + cam.y) / Z });
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          const centres: any[] = [];
          for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) { const p = Canvas.hexCenterWorld(c, rw); centres.push([c, rw, p.x, p.y]); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
          const nearest = (wx: number, wy: number) => { let best: any = null, bd = Infinity; for (const [c, rw, x, y] of centres) { const d = (x - wx) ** 2 + (y - wy) ** 2; if (d < bd) { bd = d; best = { col: c, row: rw }; } } return best; };
          const sw = world(sx as number, sy as number), ew = world(ex as number, ey as number);
          const a = nearest(sw.x, sw.y), b = nearest(Math.max(x0, Math.min(x1, ew.x)), Math.max(y0, Math.min(y1, ew.y)));
          const exp = { minCol: Math.min(a.col, b.col), maxCol: Math.max(a.col, b.col), minRow: Math.min(a.row, b.row), maxRow: Math.max(a.row, b.row) };
          let got: any;
          if (tool === 'marquee') { const bb = Selection.getBounds(); got = bb && { minCol: bb.minCol, maxCol: bb.maxCol, minRow: bb.minRow, maxRow: bb.maxRow, n: Selection.size() }; }
          else {
            let n = 0, minC = 1e9, maxC = -1, minR = 1e9, maxR = -1;
            for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) if (mapData[rw * MAP_WIDTH + c] === 'Forest_1') { n++; minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, rw); maxR = Math.max(maxR, rw); }
            got = { minCol: minC, maxCol: maxC, minRow: minR, maxRow: maxR, n };
          }
          return { exp: Object.assign(exp, { n: (exp.maxCol - exp.minCol + 1) * (exp.maxRow - exp.minRow + 1) }), got };
        }, [start.x, start.y, end.x, end.y, tool]);
        expect(r.got, `${tool} ${name}`).toEqual(r.exp);
        if (dy < 0) expect(r.got.maxCol, name).toBe(MW - 1);    // col grows UP the screen
        if (dy > 0) expect(r.got.minCol, name).toBe(0);
        if (dx < 0) expect(r.got.maxRow, name).toBe(MH - 1);    // row grows toward the WEST (left)
        if (dx > 0) expect(r.got.minRow, name).toBe(0);
      }
    });
  }

  test('a drag cannot START off the map (marquee and rectangle)', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Canvas.setZoom(50); const cv = document.getElementById('map-canvas') as HTMLCanvasElement; Canvas._test.setCamera(-300, -300); Canvas.render(); });
    const b = await page.evaluate(() => { const r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    for (const key of ['m', 'r']) {
      await page.keyboard.press(key);
      await page.mouse.move(b.x + 100, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + 500, b.y + 400, { steps: 4 }); await page.mouse.up();
    }
    expect(await page.evaluate(() => [Selection.size(), mapData.filter((x: string) => x !== 'Plain_1').length])).toEqual([0, 0]);
  });

  test('a drag cannot START beyond the top or bottom edge while x is over the map (screenToHex clamps the column there)', async ({ page }) => {
    for (const key of ['m', 'r']) {
      for (const side of ['top', 'bottom']) {
        await page.keyboard.press(key);
        await page.evaluate(([side]) => {
          IO.newMap(true); Selection.clear(); UI.selectTerrain('Forest_1'); Canvas.setZoom(50);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) { const p = Canvas.hexCenterWorld(c, rw); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
          const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
          const edge = side === 'top' ? y0 : y1;
          Canvas._test.setCamera((x0 + x1) / 2 * 0.5 - cv.width / 2, edge * 0.5 - 300); Canvas.render();
        }, [side]);
        const b = await page.evaluate(() => { const r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
        const sy0 = side === 'top' ? 300 - 60 : 300 + 60, sy1 = side === 'top' ? 300 + 100 : 300 - 100;   // start 60 px beyond the edge, end inside
        await page.mouse.move(b.x + b.w / 2, b.y + sy0); await page.mouse.down(); await page.mouse.move(b.x + b.w / 2, b.y + sy1, { steps: 4 }); await page.mouse.up();
        expect(await page.evaluate(() => [Selection.size(), mapData.filter((x: string) => x !== 'Plain_1').length]), `${key} ${side}`).toEqual([0, 0]);
      }
    }
  });

  test('the marquee mode is latched at mousedown: Shift/Alt released before mouseup still count, pressed only after do not; the preview is tinted by mode', async ({ page }) => {
    await page.keyboard.press('m');
    await page.evaluate(() => Selection.setCells(Tools._rectCells(10, 10, 11, 11)));
    const pa = await cellPoint(page, 222, 220), pb = await cellPoint(page, 226, 224);
    const modeOf = () => page.evaluate(() => (typeof _toolsRectPreview !== 'undefined' && _toolsRectPreview) ? (_toolsRectPreview.mode ?? null) : 'none');
    const strokesSeen = () => page.evaluate(() => {
      const ctx = Canvas.getCtx(), d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'strokeStyle')!, seen: string[] = [];
      Object.defineProperty(ctx, 'strokeStyle', { configurable: true, get() { return d.get!.call(ctx); }, set(v) { seen.push(String(v)); d.set!.call(ctx, v); } });
      Canvas.render(); delete (ctx as any).strokeStyle; return seen;
    });
    // Shift held at mousedown, released before mouseup -> add
    await page.keyboard.down('Shift'); await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.keyboard.up('Shift');
    await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await modeOf()).toBe('add');
    expect(await strokesSeen()).toContain('rgba(110,220,120,0.95)');
    await page.mouse.up();
    expect(await sel(page)).toBe(4 + 25);
    // Alt -> subtract (tint red)
    await page.keyboard.down('Alt'); await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.keyboard.up('Alt');
    await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await modeOf()).toBe('subtract');
    expect(await strokesSeen()).toContain('rgba(240,100,100,0.95)');
    await page.mouse.up();
    expect(await sel(page)).toBe(4);
    // plain mousedown, Shift pressed only for the release -> still replace
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await modeOf()).toBe('replace');
    expect(await strokesSeen()).toContain('rgba(245,197,24,0.95)');
    await page.keyboard.down('Shift'); await page.mouse.up(); await page.keyboard.up('Shift');
    expect(await sel(page)).toBe(25);
    // the Rectangle tool's preview is a different, undashed blue one
    await page.keyboard.press('r');
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await modeOf()).toBeNull();
    expect(await strokesSeen()).toContain('rgba(79,195,247,0.8)');
    await page.keyboard.press('Escape'); await page.mouse.up();
  });

  test('the palette scrolls on a short window and the selection controls stay reachable (1100x400)', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 400 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.evaluate(() => Selection.setCells(Tools._rectCells(1, 1, 3, 3)));
    await expect(page.locator('#selection-row')).toBeVisible();
    await page.click('#selection-clear');                      // Playwright scrolls the palette to it
    expect(await sel(page)).toBe(0);
    await page.click('.tool-btn[data-tool="marquee"]');
    expect(await page.evaluate(() => Tools.getActive())).toBe('marquee');
  });
});

// ====================================================================================================
// T2.9 layered clipboard
// ====================================================================================================
test.describe('clipboard (T2.9)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH;
      mapData[224 * W + 225] = 'Water_1'; mapData[224 * W + 226] = 'Forest_1';
      objectsData['225,224'] = 'Grain_1';
      roadsData['226,224'] = { type: 'road_hex' };
      Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }]);
    });
  });

  const count = (page: any, id: string) => page.evaluate((id: string) => mapData.filter(x => x === id).length, id);
  /** Every layer in one comparable string. */
  const layers = (page: Page) => page.evaluate(() => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') }));
  /** Blank WxH map (new arrays: a real replacement) with a matching zone layer. */
  const resize = (page: Page, W: number, H: number) => page.evaluate(([W, H]) => {
    MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
    mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
    objectsData = {}; roadsData = {}; tileExtras = {}; bridgesData = [];
    ZonePainter.init(); invalidateSatelliteMap(); History.clear();
    Canvas.centerOnCity();
  }, [W, H]);

  test('Ctrl+C then Ctrl+V and a click stamps all layers at the cursor, one undo step', async ({ page }) => {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
    expect(await count(page, 'Forest_1')).toBe(2);
    expect(await page.evaluate(() => mapData[219 * MAP_WIDTH + 225])).toBe('Water_1');
    expect(await page.evaluate(() => objectsData['225,219'])).toBe('Grain_1');
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(2);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(1);
  });

  test('Ctrl+X removes the source (terrain, building, road) and keeps it pasteable', async ({ page }) => {
    await page.keyboard.press('Control+x');
    const r = await page.evaluate(() => ({
      water: mapData.filter(x => x === 'Water_1').length,
      o: Object.keys(objectsData).length, rd: Object.keys(roadsData).length,
      clip: Clipboard.get().cells.length,
    }));
    expect(r).toEqual({ water: 0, o: 0, rd: 0, clip: 2 });
    await page.keyboard.press('Control+v');
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(1);
  });

  test('Delete clears the selected region', async ({ page }) => {
    await page.keyboard.press('Delete');
    expect(await count(page, 'Forest_1')).toBe(0);
    expect(await page.evaluate(() => Object.keys(objectsData).length)).toBe(0);
  });

  test('Esc cancels a paste without changing the map', async ({ page }) => {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const before = await layers(page);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => Selection.size())).toBe(2);            // that Esc ended the paste only, the selection stays
  });

  test('HexUtils.anchorOf: the member closest to the mean, ties to the first', async ({ page }) => {
    const r = await page.evaluate(() => {
      const c = (q: number, r: number) => ({ q, r, s: -q - r });
      return [
        HexUtils.anchorOf([c(0, 0), c(1, 0), c(2, 0)]),                 // mean (1,0): the middle one
        HexUtils.anchorOf([c(5, 5), c(6, 5)]),                          // tie: the first
        HexUtils.anchorOf([c(0, 0), c(0, 1), c(0, 2), c(0, 9)]),        // mean (0,3.0): (0,2) is closest
      ];
    });
    expect(r[0]).toEqual({ q: 1, r: 0, s: -1 });
    expect(r[1]).toEqual({ q: 5, r: 5, s: -10 });
    expect(r[2]).toEqual({ q: 0, r: 2, s: -2 });
  });

  // Independent reference: world-space translation. Every pasted cell must be its source cell translated by ONE
  // pixel vector (the same for all cells), whatever the parity of the source / the target / the map size.
  for (const [W, H] of [[450, 450], [451, 451], [450, 451], [451, 450]]) {
    test(`round trip of every layer is a pure pixel translation (${W}x${H}, four target parities)`, async ({ page }) => {
      await resize(page, W, H);
      const r = await page.evaluate(() => {
        const cw = (c: number, rr: number) => Canvas.hexCenterWorld(c, rr);
        const src: { col: number; row: number }[] = [];
        const cx = 200, cy = 200;
        for (let row = cy - 4; row <= cy + 4; row++) for (let col = cx - 5; col <= cx + 5; col++) {
          const p = cw(col, row), o = cw(cx, cy);
          if (Math.hypot(p.x - o.x, p.y - o.y) < 5 * HEX_SIZE * 1.5 && (col * 7 + row * 3) % 5 !== 0) src.push({ col, row });
        }
        src.forEach((c, i) => {
          const k = c.col + ',' + c.row, idx = c.row * MAP_WIDTH + c.col;
          mapData[idx] = ['Water_1', 'Forest_1', 'Hills_1', 'Plain_2'][i % 4];
          tileExtras[k] = { tag: i, underTerrainId: i % 3 === 0 ? 'Water_1' : undefined };
          if (i % 3 === 0) objectsData[k] = 'Grain_1';
          if (i % 4 === 1) roadsData[k] = { type: 'road_hex', n: i };
          if (i % 5 === 2) bridgesData.push({ col: c.col, row: c.row, axis: i % 3 });
        });
        Selection.setCells(src);
        Tools.copySelection();
        const out: string[] = [];
        const targets = [[100, 100], [101, 100], [100, 101], [101, 101]];
        for (const [tc, tr] of targets) {
          Tools.beginPaste(Clipboard.get());
          Tools.dropFloat(tc, tr);
          // find dest cells by tag (tags 0..n-1 occur twice: source and copy)
          const dst = new Map<number, { col: number; row: number }>();
          for (const k in tileExtras) {
            const [c, rr] = k.split(',').map(Number);
            if (!src.some(s => s.col === c && s.row === rr)) dst.set(tileExtras[k].tag, { col: c, row: rr });
          }
          if (dst.size !== src.length) out.push(`target ${tc},${tr}: ${dst.size} of ${src.length} cells placed`);
          let T: { x: number; y: number } | null = null;
          src.forEach((s, i) => {
            const d = dst.get(i); if (!d) return;
            const a = cw(s.col, s.row), b = cw(d.col, d.row);
            const t = { x: b.x - a.x, y: b.y - a.y };
            if (!T) T = t; else if (Math.abs(t.x - T.x) > 1e-6 || Math.abs(t.y - T.y) > 1e-6) out.push(`target ${tc},${tr}: cell ${i} off the common translation`);
            const sk = s.col + ',' + s.row, dk = d.col + ',' + d.row;
            if (mapData[d.row * MAP_WIDTH + d.col] !== mapData[s.row * MAP_WIDTH + s.col]) out.push(`terrain ${i}`);
            if (objectsData[dk] !== objectsData[sk]) out.push(`object ${i}`);
            if (JSON.stringify(roadsData[dk]) !== JSON.stringify(roadsData[sk])) out.push(`road ${i}`);
            if (JSON.stringify(tileExtras[dk]) !== JSON.stringify(tileExtras[sk])) out.push(`extras ${i}`);
            const bs = bridgesData.find(b => b.col === s.col && b.row === s.row), bd = bridgesData.find(b => b.col === d.col && b.row === d.row);
            if ((bs && bs.axis) !== (bd && bd.axis) || !!bs !== !!bd) out.push(`bridge ${i}`);
          });
          // the pasted region is the new selection (exactly the placed cells)
          if (Selection.size() !== src.length) out.push('selection size ' + Selection.size());
          Tools.setActive('paint');
          History.undo();                                              // one step removes everything of this paste
          if (Object.keys(tileExtras).length !== src.length) out.push('undo left extras: ' + Object.keys(tileExtras).length);
        }
        return { out, n: src.length };
      });
      expect(r.n).toBeGreaterThan(40);
      expect(r.out).toEqual([]);
    });
  }

  test('one undo step restores every layer after paste, cut and delete; redo reapplies', async ({ page }) => {
    await page.evaluate(() => {
      bridgesData.push({ col: 225, row: 224, axis: 1 }); tileExtras['226,224'] = { underTerrainId: 'Water_1' };
      ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 225] = 3;
      Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }]); Tools.copySelection();
    });
    const base = await layers(page);
    for (const op of ['cut', 'delete', 'paste']) {
      const steps = await page.evaluate(() => History.undoSize());
      await page.evaluate(op => {
        if (op === 'cut') Tools.cutSelection(); else if (op === 'delete') Tools.deleteSelection();
        else { Tools.beginPaste(Clipboard.get()); Tools.dropFloat(225, 219); }
      }, op);
      expect(await page.evaluate(() => History.undoSize())).toBe(steps + 1);
      const after = await layers(page);
      expect(after).not.toBe(base);
      await page.evaluate(() => { Tools.setActive('paint'); History.undo(); });
      expect(await layers(page)).toBe(base);
      await page.evaluate(() => History.redo());
      expect(await layers(page)).toBe(after);
      await page.evaluate(() => History.undo());
      expect(await layers(page)).toBe(base);
    }
  });

  test('cut also clears bridges, extras and zones and keeps them in the clipboard', async ({ page }) => {
    await page.evaluate(() => {
      bridgesData.push({ col: 226, row: 224, axis: 2 }); tileExtras['226,224'] = { underTerrainId: 'Water_1' };
      ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 226] = 2;
    });
    await page.keyboard.press('Control+x');
    const r = await page.evaluate(() => ({ b: bridgesData.length, x: Object.keys(tileExtras).length, z: ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 226], c: Clipboard.get().cells.map((e: any) => ({ b: e.b, x: e.x, z: e.z })) }));
    expect(r.b).toBe(0); expect(r.x).toBe(0); expect(r.z).toBe(0);
    expect(r.c[1]).toEqual({ b: 2, x: { underTerrainId: 'Water_1' }, z: 2 });
  });

  test('Delete equals the eraser on the same cells (footprints, bridges, roads, extras) and does not mirror under symmetry', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const build = () => {
        mapData.fill('Plain_1'); objectsData = {}; roadsData = {}; tileExtras = {}; bridgesData = [];
        mapData[200 * W + 200] = 'Rabbit_Flat_1'; mapData[200 * W + 203] = 'Water_1'; mapData[210 * W + 210] = 'Forest_1';
        objectsData['200,200'] = 'Grain_1'; objectsData['201,200'] = 'Grain_1'; roadsData['203,200'] = { type: 'road_hex' };
        tileExtras['203,200'] = { underTerrainId: 'Water_1' }; bridgesData.push({ col: 203, row: 200, axis: 1 });
        invalidateSatelliteMap();
      };
      const cells = Tools._rectCells(199, 199, 204, 201);
      build(); Tools.setSymmetry('hv'); Tools.eraseCells(cells, { noSymmetry: true });
      const eraser = JSON.stringify([mapData.join('|'), objectsData, roadsData, tileExtras, bridgesData]);
      build(); Selection.setCells(cells); const steps = History.undoSize(); Tools.deleteSelection();
      const del = JSON.stringify([mapData.join('|'), objectsData, roadsData, tileExtras, bridgesData]);
      return { same: eraser === del, steps: History.undoSize() - steps, far: mapData[210 * W + 210], sat: !!getSatelliteAnchor(201, 200), left: Object.keys(roadsData).length + bridgesData.length };
    });
    expect(r).toEqual({ same: true, steps: 1, far: 'Forest_1', sat: false, left: 0 });
  });

  test('Delete / Ctrl+C / Ctrl+X with an empty selection are no-ops without a History step', async ({ page }) => {
    await page.evaluate(() => Selection.clear());
    const before = await layers(page);
    const steps = await page.evaluate(() => History.undoSize());
    await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+x'); await page.keyboard.press('Control+c');
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => [History.undoSize(), Clipboard.get()])).toEqual([steps, null]);
    await page.keyboard.press('Control+v');                                     // empty clipboard: no paste mode
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
  });

  test('Backspace deletes like Delete (by e.code)', async ({ page }) => {
    await page.keyboard.press('Backspace');
    expect(await count(page, 'Forest_1')).toBe(0);
  });

  test('text fields keep Ctrl+C / Ctrl+X / Ctrl+V / Delete / Backspace', async ({ page }) => {
    const before = await layers(page);
    const steps = await page.evaluate(() => {
      const i = document.createElement('input'); i.type = 'text'; i.id = 'tmp-text'; document.body.appendChild(i); i.focus();
      return History.undoSize();
    });
    for (const k of ['Control+c', 'Control+x', 'Control+v', 'Meta+c', 'Delete', 'Backspace']) await page.keyboard.press(k);
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => [History.undoSize(), Clipboard.get(), Tools.getActive()])).toEqual([steps, null, 'paint']);
    await page.evaluate(() => (document.getElementById('tmp-text') as HTMLElement).remove());
  });

  test('a modal dialog keeps the shortcuts too', async ({ page }) => {
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.add('open'));
    const before = await layers(page);
    await page.keyboard.press('Control+x'); await page.keyboard.press('Delete');
    expect(await layers(page)).toBe(before);
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.remove('open'));
  });

  test('symmetry ON does not mirror the paste', async ({ page }) => {
    await page.evaluate(() => { Tools.setSymmetry('hv'); });
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
    expect(await count(page, 'Forest_1')).toBe(2);
    expect(await page.evaluate(() => Object.keys(roadsData).length)).toBe(2);
  });

  test('the pasted region becomes the selection and the tool stays in paste mode (stamp again, Esc ends)', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await clickCell(page, 225, 219);
    const s1 = await page.evaluate(() => Selection.getCells());
    expect(s1.length).toBe(2);
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    const ref = await page.evaluate(() => Clipboard.previewCells(Clipboard.get(), { col: 225, row: 219 }));
    expect(s1).toEqual(ref.slice().sort((a: any, b: any) => a.row - b.row || a.col - b.col));
    await clickCell(page, 225, 214);
    expect(await count(page, 'Water_1')).toBe(3);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    expect(await page.evaluate(() => Selection.size())).toBe(2);
  });

  test('pasting at the map edge drops cells outside the map; a fully outside paste writes nothing and pushes no step', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(220, 220, 224, 224)); Tools.copySelection();
      const buf = Clipboard.get();
      const exp = (tc: number, tr: number) => {
        const t = HexUtils.toCube(tc, tr, MAP_WIDTH, MAP_HEIGHT), out: string[] = [];
        for (const e of buf.cells) {
          const p = HexUtils.fromCube({ q: t.q + e.dq, r: t.r + e.dr, s: t.s - e.dq - e.dr }, MAP_WIDTH, MAP_HEIGHT);
          if (p.col >= 0 && p.col < MAP_WIDTH && p.row >= 0 && p.row < MAP_HEIGHT) out.push(p.col + ',' + p.row);
        }
        return out.sort();
      };
      const res: any = {};
      for (const [tc, tr] of [[0, 0], [MAP_WIDTH - 1, MAP_HEIGHT - 1], [0, MAP_HEIGHT - 1], [MAP_WIDTH - 1, 0]]) {
        const e = exp(tc, tr), got = Clipboard.previewCells(buf, { col: tc, row: tr }).map((c: any) => c.col + ',' + c.row).sort();
        res[tc + ',' + tr] = JSON.stringify(e) === JSON.stringify(got) && e.length > 0 && e.length < buf.cells.length;
      }
      const steps = History.undoSize();
      const base = mapData.join('|');
      Tools.beginPaste(buf); Tools.dropFloat(0, 0);
      res.placed = Selection.size() === exp(0, 0).length;
      res.steps = History.undoSize() - steps;
      Tools.setActive('paint');
      res.outside = Clipboard.place(buf, { col: -100, row: -100 }, null, {});
      return res;
    });
    expect(r).toEqual({ '0,0': true, [`449,449`]: true, '0,449': true, '449,0': true, placed: true, steps: 1, outside: 0 });
  });

  test('a paste that writes nothing pushes no History step', async ({ page }) => {
    const steps = await page.evaluate(() => {
      Tools.copySelection(); Tools.beginPaste(Clipboard.get());
      const s = History.undoSize(); Tools.dropFloat(-200, -200);                  // (callers clamp; the guard must hold anyway)
      return History.undoSize() - s;
    });
    expect(steps).toBe(0);
  });

  // ---------- footprints ---------------------------------------------------------------------
  const FP = 'Rabbit_Flat_1';   // anchor + 3 satellites
  test('a pasted multi-tile anchor brings its footprint; an anchor whose footprint is clipped or overlaps another is skipped, no orphans', async ({ page }) => {
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, id = (c: number, r: number) => mapData[r * W + c];
      mapData[200 * W + 200] = FP; invalidateSatelliteMap();
      const sats0: string[] = [];
      for (let r = 197; r <= 203; r++) for (let c = 197; c <= 203; c++) if (getSatelliteAnchor(c, r)) sats0.push(c + ',' + r);
      Selection.setCells([{ col: 200, row: 200 }]); Tools.copySelection();
      const buf = Clipboard.get();
      const res: any = { satCount: sats0.length };
      // 1. free spot: terrain written, footprint registered
      Tools.beginPaste(buf); Tools.dropFloat(100, 100);
      const sats1: string[] = [];
      for (let r = 97; r <= 103; r++) for (let c = 97; c <= 103; c++) { const a = getSatelliteAnchor(c, r); if (a) sats1.push(a.col + ',' + a.row); }
      res.free = id(100, 100) === FP && sats1.length === sats0.length && sats1.every(s => s === '100,100');
      // 2. overlapping another anchor's footprint: next to the first anchor -> skipped
      const s2 = History.undoSize();
      Tools.dropFloat(100, 101);
      res.overlapSkipped = id(100, 101) === 'Plain_1' && History.undoSize() === s2;
      // 3. clipped footprint at the corner -> skipped
      Tools.dropFloat(0, 0);
      res.cornerSkipped = id(0, 0) === 'Plain_1';
      Tools.dropFloat(MAP_WIDTH - 1, MAP_HEIGHT - 1);
      res.cornerSkipped2 = id(MAP_WIDTH - 1, MAP_HEIGHT - 1) === 'Plain_1';
      // 4. a paste over the first anchor's footprint cell (a plain cell copied elsewhere) writes nothing under it
      Tools.setActive('paint');
      mapData[150 * W + 150] = 'Water_1'; Selection.setCells([{ col: 150, row: 150 }]); Tools.copySelection();
      const sat = [...sats1].length ? (() => { for (let r = 97; r <= 103; r++) for (let c = 97; c <= 103; c++) if (getSatelliteAnchor(c, r)) return { col: c, row: r }; })()! : { col: 0, row: 0 };
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(sat.col, sat.row);
      res.underFootprint = id(sat.col, sat.row) !== 'Water_1';
      // 5. overwriting the anchor cell itself removes its footprint (no orphan satellites)
      Tools.dropFloat(100, 100);
      let orphans = 0;
      for (let r = 97; r <= 103; r++) for (let c = 97; c <= 103; c++) if (getSatelliteAnchor(c, r)) orphans++;
      res.orphans = orphans;
      Tools.setActive('paint');
      return res;
    }, FP);
    expect(r).toEqual({ satCount: 3, free: true, overlapSkipped: true, cornerSkipped: true, cornerSkipped2: true, underFootprint: true, orphans: 0 });
  });

  test('edge re-resolution is limited to the pasted region border (interior cells keep their copied tiles)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(220, 220, 226, 226)); Tools.copySelection();
      const calls: any[] = [];
      const orig = Tools.autoResolveEdgesAround;
      Tools.autoResolveEdgesAround = (cells: any[]) => { calls.push(cells.map(c => c.col + ',' + c.row)); };
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(100, 100);
      Tools.autoResolveEdgesAround = orig;
      const placed = new Set(Selection.getCells().map((c: any) => c.col + ',' + c.row));
      const border = new Set<string>();
      for (const k of placed) {
        const [c, rr] = k.split(',').map(Number);
        if (HexUtils.neighbors(c, rr, MAP_WIDTH, MAP_HEIGHT).some((n: any) => !placed.has(n.col + ',' + n.row))) border.add(k);
      }
      const got = new Set(calls[0] || []);
      return { n: calls.length, hasAllBorder: [...border].every(k => got.has(k)), noInterior: [...got].every(k => placed.has(k)), smaller: got.size < placed.size, interior: placed.size - border.size };
    });
    expect(r.n).toBe(1);
    expect(r.hasAllBorder).toBe(true);
    expect(r.noInterior).toBe(true);
    expect(r.smaller).toBe(true);
    expect(r.interior).toBeGreaterThan(5);
  });

  test('new objects keys are appended (insertion order) and existing ones keep their order', async ({ page }) => {
    const order = await page.evaluate(() => {
      objectsData['300,300'] = 'Grain_1'; Selection.setCells([{ col: 225, row: 224 }]); Tools.copySelection();
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(100, 100);
      return Object.keys(objectsData);
    });
    expect(order).toEqual(['225,224', '300,300', '100,100']);
  });

  // ---------- paste mode: ghost and input -------------------------------------------------------
  test('the ghost shows exactly the cells a click would write (pixel reference), follows the cursor and only recomputes on a cell change', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells(Tools._rectCells(222, 220, 226, 223)); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    const pts = async (c: number, r: number) => {
      const p = await cellPoint(page, c, r);
      await page.mouse.move(p.x - 3, p.y); await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 2, p.y + 1);
      return page.evaluate(([c, r]) => {
        const g = Canvas.getGhostCells(), cw = Canvas.hexCenterWorld(c, r), buf = Clipboard.get();
        const ref = new Set<string>();   // independent: pixel offset of a cube offset from the cursor cell
        for (const e of buf.cells) {
          const x = cw.x + e.dq * COL_PITCH, y = cw.y - ROW_PITCH * (e.dr + e.dq / 2);
          ref.add(Math.round(x) + ',' + Math.round(y));
        }
        const got = new Set<string>(g.map((q: any) => { const w = Canvas.hexCenterWorld(q.col, q.row); return Math.round(w.x) + ',' + Math.round(w.y); }));
        return { same: ref.size === got.size && [...ref].every(k => got.has(k)), n: g.length, sets: Canvas.getGhostStats().sets };
      }, [c, r]);
    };
    const a = await pts(225, 224);
    expect(a.same).toBe(true); expect(a.n).toBe(20);
    const b = await pts(226, 225);       // other parity
    expect(b.same).toBe(true);
    expect(b.sets).toBeGreaterThan(a.sets);
    const p = await cellPoint(page, 226, 225);
    const s0 = await page.evaluate(() => Canvas.getGhostStats().sets);
    for (let i = -2; i <= 2; i++) await page.mouse.move(p.x + i, p.y);        // same cell: nothing rebuilt
    expect(await page.evaluate(() => Canvas.getGhostStats().sets)).toBe(s0);
  });

  test('the ghost is drawn (pixels differ from the same frame without it) and is gone after Esc', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); Selection.setCells(Tools._rectCells(222, 220, 226, 223)); Tools.copySelection(); Selection.clear(); Tools.beginPaste(Clipboard.get()); });
    const p = await cellPoint(page, 225, 214);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    const h = () => page.evaluate(() => { Canvas.render(); const cv = document.getElementById('map-canvas') as HTMLCanvasElement; const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return s; });
    const withGhost = await h();
    await page.keyboard.press('Escape');
    const without = await h();
    expect(withGhost).not.toBe(without);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(0);
  });

  test('a 202,500 cell clipboard: ghost updates cost O(boundary) per frame, not O(cells), and build neither geometry nor masks per move', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.selectAll(); Tools.copySelection(); Selection.clear();
      Tools.beginPaste(Clipboard.get());
      const s0 = Canvas.getGhostStats();
      const cvEl = document.getElementById('map-canvas')!, cv = cvEl.getBoundingClientRect();
      const mv = (c: number, rr: number) => { const p = Canvas.hexScreenPos(c, rr); cvEl.dispatchEvent(new MouseEvent('mousemove', { clientX: cv.left + p.x, clientY: cv.top + p.y, bubbles: true })); };
      const out: any = { n: Clipboard.get().cells.length };
      mv(225, 224); mv(226, 225); mv(227, 225);                 // three different cursor cells (each one crosses the map edge)
      Canvas.render();
      const s1 = Canvas.getGhostStats();
      out.setsDelta = s1.sets - s0.sets; out.builds = s1.builds - s0.builds; out.masks = s1.masks - s0.masks;
      out.cellsTested = s1.cellsTested; out.segs = s1.segsTested;
      mv(227, 225); mv(227, 225);                                // the same cell again: nothing is rebuilt
      const s2 = Canvas.getGhostStats();
      out.sameCell = [s2.sets - s1.sets, s2.builds - s1.builds, s2.masks - s1.masks];
      return out;
    });
    expect(r.n).toBe(450 * 450);
    expect(r.setsDelta).toBe(3);                                 // one ghost per cursor-cell change
    expect(r.builds).toBe(1);                                    // geometry built exactly once for this buffer
    expect(r.masks).toBe(0);                                     // no O(n) validity mask for the segment path
    expect(r.cellsTested).toBe(0);                               // never per-cell for > 1500 cells ...
    // ... and the outline really was walked: boundary of the full 450 x 450 map = 6n - 2 * (adjacent pairs), where the
    // pairs are 450 * 449 inside the 450 columns plus 449 * (2 * 450 - 1) between neighbouring staggered columns
    const boundary = 6 * 450 * 450 - 2 * (450 * 449 + 449 * (2 * 450 - 1));
    expect(boundary).toBe(3598);
    expect(r.segs).toBe(boundary);
    expect(r.sameCell).toEqual([0, 0, 0]);
  });

  test('capture and a full-map paste of 202,500 cells are interactive: bounded work counters, correct result, one step', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      for (let i = 0; i < mapData.length; i += 7) mapData[i] = 'Forest_1';
      Selection.selectAll(); Tools.copySelection();
      const snap = mapData.join('|');
      const steps = History.undoSize();
      let calls = 0; const orig = Tools.autoResolveEdgesAround; Tools.autoResolveEdgesAround = (c: any[]) => { calls++; return orig(c); };
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(225, 224);
      Tools.autoResolveEdgesAround = orig;
      return { same: mapData.join('|') === snap, steps: History.undoSize() - steps, calls, sel: Selection.size() };
    });
    expect(r).toEqual({ same: true, steps: 1, calls: 1, sel: 450 * 450 });
  });

  test('Ctrl+V while a paste is active keeps one float; tool switch (P) cancels it and hides the ghost', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    await page.keyboard.press('p');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await clickCell(page, 225, 219);                                            // paint tool: paints, does not paste
    expect(await count(page, 'Water_1')).toBe(1);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(0);
  });

  test('Esc returns to the tool that was active before the paste', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('eraser'));
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).toBe('eraser');
  });

  test('right / middle / side buttons never paste; a left click does', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    const steps0 = await page.evaluate(() => History.undoSize());
    const n = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 219);
      const ev = (type: string, b: number) => cv.dispatchEvent(new MouseEvent(type, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: b, buttons: type === 'mouseup' ? 0 : 1 << b, bubbles: true }));
      for (const b of [1, 2, 3, 4]) { ev('mousedown', b); ev('mouseup', b); }
      Canvas.centerOnCity();
      return mapData.filter(x => x === 'Water_1').length;
    });
    expect(n).toBe(1);                                                          // nothing was pasted by a non-left button
    expect(await page.evaluate(() => History.undoSize())).toBe(steps0);        // and no History step was pushed
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
  });

  test('a map replacement during paste cancels it with a toast and writes nothing', async ({ page }) => {
    await toastsOn(page);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await resize(page, 450, 450);
    const before = await layers(page);
    const p = await cellPoint(page, 225, 219);
    await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
    expect(await page.evaluate(() => (window as any).__toasts.some((t: string) => /map changed/i.test(t)))).toBe(true);
    await page.mouse.click(p.x, p.y);
    expect(await layers(page)).toBe(before);
  });

  test('a click on a replaced map (no move in between) also writes nothing', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await resize(page, 450, 450);
    const before = await layers(page);
    await clickCell(page, 225, 219);
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
  });

  test('mouseleave and window blur hide the ghost without cancelling the paste', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    const p = await cellPoint(page, 225, 219);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(2);
    await page.evaluate(() => document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })));
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(0);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => [Canvas.getGhostCells().length, Tools.getActive()])).toEqual([0, 'paste']);
  });

  test('a running fill blocks Cut, Delete, Paste and the ghost', async ({ page }) => {
    await page.evaluate(() => { Tools.copySelection(); });
    await page.evaluate(() => { Tools.beginPaste(Clipboard.get()); });
    const p0 = await cellPoint(page, 225, 214);
    await page.mouse.move(p0.x - 2, p0.y); await page.mouse.move(p0.x, p0.y);
    const ghost0 = await page.evaluate(() => JSON.stringify([Canvas.getGhostCells(), Canvas.getGhostStats().sets]));
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Water_1');
      const steps0 = History.undoSize();
      Tools.fill(10, 10);                                   // starts a fill; busy until it finishes
      const busy = Tools.isFillBusy();
      const cvEl = document.getElementById('map-canvas')!, rc = cvEl.getBoundingClientRect(), q = Canvas.hexScreenPos(230, 214);
      Tools.cutSelection(); Tools.deleteSelection();
      cvEl.dispatchEvent(new MouseEvent('mousemove', { clientX: rc.left + q.x, clientY: rc.top + q.y, bubbles: true }));   // ghost must not follow
      cvEl.dispatchEvent(new MouseEvent('mousedown', { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true }));
      cvEl.dispatchEvent(new MouseEvent('mouseup', { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 0, bubbles: true }));
      const ghostBusy = JSON.stringify([Canvas.getGhostCells(), Canvas.getGhostStats().sets]);
      await Tools.whenIdle();
      return { busy, ghostBusy, steps: History.undoSize() - steps0 };
    });
    expect(r.busy).toBe(true);
    expect(r.ghostBusy).toBe(ghost0);                        // the ghost neither moved nor was rebuilt, and the click pasted nothing
    expect(r.steps).toBe(0);                                 // cut / delete / paste pushed no History step
    expect(await page.evaluate(() => [objectsData['225,224'], Object.keys(roadsData).length])).toEqual(['Grain_1', 1]);   // Cut / Delete would have removed these (a fill never touches them)
  });

  test('copy/paste adds no UI that changes the canvas width, and the default render is untouched', async ({ page }) => {
    const w0 = await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width)).toBe(w0);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(0);
  });

  test('the ghost geometry is a pure translation of the buffer for any anchor parity (hexCenterWorld reference)', async ({ page }) => {
    const bad = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(222, 220, 228, 226)); Tools.copySelection();
      const buf = Clipboard.get(), out: string[] = [];
      for (const [c, r] of [[100, 100], [101, 100], [100, 101], [101, 101]]) {
        const cells = Clipboard.previewCells(buf, { col: c, row: r });
        const o = Canvas.hexCenterWorld(c, r);
        cells.forEach((q: any, i: number) => {
          const e = buf.cells[i], w = Canvas.hexCenterWorld(q.col, q.row);
          const ex = o.x + e.dq * COL_PITCH, ey = o.y - ROW_PITCH * (e.dr + e.dq / 2);
          if (Math.abs(w.x - ex) > 1e-6 || Math.abs(w.y - ey) > 1e-6) out.push(`${c},${r}#${i}`);
        });
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('copying keeps the source untouched and is not a History step', async ({ page }) => {
    const before = await layers(page);
    const steps = await page.evaluate(() => History.undoSize());
    await page.keyboard.press('Control+c');
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => History.undoSize())).toBe(steps);
  });

  test('the buffer is a snapshot: later edits to the map or to roads do not change it', async ({ page }) => {
    await page.keyboard.press('Control+c');
    await page.evaluate(() => { roadsData['226,224'].type = 'changed'; mapData[224 * MAP_WIDTH + 225] = 'Plain_1'; });
    await page.keyboard.press('Control+v'); await clickCell(page, 225, 219);
    const r = await page.evaluate(() => {
      const roads = Object.keys(roadsData).filter(k => k !== '226,224');
      return [mapData[219 * MAP_WIDTH + 225], roads.length === 1 ? roadsData[roads[0]].type : roads.length];
    });
    expect(r).toEqual(['Water_1', 'road_hex']);
  });

  test('Delete does not mirror under symmetry: the mirror image of the selection survives', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.setSymmetry('hv');
      const m = Tools.expandSymmetry([{ col: 200, row: 190 }]).find((c: any) => c.col !== 200 || c.row !== 190);
      mapData[m.row * MAP_WIDTH + m.col] = 'Forest_1'; mapData[190 * MAP_WIDTH + 200] = 'Forest_1';
      Selection.setCells([{ col: 200, row: 190 }]); Tools.deleteSelection();
      return [mapData[190 * MAP_WIDTH + 200], mapData[m.row * MAP_WIDTH + m.col]];
    });
    expect(r).toEqual(['Plain_1', 'Forest_1']);
  });

  test('paste replaces the destination extras with the source extras (none on the source clears them)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells([{ col: 300, row: 300 }]); Tools.copySelection();     // plain cell without extras
      tileExtras['100,100'] = { underTerrainId: 'Water_1' };
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(100, 100);
      return tileExtras['100,100'] === undefined;
    });
    expect(r).toBe(true);
  });

  test('the ghost at the map corner shows only the cells inside the map (clipped like the paste)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(220, 220, 224, 224)); Tools.copySelection(); Tools.beginPaste(Clipboard.get());
      const t = { col: 0, row: 0 };
      Canvas.setGhost(Clipboard.ghostLayer(Clipboard.get(), t, null));
      const g = Canvas.getGhostCells().map((c: any) => c.col + ',' + c.row).sort();
      const e = Clipboard.previewCells(Clipboard.get(), t).map((c: any) => c.col + ',' + c.row).sort();
      return { same: JSON.stringify(g) === JSON.stringify(e), n: g.length, full: Clipboard.get().cells.length };
    });
    expect(r.same).toBe(true);
    expect(r.n).toBeLessThan(r.full);
    expect(r.n).toBeGreaterThan(0);
  });

  // ---------- fix round: satellites, clipped footprints, plan fixed point, paste-mode keys ----------------

  test('pasting a building over a spawner removes the old building\'s satellite ring (no orphans); a pasted building on a ring cell wins', async ({ page }) => {
    const r = await page.evaluate(() => {
      const __o = BldDB.getAll; BldDB.getAll = () => __o.call(BldDB).concat([{ id: 'T_A', spawnsSatellites: [{ buildingId: 'T_S', radius: 1, maxCount: 6 }] }, { id: 'T_S', canBuild: false }] as any);   // fabricated entries
      try {
        const A = { col: 225, row: 224 }, ring = HexUtils.neighbors(A.col, A.row, MAP_WIDTH, MAP_HEIGHT);   // the full true radius-1 ring (ring[0] included; the legacy distance that missed it is gone, T2.14)
        const setup = () => { for (const k of Object.keys(objectsData)) delete objectsData[k]; objectsData['225,224'] = 'T_A'; for (const n of ring) objectsData[n.col + ',' + n.row] = 'T_S'; objectsData['300,224'] = 'T_S'; };
        const countS = () => Object.values(objectsData).filter(v => v === 'T_S').length;
        objectsData['300,300'] = 'Grain_1'; Selection.setCells([{ col: 300, row: 300 }]); Tools.copySelection();
        setup(); Tools.beginPaste(Clipboard.get()); Tools.dropFloat(225, 224);
        const out: any = { anchor: objectsData['225,224'], sLeft: countS() };            // ring gone, only the far one stays
        // two cells: the anchor and ring[0]; the pasted building on the ring cell must survive the cleanup
        const c0 = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT), c1 = HexUtils.toCube(ring[0].col, ring[0].row, MAP_WIDTH, MAP_HEIGHT);
        // ring[1] gets a pasted T_S (a satellite-type id that the cleanup would delete if it ran AFTER the write): it must survive,
        // while the other four old ring satellites are removed. Without this cell the ring0 check alone cannot tell the order.
        const c2 = HexUtils.toCube(ring[1].col, ring[1].row, MAP_WIDTH, MAP_HEIGHT);
        const buf = { v: 1, origin: A, cells: [{ dq: 0, dr: 0, t: 'Plain_1', o: 'Grain_1' }, { dq: c1.q - c0.q, dr: c1.r - c0.r, t: 'Plain_1', o: 'Grain_2' }, { dq: c2.q - c0.q, dr: c2.r - c0.r, t: 'Plain_1', o: 'T_S' }] };
        setup(); Tools.setActive('paint'); Tools.beginPaste(buf); Tools.dropFloat(225, 224);
        out.ring0 = objectsData[ring[0].col + ',' + ring[0].row]; out.ring1 = objectsData[ring[1].col + ',' + ring[1].row]; out.sLeft2 = countS();
        return out;
      } finally { BldDB.getAll = __o; }
    });
    expect(r).toEqual({ anchor: 'Grain_1', sLeft: 1, ring0: 'Grain_2', ring1: 'T_S', sLeft2: 2 });   // far T_S + the pasted ring[1] one
  });

  test('cutting a spawner removes its ring (also outside the selection) and paste does not duplicate or respawn it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const __o = BldDB.getAll; BldDB.getAll = () => __o.call(BldDB).concat([{ id: 'T_A', spawnsSatellites: [{ buildingId: 'T_S', radius: 1, maxCount: 6 }] }, { id: 'T_S', canBuild: false }] as any);   // fabricated entries
      try {
        const A = { col: 225, row: 224 }, ring = HexUtils.neighbors(A.col, A.row, MAP_WIDTH, MAP_HEIGHT);   // the full true radius-1 ring (ring[0] included; the legacy distance that missed it is gone, T2.14)
        objectsData['225,224'] = 'T_A'; for (const n of ring) objectsData[n.col + ',' + n.row] = 'T_S';
        const countS = () => Object.values(objectsData).filter(v => v === 'T_S').length;
        Selection.setCells([A]); Tools.cutSelection();
        const afterCut = { anchor: objectsData['225,224'], s: countS(), clip: Clipboard.get().cells.length };
        Tools.beginPaste(Clipboard.get()); Tools.dropFloat(150, 150);
        return { afterCut, pasted: objectsData['150,150'], s: countS(), around: HexUtils.neighbors(150, 150, MAP_WIDTH, MAP_HEIGHT).filter((n: any) => objectsData[n.col + ',' + n.row]).length };
      } finally { BldDB.getAll = __o; }
    });
    expect(r).toEqual({ afterCut: { s: 0, clip: 1 }, pasted: 'T_A', s: 0, around: 0 });
  });

  test('Cut and Delete over a selection that clips a footprint without its anchor leave those cells (terrain, building, road, extras, zone) and keep them out of the clipboard', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, zl = ZonePainter.getZoneLayer();
      mapData[200 * W + 200] = 'Rabbit_Flat_1'; invalidateSatelliteMap();
      const sats: any[] = [];
      for (let rr = 197; rr <= 203; rr++) for (let c = 197; c <= 203; c++) { const a = getSatelliteAnchor(c, rr); if (a && a.col === 200 && a.row === 200) sats.push({ col: c, row: rr }); }
      for (const q of sats) { const k = q.col + ',' + q.row; objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' }; tileExtras[k] = { underTerrainId: 'Water_1' }; zl[q.row * W + q.col] = 3; }
      mapData[210 * W + 210] = 'Water_1'; zl[210 * W + 210] = 2;
      const snap = () => JSON.stringify(sats.map(q => { const k = q.col + ',' + q.row; return [mapData[q.row * W + q.col], objectsData[k], roadsData[k], tileExtras[k], zl[q.row * W + q.col]]; }));
      const before = snap();
      const sel = sats.concat([{ col: 210, row: 210 }]);
      const out: any = { nSats: sats.length };
      Selection.setCells(sel); Tools.cutSelection();
      out.cutKept = snap() === before; out.cutPlain = [mapData[210 * W + 210], zl[210 * W + 210]];
      out.clip = Clipboard.get().cells.map((e: any) => e.t);
      out.anchorStays = mapData[200 * W + 200];
      Selection.setCells(sel); const s0 = History.undoSize(); mapData[210 * W + 210] = 'Water_1'; Tools.deleteSelection();
      out.delKept = snap() === before; out.delPlain = mapData[210 * W + 210]; out.delStep = History.undoSize() - s0;
      Selection.setCells(sats); const s1 = History.undoSize(); Tools.cutSelection();
      out.onlySatsStep = History.undoSize() - s1; out.onlySatsKept = snap() === before;
      return out;
    });
    expect(r).toEqual({ nSats: 3, cutKept: true, cutPlain: ['Plain_1', 0], clip: ['Water_1'], anchorStays: 'Rabbit_Flat_1', delKept: true, delPlain: 'Plain_1', delStep: 1, onlySatsStep: 0, onlySatsKept: true });
  });

  test('a Cut or Delete that changes nothing pushes no History step (Cut still fills the clipboard)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(300, 300, 302, 302));
      const s0 = History.undoSize();
      const d = Tools.deleteSelection(); const c = Tools.cutSelection();
      return { d, c, steps: History.undoSize() - s0, clip: Clipboard.get().cells.length };
    });
    expect(r).toEqual({ d: false, c: true, steps: 0, clip: 9 });
  });

  test('plan(): footprint clipping cascades to a fixed point however long the chain (no iteration cap), writes nothing and pushes no step', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, FPID = 'Rabbit_Flat_1', R0 = 100, C0 = 100, N = 30;
      // existing anchors D, p1..pN in a row: each one's N footprint cell is the next one (col + 1)
      for (let i = 0; i <= N; i++) mapData[R0 * W + C0 - 1 + i] = FPID;
      invalidateSatelliteMap();
      let chain = true;
      for (let i = 1; i <= N; i++) { const a = getSatelliteAnchor(C0 + i - 1, R0); chain = chain && !!a && a.col === C0 + i - 2 && a.row === R0; }
      const c0 = HexUtils.toCube(C0, R0, W, MAP_HEIGHT);
      const cells = []; for (let i = 0; i < N; i++) { const q = HexUtils.toCube(C0 + i, R0, W, MAP_HEIGHT); cells.push({ dq: q.q - c0.q, dr: q.r - c0.r, t: 'Water_1' }); }
      const buf = { v: 1, origin: { col: C0, row: R0 }, cells };
      const water0 = mapData.filter(x => x === 'Water_1').length, items = Clipboard.plan(buf, { col: C0, row: R0 }, null);
      const s0 = History.undoSize(); Tools.beginPaste(buf); Tools.dropFloat(C0, R0);
      return { chain, kept: items.length, steps: History.undoSize() - s0, water: mapData.filter(x => x === 'Water_1').length - water0 };
    });
    expect(r).toEqual({ chain: true, kept: 0, steps: 0, water: 0 });
  });

  test('two pasted anchors whose footprints overlap: the earlier cell wins, no orphan satellites, one step', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, FPID = 'Rabbit_Flat_1', c0 = HexUtils.toCube(100, 100, W, MAP_HEIGHT), c1 = HexUtils.toCube(101, 100, W, MAP_HEIGHT);
      const mk = (order: number[]) => ({ v: 1, origin: { col: 100, row: 100 }, cells: order.map(i => i === 0 ? { dq: 0, dr: 0, t: FPID } : { dq: c1.q - c0.q, dr: c1.r - c0.r, t: FPID }) });
      const s0 = History.undoSize();
      Tools.beginPaste(mk([0, 1])); Tools.dropFloat(100, 100);
      const sat: string[] = [];
      for (let rr = 97; rr <= 103; rr++) for (let c = 97; c <= 103; c++) { const a = getSatelliteAnchor(c, rr); if (a) sat.push(a.col + ',' + a.row); }
      const forward = { first: mapData[100 * W + 100], second: mapData[100 * W + 101], sat, steps: History.undoSize() - s0 };
      // reversed buffer order: the earlier BUFFER cell wins (Clipboard.plan walks the buffer in order), so the other anchor survives
      History.undo();
      const s1 = History.undoSize();
      Tools.beginPaste(mk([1, 0])); Tools.dropFloat(100, 100);
      const sat2: string[] = [];
      for (let rr = 97; rr <= 103; rr++) for (let c = 97; c <= 103; c++) { const a = getSatelliteAnchor(c, rr); if (a) sat2.push(a.col + ',' + a.row); }
      const reversed = { first: mapData[100 * W + 100], second: mapData[100 * W + 101], sat: sat2, steps: History.undoSize() - s1 };
      return { forward, reversed };
    });
    const want = { first: 'Rabbit_Flat_1', second: 'Plain_1', sat: ['100,100', '100,100', '100,100'], steps: 1 };
    expect(r.forward).toEqual(want);
    expect(r.reversed).toEqual({ first: 'Plain_1', second: 'Rabbit_Flat_1', sat: ['101,100', '101,100', '101,100'], steps: 1 });
  });

  test('a pasted footprint that would cover an existing anchor outside the paste is skipped', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, FPID = 'Rabbit_Flat_1';
      mapData[100 * W + 101] = FPID; invalidateSatelliteMap();               // existing anchor at (101,100), N of (100,100)
      const buf = { v: 1, origin: { col: 100, row: 100 }, cells: [{ dq: 0, dr: 0, t: FPID }] };
      const s0 = History.undoSize(); Tools.beginPaste(buf); Tools.dropFloat(100, 100);
      return { written: mapData[100 * W + 100], existing: mapData[100 * W + 101], steps: History.undoSize() - s0 };
    });
    expect(r).toEqual({ written: 'Plain_1', existing: 'Rabbit_Flat_1', steps: 0 });
  });

  test('footprintCells is the shared footprint definition: it reproduces the satellite map for both row parities', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, FPID = 'Rabbit_Flat_1', te = Terrain.byHexId(FPID), out: any[] = [];
      for (const [c, rr] of [[200, 200], [200, 201], [301, 300], [301, 301]]) {
        mapData[rr * W + c] = FPID; invalidateSatelliteMap();
        const fromMap: string[] = [];
        for (let y = rr - 2; y <= rr + 2; y++) for (let x = c - 2; x <= c + 2; x++) { const a = getSatelliteAnchor(x, y); if (a && a.col === c && a.row === rr) fromMap.push(x + ',' + y); }
        const fc = footprintCells(c, rr, te).map((q: any) => q.col + ',' + q.row);
        out.push(JSON.stringify(fc.slice().sort()) === JSON.stringify(fromMap.sort()) && fc.length === 3);
        mapData[rr * W + c] = 'Plain_1';
      }
      return out;
    });
    expect(r).toEqual([true, true, true, true]);
  });

  test('paste across map sizes: a 451 x 451 buffer pasted onto a 450 x 450 map is clipped, one step, selection = written cells', async ({ page }) => {
    await resize(page, 451, 451);
    await page.evaluate(() => { mapData.fill('Forest_1'); Selection.selectAll(); Tools.copySelection(); });
    await resize(page, 450, 450);
    const r = await page.evaluate(() => {
      const buf = Clipboard.get(), s0 = History.undoSize();
      Tools.beginPaste(buf);
      const n = Tools.dropFloat(225, 224);
      const forest = mapData.filter(x => x === 'Forest_1').length;
      return { cells: buf.cells.length, n, sel: Selection.size(), forest, outside: mapData.length, steps: History.undoSize() - s0, preview: Clipboard.previewCells(buf, { col: 225, row: 224 }, null).length };
    });
    expect(r.cells).toBe(451 * 451);
    expect(r.outside).toBe(450 * 450);
    expect(r.n).toBe(r.preview);
    expect(r.sel).toBe(r.n);
    expect(r.forest).toBe(r.n);
    expect(r.n).toBeLessThanOrEqual(450 * 450);
    expect(r.n).toBeGreaterThan(450 * 450 * 0.9);
    expect(r.steps).toBe(1);
  });

  test('undo while pasting keeps paste mode, ghost and selection; the next click pastes again on the restored map', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
    await page.keyboard.press('Control+z');
    const r = await page.evaluate(() => ({ water: mapData.filter(x => x === 'Water_1').length, tool: Tools.getActive(), pasting: Tools.isPasting(), sel: Selection.size(), has: Selection.has(225, 219) }));
    expect(r).toEqual({ water: 1, tool: 'paste', pasting: true, sel: 2, has: true });   // documented: the selection (the pasted region) is not an undo target
    const p = await cellPoint(page, 225, 214);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(2);
    await clickCell(page, 225, 219);
    expect(await count(page, 'Water_1')).toBe(2);
  });

  test('Cmd (Meta) + C / X / V work in map mode like Ctrl', async ({ page }) => {
    await page.keyboard.press('Meta+c');
    expect(await page.evaluate(() => Clipboard.get().cells.length)).toBe(2);
    await page.keyboard.press('Meta+v');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+x');
    expect(await page.evaluate(() => [mapData.filter(x => x === 'Water_1').length, Object.keys(objectsData).length])).toEqual([0, 0]);
  });

  test('while pasting, Ctrl+C / Ctrl+X / Delete are ignored with a toast; Ctrl+V with a new buffer refreshes the ghost at once', async ({ page }) => {
    await toastsOn(page);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    const p = await cellPoint(page, 225, 214);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    const before = await layers(page), steps = await page.evaluate(() => History.undoSize());
    const buf0 = await page.evaluate(() => { (window as any).__b0 = Clipboard.get(); return Clipboard.get().cells.length; });
    await page.evaluate(() => Selection.setCells(Tools._rectCells(222, 220, 226, 223)));
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+x'); await page.keyboard.press('Delete');
    expect(await page.evaluate(() => Clipboard.get() === (window as any).__b0)).toBe(true);
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => History.undoSize())).toBe(steps);
    expect(await page.evaluate(() => (window as any).__toasts.filter((t: string) => /Finish the paste first/.test(t)).length)).toBe(3);
    expect(buf0).toBe(2);
    // a different buffer + Ctrl+V: the ghost shows it without moving the mouse
    await page.evaluate(() => { const b = Clipboard.get(); Clipboard.set({ v: 1, origin: b.origin, cells: b.cells.concat([{ dq: 2, dr: 0, t: 'Plain_1' }]) }); });
    await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => Canvas.getGhostCells().length)).toBe(3);
  });

  test('an Escape another handler already consumed (defaultPrevented) does not end the paste', async ({ page }) => {
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await page.evaluate(() => { (window as any).__eat = (e: KeyboardEvent) => e.preventDefault(); window.addEventListener('keydown', (window as any).__eat, true); });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paste');
    await page.evaluate(() => window.removeEventListener('keydown', (window as any).__eat, true));
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
  });

  test('under-terrain belongs to the terrain layer: terrain=false keeps the destination extras, objects=false still replaces them', async ({ page }) => {
    const r = await page.evaluate(() => {
      tileExtras['225,224'] = { underTerrainId: 'Water_1' }; Selection.setCells([{ col: 225, row: 224 }]); Tools.copySelection();
      const buf = Clipboard.get();
      tileExtras['100,100'] = { underTerrainId: 'Forest_1' }; delete objectsData['100,100'];
      Clipboard.write(Clipboard.plan(buf, { col: 100, row: 100 }, null), { terrain: false });
      const kept = tileExtras['100,100'].underTerrainId;
      delete objectsData['100,100'];
      Clipboard.write(Clipboard.plan(buf, { col: 100, row: 100 }, null), { objects: false });
      return { kept, replaced: tileExtras['100,100'].underTerrainId, obj: objectsData['100,100'] };
    });
    expect(r).toEqual({ kept: 'Forest_1', replaced: 'Water_1', obj: undefined });
  });

  test('ghost geometry is cached per (buffer, transform signature) and masks are only built for small edge-crossing buffers', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.copySelection(); const buf = Clipboard.get();
      const a = Clipboard.ghostGeometry(buf, null), b = Clipboard.ghostGeometry(buf, null), c = Clipboard.ghostGeometry(buf, { rot: 1 }), d = Clipboard.ghostGeometry(buf, { rot: 1 });
      const m0 = Canvas.getGhostStats().masks;
      Canvas.setGhost(Clipboard.ghostLayer(buf, { col: 0, row: 0 }, null)); const m1 = Canvas.getGhostStats().masks;
      Canvas.setGhost(Clipboard.ghostLayer(buf, { col: 225, row: 224 }, null)); const m2 = Canvas.getGhostStats().masks;
      Canvas.setGhost(null);
      return { same: a === b && c === d, differ: a !== c, edgeMask: m1 - m0, inside: m2 - m1 };
    });
    expect(r).toEqual({ same: true, differ: true, edgeMask: 1, inside: 0 });
  });

  test('the ghost is tinted exactly on the cells a click would write (pixel check at hexScreenPos centres, neighbours untouched)', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells(Tools._rectCells(222, 220, 225, 222)); Tools.copySelection(); Selection.clear(); Tools.beginPaste(Clipboard.get()); });
    const p = await cellPoint(page, 225, 214);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    const r = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas') as HTMLCanvasElement, k = cv.width / cv.getBoundingClientRect().width;
      const px = (c: number, rr: number) => { const q = Canvas.hexScreenPos(c, rr); return Array.from(cv.getContext('2d')!.getImageData(Math.round(q.x * k), Math.round(q.y * k), 1, 1).data).slice(0, 3); };
      const exp = Clipboard.previewCells(Clipboard.get(), { col: 225, row: 214 }, null);
      const inSet = new Set(exp.map((q: any) => q.col + ',' + q.row));
      const outside: any[] = [];
      for (const q of exp) for (const n of HexUtils.neighbors(q.col, q.row, MAP_WIDTH, MAP_HEIGHT)) if (!inSet.has(n.col + ',' + n.row)) outside.push(n);
      Canvas.render(); const withG = { i: exp.map((q: any) => px(q.col, q.row)), o: outside.map((q: any) => px(q.col, q.row)) };
      Canvas.setGhost(null);
      const without = { i: exp.map((q: any) => px(q.col, q.row)), o: outside.map((q: any) => px(q.col, q.row)) };
      const d = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));   // largest channel difference
      return { n: exp.length, minIn: Math.min(...withG.i.map((v: number[], i: number) => d(v, without.i[i]))), maxOut: Math.max(...withG.o.map((v: number[], i: number) => d(v, without.o[i]))), nOut: outside.length };
    });
    expect(r.n).toBe(12);
    expect(r.minIn).toBeGreaterThan(10);   // every ghost cell centre is tinted (alpha .22 of the green over the terrain)
    expect(r.nOut).toBeGreaterThan(5);
    expect(r.maxOut).toBeLessThanOrEqual(3); // cells just outside the ghost are not (<= 3 levels: antialiasing of the neighbouring outline)
  });
});

// ====================================================================================================
// T2.10 rotate, mirror and move
// ====================================================================================================
test.describe('transform and move (T2.10)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const n = HexUtils.neighbors(225, 224, W, H)[0];
      (window as any).__n = n;
      mapData[224 * W + 225] = 'Water_1';
      mapData[n.row * W + n.col] = 'Forest_1';
      Selection.setCells([{ col: 225, row: 224 }, n]);
      // independent pixel reference: mirror h (x), mirror v (y), then rotate screen-clockwise (y down) by rot*60 degrees
      (window as any).__ref = (v: { x: number; y: number }, rot: number, mh: boolean, mv: boolean) => {
        let x = mh ? -v.x : v.x, y = mv ? -v.y : v.y;
        const a = Math.PI / 3 * rot, cs = Math.cos(a), sn = Math.sin(a);
        return { x: x * cs - y * sn, y: x * sn + y * cs };
      };
    });
  });

  const XFS: [number, boolean, boolean][] = [];
  for (let rot = 0; rot < 6; rot++) for (const mh of [false, true]) for (const mv of [false, true]) XFS.push([rot, mh, mv]);
  const layers = (page: Page) => page.evaluate(() => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') }));
  const resize = (page: Page, W: number, H: number) => page.evaluate(([W, H]) => {
    MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
    mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
    objectsData = {}; roadsData = {}; tileExtras = {}; bridgesData = [];
    ZonePainter.init(); invalidateSatelliteMap(); History.clear();
    Canvas.centerOnCity();
  }, [W, H]);

  const vectors = (page: any) => page.evaluate(() => {
    const W = MAP_WIDTH;
    const pos = (i: number) => Canvas.hexCenterWorld(i % W, Math.floor(i / W));
    const water: number[] = [], forest: number[] = [];
    mapData.forEach((id, i) => { if (id === 'Water_1') water.push(i); if (id === 'Forest_1') forest.push(i); });
    const srcW = 224 * W + 225, n = (window as any).__n, srcF = n.row * W + n.col;
    const dstW = water.find(i => i !== srcW)!, dstF = forest.find(i => i !== srcF)!;
    const v = (a: number, b: number) => ({ x: pos(b).x - pos(a).x, y: pos(b).y - pos(a).y });
    return { src: v(srcW, srcF), dst: v(dstW, dstF) };
  });
  async function pasteWith(page: any, keys: string[]) {
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    for (const k of keys) await page.keyboard.press(k);
    await clickCell(page, 225, 219);
  }

  test('"." rotates 60 degrees clockwise on screen', async ({ page }) => {
    await pasteWith(page, ['.']);
    const { src, dst } = await vectors(page);
    const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
    expect(dst.x).toBeCloseTo(src.x * cs - src.y * sn, 4);
    expect(dst.y).toBeCloseTo(src.x * sn + src.y * cs, 4);
  });

  test('"," rotates counter-clockwise, "/" mirrors left-right, ";" mirrors top-bottom', async ({ page }) => {
    await pasteWith(page, [',']);
    let v = await vectors(page);
    const cs = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
    expect(v.dst.x).toBeCloseTo(v.src.x * cs + v.src.y * sn, 4);
    expect(v.dst.y).toBeCloseTo(-v.src.x * sn + v.src.y * cs, 4);
    await page.evaluate(() => History.undo());
    await pasteWith(page, ['/']);
    v = await vectors(page);
    expect(v.dst.x).toBeCloseTo(-v.src.x, 4); expect(v.dst.y).toBeCloseTo(v.src.y, 4);
    await page.evaluate(() => History.undo());
    await pasteWith(page, [';']);
    v = await vectors(page);
    expect(v.dst.x).toBeCloseTo(v.src.x, 4); expect(v.dst.y).toBeCloseTo(-v.src.y, 4);
  });

  test('Enter lifts the selection: nothing is written until the drop; a click drops it as ONE step and selects the new cells', async ({ page }) => {
    const base = await layers(page), s0 = await page.evaluate(() => History.undoSize());
    const anchorId = await page.evaluate(() => { const o = Clipboard.capture(Selection.getCells()).origin; return mapData[o.row * MAP_WIDTH + o.col]; });
    await page.keyboard.press('Enter');
    expect(await layers(page)).toBe(base);                                              // nothing written at lift time
    expect(await page.evaluate(() => [Tools.getActive(), History.undoSize()])).toEqual(['paste', s0]);
    await clickCell(page, 225, 219);
    const r = await page.evaluate(() => ({
      water: mapData.filter(x => x === 'Water_1').length, forest: mapData.filter(x => x === 'Forest_1').length,
      sel: Selection.size(), moved: mapData[219 * MAP_WIDTH + 225], src: mapData[224 * MAP_WIDTH + 225], steps: History.undoSize(),
    }));
    expect(r).toEqual({ water: 1, forest: 1, sel: 2, moved: anchorId, src: 'Plain_1', steps: s0 + 1 });   // the click cell receives the ANCHOR cell (closest to the mean)
    expect(await page.evaluate(() => Tools.getActive())).not.toBe('paste');
    await page.evaluate(() => History.undo());
    expect(await layers(page)).toBe(base);                                              // one undo restores every layer
    await page.evaluate(() => History.redo());
    expect(await page.evaluate(() => mapData[219 * MAP_WIDTH + 225])).toBe(anchorId);
  });

  test('Esc while moving cancels: map, selection and History untouched, previous tool back', async ({ page }) => {
    await page.evaluate(() => Tools.setActive('eraser'));
    const base = await layers(page), s0 = await page.evaluate(() => History.undoSize());
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    expect(await layers(page)).toBe(base);
    expect(await page.evaluate(() => [Selection.size(), History.undoSize(), Tools.getActive()])).toEqual([2, s0, 'eraser']);
  });

  test('Enter does nothing without a selection, while pasting, in a text field, or from a focused button', async ({ page }) => {
    await page.evaluate(() => Selection.clear());
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isPasting())).toBe(false);
    await page.evaluate(() => Selection.setCells([{ col: 225, row: 224 }]));
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'zz-input'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isPasting())).toBe(false);
    await page.evaluate(() => { (document.activeElement as HTMLElement).blur(); document.getElementById('zz-input')!.remove(); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
    await page.evaluate(() => { Tools.setActive('paint'); const b = document.querySelector('.tool-btn[data-tool="marquee"]') as HTMLElement; b.focus(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
  });

  // ---------- invariants ----------------------------------------------------------------------
  test('transformOffset: 6 rotations and 2 mirrors are the identity, mh+mv = rotation by 3, mirror-then-rotate order is fixed', async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out: string[] = [], eq = (a: any, b: any) => a.q === b.q && a.r === b.r && a.s === b.s;
      const T = HexUtils.transformOffset;
      for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
        const c = { q, r, s: -q - r };
        let x = c; for (let i = 0; i < 6; i++) x = T(x, 1, false, false);
        if (!eq(x, c)) out.push('rot6 ' + q + ',' + r);
        if (!eq(T(T(c, 0, true, false), 0, true, false), c)) out.push('mh2');
        if (!eq(T(T(c, 0, false, true), 0, false, true), c)) out.push('mv2');
        if (!eq(T(c, 0, true, true), T(c, 3, false, false))) out.push('mhmv');
        if (!eq(T(c, 2, true, false), HexUtils.rotateCube(HexUtils.mirrorCube(c, 'h'), 2))) out.push('order');
        // rotate-then-mirror equals mirror-then-rotate by the opposite angle
        if (!eq(HexUtils.mirrorCube(HexUtils.rotateCube(c, 2), 'h'), T(c, -2, true, false))) out.push('conj');
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('a float rotated 6 times, mirrored twice or rotated +1 -1 pastes exactly like the untransformed one', async ({ page }) => {
    await page.evaluate(() => {
      const W = MAP_WIDTH;
      Selection.setCells(Tools._rectCells(222, 220, 227, 223));
      Selection.forEach((c: number, r: number) => {
        const k = c + ',' + r, i = r * W + c;
        mapData[i] = ['Water_1', 'Forest_1', 'Hills_1'][(c + r) % 3];
        if ((c + r) % 4 === 0) objectsData[k] = 'Grain_1';
        if ((c + r) % 5 === 0) roadsData[k] = { type: 'road_hex' };
        if ((c + r) % 7 === 0) bridgesData.push({ col: c, row: r, axis: (c + r) % 3 });
        tileExtras[k] = { tag: c * 100 + r };
        if ((c + r) % 3 === 0) ZonePainter.getZoneLayer()[i] = 2;
      });
      Tools.copySelection();
    });
    const run = (ops: string) => page.evaluate((ops: string) => {
      Tools.beginPaste(Clipboard.get());
      for (const o of ops) { if (o === 'c') Tools.rotateFloat(1); else if (o === 'a') Tools.rotateFloat(-1); else if (o === 'h') Tools.mirrorFloat('h'); else if (o === 'v') Tools.mirrorFloat('v'); }
      Tools.dropFloat(100, 100);
      const s = JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') });
      Tools.setActive('paint'); History.undo();
      return s;
    }, ops);
    const id = await run('');
    expect(await run('cccccc')).toBe(id);
    expect(await run('hh')).toBe(id);
    expect(await run('vv')).toBe(id);
    expect(await run('ca')).toBe(id);
    expect(await run('hvhv')).toBe(id);
    expect(await run('c')).not.toBe(id);                  // and a single rotation really changes it
    expect(await run('hv')).toBe(await run('ccc'));       // mirror h + mirror v = rotate 180
  });

  // ---------- pixel geometry ------------------------------------------------------------------
  for (const [W, H] of [[31, 31], [30, 30], [31, 30], [30, 31]]) {
    test(`pasted tiles sit at the rotated / mirrored pixel offsets of the source (hexCenterWorld reference), ${W}x${H}, 24 transforms, odd and even anchor parities, clipped at the edges`, async ({ page }) => {
      await resize(page, W, H);
      const r = await page.evaluate(([W, H]) => {
        const cw = Canvas.hexCenterWorld, ref = (window as any).__ref, bad: string[] = [];
        const key = (x: number, y: number) => Math.round(x * 1000) + '/' + Math.round(y * 1000);
        const at = new Map<string, { col: number; row: number }>();
        for (let c = 0; c < MAP_WIDTH; c++) for (let r = 0; r < MAP_HEIGHT; r++) { const p = cw(c, r); at.set(key(p.x, p.y), { col: c, row: r }); }
        const src: { col: number; row: number }[] = [];
        for (const d of HexUtils.discCells(22, 22, 2, MAP_WIDTH, MAP_HEIGHT)) src.push(d);
        const srcSet = new Set(src.map(s => s.col + ',' + s.row));
        src.forEach((c, i) => {
          const k = c.col + ',' + c.row;
          mapData[c.row * MAP_WIDTH + c.col] = ['Water_1', 'Forest_1', 'Hills_1'][i % 3];
          tileExtras[k] = { tag: i };
          if (i % 2) objectsData[k] = 'Grain_1';
          if (i % 3 === 1) roadsData[k] = { type: 'road_hex' };
          if (i % 4 === 2) ZonePainter.getZoneLayer()[c.row * MAP_WIDTH + c.col] = 3;
        });
        Selection.setCells(src); Tools.copySelection();
        const buf = Clipboard.get(), o = buf.origin, po = cw(o.col, o.row);
        const targets = [[10, 10], [11, 10], [10, 11], [11, 11], [0, 0], [MAP_WIDTH - 1, MAP_HEIGHT - 1], [0, MAP_HEIGHT - 1], [MAP_WIDTH - 1, 0], [1, 1]];
        let placed = 0, clipped = 0;
        for (const [rot, mh, mv] of [[0, false, false], [1, false, false], [2, false, false], [3, false, false], [4, false, false], [5, false, false],
          [0, true, false], [1, true, false], [2, true, false], [3, true, false], [4, true, false], [5, true, false],
          [0, false, true], [1, false, true], [2, false, true], [3, false, true], [4, false, true], [5, false, true],
          [0, true, true], [1, true, true], [2, true, true], [3, true, true], [4, true, true], [5, true, true]] as [number, boolean, boolean][]) {
          for (const [tc, tr] of targets) {
            Tools.beginPaste(buf);
            Tools.setFloatTransform({ rot, mh, mv });
            Tools.dropFloat(tc, tr);
            const pt = cw(tc, tr), got = new Map<number, { col: number; row: number }>();
            for (const k in tileExtras) {
              const [c, rr] = k.split(',').map(Number);
              if (!srcSet.has(k)) got.set(tileExtras[k].tag, { col: c, row: rr });
            }
            let want = 0;
            src.forEach((s, i) => {
              const ps = cw(s.col, s.row), v = ref({ x: ps.x - po.x, y: ps.y - po.y }, rot, mh, mv);
              const d = at.get(key(pt.x + v.x, pt.y + v.y)), g = got.get(i);
              if (!d) { clipped++; if (g) bad.push(`${rot}${mh}${mv}@${tc},${tr} #${i} placed off map`); return; }
              want++;
              if (!g || g.col !== d.col || g.row !== d.row) { bad.push(`${rot}${mh}${mv}@${tc},${tr} #${i} want ${d.col},${d.row} got ${g && g.col + ',' + g.row}`); return; }
              const dk = d.col + ',' + d.row, sk = s.col + ',' + s.row;
              if (mapData[d.row * MAP_WIDTH + d.col] !== mapData[s.row * MAP_WIDTH + s.col] || objectsData[dk] !== objectsData[sk]
                || JSON.stringify(roadsData[dk]) !== JSON.stringify(roadsData[sk])
                || ZonePainter.getZoneLayer()[d.row * MAP_WIDTH + d.col] !== ZonePainter.getZoneLayer()[s.row * MAP_WIDTH + s.col]) bad.push(`${rot}${mh}${mv}@${tc},${tr} #${i} content`);
            });
            if (got.size !== want) bad.push(`${rot}${mh}${mv}@${tc},${tr} count ${got.size}/${want}`);
            placed += want;
            if (bad.length > 6) return { bad };
            Tools.setActive('paint'); History.undo();
          }
        }
        return { bad, placed, clipped };
      }, [W, H]);
      expect(r.bad).toEqual([]);
      expect(r.placed).toBeGreaterThan(24 * 4 * 19);
      expect(r.clipped).toBeGreaterThan(0);                     // the corner targets really clipped after the transform
    });
  }

  // ---------- bridges -------------------------------------------------------------------------
  test('bridge axes follow the transform (expected axis derived from the pixel directions of the cells it connects); Road_Bridge buildings keep their id', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ref = (window as any).__ref, bad: string[] = [], cw = Canvas.hexCenterWorld, W = MAP_WIDTH;
      // Independent of the code under test: the six neighbours of a cell are the cells at the minimum pixel distance;
      // a bridge axis connects the cell with the neighbour in the direction named by the UI label (N<->S, NE<->SW, NW<->SE).
      const c0 = { col: 225, row: 224 }, p0 = cw(c0.col, c0.row), nbs: { x: number; y: number }[] = [];
      let min = Infinity;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { if (!dc && !dr) continue; const p = cw(c0.col + dc, c0.row + dr); min = Math.min(min, Math.hypot(p.x - p0.x, p.y - p0.y)); }
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { if (!dc && !dr) continue; const p = cw(c0.col + dc, c0.row + dr); if (Math.hypot(p.x - p0.x, p.y - p0.y) < min + 1e-6) nbs.push({ x: p.x - p0.x, y: p.y - p0.y }); }
      if (nbs.length !== 6) bad.push('neighbours ' + nbs.length);
      const eps = 1e-6;
      const upN = nbs.find(v => Math.abs(v.x) < eps && v.y < 0)!;       // N
      const upNE = nbs.find(v => v.x > eps && v.y < 0)!;                 // NE (screen y grows downwards)
      const upNW = nbs.find(v => v.x < -eps && v.y < 0)!;                // NW
      const dirOf = [upN, upNE, upNW];                                   // axis 0 N-S, 1 NE-SW, 2 NW-SE
      // classify a pixel vector back into an axis: vertical = 0; up-right / down-left = 1; up-left / down-right = 2
      const axisOf = (v: { x: number; y: number }) => Math.abs(v.x) < eps ? 0 : v.x * v.y < 0 ? 1 : 2;
      dirOf.forEach((v, a) => { if (axisOf(v) !== a) bad.push('classifier ' + a); });
      for (let rot = 0; rot < 6; rot++) for (const mh of [false, true]) for (const mv of [false, true]) {
        for (let a = 0; a < 3; a++) {
          mapData.fill('Plain_1'); bridgesData.length = 0; objectsData = {};
          mapData[224 * W + 225] = 'Road_Bridge_NEWS_1'; objectsData['225,224'] = 'Road_Bridge_NEWS_1';
          bridgesData.push({ col: 225, row: 224, axis: a });
          Selection.setCells([{ col: 225, row: 224 }]); Tools.copySelection();
          Tools.beginPaste(Clipboard.get()); Tools.setFloatTransform({ rot, mh, mv });
          Tools.dropFloat(100, 100);
          const want = axisOf(ref(dirOf[a], rot, mh, mv));
          const b = bridgesData.find((x: any) => x.col === 100 && x.row === 100);
          if (!b || b.axis !== want) bad.push(`axis ${a} ${rot}${mh}${mv}: want ${want} got ${b && b.axis}`);
          // building ids are NOT re-mapped: the bridge building keeps its orientation
          if (mapData[100 * W + 100] !== 'Road_Bridge_NEWS_1') bad.push(`terrain id ${a} ${rot}${mh}${mv}: ${mapData[100 * W + 100]}`);
          if (objectsData['100,100'] !== 'Road_Bridge_NEWS_1') bad.push(`object id ${a} ${rot}${mh}${mv}: ${objectsData['100,100']}`);
          Tools.setActive('paint');
        }
      }
      // an axis outside 0..2 is carried over unchanged
      mapData.fill('Plain_1'); bridgesData.length = 0; bridgesData.push({ col: 225, row: 224, axis: 7 });
      Selection.setCells([{ col: 225, row: 224 }]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); Tools.rotateFloat(1); Tools.dropFloat(100, 100);
      return { bad, odd: bridgesData.find((x: any) => x.col === 100 && x.row === 100).axis };
    });
    expect(r.bad).toEqual([]);
    expect(r.odd).toBe(7);
  });


  // ---------- directional water ---------------------------------------------------------------
  test('a transformed paste re-resolves EVERY water / river cell of the region (masks equal resolveEdgeTile on the final map)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
      const fallback = HexDB.getAll().find((h: any) => h.id === 'Water_1').id;
      const origRandom = Math.random; Math.random = () => 0.5;
      try {
        mapData.fill('Plain_1');
        const band: any[] = [];
        for (let row = 218; row <= 232; row++) band.push({ col: 225, row });                  // a one-cell-wide river: every river cell is INTERIOR to the copied rectangle
        for (const b of band) mapData[b.row * W + b.col] = rivers[0].id;
        Tools.autoResolveEdgesAround(band);
        Selection.setCells(Tools._rectCells(222, 215, 228, 235)); Tools.copySelection();
        const out: any = {};
        for (const [name, rot] of [['identity', 0], ['rot1', 1], ['rot2', 2]] as [string, number][]) {
          Tools.beginPaste(Clipboard.get()); Tools.rotateFloat(rot); Tools.dropFloat(100, 100);
          const placed = Selection.getCells();
          const cells = new Map<string, any>();
          for (const p of placed) { cells.set(p.col + ',' + p.row, p); for (const n of HexUtils.neighbors(p.col, p.row, W, H)) cells.set(n.col + ',' + n.row, n); }
          let checked = 0, bad = 0, dir = 0;
          for (const c of cells.values()) {
            const id = mapData[c.row * W + c.col], e = Terrain.byHexId(id);
            if (!e || !['Water', 'Rivers'].includes(e.type)) continue;                          // every water / river cell
            checked++; if (faces(id) !== '') dir++;
            if (faces(id) !== faces(EdgeTiling.resolveEdgeTile(c.col, c.row, W, H, mapData, ['Water', 'Rivers'], () => 0, [fallback]))) bad++;
          }
          out[name] = { checked, bad, dir, n: placed.length };
          Tools.setActive('paint'); History.undo();
          Selection.setCells(Tools._rectCells(222, 215, 228, 235));
        }
        return out;
      } finally { Math.random = origRandom; }
    });
    expect(r.rot1.checked).toBeGreaterThan(10); expect(r.rot1.dir).toBeGreaterThanOrEqual(8); expect(r.rot1.bad).toBe(0);
    expect(r.rot2.checked).toBeGreaterThan(10); expect(r.rot2.dir).toBeGreaterThanOrEqual(8); expect(r.rot2.bad).toBe(0);
    expect([r.identity.n, r.rot1.n, r.rot2.n]).toEqual([147, 147, 147]);   // 7 x 21 cells land each time
    expect(r.identity.checked).toBeGreaterThan(10); expect(r.identity.dir).toBeGreaterThanOrEqual(8);   // (an identity paste keeps copied interiors as before; at another row parity they may differ from a fresh resolve under K1, which is not this task's concern)
  });

  // ---------- multi-tile footprints -----------------------------------------------------------
  const FP = 'Rabbit_Flat_1';
  test('a rotated multi-tile anchor keeps its id and its REAL footprint at the destination (plan checks the destination footprint); clipped / overlapping ones are skipped', async ({ page }) => {
    await toastsOn(page);
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, id = (c: number, r: number) => mapData[r * W + c], entry = Terrain.byHexId(FP), res: any = {};
      mapData[200 * W + 200] = FP; invalidateSatelliteMap();
      const fp0 = footprintCells(200, 200, entry);
      Selection.setCells([{ col: 200, row: 200 }].concat(fp0)); Tools.copySelection();
      const buf = Clipboard.get();
      res.bufCells = buf.cells.length;
      const orphanCheck = () => { let o = 0; for (let r = 90; r <= 110; r++) for (let c = 90; c <= 110; c++) { const a = getSatelliteAnchor(c, r); if (a && !(Terrain.byHexId(id(a.col, a.row)) || {}).occupiedOffsets) o++; } return o; };
      res.ok = []; res.orphans = 0;
      for (let rot = 0; rot < 6; rot++) {
        Tools.beginPaste(buf); Tools.setFloatTransform({ rot, mh: true, mv: false }); Tools.dropFloat(100, 100);
        const real = footprintCells(100, 100, entry);
        res.ok.push(id(100, 100) === FP && real.every((f: any) => { const a = getSatelliteAnchor(f.col, f.row); return a && a.col === 100 && a.row === 100; }));
        res.orphans += orphanCheck();
        Tools.setActive('paint'); History.undo();
      }
      // clipped real footprint: target the corner
      Tools.beginPaste(buf); Tools.rotateFloat(3); Tools.dropFloat(0, 0); res.corner = id(0, 0); Tools.setActive('paint');
      // real footprint overlapping an existing anchor outside the paste
      mapData[150 * W + 150] = FP; invalidateSatelliteMap();
      Selection.setCells([{ col: 200, row: 200 }]); Tools.copySelection();
      const s0 = History.undoSize();
      Tools.beginPaste(Clipboard.get()); Tools.rotateFloat(2); Tools.dropFloat(150, 151); res.overlap = id(150, 151); res.steps = History.undoSize() - s0;
      Tools.setActive('paint');
      return res;
    }, FP);
    expect(r.bufCells).toBe(4);
    expect(r.ok).toEqual([true, true, true, true, true, true]);
    expect(r.orphans).toBe(0);
    expect(r.corner).toBe('Plain_1');
    expect(r.overlap).toBe('Plain_1');
    expect(r.steps).toBe(0);
  });

  test('a transformed paste containing multi-tile terrain toasts that it keeps its orientation; identity and plain pastes do not', async ({ page }) => {
    await toastsOn(page);
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, t = () => (window as any).__toasts.filter((x: string) => /orientation/i.test(x)).length;
      mapData[200 * W + 200] = FP; invalidateSatelliteMap();
      Selection.setCells([{ col: 200, row: 200 }]); Tools.copySelection();
      Tools.beginPaste(Clipboard.get()); Tools.dropFloat(100, 100); const a = t(); Tools.setActive('paint');
      Tools.beginPaste(Clipboard.get()); Tools.rotateFloat(1); Tools.dropFloat(60, 60); const b = t(); Tools.setActive('paint');
      Selection.setCells([{ col: 225, row: 224 }]); Tools.copySelection();
      Tools.beginPaste(Clipboard.get()); Tools.rotateFloat(1); Tools.dropFloat(80, 80); const c = t(); Tools.setActive('paint');
      return [a, b, c];
    }, FP);
    expect(r).toEqual([0, 1, 1]);
  });

  // ---------- ghost ---------------------------------------------------------------------------
  test('rotate / mirror keys update the ghost live: one ghost set per key, geometry built once per distinct transform (second lap builds nothing), cells equal the pixel reference', async ({ page }) => {
    await page.evaluate(() => { Selection.setCells(Tools._rectCells(222, 220, 225, 222)); Tools.copySelection(); Selection.clear(); Tools.beginPaste(Clipboard.get()); });
    const p = await cellPoint(page, 225, 214);
    await page.mouse.move(p.x - 2, p.y); await page.mouse.move(p.x, p.y);
    const s0 = await page.evaluate(() => Canvas.getGhostStats());
    for (let i = 0; i < 6; i++) await page.keyboard.press('.');
    const s1 = await page.evaluate(() => Canvas.getGhostStats());
    for (let i = 0; i < 6; i++) await page.keyboard.press('.');
    const s2 = await page.evaluate(() => Canvas.getGhostStats());
    expect(s1.sets - s0.sets).toBe(6);
    expect(s1.builds - s0.builds).toBe(5);                  // rot 1..5 are new; the sixth press returns to the cached identity geometry
    expect(s2.sets - s1.sets).toBe(6);
    expect(s2.builds - s1.builds).toBe(0);
    for (const [keys, rot, mh, mv] of [[['.'], 1, false, false], [['/'], 0, true, false], [[';', ','], 5, false, true]] as [string[], number, boolean, boolean][]) {
      await page.evaluate(() => Tools.setFloatTransform({ rot: 0, mh: false, mv: false }));
      for (const k of keys) await page.keyboard.press(k);
      const r = await page.evaluate(([rot, mh, mv]) => {
        const buf = Clipboard.get(), cw = Canvas.hexCenterWorld, o = buf.origin, po = cw(o.col, o.row), pt = cw(225, 214), ref = (window as any).__ref;
        const want = new Set<string>();
        for (const e of buf.cells) {
          const c = HexUtils.fromCube({ q: HexUtils.toCube(o.col, o.row, MAP_WIDTH, MAP_HEIGHT).q + e.dq, r: HexUtils.toCube(o.col, o.row, MAP_WIDTH, MAP_HEIGHT).r + e.dr, s: 0 }, MAP_WIDTH, MAP_HEIGHT);
          const ps = cw(c.col, c.row), v = ref({ x: ps.x - po.x, y: ps.y - po.y }, rot as number, mh as boolean, mv as boolean), x = pt.x + v.x, y = pt.y + v.y;
          let best: any = null, bd = 1e9;
          for (let col = 215; col <= 235; col++) for (let row = 205; row <= 225; row++) { const q = cw(col, row), d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = col + ',' + row; } }
          want.add(best);
        }
        const got = new Set(Canvas.getGhostCells().map((c: any) => c.col + ',' + c.row));
        return { same: want.size === got.size && [...want].every(k => got.has(k)), n: got.size, xf: Tools.getFloatTransform() };
      }, [rot, mh, mv]);
      expect(r.n).toBe(12);
      expect(r.same).toBe(true);
      expect(r.xf).toEqual({ rot, mh, mv });
    }
  });

  test('rotate / mirror shortcuts are only active while pasting, respect text fields and modals, and the old shortcuts are untouched', async ({ page }) => {
    for (const k of ['.', ',', '/', ';']) await page.keyboard.press(k);
    expect(await page.evaluate(() => Tools.getFloatTransform())).toBe(null);          // no float: nothing happens
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    expect(await page.evaluate(() => ['Period', 'Comma', 'Slash', 'Semicolon'].map(code => { const ev = new KeyboardEvent('keydown', { code, key: 'x', bubbles: true, cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; }))).toEqual([false, false, false, false]);   // the keys are not swallowed outside a float
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    await page.evaluate(() => { const i = document.getElementById('scatter-density')!; (i.closest('#scatter-row') as HTMLElement).style.display = 'block'; i.focus(); });
    for (const k of ['.', ',', '/', ';']) await page.keyboard.press(k);
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 0, mh: false, mv: false });
    await page.evaluate(() => { (document.activeElement as HTMLElement).blur(); const m = document.createElement('div'); m.id = 'zz-modal'; m.style.display = 'block'; document.body.appendChild(m); });
    await page.keyboard.press('.');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 0, mh: false, mv: false });
    await page.evaluate(() => document.getElementById('zz-modal')!.remove());
    await page.keyboard.press('Shift+.'); await page.keyboard.press('Alt+,');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 0, mh: false, mv: false });
    await page.keyboard.press('.'); await page.keyboard.press('/'); await page.keyboard.press(';'); await page.keyboard.press(';');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 5, mh: true, mv: false });   // screen mirrors: '.' then '/' = mirror, rotate -1; ';' twice cancels
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    expect(await page.evaluate(() => Tools.getActive())).toBe('fill');
  });

  test('palette buttons rotate and mirror, show only while pasting and leave the canvas size alone', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const size = () => page.evaluate(() => { const c = document.getElementById('map-canvas')!.getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height)]; });
    const s0 = await size();
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('paste-tools')!).display)).toBe('none');
    expect(await page.evaluate(() => !!document.getElementById('palette-panel')!.querySelector('#paste-tools'))).toBe(true);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('paste-tools')!).display)).not.toBe('none');
    expect(await size()).toEqual(s0);
    expect(s0).toEqual([1491, 808]);
    await page.click('#paste-tools [data-act="cw"]'); await page.click('#paste-tools [data-act="cw"]');
    await page.click('#paste-tools [data-act="ccw"]');
    await page.click('#paste-tools [data-act="mh"]'); await page.click('#paste-tools [data-act="mv"]');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 1, mh: true, mv: true });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('paste-tools')!).display)).toBe('none');
    expect(await size()).toEqual(s0);
  });

  test('undo / redo of a transformed paste restores all layers in ONE step', async ({ page }) => {
    await page.evaluate(() => {
      objectsData['225,224'] = 'Grain_1'; roadsData['225,224'] = { type: 'road_hex' }; bridgesData.push({ col: 225, row: 224, axis: 1 });
      tileExtras['225,224'] = { tag: 1 }; ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 225] = 3;
    });
    const base = await layers(page), s0 = await page.evaluate(() => History.undoSize());
    await pasteWith(page, ['.', '/']);
    const after = await layers(page);
    expect(after).not.toBe(base);
    expect(await page.evaluate(() => History.undoSize())).toBe(s0 + 1);
    await page.evaluate(() => { Tools.setActive('paint'); History.undo(); });
    expect(await layers(page)).toBe(base);
    await page.evaluate(() => History.redo());
    expect(await layers(page)).toBe(after);
  });

  // ---------- move ----------------------------------------------------------------------------
  test('moving onto the overlapping source region: read before write, pure translation, one step, vacated cells are blank, selection follows', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, cw = Canvas.hexCenterWorld;
      Selection.clear();
      const src = Tools._rectCells(222, 220, 225, 222);
      src.forEach((c: any, i: number) => { const k = c.col + ',' + c.row; mapData[c.row * W + c.col] = ['Water_1', 'Forest_1', 'Hills_1'][i % 3]; tileExtras[k] = { tag: i }; if (i % 2) objectsData[k] = 'Grain_1'; });
      Selection.setCells(src);
      const o = Clipboard.capture(src).origin, steps = History.undoSize();
      Tools.beginMove();
      const tgt = { col: o.col + 1, row: o.row };
      Tools.dropFloat(tgt.col, tgt.row);
      const pos = new Map<number, { col: number; row: number }>(), bad: string[] = [];
      for (const k in tileExtras) { const [c, rr] = k.split(',').map(Number); if (pos.has(tileExtras[k].tag)) bad.push('dup ' + tileExtras[k].tag); pos.set(tileExtras[k].tag, { col: c, row: rr }); }
      const po = cw(o.col, o.row), pt = cw(tgt.col, tgt.row);
      src.forEach((s: any, i: number) => {
        const d = pos.get(i); if (!d) { bad.push('lost ' + i); return; }
        const a = cw(s.col, s.row), b = cw(d.col, d.row);
        if (Math.abs((b.x - a.x) - (pt.x - po.x)) > 1e-6 || Math.abs((b.y - a.y) - (pt.y - po.y)) > 1e-6) bad.push('not a translation ' + i);
        if (mapData[d.row * W + d.col] !== ['Water_1', 'Forest_1', 'Hills_1'][i % 3] || (objectsData[d.col + ',' + d.row] === 'Grain_1') !== !!(i % 2)) bad.push('content ' + i);
      });
      const dst = new Set([...pos.values()].map(p => p.col + ',' + p.row));
      let vacated = 0;
      for (const s of src) { const k = s.col + ',' + s.row; if (dst.has(k)) continue; vacated++; if (mapData[s.row * W + s.col] !== 'Plain_1' || tileExtras[k] || objectsData[k]) bad.push('not blank ' + k); }
      const sel = Selection.getCells().map((c: any) => c.col + ',' + c.row).sort().join(), want = [...dst].sort().join();
      return { bad, n: pos.size, vacated, selOk: sel === want, steps: History.undoSize() - steps };
    });
    expect(r.bad).toEqual([]);
    expect(r.n).toBe(12); expect(r.vacated).toBeGreaterThan(0); expect(r.selOk).toBe(true); expect(r.steps).toBe(1);
  });

  test('moving with a rotation and a mirror applies the transform, clears the source, and undo restores everything', async ({ page }) => {
    const base = await layers(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('.'); await page.keyboard.press('/');
    await clickCell(page, 225, 219);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Plain_1');
    const { src, dst } = await vectors(page);
    const m = await page.evaluate(([vx, vy]) => (window as any).__ref({ x: vx, y: vy }, 5, true, false), [src.x, src.y]);
    expect(dst.x).toBeCloseTo(m.x, 4); expect(dst.y).toBeCloseTo(m.y, 4);
    await page.evaluate(() => History.undo());
    expect(await layers(page)).toBe(base);
  });

  test('a move dropped on its own source with no transform pushes no step', async ({ page }) => {
    const s0 = await page.evaluate(() => History.undoSize());
    const base = await layers(page);
    await page.keyboard.press('Enter');
    const o = await page.evaluate(() => Clipboard.capture(Selection.getCells()).origin);
    await clickCell(page, o.col, o.row);
    expect(await layers(page)).toBe(base);
    expect(await page.evaluate(() => [History.undoSize(), Selection.size(), Tools.getActive()])).toEqual([s0, 2, 'paint']);
  });

  test('a selection that covers only part of a footprint (no anchor) cannot be lifted; a move whose plan writes nothing rolls back completely and stays in move mode', async ({ page }) => {
    await toastsOn(page);
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, entry = Terrain.byHexId(FP), res: any = {};
      mapData[200 * W + 200] = FP; mapData[150 * W + 150] = FP; invalidateSatelliteMap();
      Selection.setCells(footprintCells(200, 200, entry));
      res.lifted = Tools.beginMove(); res.pasting = Tools.isPasting();
      Selection.setCells([{ col: 200, row: 200 }]);
      const base = JSON.stringify([mapData.join('|'), History.undoSize()]);
      res.begin = Tools.beginMove();
      res.n = Tools.dropFloat(150, 151);                                   // real footprint overlaps the anchor at 150,150: nothing can be written
      res.same = JSON.stringify([mapData.join('|'), History.undoSize()]) === base;
      res.still = Tools.isMoving();
      return res;
    }, FP);
    expect(r).toEqual({ lifted: false, pasting: false, begin: true, n: 0, same: true, still: true });
    expect(await page.evaluate(() => (window as any).__toasts.some((t: string) => /nothing to move|cannot place|can't place/i.test(t)))).toBe(true);
  });

  test('moving input handling: side buttons never drop, tool switch cancels, a map replacement cancels with a toast, undo is ignored, a running fill blocks the drop', async ({ page }) => {
    await toastsOn(page);
    const base = await layers(page);
    await page.keyboard.press('Enter');
    const n = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 219);
      const ev = (type: string, b: number) => cv.dispatchEvent(new MouseEvent(type, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: b, buttons: type === 'mouseup' ? 0 : 1 << b, bubbles: true }));
      for (const b of [1, 2, 3, 4]) { ev('mousedown', b); ev('mouseup', b); }
      return mapData.filter(x => x === 'Water_1').length;
    });
    expect(n).toBe(1);
    expect(await layers(page)).toBe(base);
    await page.evaluate(() => History.undo());                           // undo mid-move is ignored (the lifted content must match the map)
    expect(await page.evaluate(() => Tools.isMoving())).toBe(true);
    // a running fill blocks the drop
    const busy = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1'); Tools.fill(10, 10);
      const b = Tools.isFillBusy(), cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(225, 219);
      cv.dispatchEvent(new MouseEvent('mousedown', { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true }));
      cv.dispatchEvent(new MouseEvent('mouseup', { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 0, bubbles: true }));
      const moved = mapData[219 * MAP_WIDTH + 225] === 'Water_1';
      await Tools.whenIdle();
      return { b, moved };
    });
    expect(busy).toEqual({ b: true, moved: false });
    await page.keyboard.press('p');                                       // tool switch cancels, writes nothing
    expect(await page.evaluate(() => [Tools.isMoving(), Tools.isPasting(), mapData[224 * MAP_WIDTH + 225]])).toEqual([false, false, 'Water_1']);
    await page.evaluate(() => { Selection.setCells([{ col: 225, row: 224 }]); });
    await page.keyboard.press('Enter');
    await resize(page, 450, 450);
    await page.evaluate(() => UI.selectTerrain('Plain_1'));     // the click after the cancel is a Paint click: paint what is already there
    const before = await layers(page);
    await clickCell(page, 225, 219);
    expect(await layers(page)).toBe(before);
    expect(await page.evaluate(() => (window as any).__toasts.some((t: string) => /map changed/i.test(t)))).toBe(true);
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
  });
});


// ====================================================================================================
// T2.10 fix round 1
// ====================================================================================================
test.describe('transform and move: fix round 1 (T2.10)', () => {
  const FP = 'Rabbit_Flat_1';
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await toastsOn(page);
    await page.evaluate(() => {
      (window as any).__ref = (v: { x: number; y: number }, rot: number, mh: boolean, mv: boolean) => {
        const x = mh ? -v.x : v.x, y = mv ? -v.y : v.y, a = Math.PI / 3 * rot, cs = Math.cos(a), sn = Math.sin(a);
        return { x: x * cs - y * sn, y: x * sn + y * cs };
      };
    });
  });
  const snap = (page: Page) => page.evaluate(() => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') }));
  const toasts = (page: Page) => page.evaluate(() => (window as any).__toasts as string[]);
  /** A 5 x 4 block of varied content, selected (cells 222..226 x 220..223). */
  const seedBlock = (page: Page) => page.evaluate(() => {
    const W = MAP_WIDTH, cells = Tools._rectCells(222, 220, 226, 223);
    cells.forEach((c: any, i: number) => { mapData[c.row * W + c.col] = ['Water_1', 'Forest_1', 'Hills_1'][i % 3]; if ((c.col + c.row) % 2 === 0) objectsData[c.col + ',' + c.row] = 'Grain_1'; });
    Selection.setCells(cells);
    return cells.length;
  });

  // ---------- I2: Enter in a field that blurs itself ---------------------------------------------
  for (const id of ['scatter-density', 'scatter-seed']) {
    test(`Enter in #${id} (which blurs itself) does not lift the selection`, async ({ page }) => {
      await seedBlock(page);
      await page.evaluate(() => Tools.setActive('scatter'));
      const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
      await page.fill('#' + id, id === 'scatter-density' ? '60' : '123');
      await page.press('#' + id, 'Enter');
      expect(await page.evaluate(() => [Tools.getActive(), Tools.isPasting(), Tools.isMoving(), History.undoSize(), Selection.size()])).toEqual(['scatter', false, false, s0, 20]);
      expect(await snap(page)).toBe(base);
    });
  }

  test('Enter on a self-blurring field target that is not in the DOM focus path (zone-config-name keydown) does not lift', async ({ page }) => {
    await seedBlock(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById('zone-config-name') as HTMLElement;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return { ok: !!el, moving: Tools.isMoving(), pasting: Tools.isPasting() };
    });
    expect(r).toEqual({ ok: true, moving: false, pasting: false });
  });

  test('Enter on a focused input[type=button] activates it and does not lift; the transform keys ignore a text-field target too', async ({ page }) => {
    await seedBlock(page);
    await page.evaluate(() => {
      const b = document.createElement('input'); b.type = 'button'; b.id = 'zz-btn'; (window as any).__clicks = 0;
      b.onclick = () => { (window as any).__clicks++; };
      document.body.appendChild(b); b.focus();
    });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [(window as any).__clicks, Tools.isMoving(), Tools.isPasting()])).toEqual([1, false, false]);
    // a text field target blurring itself on a transform key must not rotate a float either
    await page.evaluate(() => { document.getElementById('zz-btn')!.remove(); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    const rot = await page.evaluate(() => {
      const i = document.createElement('input'); i.id = 'zz-txt'; i.onkeydown = () => i.blur(); document.body.appendChild(i); i.focus();
      i.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period', bubbles: true }));
      const x = Tools.getFloatTransform(); i.remove(); return x;
    });
    expect(rot).toEqual({ rot: 0, mh: false, mv: false });
  });

  test('a focusable container (tabindex=-1 div) does not disable Enter-lift or the transform keys; a role=button and a building card still own Enter (cleanup A2)', async ({ page }) => {
    await seedBlock(page);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'zz-box'; d.tabIndex = -1; document.body.appendChild(d); d.focus(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isMoving())).toBe(true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { Tools.copySelection(); Tools.beginPaste(Clipboard.get()); document.getElementById('zz-box')!.focus(); });
    await page.keyboard.press('Period');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 1, mh: false, mv: false });
    // positive controls: Enter on a role=button element is that element's key
    await page.evaluate(() => { Tools.setActive('paint'); const b = document.createElement('div'); b.id = 'zz-rb'; b.tabIndex = 0; b.setAttribute('role', 'button'); document.body.appendChild(b); b.focus(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
  });

  // ---------- I3: in-place writers while a region is lifted ---------------------------------------
  const lift = (page: Page) => page.evaluate(() => { const ok = Tools.beginMove(); return ok && Tools.isMoving(); });
  async function writerCase(page: Page, run: () => Promise<void>) {
    expect(await lift(page)).toBe(true);
    const s0 = await page.evaluate(() => History.undoSize());
    await run();
    const after = await snap(page), s1 = await page.evaluate(() => History.undoSize());
    expect(s1 - s0).toBe(1);                                              // the writer's own step only
    expect(await page.evaluate(() => Tools.isMoving() || Tools.isPasting())).toBe(false);   // the lift is cancelled at once
    await page.evaluate(() => Tools.dropFloat(225, 190));                 // a stale drop writes nothing
    expect(await snap(page)).toBe(after);
    expect(await page.evaluate(() => History.undoSize())).toBe(s1);
  }
  test('Clear Map while a region is lifted cancels the lift: a later drop writes nothing and adds no step', async ({ page }) => {
    await seedBlock(page);
    await writerCase(page, () => page.evaluate(() => { UI.showConfirm = (_t: string, _m: string, ok: () => void) => ok(); IO.clearMap(); }));
  });
  test('Fill Map while a region is lifted cancels the lift', async ({ page }) => {
    await seedBlock(page);
    await writerCase(page, () => page.evaluate(() => { UI.showConfirm = (_t: string, _m: string, ok: () => void) => ok(); UI.selectTerrain('Desert_1'); IO.fillMap(); }));
  });
  test('the QA tile placer while a region is lifted cancels the lift', async ({ page }) => {
    await seedBlock(page);
    await page.evaluate(() => { Selection.setCells(Tools._rectCells(223, 222, 227, 226)); });   // right next to the city, where the placer writes
    await writerCase(page, () => page.evaluate(() => Dev.qaPlaceAllTiles()));
  });
  test('applying a satellite classification while a region is lifted cancels the lift', async ({ page }) => {
    await seedBlock(page);
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!;
      for (let j = 0; j < 64; j += 8) for (let i = 0; i < 64; i += 8) { x.fillStyle = `hsl(${(i * 7 + j * 3) % 360},${30 + (i % 5) * 12}%,${15 + (j % 7) * 10}%)`; x.fillRect(i, j, 8, 8); }
      return c.toDataURL('image/png');
    });
    await page.evaluate(() => Satellite.open());
    await page.locator('#sat-modal input[type=file]').setInputFiles({ name: 'sat.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
    await page.waitForFunction(() => !(document.getElementById('sat-apply-btn') as HTMLButtonElement).disabled);
    await writerCase(page, () => page.evaluate(() => Satellite.apply()));
  });

  // The drop itself revalidates the lifted cells against the map (writers that do not cancel, or any other in-place edit).
  const mutations = ['terrain id', 'an object appears', 'an object id changes', 'a road appears', 'a bridge appears', 'extras appear', 'a zone is painted'];
  const mutate = (page: Page, name: string) => page.evaluate((name) => {
    const W = MAP_WIDTH;
    if (name === 'terrain id') mapData[220 * W + 222] = 'Desert_1';
    else if (name === 'an object appears') objectsData['223,220'] = 'Grain_1';              // (223,220): no object after seedBlock
    else if (name === 'an object id changes') objectsData['222,220'] = 'Grain_2';        // (222,220) holds Grain_1 after seedBlock
    else if (name === 'a road appears') roadsData['224,221'] = { type: 'dirt' };
    else if (name === 'a bridge appears') bridgesData.push({ col: 225, row: 221, axis: 1 });
    else if (name === 'extras appear') tileExtras['226,221'] = { tag: 1 };
    else if (name === 'a zone is painted') ZonePainter.getZoneLayer()[222 * W + 224] = 3;
    else throw new Error(name);
  }, name);
  for (const name of mutations) {
    test(`drop-time revalidation: ${name} in the lifted region behind the float cancels the move (toast, nothing written, no step)`, async ({ page }) => {
      await seedBlock(page);
      expect(await lift(page)).toBe(true);
      const s0 = await page.evaluate(() => History.undoSize());
      await mutate(page, name);
      const base = await snap(page);
      const n = await page.evaluate(() => Tools.dropFloat(225, 190));
      expect(n).toBe(0);
      expect(await snap(page)).toBe(base);
      expect(await page.evaluate(() => [History.undoSize(), Tools.isMoving(), Tools.isPasting()])).toEqual([s0, false, false]);
      expect((await toasts(page)).some(t => /map changed while the region was lifted/i.test(t))).toBe(true);
    });
  }
  test('an edit OUTSIDE the lifted cells does not cancel the move', async ({ page }) => {
    await seedBlock(page);
    expect(await lift(page)).toBe(true);
    const n = await page.evaluate(() => { mapData[300 * MAP_WIDTH + 300] = 'Desert_1'; return Tools.dropFloat(225, 190); });
    expect(n).toBe(20);
    expect(await page.evaluate(() => Tools.isMoving())).toBe(false);
  });

  // ---------- I4: a move dropped partly off the map ------------------------------------------------
  test('a move dropped on the map corner tells how many cells fell off the map; undo restores them', async ({ page }) => {
    const n = await seedBlock(page);
    const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
    expect(await lift(page)).toBe(true);
    await page.evaluate(() => Tools.dropFloat(1, 1));
    const written = await page.evaluate(() => Selection.size());
    expect(written).toBeGreaterThan(0); expect(written).toBeLessThan(n);
    const t = (await toasts(page)).find(x => /fell off the map/i.test(x));
    expect(t).toBeTruthy();
    expect(Number(/(\d+) cells? fell off/.exec(t!)![1])).toBe(n - written);
    expect(await page.evaluate(() => History.undoSize())).toBe(s0 + 1);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(base);
  });
  test('a move that keeps every cell does not toast about lost cells', async ({ page }) => {
    await seedBlock(page);
    expect(await lift(page)).toBe(true);
    await page.evaluate(() => Tools.dropFloat(225, 190));
    expect((await toasts(page)).filter(x => /fell off|skipped/i.test(x))).toEqual([]);
  });
  test('a rotated move that loses cells AND keeps a multi-tile anchor shows both the lost-cells and the orientation toast', async ({ page }) => {
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT, cells = HexUtils.discCells(200, 200, 4, W, H);
      cells.forEach((c: any) => { mapData[c.row * W + c.col] = 'Forest_1'; });
      mapData[200 * W + 200] = FP; invalidateSatelliteMap();
      Selection.setCells(cells);
      Tools.beginMove(); Tools.rotateFloat(1); Tools.dropFloat(2, 2);
      const t = (window as any).__toasts as string[];
      return { n: cells.length, sel: Selection.size(), t, anchor: mapData[2 * W + 2] };
    }, 'Rabbit_Flat_1');
    expect(r.anchor).toBe('Rabbit_Flat_1');
    const lost = r.t.find(x => /fell off the map/i.test(x));
    expect(lost).toBeTruthy();
    expect(Number(/(\d+) cells? fell off/.exec(lost!)![1])).toBe(r.n - 3 - r.sel);     // the 3 satellite cells are not carried (anchor + derived footprint), they are not "lost"
    expect(r.t.some(x => /orientation/i.test(x))).toBe(true);
  });

  // ---------- Minor 1: multi-tile footprints under a transform ------------------------------------
  test('a transformed move / paste of an anchor with its footprint writes only the anchor: no stray terrain at the rotated footprint cells', async ({ page }) => {
    const r = await page.evaluate((FP) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT, entry = Terrain.byHexId(FP), out: any[] = [];
      const src = HexUtils.discCells(200, 200, 1, W, H);
      src.forEach((c: any) => { mapData[c.row * W + c.col] = 'Forest_1'; });
      mapData[200 * W + 200] = FP; invalidateSatelliteMap();
      const fp = footprintCells(200, 200, entry);
      Selection.setCells([{ col: 200, row: 200 }].concat(fp)); Tools.copySelection();
      const buf = Clipboard.get();
      for (const [rot, mh] of [[0, false], [1, false], [2, true], [3, false], [4, true], [5, false]] as [number, boolean][]) {
        const area = HexUtils.discCells(100, 100, 3, W, H);
        area.forEach((c: any) => { mapData[c.row * W + c.col] = 'Desert_1'; });
        invalidateSatelliteMap();
        Tools.beginPaste(buf); Tools.setFloatTransform({ rot, mh, mv: false }); Tools.dropFloat(100, 100);
        const other = area.filter((c: any) => mapData[c.row * W + c.col] !== 'Desert_1');
        const real = footprintCells(100, 100, entry);
        out.push({ rot, mh, others: other.map((c: any) => c.col + ',' + c.row + ':' + mapData[c.row * W + c.col]), fpOk: real.every((f: any) => { const a = getSatelliteAnchor(f.col, f.row); return a && a.col === 100 && a.row === 100; }) });
        Tools.setActive('paint'); History.undo();
      }
      return out;
    }, FP);
    for (const o of r) {
      if (o.rot === 0 && !o.mh) continue;       // identity: the satellite cells land on the footprint and are the same plain terrain
      expect(o.others, `rot ${o.rot} mh ${o.mh}`).toEqual(['100,100:Rabbit_Flat_1']);
      expect(o.fpOk).toBe(true);
    }
  });

  // ---------- Minor 2: geometry cache ------------------------------------------------------------
  test('geometry cache: equivalent transforms share one entry (mh+mv = rot 3, mv = mh + rot 3) and each buffer keeps at most 6 geometries', async ({ page }) => {
    const r = await page.evaluate(() => {
      Selection.setCells(Tools._rectCells(222, 220, 225, 222)); Tools.copySelection();
      const buf = Clipboard.get(), g = (rot: number, mh: boolean, mv: boolean) => Clipboard.ghostGeometry(buf, { rot, mh, mv });
      const res: any = {};
      res.hvIsRot3 = g(0, true, true) === g(3, false, false);
      res.hvRot = g(2, true, true) === g(5, false, false);
      res.vIsHRot3 = g(1, false, true) === g(4, true, false);
      res.identity = Clipboard.ghostGeometry(buf, null) === g(0, false, false) && g(6, false, false) === g(0, false, false);
      const b3 = JSON.parse(JSON.stringify(buf)), objs: any[] = [];
      for (let rot = 0; rot < 6; rot++) for (const mh of [false, true]) objs.push(Clipboard.ghostGeometry(b3, { rot, mh, mv: false }));
      res.cacheSize = Clipboard._geomCacheSize(b3);
      const last = objs[objs.length - 1];
      res.recentHit = Clipboard.ghostGeometry(b3, { rot: 5, mh: true, mv: false }) === last;      // most recent stays cached
      res.evictedRebuilt = Clipboard.ghostGeometry(b3, { rot: 0, mh: false, mv: false }) !== objs[0];   // the oldest was evicted, a new (equal) geometry is built
      res.evictedEqual = (() => { const a = Clipboard.ghostGeometry(b3, { rot: 0, mh: false, mv: false }); return a.n === objs[0].n && a.segs.length === objs[0].segs.length && a.dq.every((v: number, i: number) => v === objs[0].dq[i]); })();
      res.cacheAfter = Clipboard._geomCacheSize(b3);
      return res;
    });
    expect(r).toEqual({ hvIsRot3: true, hvRot: true, vIsHRot3: true, identity: true, cacheSize: 6, recentHit: true, evictedRebuilt: true, evictedEqual: true, cacheAfter: 6 });
  });

  // ---------- Minor 5: palette visibility at 1100 x 700 -------------------------------------------
  test('at 1100x700 the move button and the four transform buttons are visible inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await seedBlock(page);
    await expect(page.locator('#selection-move')).toBeVisible();
    await expect(page.locator('#selection-move')).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    for (const a of ['ccw', 'cw', 'mh', 'mv']) {
      const b = page.locator(`#paste-tools [data-act="${a}"]`);
      await expect(b).toBeVisible();
      await expect(b).toBeInViewport({ ratio: 1 });
    }
    await page.click('#paste-tools [data-act="cw"]');
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 1, mh: false, mv: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 2 (T2.10): zone / road of multi-tile footprint cells travel under a transform; identity-equivalent
// transforms are the identity; the drop-time signature sees road type, extras content and bridge axis.
// ---------------------------------------------------------------------------------------------------------------
test.describe('transform and move: fix round 2 (T2.10)', () => {
  const FP = 'Rabbit_Flat_1';
  test.beforeEach(async ({ page }) => { await freshEditor(page); await toastsOn(page); });
  const snap = (page: Page) => page.evaluate(() => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, x: tileExtras, z: Array.from(ZonePainter.getZoneLayer()).join('') }));
  const toasts = (page: Page) => page.evaluate(() => (window as any).__toasts as string[]);

  /** Seeds a Rabbit_Flat_1 anchor at (200,200) in a Forest disc, zones / roads / objects / bridge / extras on its footprint
   *  cells and an ordinary zone on a plain neighbour. Selects the disc. Returns the cell lists (strings "col,row"). */
  const seed = (page: Page, withLost: boolean) => page.evaluate(([FP, withLost]) => {
    const W = MAP_WIDTH, H = MAP_HEIGHT, entry = Terrain.byHexId(FP as string);
    const disc = HexUtils.discCells(200, 200, 3, W, H);
    disc.forEach((c: any) => { mapData[c.row * W + c.col] = 'Forest_1'; });
    mapData[200 * W + 200] = FP as string; invalidateSatelliteMap();
    const fp = footprintCells(200, 200, entry), zl = ZonePainter.getZoneLayer();
    fp.forEach((f: any, i: number) => { if (i !== 1) zl[f.row * W + f.col] = 3 + i; });   // fp[1]: road only (no zone)
    zl[200 * W + 200] = 2;
    roadsData[fp[0].col + ',' + fp[0].row] = { type: 'road_hex', tag: 'a' };
    roadsData[fp[2].col + ',' + fp[2].row] = { type: 'road_hex', tag: 'b' };
    roadsData[fp[1].col + ',' + fp[1].row] = { type: 'road_hex', tag: 'c' };
    const plainN = disc.find((c: any) => !(c.col === 200 && c.row === 200) && !fp.some((f: any) => f.col === c.col && f.row === c.row));
    zl[plainN.row * W + plainN.col] = 9; roadsData[plainN.col + ',' + plainN.row] = { type: 'road_hex', tag: 'n' };
    if (withLost) {
      objectsData[fp[1].col + ',' + fp[1].row] = 'Grain_1';
      bridgesData.push({ col: fp[2].col, row: fp[2].row, axis: 1 });
      tileExtras[fp[0].col + ',' + fp[0].row] = { under: 'Water_1' };
    }
    // data far away from the move: must never change
    zl[300 * W + 300] = 11; roadsData['300,300'] = { type: 'road_hex', tag: 'far' }; mapData[300 * W + 300] = 'Desert_1';
    Selection.setCells(disc);
    return { fp: fp.map((f: any) => f.col + ',' + f.row), plain: plainN.col + ',' + plainN.row };
  }, [FP, withLost] as [string, boolean]);

  /** Independent expectation: for every source cell, its destination under (rot, mh, mv) found from PIXEL geometry. */
  const expectedDest = (page: Page, keys: string[], origin: { col: number; row: number }, drop: { col: number; row: number }, xf: { rot: number; mh: boolean; mv: boolean }) => page.evaluate(([keys, o, d, xf]: any) => {
    const W = MAP_WIDTH, H = MAP_HEIGHT, c0 = Canvas.hexCenterWorld(o.col, o.row), d0 = Canvas.hexCenterWorld(d.col, d.row);
    const ref = (v: { x: number; y: number }) => {
      const x = xf.mh ? -v.x : v.x, y = xf.mv ? -v.y : v.y, a = Math.PI / 3 * xf.rot, cs = Math.cos(a), sn = Math.sin(a);
      return { x: x * cs - y * sn, y: x * sn + y * cs };
    };
    const area = HexUtils.discCells(d.col, d.row, 8, W, H), out: Record<string, string> = {};
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number), p = Canvas.hexCenterWorld(c, r), v = ref({ x: p.x - c0.x, y: p.y - c0.y });
      const hit = area.find((a: any) => { const q = Canvas.hexCenterWorld(a.col, a.row); return Math.abs(q.x - d0.x - v.x) < 1e-3 && Math.abs(q.y - d0.y - v.y) < 1e-3; });
      out[k] = hit ? hit.col + ',' + hit.row : 'none';
    }
    return out;
  }, [keys, origin, drop, xf]);

  const XFS: { rot: number; mh: boolean; mv: boolean }[] = [{ rot: 1, mh: false, mv: false }, { rot: 2, mh: true, mv: false }, { rot: 4, mh: false, mv: true }, { rot: 5, mh: true, mv: true }];
  const lay = (page: Page, key: string) => page.evaluate((key) => { const [c, r] = key.split(',').map(Number); return { z: ZonePainter.getZoneLayer()[r * MAP_WIDTH + c], rd: (roadsData[key] || {}).tag || null, o: objectsData[key] || null, x: !!tileExtras[key], b: bridgesData.some((b: any) => b.col === c && b.row === r) }; }, key);

  for (const xf of XFS) {
    test(`a rotated / mirrored MOVE carries zones and roads of footprint cells to their transformed cells (rot ${xf.rot}, mh ${xf.mh}, mv ${xf.mv}); one step; nothing else changes`, async ({ page }) => {
      const s = await seed(page, false);
      const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
      const origin = await page.evaluate(() => Clipboard.capture(Selection.getCells()).origin);
      const drop = { col: 150, row: 150 };
      const dest = await expectedDest(page, [...s.fp, s.plain, '200,200'], origin, drop, xf);
      expect(Object.values(dest).every(v => v !== 'none')).toBe(true);
      const farBase = await page.evaluate(() => [ZonePainter.getZoneLayer()[300 * MAP_WIDTH + 300], JSON.stringify(roadsData['300,300']), mapData[300 * MAP_WIDTH + 300]]);
      await page.evaluate((xf) => { Tools.beginMove(); Tools.setFloatTransform(xf); Tools.dropFloat(150, 150); }, xf);
      // zones (ids 3,4,5 on the footprint cells, 2 on the anchor, 9 on the plain neighbour)
      expect(await lay(page, dest[s.fp[0]])).toMatchObject({ z: 3, rd: 'a' });
      expect(await lay(page, dest[s.fp[1]])).toMatchObject({ z: 0, rd: 'c' });
      expect(await lay(page, dest[s.fp[2]])).toMatchObject({ z: 5, rd: 'b' });
      expect(await lay(page, dest[s.plain])).toMatchObject({ z: 9, rd: 'n' });
      expect(await lay(page, dest['200,200'])).toMatchObject({ z: 2 });
      expect(await lay(page, '150,150')).toMatchObject({ z: 2 });       // the anchor lands on the drop cell
      // the source is vacated, the far data is untouched, no object / bridge appeared
      for (const k of [...s.fp, '200,200', s.plain]) expect(await lay(page, k)).toMatchObject({ z: 0, rd: null });
      expect(await page.evaluate(() => [ZonePainter.getZoneLayer()[300 * MAP_WIDTH + 300], JSON.stringify(roadsData['300,300']), mapData[300 * MAP_WIDTH + 300]])).toEqual(farBase);
      expect(await page.evaluate(() => [History.undoSize(), mapData[150 * MAP_WIDTH + 150]])).toEqual([s0 + 1, FP]);
      await page.evaluate(() => History.undo());
      expect(await snap(page)).toBe(base);
    });
  }

  test('objects, bridges and extras on footprint cells cannot follow a fixed-orientation footprint: they are dropped, counted in a toast, restored by undo; zone and road still travel', async ({ page }) => {
    const s = await seed(page, true);
    const base = await snap(page);
    const origin = await page.evaluate(() => Clipboard.capture(Selection.getCells()).origin);
    const xf = { rot: 1, mh: false, mv: false };
    const dest = await expectedDest(page, s.fp, origin, { col: 150, row: 150 }, xf);
    await page.evaluate((xf) => { Tools.beginMove(); Tools.setFloatTransform(xf); Tools.dropFloat(150, 150); }, xf);
    expect(await page.evaluate(() => [Object.keys(objectsData).filter(k => objectsData[k] === 'Grain_1').length, bridgesData.length, Object.keys(tileExtras).length])).toEqual([0, 0, 0]);
    expect(await lay(page, dest[s.fp[0]])).toMatchObject({ z: 3, rd: 'a', x: false });
    expect(await lay(page, dest[s.fp[2]])).toMatchObject({ z: 5, rd: 'b', b: false });
    const t = (await toasts(page)).find(x => /multi-tile footprints were not carried/.test(x));
    expect(t).toMatch(/^3 objects\/bridges\/extras on multi-tile footprints were not carried/);
    expect((await toasts(page)).some(x => /fell off|skipped/.test(x))).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(base);
  });

  test('a transformed PASTE carries zone and road of footprint cells too (source intact, one step), and reports dropped objects', async ({ page }) => {
    const s = await seed(page, true);
    const origin = await page.evaluate(() => { Tools.copySelection(); return Clipboard.get().origin; });
    const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
    const xf = { rot: 2, mh: true, mv: false };
    const dest = await expectedDest(page, [...s.fp, '200,200'], origin, { col: 150, row: 150 }, xf);
    await page.evaluate((xf) => { Tools.beginPaste(Clipboard.get()); Tools.setFloatTransform(xf); Tools.dropFloat(150, 150); }, xf);
    expect(await lay(page, dest[s.fp[0]])).toMatchObject({ z: 3, rd: 'a' });
    expect(await lay(page, dest[s.fp[1]])).toMatchObject({ z: 0, rd: 'c' });
    expect(await lay(page, dest[s.fp[2]])).toMatchObject({ z: 5, rd: 'b' });
    expect(await lay(page, s.fp[0])).toMatchObject({ z: 3, rd: 'a' });           // the source is untouched
    expect(await page.evaluate(() => History.undoSize())).toBe(s0 + 1);
    expect((await toasts(page)).some(x => /^3 objects\/bridges\/extras on multi-tile footprints were not carried/.test(x))).toBe(true);
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(base);
  });

  test('an identity-EQUIVALENT transform (/ ; and . x3 = rot 3 + both mirrors) behaves as no transform: dropped where it was = nothing, no orientation toast', async ({ page }) => {
    await seed(page, false);
    const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
    await page.keyboard.press('Enter');
    for (const k of ['/', ';', '.', '.', '.']) await page.keyboard.press(k);
    expect(await page.evaluate(() => Tools.getFloatTransform())).toEqual({ rot: 3, mh: true, mv: true });
    const o = await page.evaluate(() => Clipboard.capture(Selection.getCells()).origin);
    expect(await page.evaluate(([c, r]) => Tools.dropFloat(c, r), [o.col, o.row])).toBe(0);
    expect(await snap(page)).toBe(base);
    expect(await page.evaluate(() => [History.undoSize(), Tools.isMoving(), Tools.isPasting()])).toEqual([s0, false, false]);
    expect((await toasts(page)).filter(x => /orientation|not carried|fell off/.test(x))).toEqual([]);
  });

  test('an identity-equivalent move to ANOTHER cell is a pure translation: footprint cells keep zone and road at the translated cells, no orientation toast', async ({ page }) => {
    const s = await seed(page, false);
    const origin = await page.evaluate(() => Clipboard.capture(Selection.getCells()).origin);
    const dest = await expectedDest(page, s.fp, origin, { col: 150, row: 150 }, { rot: 0, mh: false, mv: false });
    await page.evaluate(() => { Tools.beginMove(); Tools.setFloatTransform({ rot: 3, mh: true, mv: true }); Tools.dropFloat(150, 150); });
    expect(await lay(page, dest[s.fp[0]])).toMatchObject({ z: 3, rd: 'a' });
    expect(await lay(page, dest[s.fp[2]])).toMatchObject({ z: 5, rd: 'b' });
    expect((await toasts(page)).filter(x => /orientation|not carried/.test(x))).toEqual([]);
  });

  // ---- drop-time signature: road type, extras content, bridge axis ------------------------------------
  const sigCases: [string, string][] = [
    ['a road changes its TYPE (presence unchanged)', `roadsData['222,220'] = { type: 'other_road' }`],
    ['extras change their CONTENT (presence unchanged)', `tileExtras['223,220'] = { under: 'Desert_1' }`],
    ['a bridge changes its AXIS (presence unchanged)', `bridgesData.find(b => b.col === 224 && b.row === 220).axis = 2`],
  ];
  for (const [name, code] of sigCases) {
    test(`drop-time signature: ${name} behind the float cancels the move`, async ({ page }) => {
      await page.evaluate(() => {
        const cells = Tools._rectCells(222, 220, 226, 222);
        roadsData['222,220'] = { type: 'road_hex' }; tileExtras['223,220'] = { under: 'Water_1' }; bridgesData.push({ col: 224, row: 220, axis: 0 });
        Selection.setCells(cells);
      });
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => Tools.isMoving())).toBe(true);
      await page.evaluate(new Function(code) as any);
      const base = await snap(page), s0 = await page.evaluate(() => History.undoSize());
      expect(await page.evaluate(() => Tools.dropFloat(225, 190))).toBe(0);
      expect(await snap(page)).toBe(base);
      expect(await page.evaluate(() => History.undoSize())).toBe(s0);
      expect((await toasts(page)).some(t => /map changed while the region was lifted/i.test(t))).toBe(true);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Replace X with Y (T2.11)
// ════════════════════════════════════════════════════════════════════════════════════════════════
test.describe('replace (T2.11)', () => {
  const RB = 'Rabbit_Flat_1', DR = 'Dragon_Flat_1';   // multi-tile anchors with 3 and 6 satellite offsets
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(() => {
      const W = MAP_WIDTH;
      for (const [c, r] of [[225, 224], [226, 224], [227, 224], [225, 230], [226, 230]]) mapData[r * W + c] = 'Rubble_1';
      Selection.setCells([{ col: 225, row: 224 }, { col: 226, row: 224 }, { col: 227, row: 224 }]);
    });
  });
  const rubble = (page: Page) => page.evaluate(() => mapData.filter((x: string) => x === 'Rubble_1').length);
  const snapshot = (page: Page) => page.evaluate(() => mapData.join('|'));
  const steps = (page: Page) => page.evaluate(() => History.undoSize());
  const open = async (page: Page, from: string, to: string, selOnly: boolean) => {
    await page.evaluate(() => Tools.openReplace());
    await page.fill('#replace-from', from);
    await page.fill('#replace-to', to);
    await page.locator('#replace-sel-only').setChecked(selOnly);
  };
  /** satellite cells registered to the anchor at (c,r), found by scanning a window (independent of footprintCells) */
  const satsOf = (page: Page, c: number, r: number) => page.evaluate(([c, r]) => {
    const out: string[] = [];
    for (let rr = r - 4; rr <= r + 4; rr++) for (let cc = c - 4; cc <= c + 4; cc++) { const a = getSatelliteAnchor(cc, rr); if (a && a.col === c && a.row === r) out.push(cc + ',' + rr); }
    return out.sort();
  }, [c, r]);
  /** the shared footprint definition (footprintCells) applied to the live anchor; the registered satellites must be exactly these */
  const sharedFp = (page: Page, c: number, r: number) => page.evaluate(([c, r]) => {
    const e = Terrain.byHexId(mapData[r * MAP_WIDTH + c]);
    return footprintCells(c, r, e).map((f: any) => f.col + ',' + f.row).sort();
  }, [c, r]);
  /** pixel reference: every registered satellite is exactly one hex pitch (centre to centre) from its anchor */
  const pitchOk = (page: Page, c: number, r: number) => page.evaluate(([c, r]) => {
    const a = Canvas.hexCenterWorld(c, r), pitch = Math.sqrt(3) * 40;
    const sats: string[] = [];
    for (let rr = r - 4; rr <= r + 4; rr++) for (let cc = c - 4; cc <= c + 4; cc++) { const q = getSatelliteAnchor(cc, rr); if (q && q.col === c && q.row === r) sats.push(cc + ',' + rr); }
    return sats.length > 0 && sats.every(s => { const [x, y] = s.split(',').map(Number); const p = Canvas.hexCenterWorld(x, y); return Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - pitch) < 1; });
  }, [c, r]);

  // ---- brief tests (adapted) ----
  test('replaceTerrain honours the selection scope and the whole-map scope', async ({ page }) => {
    const n = await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'Plain_2', Selection.getCells()));
    expect(n).toBe(3);
    expect(await rubble(page)).toBe(2);
    const m = await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'Plain_2', null));
    expect(m).toBe(2);
    expect(await rubble(page)).toBe(0);
    expect(await page.evaluate(() => mapData.filter((x: string) => x === 'Plain_2').length)).toBe(5);
  });

  test('Edit > Replace modal replaces inside the selection and undoes in one step', async ({ page }) => {
    await page.evaluate(() => Tools.openReplace());
    await page.fill('#replace-from', 'Rubble_1');
    await page.fill('#replace-to', 'Water_1');
    await page.check('#replace-sel-only');
    const before = await steps(page);
    await page.click('#replace-apply');
    expect(await rubble(page)).toBe(2);
    expect(await steps(page)).toBe(before + 1);
    await page.evaluate(() => History.undo());
    expect(await rubble(page)).toBe(5);
  });

  test('H tool replaces the clicked tile id with the active terrain', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Plain_2'); });
    await page.keyboard.press('h');
    expect(await page.evaluate(() => Tools.getActive())).toBe('replace');
    await clickCell(page, 226, 224);
    expect(await rubble(page)).toBe(0);
  });

  // ---- scope, exactness, guards ----
  test('the Edit menu entry opens the modal; the modal pre-fills the active terrain and the selection scope', async ({ page }) => {
    await page.click('#menu-edit');
    await page.getByRole('button', { name: /Replace Tile/ }).click();
    await expect(page.locator('#replace-modal')).toBeVisible();
    expect(await page.inputValue('#replace-to')).toBe('Plain_1');
    expect(await page.locator('#replace-sel-only').isChecked()).toBe(true);
    await page.evaluate(() => { Tools.closeReplace(); Selection.clear(); Tools.openReplace(); });
    expect(await page.locator('#replace-sel-only').isChecked()).toBe(false);
  });

  test('a selected scope examines and replaces only the selected cells (work counter: 3 examined, not the map; plain tiles have no edges, so nothing outside changes); whole map examines every cell', async ({ page }) => {
    const r = await page.evaluate(() => {
      const outside = mapData.slice();
      Tools.replaceTerrain('Rubble_1', 'Plain_2', Selection.getCells());
      const a = Tools.replaceInfo();
      let leaked = 0;
      for (let i = 0; i < mapData.length; i++) if (mapData[i] !== outside[i] && !Selection.has(i % MAP_WIDTH, Math.floor(i / MAP_WIDTH))) leaked++;
      Tools.replaceTerrain('Plain_2', 'Forest_1', null);
      const b = Tools.replaceInfo();
      return { a, b, leaked, W: MAP_WIDTH * MAP_HEIGHT };
    });
    expect(r.leaked).toBe(0);
    expect(r.a.scanned).toBe(3);
    expect(r.a.replaced).toBe(3);
    expect(r.b.scanned).toBe(r.W);
    expect(r.b.replaced).toBe(3);
  });

  test('ids are compared exactly (case-sensitive); the target must exist in the tile database; same ids and no-ops write nothing', async ({ page }) => {
    const before = await snapshot(page);
    const r = await page.evaluate(() => ({
      lower: Tools.replaceTerrain('rubble_1', 'Plain_2', null),
      unknownTo: Tools.replaceTerrain('Rubble_1', 'No_Such_Tile', null),
      same: Tools.replaceTerrain('Rubble_1', 'Rubble_1', null),
      absent: Tools.replaceTerrain('Forest_1', 'Plain_2', null),
      empty: Tools.replaceTerrain('', 'Plain_2', null),
    }));
    expect(r).toEqual({ lower: 0, unknownTo: 0, same: 0, absent: 0, empty: 0 });
    expect(await snapshot(page)).toBe(before);
    // a lower-case TARGET resolves to the canonical id
    await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'water_1', null));
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Water_1');
  });

  test('out-of-map and duplicate cells in the scope are ignored; each cell is replaced once', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cells = [{ col: 225, row: 224 }, { col: 225, row: 224 }, { col: -1, row: 3 }, { col: 9999, row: 0 }, { col: 3, row: -5 }, { col: 226, row: 224 }];
      const n = Tools.replaceTerrain('Rubble_1', 'Plain_2', cells);
      return { n, info: Tools.replaceInfo() };
    });
    expect(r.n).toBe(2);
    expect(r.info.scanned).toBe(2);
    expect(await rubble(page)).toBe(3);
  });

  test('modal: nothing to replace, same ids, unknown target, empty selection and an empty field each toast and write no History step', async ({ page }) => {
    await toastsOn(page);
    const s0 = await steps(page), snap0 = await snapshot(page);
    const cases: [string, string, boolean, RegExp][] = [
      ['Rubble_1', 'Rubble_1', false, /different/i],
      ['Rubble_1', 'rubble_1', false, /different/i],       // the same tile in another letter case: canonical ids are compared, no dishonest 'no tiles' toast
      ['', 'Plain_2', false, /different|pick/i],
      ['Rubble_1', 'No_Such_Tile', false, /unknown/i],
      ['Forest_1', 'Plain_2', false, /no .*Forest_1|nothing/i],
    ];
    for (const [f, t, so, re] of cases) {
      await open(page, f, t, so);
      await page.click('#replace-apply');
      const last = await page.evaluate(() => (window as any).__toasts.slice(-1)[0]);
      expect(last).toMatch(re);
    }
    await page.evaluate(() => { Tools.closeReplace(); Selection.clear(); });
    await open(page, 'Rubble_1', 'Plain_2', true);
    await page.click('#replace-apply');
    expect(await page.evaluate(() => (window as any).__toasts.slice(-1)[0])).toMatch(/select a region/i);
    expect(await steps(page)).toBe(s0);
    expect(await snapshot(page)).toBe(snap0);
  });

  test('Escape closes the modal without a step; Enter in a field applies; a modal open blocks the H shortcut', async ({ page }) => {
    const s0 = await steps(page);
    await open(page, 'Rubble_1', 'Plain_2', false);
    await page.keyboard.press('h');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.keyboard.press('Escape');
    await expect(page.locator('#replace-modal')).toBeHidden();
    expect(await steps(page)).toBe(s0);
    expect(await rubble(page)).toBe(5);
    await open(page, 'Rubble_1', 'Plain_2', false);
    await page.focus('#replace-to');
    await page.keyboard.press('Enter');
    await expect(page.locator('#replace-modal')).toBeHidden();
    expect(await rubble(page)).toBe(0);
    expect(await steps(page)).toBe(s0 + 1);
  });

  test('one undo step per operation, redo reapplies, the selection survives and is not a History step', async ({ page }) => {
    const s0 = await steps(page), snap0 = await snapshot(page);
    await page.evaluate(() => Tools.replaceTerrain('Rubble_1', 'Plain_2', null, { beforeWrite: () => History.push() }));
    expect(await steps(page)).toBe(s0 + 1);
    const snap1 = await snapshot(page);
    expect(snap1).not.toBe(snap0);
    expect(await sel(page)).toBe(3);
    await page.evaluate(() => History.undo());
    expect(await snapshot(page)).toBe(snap0);
    await page.evaluate(() => History.redo());
    expect(await snapshot(page)).toBe(snap1);
  });

  test('beforeWrite runs exactly once, only when something will change (no empty step)', async ({ page }) => {
    const r = await page.evaluate(() => {
      let calls = 0, mapAtCall = '';
      const cb = () => { calls++; mapAtCall = mapData.join('|'); };
      const none = Tools.replaceTerrain('Forest_1', 'Plain_2', null, { beforeWrite: cb });
      const callsNone = calls;
      const before = mapData.join('|');
      const n = Tools.replaceTerrain('Rubble_1', 'Plain_2', null, { beforeWrite: cb });
      return { none, callsNone, n, calls, preState: mapAtCall === before };
    });
    expect(r).toEqual({ none: 0, callsNone: 0, n: 5, calls: 1, preState: true });
  });

  test('replace is terrain-only: zones, buildings, roads and under-terrain stay; symmetry is not applied', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, k = '225,224', zl = ZonePainter.getZoneLayer();
      zl[224 * W + 225] = 3; roadsData[k] = { type: 'dirt' }; objectsData[k] = 'Ruins_1'; tileExtras[k] = { under: 'x' };
      Tools.setSymmetry('hv');
      Tools.replaceTerrain('Rubble_1', 'Plain_2', [{ col: 225, row: 224 }]);
      Tools.setSymmetry('none');
      return { zone: zl[224 * W + 225], road: roadsData[k], obj: objectsData[k], ex: tileExtras[k], plain2: mapData.filter((x: string) => x === 'Plain_2').length, rub: mapData.filter((x: string) => x === 'Rubble_1').length };
    });
    expect(r).toEqual({ zone: 3, road: { type: 'dirt' }, obj: 'Ruins_1', ex: { under: 'x' }, plain2: 1, rub: 4 });
  });

  test('a replaced river cell loses its bridge; other bridges stay (single pass, no per-cell bridge search)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      mapData[224 * W + 225] = 'Water_1'; mapData[224 * W + 226] = 'Water_1';
      bridgesData.length = 0;
      bridgesData.push({ col: 225, row: 224, axis: 0 }, { col: 226, row: 224, axis: 1 }, { col: 300, row: 300, axis: 2 });
      Tools.replaceTerrain('Water_1', 'Plain_2', [{ col: 225, row: 224 }]);
      return bridgesData.map((b: any) => b.col + ',' + b.row);
    });
    expect(r).toEqual(['226,224', '300,300']);
  });

  // ---- footprints ----
  test('replacing a multi-tile anchor with a plain tile removes its footprint; the satellite cells keep their terrain', async ({ page }) => {
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH;
      mapData[200 * W + 200] = RB; invalidateSatelliteMap();
      const sats: any[] = [];
      for (let r = 196; r <= 204; r++) for (let c = 196; c <= 204; c++) if (getSatelliteAnchor(c, r)) sats.push([c, r, mapData[r * W + c]]);
      const n = Tools.replaceTerrain(RB, 'Plain_2', null);
      let left = 0;
      for (let r = 196; r <= 204; r++) for (let c = 196; c <= 204; c++) if (getSatelliteAnchor(c, r)) left++;
      return { n, sats, left, anchor: mapData[200 * W + 200], satTerrain: sats.map(s => mapData[s[1] * W + s[0]]) };
    }, [RB]);
    expect(r.n).toBe(1);
    expect(r.sats.length).toBe(3);
    expect(r.left).toBe(0);
    expect(r.anchor).toBe('Plain_2');
    expect(r.satTerrain).toEqual(r.sats.map((s: any) => s[2]));
  });

  test('replacing a plain tile with a multi-tile anchor registers its real footprint (pixel reference: neighbours at one hex pitch)', async ({ page }) => {
    const want = await page.evaluate(([RB]) => Terrain.byHexId(RB).occupiedOffsets.length, [RB]);
    expect(want).toBe(3);
    for (const [col, row] of [[200, 200], [300, 201]]) {            // both row parities
      await page.evaluate(([col, row, RB]) => { mapData[row * MAP_WIDTH + col] = 'Rubble_2'; Tools.replaceTerrain('Rubble_2', RB, null); }, [col, row, RB]);
      expect(await page.evaluate(([col, row]) => mapData[row * MAP_WIDTH + col], [col, row])).toBe(RB);
      expect((await satsOf(page, col, row)).length).toBe(want);
      expect(await satsOf(page, col, row)).toEqual(await sharedFp(page, col, row));
      // pixel reference where the legacy footprint tables are true adjacency (even rows of this 450-high map). On the
      // odd-row parity two of the three offsets are 120 px away: the pre-existing K1 table defect, not part of this task.
      if (row % 2 === 0) expect(await pitchOk(page, col, row)).toBe(true);
    }
  });

  test('anchor with another anchor id: the old footprint goes, the new (larger, 6-cell) one is derived', async ({ page }) => {
    await page.evaluate(([RB]) => { mapData[200 * MAP_WIDTH + 200] = RB; invalidateSatelliteMap(); }, [RB]);
    const rabbitSats = await satsOf(page, 200, 200);
    expect(rabbitSats.length).toBe(3);
    expect(await pitchOk(page, 200, 200)).toBe(true);        // even row: the Rabbit's 3 cells are true neighbours (pixel geometry)
    const n = await page.evaluate(([RB, DR]) => Tools.replaceTerrain(RB, DR, null), [RB, DR]);
    expect(n).toBe(1);
    const want = await page.evaluate(([DR]) => Terrain.byHexId(DR).occupiedOffsets.length, [DR]);
    expect(want).toBe(6);
    expect((await satsOf(page, 200, 200)).length).toBe(want);
    expect(await satsOf(page, 200, 200)).toEqual(await sharedFp(page, 200, 200));   // the shared definition
    // Independent reference on an EVEN row: the Dragon keeps the Rabbit's pixel-verified cells and adds 3 distinct new ones.
    // The 3 added offsets (SE, S, SW) are NOT pixel-checked: on this row the legacy table puts SW/SE 2 steps away
    // (pre-existing K1 defect, outside this task); on odd rows some of NW/N/NE are off too (see the Rabbit test above), so
    // there the shared footprint definition, which the satellite map itself uses (asserted above), is the only reference.
    const dragonSats = await satsOf(page, 200, 200);
    expect(rabbitSats.every(c => dragonSats.includes(c))).toBe(true);
    expect(new Set(dragonSats).size).toBe(6);
    expect(dragonSats.includes('200,200')).toBe(false);
    expect(await page.evaluate(() => mapData[200 * MAP_WIDTH + 200])).toBe('Dragon_Flat_1');
  });

  test('a new footprint that would be clipped, or overlaps a surviving footprint or anchor, is skipped and counted; others still replace', async ({ page }) => {
    await toastsOn(page);
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      mapData.fill('Plain_1');
      const T = 'Rubble_2';
      for (const [c, rr] of [[0, 0], [W - 1, H - 1], [100, 100], [100, 101], [300, 300], [400, 100]]) mapData[rr * W + c] = T;
      mapData[100 * W + 101] = RB;                       // an existing anchor right next to (100,100)
      mapData[101 * W + 100] = T; mapData[101 * W + 100] = T;
      invalidateSatelliteMap();
      const n = Tools.replaceTerrain(T, RB, null);
      const info = Tools.replaceInfo();
      const id = (c: number, rr: number) => mapData[rr * W + c];
      return { n, info, corner0: id(0, 0), corner1: id(W - 1, H - 1), ok1: id(300, 300), ok2: id(400, 100), overl: [id(100, 100), id(100, 101)] };
    }, [RB]);
    expect(r.corner0).toBe('Rubble_2');                  // skipped: stays what it was
    expect(r.corner1).toBe('Rubble_2');
    expect(r.ok1).toBe(RB);
    expect(r.ok2).toBe(RB);
    expect(r.info.skipped).toBe(r.info.matched - r.n);
    expect(r.info.skipped).toBeGreaterThanOrEqual(2);
    expect(r.n + r.info.skipped).toBe(r.info.matched);
    // every anchor placed has all its satellites registered to it, and no cell is claimed twice
    expect(await page.evaluate(() => {
      const W = MAP_WIDTH, claimed = new Map<string, string>();
      let bad = 0;
      for (let i = 0; i < mapData.length; i++) {
        const e = Terrain.byHexId(mapData[i]);
        if (!e || !e.occupiedOffsets || !e.occupiedOffsets.length) continue;
        const c = i % W, rr = Math.floor(i / W);
        for (const f of footprintCells(c, rr, e)) {
          if (f.col < 0 || f.col >= W || f.row < 0 || f.row >= MAP_HEIGHT) { bad++; continue; }
          const key = f.col + ',' + f.row, a = getSatelliteAnchor(f.col, f.row);
          if (claimed.has(key) || !a || a.col !== c || a.row !== rr) bad++;
          claimed.set(key, c + ',' + rr);
        }
      }
      return bad;
    })).toBe(0);
  });

  test('two candidates whose new footprints overlap: the earlier cell (row-major) wins, the other stays; no orphans', async ({ page }) => {
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH;
      mapData.fill('Plain_1');
      mapData[200 * W + 200] = 'Rubble_2'; mapData[200 * W + 201] = 'Rubble_2';   // neighbours: footprints collide
      const n = Tools.replaceTerrain('Rubble_2', RB, null);
      return { n, a: mapData[200 * W + 200], b: mapData[200 * W + 201], info: Tools.replaceInfo() };
    }, [RB]);
    expect(r.n).toBe(1);
    expect(r.a).toBe(RB);
    expect(r.b).toBe('Rubble_2');
    expect(r.info.skipped).toBe(1);
    expect((await satsOf(page, 200, 200)).length).toBe(3);
  });

  test('the overlap winner does not depend on the order of the cells passed in (row-major wins, even for a reversed list)', async ({ page }) => {
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH;
      mapData.fill('Plain_1');
      mapData[200 * W + 200] = 'Rubble_2'; mapData[200 * W + 201] = 'Rubble_2';
      const n = Tools.replaceTerrain('Rubble_2', RB, [{ col: 201, row: 200 }, { col: 200, row: 200 }]);
      return { n, a: mapData[200 * W + 200], b: mapData[200 * W + 201] };
    }, [RB]);
    expect(r.n).toBe(1);
    expect(r.a).toBe(RB);
    expect(r.b).toBe('Rubble_2');
  });

  test('a candidate lying under another anchor footprint is not replaced (nothing is painted under a footprint)', async ({ page }) => {
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH;
      mapData.fill('Plain_1');
      mapData[200 * W + 200] = RB; invalidateSatelliteMap();
      const sat = (() => { for (let rr = 196; rr <= 204; rr++) for (let c = 196; c <= 204; c++) if (getSatelliteAnchor(c, rr)) return { c, rr }; return null; })()!;
      mapData[sat.rr * W + sat.c] = 'Rubble_2';
      const n = Tools.replaceTerrain('Rubble_2', 'Water_1', null);
      return { n, kept: mapData[sat.rr * W + sat.c] };
    }, [RB]);
    expect(r).toEqual({ n: 0, kept: 'Rubble_2' });
  });

  test('replacing within a selection that covers only a satellite cell does not touch the anchor; one that covers the anchor takes the footprint along', async ({ page }) => {
    const r = await page.evaluate(([RB]) => {
      const W = MAP_WIDTH;
      mapData.fill('Plain_1'); mapData[200 * W + 200] = RB; invalidateSatelliteMap();
      const sat = (() => { for (let rr = 196; rr <= 204; rr++) for (let c = 196; c <= 204; c++) if (getSatelliteAnchor(c, rr)) return { col: c, row: rr }; return null; })()!;
      const a = Tools.replaceTerrain(RB, 'Plain_2', [sat]);
      const b = Tools.replaceTerrain(RB, 'Plain_2', [{ col: 200, row: 200 }]);
      return { a, b };
    }, [RB]);
    expect(r).toEqual({ a: 0, b: 1 });
  });

  test('H tool on a footprint cell uses the anchor id (like the eyedropper)', async ({ page }) => {
    await page.evaluate(([RB]) => { Selection.clear(); mapData[226 * MAP_WIDTH + 228] = RB; invalidateSatelliteMap(); UI.selectTerrain('Plain_2'); Tools.setActive('replace'); }, [RB]);
    const sat = (await satsOf(page, 228, 226))[0].split(',').map(Number);
    expect(sat).not.toEqual([228, 226]);
    await clickCell(page, sat[0], sat[1]);
    expect(await page.evaluate(() => mapData[226 * MAP_WIDTH + 228])).toBe('Plain_2');
    expect((await satsOf(page, 228, 226)).length).toBe(0);
  });

  // ---- edges ----
  test('water/river edges are re-resolved after a replace: only the cells next to the replaced ones (these neighbours lie OUTSIDE the replaced cell list and ARE rewritten), and they match resolveEdgeTile on the final map', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
      const fallback = HexDB.getAll().find((h: any) => h.id === 'Water_1').id;
      const R = rivers[0].id, origRandom = Math.random; Math.random = () => 0.5;
      const out: any = {};
      try {
        mapData.fill('Plain_1');
        const band: any[] = [];
        for (let row = 218; row <= 232; row++) for (let col = 224; col <= 226; col++) band.push({ col, row });
        for (const b of band) mapData[b.row * W + b.col] = R;           // a band of one (unresolved) river piece
        const mid = band.filter(b => b.row >= 222 && b.row <= 226);
        const midKeys = new Set(mid.map(b => b.col + ',' + b.row));
        const adj = new Map<string, any>();                              // band cells next to a replaced cell (true + legacy adjacency)
        for (const m of mid) {
          const near = HexUtils.neighbors(m.col, m.row, W, H).concat(EdgeTiling.legacyOffsets(m.row, H).map((o: number[]) => ({ col: m.col + o[0], row: m.row + o[1] })));
          for (const q of near) { const k = q.col + ',' + q.row; if (!midKeys.has(k) && band.some(b => b.col === q.col && b.row === q.row)) adj.set(k, q); }
        }
        out.n = Tools.replaceTerrain(R, 'Plain_1', mid);
        out.mid = mid.length; out.adj = adj.size;
        let bad = 0, changed = 0, untouchedOk = 0, untouched = 0;
        for (const b of band) {
          const k = b.col + ',' + b.row, id = mapData[b.row * W + b.col];
          if (midKeys.has(k)) continue;
          if (adj.has(k)) {
            const want = faces(EdgeTiling.resolveEdgeTile(b.col, b.row, W, H, mapData, ['Water', 'Rivers'], () => 0, [fallback]));
            if (faces(id) !== want) bad++;
            if (faces(id) !== faces(R)) changed++;
          } else { untouched++; if (id === R) untouchedOk++; }
        }
        Object.assign(out, { bad, changed, untouched, untouchedOk });
      } finally { Math.random = origRandom; }
      return out;
    });
    expect(r.n).toBe(r.mid);
    expect(r.adj).toBeGreaterThan(2);
    expect(r.changed).toBeGreaterThan(0);
    expect(r.bad).toBe(0);
    expect(r.untouched).toBeGreaterThan(5);
    expect(r.untouchedOk).toBe(r.untouched);
  });

  test('replacing land with a directional river tile re-resolves it and its river neighbours', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0).id;
      mapData.fill('Plain_1');
      const c = { col: 225, row: 224 }, nb = HexUtils.neighbors(c.col, c.row, W, H)[0];
      mapData[nb.row * W + nb.col] = river;
      mapData[c.row * W + c.col] = 'Rubble_2';
      const seen: string[] = [];
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (col: number, row: number, ...rest: any[]) => { seen.push(col + ',' + row); return orig(col, row, ...rest); };
      try { Tools.replaceTerrain('Rubble_2', river, null); } finally { EdgeTiling.resolveEdgeTile = orig; }
      return { seen, c: c.col + ',' + c.row, nb: nb.col + ',' + nb.row };
    });
    expect(r.seen).toContain(r.c);
    expect(r.seen).toContain(r.nb);
  });

  // ---- large maps: one O(map) pass, counted ----
  test('whole-map replace on 450x450 is one pass: every cell examined once, one footprint-map lookup per match, no edge work for non-water ids, one History step', async ({ page }) => {
    const r = await page.evaluate(() => {
      let resolves = 0; const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { resolves++; return orig(...a); };
      const s0 = History.undoSize();
      let n = 0;
      try { n = Tools.replaceTerrain('Plain_1', 'Plain_2', null, { beforeWrite: () => History.push() }); } finally { EdgeTiling.resolveEdgeTile = orig; }
      const info = Tools.replaceInfo();
      return { n, info, resolves, steps: History.undoSize() - s0, total: MAP_WIDTH * MAP_HEIGHT, left: mapData.filter((x: string) => x === 'Plain_1').length, rubble: mapData.filter((x: string) => x === 'Rubble_1').length };
    });
    expect(r.total).toBe(202500);
    expect(r.info.scanned).toBe(r.total);
    expect(r.n).toBe(r.total - 5);
    expect(r.info.matched).toBe(r.n);
    expect(r.left).toBe(0);
    expect(r.rubble).toBe(5);
    expect(r.resolves).toBe(0);
    expect(r.steps).toBe(1);
  });

  test('a big water replace re-resolves only the cells next to the replaced river pieces (work bounded by the touched cells)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      mapData.fill('Water_1');
      let resolves = 0; const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { resolves++; return orig(...a); };
      let n = 0;
      try { n = Tools.replaceTerrain('Water_1', 'Plain_1', null); } finally { EdgeTiling.resolveEdgeTile = orig; }
      return { n, resolves, total: W * MAP_HEIGHT };
    });
    expect(r.n).toBe(r.total);
    expect(r.resolves).toBe(0);                // nothing directional anywhere: nothing to re-resolve
  });

  // ---- multi-tile X and multi-tile Y: the plan must leave a consistent satellite map (fix round 1) ----
  /** Installs window.__inv(c0, c1, r0, r1): violations of the footprint invariants inside the window (anchors up to 6 cells
   *  outside it are included): a cell claimed by two anchors' footprints (an anchor's own cell counts), a footprint cell
   *  that is not registered to its anchor in the satellite map, a satellite whose anchor is not a multi-tile tile or
   *  whose footprint does not contain it. Reads only footprintCells / the live satellite map. */
  const installInv = (page: Page) => page.evaluate(() => {
    (window as any).__inv = (c0: number, c1: number, r0: number, r1: number) => {
      const W = MAP_WIDTH, bad: string[] = [], owner = new Map<string, string>();
      const multi = (id: string) => { const e = Terrain.byHexId(id); return !!(e && Array.isArray(e.occupiedOffsets) && e.occupiedOffsets.length); };
      const claim = (c: number, r: number, who: string) => { const k = c + ',' + r; if (owner.has(k)) bad.push(`cell ${k} claimed by ${owner.get(k)} and ${who}`); else owner.set(k, who); };
      for (let r = r0 - 6; r <= r1 + 6; r++) for (let c = c0 - 6; c <= c1 + 6; c++) {
        const id = mapData[r * W + c];
        if (!multi(id)) continue;
        const who = `${id}@${c},${r}`, e = Terrain.byHexId(id);
        claim(c, r, who);
        for (const f of footprintCells(c, r, e)) {
          if (f.col < 0 || f.col >= W || f.row < 0 || f.row >= MAP_HEIGHT) { bad.push(who + ' footprint leaves the map'); continue; }
          claim(f.col, f.row, who);
          const a = getSatelliteAnchor(f.col, f.row);
          if (!a || a.col !== c || a.row !== r) bad.push(`${who} footprint cell ${f.col},${f.row} is registered to ${a ? a.col + ',' + a.row : 'nobody'}`);
        }
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const a = getSatelliteAnchor(c, r);
        if (!a) continue;
        const id = mapData[a.row * W + a.col];
        if (!multi(id) || !footprintCells(a.col, a.row, Terrain.byHexId(id)).some((f: any) => f.col === c && f.row === r)) bad.push(`orphan satellite ${c},${r} (anchor ${a.col},${a.row} = ${id})`);
      }
      return bad;
    };
  });

  test('two multi-tile anchors with disjoint footprints, X to a larger multi-tile Y: no cell is claimed twice, no orphan satellite (the reported corruption)', async ({ page }) => {
    await installInv(page);
    const r = await page.evaluate(([RB, DR]) => {
      mapData.fill('Plain_1');
      const W = MAP_WIDTH;
      mapData[200 * W + 200] = RB; mapData[202 * W + 201] = RB; invalidateSatelliteMap();
      const before = (window as any).__inv(195, 206, 195, 206);
      const n = Tools.replaceTerrain(RB, DR, null), info = Tools.replaceInfo();
      return { before, n, info, bad: (window as any).__inv(195, 206, 195, 206), ids: [mapData[200 * W + 200], mapData[202 * W + 201]] };
    }, [RB, DR]);
    expect(r.before).toEqual([]);                 // the fixture itself is valid
    expect(r.bad).toEqual([]);
    expect(r.n + r.info.skipped).toBe(2);
    expect(r.ids.filter((x: string) => x === DR).length).toBe(r.n);
    expect(r.ids.filter((x: string) => x === RB).length).toBe(r.info.skipped);
  });

  test('a winner whose new footprint covers another X anchor\'s own cell: that anchor is not left standing under the footprint', async ({ page }) => {
    await installInv(page);
    const r = await page.evaluate(([RB, DR]) => {
      mapData.fill('Plain_1');
      const W = MAP_WIDTH, dr = Terrain.byHexId(DR), rb = Terrain.byHexId(RB);
      // In the real database every Y footprint that is larger than X's is adjacent to X, so two valid X anchors can never
      // stand on each other's new cells. Shrink this page's Rabbit to ONE satellite (NW) to make that reachable.
      rb.occupiedOffsets.length = 0; rb.occupiedOffsets.push('NW'); invalidateSatelliteMap();
      // B sits on one cell of A's DRAGON footprint, with an RB footprint that is valid and disjoint from A's; A is tried
      // on both row parities (the legacy footprint tables differ between them). Every such fixture is run: B comes both
      // before and after A in row-major order (the earlier anchor wins an overlap, so both orders take different paths).
      const out: any[] = [];
      for (const A of [{ col: 200, row: 200 }, { col: 200, row: 201 }]) {
        const oldA = footprintCells(A.col, A.row, rb).map((f: any) => f.col + ',' + f.row);
        for (const f of footprintCells(A.col, A.row, dr)) {
          const k = f.col + ',' + f.row; if (oldA.includes(k)) continue;
          const bFp = footprintCells(f.col, f.row, rb).map((q: any) => q.col + ',' + q.row);
          if (bFp.includes(A.col + ',' + A.row) || bFp.some((x: string) => oldA.includes(x))) continue;
          mapData.fill('Plain_1'); mapData[A.row * W + A.col] = RB; mapData[f.row * W + f.col] = RB; invalidateSatelliteMap();
          if ((window as any).__inv(190, 215, 190, 215).length) continue;
          const n = Tools.replaceTerrain(RB, DR, null), info = Tools.replaceInfo();
          out.push({ B: k, A: A.col + ',' + A.row, bAfterA: f.row * W + f.col > A.row * W + A.col, n, skipped: info.skipped, bad: (window as any).__inv(190, 215, 190, 215) });
        }
      }
      return { out };
    }, [RB, DR]);
    expect(r.out.filter((o: any) => o.bAfterA).length).toBeGreaterThan(0);
    expect(r.out.filter((o: any) => !o.bAfterA).length).toBeGreaterThan(0);
    for (const o of r.out) { expect(o.bad, `A ${o.A} B ${o.B}`).toEqual([]); expect(o.n + o.skipped).toBe(2); }
  });

  test('cascade: three anchors where each new footprint covers the next anchor; the plan re-checks until stable (invariants hold, counts add up)', async ({ page }) => {
    await installInv(page);
    const r = await page.evaluate(([RB, DR]) => {
      mapData.fill('Plain_1');
      const W = MAP_WIDTH, dr = Terrain.byHexId(DR), rb = Terrain.byHexId(RB);
      // In the real database every Y footprint that is larger than X's is adjacent to X, so two valid X anchors can never
      // stand on each other's new cells. Shrink this page's Rabbit to ONE satellite (NW) to make that reachable.
      rb.occupiedOffsets.length = 0; rb.occupiedOffsets.push('NW'); invalidateSatelliteMap();
      const keys = (a: any[]) => a.map((q: any) => q.col + ',' + q.row);
      // search a chain A -> B -> C: B on a cell of A's dragon footprint, C on a cell of B's; every old RB footprint valid and disjoint
      for (const A of [{ col: 200, row: 200 }, { col: 200, row: 201 }]) for (const fb of footprintCells(A.col, A.row, dr)) for (const fc of footprintCells(fb.col, fb.row, dr)) {
        const pts = [A, fb, fc];
        if (new Set(keys(pts)).size !== 3) continue;
        mapData.fill('Plain_1');
        for (const q of pts) mapData[q.row * W + q.col] = RB;
        invalidateSatelliteMap();
        if ((window as any).__inv(190, 215, 190, 215).length) continue;
        const n = Tools.replaceTerrain(RB, DR, null), info = Tools.replaceInfo();
        return { found: true, n, info, bad: (window as any).__inv(190, 215, 190, 215), pts: keys(pts) };
      }
      return { found: false };
    }, [RB, DR]);
    expect(r.found).toBe(true);
    expect(r.info!.matched).toBe(3);
    expect(r.bad).toEqual([]);
    expect(r.n! + r.info!.skipped).toBe(3);
  });

  test('seeded random layouts of X and Y anchors (200 on a 20x20 region): the invariants hold after every replace, in both directions', async ({ page }) => {
    await installInv(page);
    const r = await page.evaluate(([RB, DR]) => {
      let seed = 20260705;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const W = MAP_WIDTH, C0 = 200, R0 = 200, S = 20;
      const fails: string[] = [];
      let replacedTotal = 0, skippedTotal = 0;
      for (let layout = 0; layout < 200; layout++) {
        mapData.fill('Plain_1');
        const used = new Set<string>();
        const tries = 6 + Math.floor(rnd() * 30);
        for (let t = 0; t < tries; t++) {
          const id = rnd() < 0.5 ? RB : DR, c = C0 + 3 + Math.floor(rnd() * (S - 6)), r = R0 + 3 + Math.floor(rnd() * (S - 6));
          const cells = [{ col: c, row: r }].concat(footprintCells(c, r, Terrain.byHexId(id)));
          if (cells.some((q: any) => used.has(q.col + ',' + q.row))) continue;
          for (const q of cells) used.add(q.col + ',' + q.row);
          mapData[r * W + c] = id;
        }
        invalidateSatelliteMap();
        const [from, to] = layout % 2 ? [RB, DR] : [DR, RB];
        const matched = mapData.filter((x: string) => x === from).length, toBefore = mapData.filter((x: string) => x === to).length;
        const n = Tools.replaceTerrain(from, to, null), info = Tools.replaceInfo();
        const bad = (window as any).__inv(C0, C0 + S, R0, R0 + S);
        const toAfter = mapData.filter((x: string) => x === to).length;
        if (bad.length) fails.push(`layout ${layout} ${from}->${to}: ${bad[0]}`);
        if (info.matched !== matched || n + info.skipped !== matched || toAfter !== toBefore + n) fails.push(`layout ${layout}: counts ${JSON.stringify(info)} n=${n} matched=${matched}`);
        replacedTotal += n; skippedTotal += info.skipped;
      }
      return { fails: fails.slice(0, 5), replacedTotal, skippedTotal };
    }, [RB, DR]);
    expect(r.fails).toEqual([]);
    expect(r.replacedTotal).toBeGreaterThan(100);       // the sweep really replaces ...
    expect(r.skippedTotal).toBeGreaterThan(20);         // ... and really hits the skip paths
  });

  // ---- busy / stale / state ----
  test('refused while a fill runs: the API returns 0 and openReplace refuses with its own toast; nothing is written, no step', async ({ page }) => {
    await toastsOn(page);
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Water_1');
      const p = Tools.fillAt(100, 100);                      // starts a time-sliced fill of the Plain region
      const busy = Tools.isFillBusy();
      const s0 = History.undoSize(), snap = mapData.join('|'), t0 = (window as any).__toasts.length;
      const api = Tools.replaceTerrain('Rubble_1', 'Plain_2', null);
      const apiToasts = (window as any).__toasts.slice(t0);
      Tools.openReplace();
      const toasts = (window as any).__toasts.slice(t0);     // read BEFORE the fill ends (it toasts 'Fill applied' itself)
      const modalOpen = document.getElementById('replace-modal')!.classList.contains('open');
      const same = mapData.join('|') === snap && History.undoSize() === s0;
      await p;
      return { busy, api, apiToasts, toasts, modalOpen, same };
    });
    expect(r.busy).toBe(true);
    expect(r.api).toBe(0);
    expect(r.apiToasts).toEqual([]);
    expect(r.toasts).toEqual(['Wait for the fill to finish']);
    expect(r.modalOpen).toBe(false);
    expect(r.same).toBe(true);
  });

  test('applyReplace with filled fields while a fill runs reaches the _runReplace guard: its toast, nothing written, no step, the dialog stays open', async ({ page }) => {
    await toastsOn(page);
    await open(page, 'Rubble_1', 'Plain_2', false);          // dialog opened (and fields filled) BEFORE the fill starts
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Water_1');
      const p = Tools.fillAt(100, 100);
      const busy = Tools.isFillBusy();
      const s0 = History.undoSize(), snap = mapData.join('|'), t0 = (window as any).__toasts.length;
      Tools.applyReplace();
      const toasts = (window as any).__toasts.slice(t0);     // read BEFORE the fill ends
      const stillOpen = document.getElementById('replace-modal')!.classList.contains('open');
      const same = mapData.join('|') === snap && History.undoSize() === s0;
      await p;
      return { busy, toasts, stillOpen, same };
    });
    expect(r).toEqual({ busy: true, toasts: ['Wait for the fill to finish'], stillOpen: true, same: true });
  });

  test('H click while a fill runs is ignored (synthetic mousedown dispatched while busy)', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Water_1'); Tools.setActive('replace'); });
    const r = await page.evaluate(async () => {
      const s0 = History.undoSize();
      const p = Tools.fillAt(100, 100);
      const busy = Tools.isFillBusy();
      const q = Canvas.hexScreenPos(226, 224), cv = document.getElementById('map-canvas')!, b = cv.getBoundingClientRect();
      const opts = { clientX: b.left + q.x, clientY: b.top + q.y, button: 0, buttons: 1, bubbles: true };
      cv.dispatchEvent(new MouseEvent('mousedown', opts));
      cv.dispatchEvent(new MouseEvent('mouseup', opts));
      const during = mapData[224 * MAP_WIDTH + 226], stepsDuring = History.undoSize() - s0;
      await p;
      return { busy, during, stepsDuring };
    });
    expect(r).toEqual({ busy: true, during: 'Rubble_1', stepsDuring: 0 });
  });

  test('the modal cancels with a toast when the map was replaced while it was open', async ({ page }) => {
    await toastsOn(page);
    await open(page, 'Plain_1', 'Plain_2', false);
    await page.evaluate(() => { IO.newMap(true); });
    const s0 = await steps(page), snap0 = await snapshot(page);
    await page.click('#replace-apply');
    expect(await snapshot(page)).toBe(snap0);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => (window as any).__toasts.slice(-1)[0])).toMatch(/map changed/i);
    await expect(page.locator('#replace-modal')).toBeHidden();
  });

  test('Escape in the dialog closes only the dialog: a pending polygon survives and still commits with Enter', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Plain_2'); Tools.setActive('polygon'); });
    const tri = await page.evaluate(() => {              // a triangle around the view centre, like the paint-tools polygon tests
      const a = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
      return [a, { q: a.q + 5, r: a.r, s: a.s - 5 }, { q: a.q, r: a.r + 5, s: a.s - 5 }].map(c => HexUtils.fromCube(c, MAP_WIDTH, MAP_HEIGHT));
    });
    for (const v of tri) await clickCell(page, v.col, v.row);
    await page.evaluate(() => Tools.openReplace());
    await expect(page.locator('#replace-modal')).toBeVisible();
    await page.focus('#replace-from');
    await page.keyboard.press('Escape');
    await expect(page.locator('#replace-modal')).toBeHidden();
    const s0 = await steps(page);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Enter');                       // commits the polygon only if Escape did not cancel it
    expect(await steps(page)).toBe(s0 + 1);
    expect(await page.evaluate(([c, r]) => mapData[r * MAP_WIDTH + c], [tri[0].col, tri[0].row])).toBe('Plain_2');
  });

  test('Selection-only with the map array replaced (same size) while the dialog is open: the stale-map check cancels the replace, nothing is written', async ({ page }) => {
    await toastsOn(page);
    await open(page, 'Plain_1', 'Plain_2', true);
    await page.evaluate(() => { mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1'); });
    const snap0 = await snapshot(page);
    await page.click('#replace-apply');
    expect(await snapshot(page)).toBe(snap0);
    expect(await page.evaluate(() => (window as any).__toasts.slice(-1)[0])).toMatch(/map changed/i);
  });

  test('refused while a lifted selection is moving', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.beginMove();
      const moving = Tools.isMoving();
      const s0 = History.undoSize(), snap = mapData.join('|');
      Tools.openReplace();
      const open = document.getElementById('replace-modal')!.classList.contains('open');
      const n = Tools.replaceTerrain('Rubble_1', 'Plain_2', null);
      return { moving, open, n, same: mapData.join('|') === snap && History.undoSize() === s0 };
    });
    expect(r).toEqual({ moving: true, open: false, n: 0, same: true });
  });

  // ---- H tool input ----
  test('H tool: scoped to the selection when one exists, whole map otherwise; one step per click', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Plain_2'); Tools.setActive('replace'); });
    const s0 = await steps(page);
    await clickCell(page, 226, 224);                         // selection (3 cells) exists
    expect(await rubble(page)).toBe(2);
    expect(await steps(page)).toBe(s0 + 1);
    await page.evaluate(() => Selection.clear());
    await clickCell(page, 225, 230);
    expect(await rubble(page)).toBe(0);
    expect(await steps(page)).toBe(s0 + 2);
    await page.evaluate(() => History.undo());
    expect(await rubble(page)).toBe(2);
  });

  test('H tool: clicking a tile that already is the active terrain does nothing (no step, toast); a click with nothing to replace in the selection adds no step', async ({ page }) => {
    await toastsOn(page);
    await page.evaluate(() => { UI.selectTerrain('Rubble_1'); Tools.setActive('replace'); });
    const s0 = await steps(page);
    await clickCell(page, 226, 224);
    expect(await steps(page)).toBe(s0);
    expect(await page.evaluate(() => (window as any).__toasts.slice(-1)[0])).toMatch(/already/i);
    await page.evaluate(() => { mapData[231 * MAP_WIDTH + 225] = 'Forest_1'; UI.selectTerrain('Plain_2'); });
    await clickCell(page, 225, 231);                         // Forest outside the 3-cell selection: nothing to replace inside it
    expect(await page.evaluate(() => mapData[231 * MAP_WIDTH + 225])).toBe('Forest_1');
    expect(await rubble(page)).toBe(5);
    expect(await steps(page)).toBe(s0);
  });

  test('H tool ignores the right, middle and side buttons', async ({ page }) => {
    await page.evaluate(() => { Selection.clear(); UI.selectTerrain('Plain_2'); Tools.setActive('replace'); });
    const s0 = await steps(page);
    const p = await cellPoint(page, 226, 224);
    await page.mouse.move(p.x, p.y);
    for (const button of ['right', 'middle'] as const) { await page.mouse.down({ button }); await page.mouse.up({ button }); }
    await page.evaluate(([x, y]) => {
      const c = document.getElementById('map-canvas')!;
      for (const b of [3, 4]) { c.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: b, buttons: 1 << b, bubbles: true })); c.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, button: b, bubbles: true })); }
    }, [p.x, p.y]);
    expect(await rubble(page)).toBe(5);
    expect(await steps(page)).toBe(s0);
  });

  test('H shortcut: by physical key (any layout), not with modifiers, not while typing, no other shortcut changed', async ({ page }) => {
    const press = (init: any) => page.evaluate((i) => { window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true }, i))); return Tools.getActive(); }, init);
    expect(await press({ code: 'KeyH', key: 'р' })).toBe('replace');         // Ukrainian layout: code only
    await page.evaluate(() => Tools.setActive('paint'));
    expect(await press({ code: 'KeyH', key: 'h', shiftKey: true })).toBe('paint');
    expect(await press({ code: 'KeyH', key: 'h', altKey: true })).toBe('paint');
    expect(await press({ code: 'KeyH', key: 'h', ctrlKey: true })).toBe('paint');
    expect(await press({ code: 'KeyH', key: 'h', repeat: true })).toBe('paint');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = '__t'; document.body.appendChild(i); i.focus(); });
    expect(await press({ code: 'KeyH', key: 'h' })).toBe('paint');
    await page.evaluate(() => document.getElementById('__t')!.remove());
    // event TARGET counts too (a field that blurred itself before the event bubbled)
    const viaTarget = await page.evaluate(() => {
      const i = document.createElement('input'); document.body.appendChild(i);
      i.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true }));
      i.remove(); return Tools.getActive();
    });
    expect(viaTarget).toBe('paint');
    // map-mode only
    await page.evaluate(() => { document.body.classList.remove('mode-map'); });
    expect(await press({ code: 'KeyH', key: 'h' })).toBe('paint');
    await page.evaluate(() => { document.body.classList.add('mode-map'); });
    // the neighbours still work
    for (const [code, key, tool] of [['KeyP', 'p', 'paint'], ['KeyF', 'f', 'fill'], ['KeyR', 'r', 'rect'], ['KeyE', 'e', 'eye'], ['KeyL', 'l', 'line'], ['KeyM', 'm', 'marquee'], ['KeyX', 'x', 'eraser'], ['KeyA', 'a', 'scatter']])
      expect(await press({ code, key })).toBe(tool);
  });

  test('tool switch while H is active leaves no state; the palette button activates the tool', async ({ page }) => {
    await page.click('#shape-tools [data-tool="replace"]');
    expect(await page.evaluate(() => Tools.getActive())).toBe('replace');
    await expect(page.locator('#shape-tools [data-tool="replace"]')).toHaveClass(/active/);
    await page.keyboard.press('p');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await expect(page.locator('#shape-tools [data-tool="replace"]')).not.toHaveClass(/active/);
  });

  test('layout: the control lives in the left palette; the canvas stays 1491x808 at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const c = document.getElementById('map-canvas')!, b = document.querySelector('[data-tool="replace"]')!;
      return { w: c.clientWidth, h: c.clientHeight, inPalette: !!b.closest('#palette-panel'), inToolbar: !!document.querySelector('#toolbar [data-tool="replace"]') };
    });
    expect(r).toEqual({ w: 1491, h: 808, inPalette: true, inToolbar: false });
  });
});
