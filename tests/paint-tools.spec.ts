import { test, expect } from '@playwright/test';
import { freshEditor, clickCell, dragCells } from './editor-helpers';

const CITY = { col: 225, row: 224 };

test.describe('terrain apply and edge re-resolution (T2.2)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Rectangle re-resolves directional river tiles', async ({ page }) => {
    await page.evaluate(() => {
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      UI.selectTerrain(river.id); Tools.setActive('rect');
      (window as any).__resolveCalls = 0;
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (...a: any[]) => { (window as any).__resolveCalls++; return orig(...a); };
    });
    await dragCells(page, { col: 224, row: 222 }, { col: 226, row: 226 });
    expect(await page.evaluate(() => (window as any).__resolveCalls)).toBeGreaterThan(0);
  });

  test('painting land over a river re-resolves its directional neighbours', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0).id;
      const c = { col: 225, row: 224 };
      const nb = HexUtils.neighbors(c.col, c.row, W, MAP_HEIGHT)[0];
      mapData[c.row * W + c.col] = river;
      mapData[nb.row * W + nb.col] = river;
      const seen: string[] = [];
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (col: number, row: number, ...rest: any[]) => { seen.push(col + ',' + row); return orig(col, row, ...rest); };
      Tools.applyTerrainCells([c], 'Plain_1');
      EdgeTiling.resolveEdgeTile = orig;
      return { seen, nb: nb.col + ',' + nb.row };
    });
    expect(r.seen).toContain(r.nb);
  });

  // Rectangle resolves each neighbour once, per-cell Paint many times, so the RNG is consumed in a different
  // order: compare resolved MASKS (edgeFaces) with the live RNG, and exact ids with Math.random stubbed constant.
  for (const mode of ['masks', 'constant-rng ids'] as const) {
    test(`Rectangle over a river equals painting the same cells one by one (${mode})`, async ({ page }) => {
      const r = await page.evaluate((mode: string) => {
        const W = MAP_WIDTH;
        const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
        const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
        const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const origRandom = Math.random;
        const rng = (seed: number) => mode === 'masks' ? seeded(seed) : () => 0.5;
        const build = () => {
          IO.newMap(true);
          const band: any[] = [];
          for (let row = 215; row <= 233; row++) for (let col = 222; col <= 228; col++) band.push({ col, row });
          for (const p of band) mapData[p.row * W + p.col] = rivers[0].id;
          Math.random = rng(7);
          Tools.autoResolveEdgesAround(band);
        };
        const rects = [[224, 218, 226, 229], [222, 215, 228, 220], [225, 224, 225, 224], [223, 217, 227, 222]];
        const out: any[] = [];
        try {
          for (const [c1, r1, c2, r2] of rects) {
            const cells: any[] = [];
            for (let c = c1; c <= c2; c++) for (let rr = r1; rr <= r2; rr++) cells.push({ col: c, row: rr });
            build(); Math.random = rng(99); UI.selectTerrain('Plain_1');
            Tools.applyRect(c1, r1, c2, r2);
            const viaRect = mapData.slice();
            build(); Math.random = rng(99);
            for (const p of cells) Tools.applyTerrainCells([p], 'Plain_1');
            const viaPaint = mapData.slice();
            let diff = 0;
            for (let i = 0; i < viaRect.length; i++) {
              if (mode === 'masks' ? faces(viaRect[i]) !== faces(viaPaint[i]) : viaRect[i] !== viaPaint[i]) diff++;
            }
            out.push({ rect: [c1, r1, c2, r2], diff, riversLeft: viaRect.filter(v => rivers.some((h: any) => h.id === v) || faces(v)).length });
          }
        } finally { Math.random = origRandom; }
        return out;
      }, mode);
      for (const x of r) { expect(x.diff, JSON.stringify(x)).toBe(0); expect(x.riversLeft).toBeGreaterThan(0); }
    });
  }

  // K1: EdgeTiling's mask reads the legacy _DIRS tables, which differ from true hex adjacency on some heights.
  // Every cell whose mask reads a written cell must be re-resolved, under both kinds of map height.
  for (const H of [450, 452]) {
    test(`edge re-resolution reaches every cell whose mask reads the painted cell (H=${H})`, async ({ page }) => {
      const r = await page.evaluate((H: number) => {
        const oldH = MAP_HEIGHT, oldData = mapData, W = MAP_WIDTH;
        const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
        const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
        const fallback = HexDB.getAll().find((h: any) => h.id === 'Water_1').id;
        const bad: string[] = [];
        try {
          MAP_HEIGHT = H; mapData = new Array(W * H).fill('Plain_1'); invalidateSatelliteMap();
          for (const P of [{ col: 225, row: 224 }, { col: 225, row: 225 }, { col: 100, row: 100 }, { col: 100, row: 101 }]) {
            const cands = new Map<string, any>();
            for (const n of HexUtils.neighbors(P.col, P.row, W, H)) cands.set(n.col + ',' + n.row, n);
            for (const o of EdgeTiling.legacyOffsets(P.row, H)) cands.set((P.col + o[0]) + ',' + (P.row + o[1]), { col: P.col + o[0], row: P.row + o[1] });
            // legacy readers of P: cells X whose own legacy offsets include P (symmetric, but computed independently)
            for (const X of cands.values()) {
              mapData.fill('Plain_1');
              mapData[X.row * W + X.col] = fallback;                 // a stale flat tile that should become directional
              Tools.applyTerrainCells([P], rivers[0].id);
              const got = faces(mapData[X.row * W + X.col]);
              const want = faces(EdgeTiling.resolveEdgeTile(X.col, X.row, W, H, mapData, ['Water', 'Rivers'], () => 0, [fallback]));
              if (got !== want) bad.push(`P=${P.col},${P.row} X=${X.col},${X.row} got "${got}" want "${want}"`);
            }
          }
        } finally { MAP_HEIGHT = oldH; mapData = oldData; invalidateSatelliteMap(); }
        return bad;
      }, H);
      expect(r).toEqual([]);
    });
  }

  test('Fill stays inside a hex ring and fills exactly the 7 enclosed cells', async ({ page }) => {
    const filled = await page.evaluate(async () => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const centre = HexUtils.toCube(225, 224, W, H);
      for (const p of HexUtils.cellsFromCubes(HexUtils.cubeRing(centre, 2), W, H)) mapData[p.row * W + p.col] = 'Rubble_1';
      UI.selectTerrain('Forest_1');
      await Tools.fillAt(225, 224);
      return mapData.filter(id => id === 'Forest_1').length;
    });
    expect(filled).toBe(7);
  });

  test('Paint still undoes in one step', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await clickCell(page, CITY.col + 2, CITY.row);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Water_1');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 227])).toBe('Plain_1');
  });

  test('Rectangle and Fill are one undo step each', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
    const before = await page.evaluate(() => History.undoSize());
    await dragCells(page, { col: 224, row: 222 }, { col: 226, row: 226 });
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    await page.evaluate(() => { UI.selectTerrain('Hills_1'); Tools.setActive('fill'); });
    await clickCell(page, CITY.col - 4, CITY.row - 6);
    await page.evaluate(() => Tools.whenIdle());
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 2);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.filter(x => x === 'Hills_1').length)).toBe(0);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.every(x => x === 'Plain_1'))).toBe(true);
  });
});

