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
  // Independent pixel reference for a grid-cell rectangle: x of a cell centre depends only on its row, and the
  // y bands of different columns do not overlap (band of column c = [k*ROW_PITCH, k*ROW_PITCH + STAGGER], k = W-1-c).
  for (const [W, H] of [[450, 450], [451, 451], [450, 451], [451, 450], [21, 20], [20, 21]]) {
    test(`rectangle membership equals the pixel-geometry reference on ${W}x${H}`, async ({ page }) => {
      const r = await page.evaluate(([W, H]) => {
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Plain_1');
        const STAG = ROW_PITCH / 2, eps = 1e-6;
        const bad: string[] = [];
        const rects = [[3, 4, 9, 7], [9, 7, 3, 4], [0, 0, 0, 0], [5, 0, 5, 14], [0, 3, 14, 3], [MAP_WIDTH - 6, MAP_HEIGHT - 5, MAP_WIDTH - 1, MAP_HEIGHT - 1], [-5, -5, 2, 2], [MAP_WIDTH - 2, MAP_HEIGHT - 2, MAP_WIDTH + 9, MAP_HEIGHT + 9]];
        for (const [c1, r1, c2, r2] of rects) {
          Selection.clear();
          Selection.setCells(Tools._rectCells(c1, r1, c2, r2));
          // corner pixels come from the (clipped) corner cells
          const cLo = Math.max(0, Math.min(c1, c2)), cHi = Math.min(MAP_WIDTH - 1, Math.max(c1, c2));
          const rLo = Math.max(0, Math.min(r1, r2)), rHi = Math.min(MAP_HEIGHT - 1, Math.max(r1, r2));
          const xA = Canvas.hexCenterWorld(0, rHi).x, xB = Canvas.hexCenterWorld(0, rLo).x;     // x depends on the row only
          const yTop = (MAP_WIDTH - 1 - cHi) * ROW_PITCH, yBot = (MAP_WIDTH - 1 - cLo) * ROW_PITCH + STAG;
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
  test('the overlay is ONE fill and ONE stroke per frame at LOD 0/1; at LOD 2 one stroke and no fill (outline only)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ctx = Canvas.getCtx(); const out: any = {};
      const os = ctx.stroke.bind(ctx), of = ctx.fill.bind(ctx);
      const count = () => {
        let strokes = 0, fills = 0;
        ctx.stroke = () => { strokes++; os(); }; ctx.fill = () => { fills++; of(); };
        Canvas.render();
        ctx.stroke = os; ctx.fill = of;
        return { strokes, fills };
      };
      for (const [name, build] of [['small', () => Selection.setCells(Tools._rectCells(220, 218, 229, 227))], ['all', () => Selection.selectAll()]] as [string, () => void][]) {
        for (const lod of [0, 1, 2]) {
          Canvas._test.setLod(lod);
          Canvas.setZoom(lod === 2 ? 5 : lod === 1 ? 15 : 100);
          Selection.clear(); Canvas.render();
          const base = count();
          build();
          const withSel = count();
          out[name + lod] = { dStrokes: withSel.strokes - base.strokes, dFills: withSel.fills - base.fills };
          Selection.clear();
        }
      }
      Canvas._test.setLod(null);
      return out;
    });
    for (const n of ['small', 'all']) {
      expect(r[n + '0']).toEqual({ dStrokes: 1, dFills: 1 });
      expect(r[n + '1']).toEqual({ dStrokes: 1, dFills: 1 });
      expect(r[n + '2']).toEqual({ dStrokes: 1, dFills: 0 });
    }
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
      return { delta: withAll - base, visible, counts };
    });
    expect(r.visible).toBeGreaterThan(200);
    expect(r.visible).toBeLessThan(202500 / 4);
    expect(r.delta).toBeGreaterThanOrEqual(6 * (r.visible * 0.5));            // the visible cells really are drawn
    expect(r.delta).toBeLessThanOrEqual(6 * (r.visible + 400));               // ... and only those (+ one widened ring)
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
      out.textSel = window.getSelection()!.toString().length;
      return out;
    });
    expect(r.prevA).toBe(true); expect(r.all).toBe(450 * 450);
    expect(r.prevD).toBe(true); expect(r.afterD).toBe(0);
    expect(r.prevMeta).toBe(true); expect(r.metaAll).toBe(450 * 450);
    expect(r.shiftA).toEqual([false, 0]); expect(r.altA).toEqual([false, 0]);
    expect(r.plainA).toEqual([false, 0, 'scatter']);   // plain A is still Scatter
    expect(r.textSel).toBe(0);
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
});
