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
  for (const tool of ['marquee', 'rect']) {
    test(`${tool}: dragging past every edge and corner stops at the border (no flip to the opposite edge)`, async ({ page }) => {
      await page.keyboard.press(tool === 'marquee' ? 'm' : 'r');
      await page.evaluate(() => UI.selectTerrain('Forest_1'));
      const dirs: [string, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0], ['upleft', -1, -1], ['upright', 1, -1], ['downleft', -1, 1], ['downright', 1, 1]];
      for (const [name, dx, dy] of dirs) {
        const setup = await page.evaluate(([dx, dy]) => {
          IO.newMap(true); Selection.clear();
          const Z = 0.5; Canvas.setZoom(50);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let c = 0; c < MAP_WIDTH; c++) for (let rw = 0; rw < MAP_HEIGHT; rw++) { const p = Canvas.hexCenterWorld(c, rw); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
          const ex = (dx as number) < 0 ? x0 : (dx as number) > 0 ? x1 : (x0 + x1) / 2, ey = (dy as number) < 0 ? y0 : (dy as number) > 0 ? y1 : (y0 + y1) / 2;
          const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
          Canvas._test.setCamera(ex * Z - cv.width / 2, ey * Z - cv.height / 2); Canvas.render();
          const b = cv.getBoundingClientRect();
          return { Z, x0, x1, y0, y1, left: b.left, top: b.top, cx: cv.width / 2, cy: cv.height / 2, ex, ey };
        }, [dx, dy]);
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
        if (dy < 0) expect(r.got.maxCol, name).toBe(449);       // col grows UP the screen
        if (dy > 0) expect(r.got.minCol, name).toBe(0);
        if (dx < 0) expect(r.got.maxRow, name).toBe(449);       // row grows toward the WEST (left)
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