test.describe('brush sizes and shortcuts (T2.3)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // Reference built only from Canvas.hexCenterWorld pixel positions: breadth-first search over pixel adjacency.
  const REF = `(c0, r0, R) => {
    const pos = (c, r) => Canvas.hexCenterWorld(c, r);
    const a = pos(c0, r0), cand = [];
    for (let c = c0 - 2 * R - 2; c <= c0 + 2 * R + 2; c++) for (let r = r0 - 2 * R - 2; r <= r0 + 2 * R + 2; r++)
      if (c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT) cand.push([c, r]);
    let d = Infinity;
    for (const [c, r] of cand) { const p = pos(c, r), x = Math.hypot(p.x - a.x, p.y - a.y); if (x > 1 && x < d) d = x; }
    const dist = new Map([[c0 + ',' + r0, 0]]); let frontier = [[c0, r0]];
    for (let i = 1; i <= R; i++) {
      const next = [];
      for (const [fc, fr] of frontier) { const p = pos(fc, fr);
        for (const [c, r] of cand) { const k = c + ',' + r; if (dist.has(k)) continue;
          const q = pos(c, r); if (Math.hypot(q.x - p.x, q.y - p.y) < d * 1.05) { dist.set(k, i); next.push([c, r]); } } }
      frontier = next;
    }
    return [...dist.keys()].sort();
  }`;

  for (const [W, H] of [[450, 450], [451, 451], [13, 9], [9, 13], [450, 451], [451, 450]]) {
    test(`brush disc equals the pixel-distance reference on ${W}x${H} (K3)`, async ({ page }) => {
      const res = await page.evaluate(([W, H, ref]) => {
        const refFn = eval(ref as string);
        const save = [MAP_WIDTH, MAP_HEIGHT];
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        const bad: string[] = [];
        const key = (t: any) => t.col + ',' + t.row;
        const cx = (W as number) >> 1, cy = (H as number) >> 1;
        for (const R of [1, 2, 5]) for (const [c, r] of [[cx, cy], [cx, cy + 1], [cx + 1, cy], [cx + 1, cy + 1]]) {
          Brush.setSize(R);
          const got = Brush.getAffectedTiles(c, r).map(key).sort().join('|');
          const want = refFn(c, r, R).join('|');
          if (got !== want) bad.push(`R${R}@${c},${r}`);
        }
        MAP_WIDTH = save[0]; MAP_HEIGHT = save[1]; Brush.setSize(0);
        return bad;
      }, [W, H, REF]);
      expect(res).toEqual([]);
    });
  }

  test('radius 9 gives 271 tiles and is clamped to 0..12', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(9);
      const n9 = Brush.getAffectedTiles(225, 224).length;
      Brush.setSize(99); const hi = Brush.getSize();
      Brush.setSize(-4); const lo = Brush.getSize();
      Brush.setSize('x'); const bad = Brush.getSize();
      Brush.setSize(0);
      return { n9, hi, lo, bad, max: Brush.MAX_SIZE };
    });
    expect(r).toEqual({ n9: 271, hi: 12, lo: 0, bad: 0, max: 12 });
  });

  test('edge clipping: cells outside the map are dropped, off-map centre gives none', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(3);
      const corner = Brush.getAffectedTiles(0, 0);
      const inside = corner.every((t: any) => t.col >= 0 && t.row >= 0 && t.col < MAP_WIDTH && t.row < MAP_HEIGHT);
      const off = Brush.getAffectedTiles(-1, 5).length;
      Brush.setSize(0);
      return { n: corner.length, inside, off };
    });
    expect(r.inside).toBe(true);
    expect(r.n).toBeLessThan(37);
    expect(r.n).toBeGreaterThan(8);
    expect(r.off).toBe(0);
  });

  test('[ and ] change the size by code, regardless of the layout character', async ({ page }) => {
    const press = (code: string, key: string) => page.evaluate(([code, key]) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
    }, [code, key]);
    await press('BracketRight', 'ї');
    await press('BracketRight', 'ї');
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    await press('BracketLeft', 'х');
    expect(await page.evaluate(() => Brush.getSize())).toBe(1);
    await press('BracketLeft', 'х'); await press('BracketLeft', 'х');
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
    for (let i = 0; i < 20; i++) await press('BracketRight', ']');
    expect(await page.evaluate(() => Brush.getSize())).toBe(12);
    // a key whose character is '[' but a different physical code must do nothing
    await press('KeyA', '[');
    expect(await page.evaluate(() => Brush.getSize())).toBe(12);
    // the slider and label follow
    expect(await page.evaluate(() => [(document.getElementById('brush-size-range') as HTMLInputElement).value,
      document.getElementById('brush-size-label')!.textContent])).toEqual(['12', 'Radius 12 (469 tiles)']);
  });

  test('slider changes the size and unticks the preset buttons', async ({ page }) => {
    await page.locator('#brush-size-range').fill('7');
    expect(await page.evaluate(() => Brush.getSize())).toBe(7);
    expect(await page.locator('.brush-btn.active').count()).toBe(0);
    await page.locator('.brush-btn[data-brush="2"]').click();
    expect(await page.evaluate(() => (document.getElementById('brush-size-range') as HTMLInputElement).value)).toBe('2');
  });

  test('shortcuts do not fire in an input, select, modal, ctrl-combo or outside the map mode', async ({ page }) => {
    const sz = () => page.evaluate(() => Brush.getSize());
    // focused input
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('BracketRight');
    expect(await sz()).toBe(0);
    await page.evaluate(() => { document.getElementById('tmp-in')!.remove(); const s = document.createElement('select'); s.id = 'tmp-sel'; document.body.appendChild(s); s.focus(); });
    await page.keyboard.press('BracketRight');
    expect(await sz()).toBe(0);
    await page.evaluate(() => { document.getElementById('tmp-sel')!.remove(); (document.activeElement as HTMLElement).blur(); });
    // open modal
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.add('open'));
    await page.keyboard.press('BracketRight');
    expect(await sz()).toBe(0);
    await page.evaluate(() => document.getElementById('newmap-modal')!.classList.remove('open'));
    // ctrl combo
    await page.keyboard.press('Control+BracketRight');
    expect(await sz()).toBe(0);
    // other mode
    await page.evaluate(() => { document.body.classList.remove('mode-map'); });
    await page.keyboard.press('BracketRight');
    expect(await sz()).toBe(0);
    await page.evaluate(() => { document.body.classList.add('mode-map'); });
    await page.keyboard.press('BracketRight');
    expect(await sz()).toBe(1);
  });

  test('hover preview draws exactly the tiles that get painted', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(3);
      Canvas.setZoom?.(100);
      const painted = Brush.getAffectedTiles(225, 224).map((t: any) => t.col + ',' + t.row).sort();
      // the preview and the paint both call Brush.getAffectedTiles for the cursor cell
      const calls: string[] = []; const orig = Brush.getAffectedTiles;
      Brush.getAffectedTiles = (c: number, r: number) => { calls.push(c + ',' + r); return orig(c, r); };
      Canvas.render();
      Brush.getAffectedTiles = orig;
      Brush.setSize(0);
      return { painted: painted.length, calls: calls.length };
    });
    expect(r.painted).toBe(37);
    expect(r.calls).toBeLessThanOrEqual(1);
  });

  test('a click with radius 3 paints exactly the brush set, as one undo step', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Brush.setSize(3); });
    await clickCell(page, 225, 220);
    const r = await page.evaluate(() => {
      const want = new Set(Brush.getAffectedTiles(225, 220).map((t: any) => t.col + ',' + t.row));
      let painted = 0, stray = 0;
      for (let row = 0; row < MAP_HEIGHT; row++) for (let col = 0; col < MAP_WIDTH; col++)
        if (mapData[row * MAP_WIDTH + col] === 'Forest_1') { if (want.has(col + ',' + row)) painted++; else stray++; }
      return { n: want.size, painted, stray };
    });
    expect(r).toEqual({ n: 37, painted: 37, stray: 0 });
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => mapData.filter((id: string) => id === 'Forest_1').length)).toBe(0);
  });

  test('moving the cursor reuses cached offset patterns (work counter) and avoids string-keyed dedup', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(12);
      const b0 = Brush.patternBuilds();
      let adds = 0; const oa = Set.prototype.add;
      Set.prototype.add = function (this: any, v: any) { adds++; return oa.call(this, v); };
      for (let i = 0; i < 400; i++) Brush.getAffectedTiles(100 + (i % 20), 100 + (i >> 4));
      Set.prototype.add = oa;
      const builds = Brush.patternBuilds() - b0;
      // big discs through HexUtils: no dedup Set either
      adds = 0; Set.prototype.add = function (this: any, v: any) { adds++; return oa.call(this, v); };
      const n = HexUtils.discCells(225, 224, 150, 450, 450).length;
      const ring = HexUtils.ringCells(225, 224, 150, 450, 450).length;
      Set.prototype.add = oa;
      Brush.setSize(0);
      return { builds, adds, n, ring };
    });
    expect(r.builds).toBeLessThanOrEqual(2);
    expect(r.adds).toBe(0);
    expect(r.ring).toBe(900);
    expect(r.n).toBeGreaterThan(60000);
  });
});
