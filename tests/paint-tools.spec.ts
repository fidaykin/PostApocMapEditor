import { test, expect } from '@playwright/test';
import { freshEditor, clickCell, dragCells, cellPoint } from './editor-helpers';

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

  // Reference built only from Canvas.hexCenterWorld pixel positions. The six pixel-adjacency vectors are measured
  // at the centre; a BFS over an UNCLIPPED virtual lattice (pixel-key lookup) gives each cell's hex distance, then the
  // caller filters by radius and map bounds.
  const REF = `(c0, r0, R) => {
    const pos = (c, r) => Canvas.hexCenterWorld(c, r);
    const key = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
    const a = pos(c0, r0), byPix = new Map(), W2 = 2 * R + 3;
    for (let c = c0 - W2; c <= c0 + W2; c++) for (let r = r0 - W2; r <= r0 + W2; r++) { const p = pos(c, r); byPix.set(key(p.x, p.y), [c, r]); }
    let d = Infinity;
    for (let c = c0 - 2; c <= c0 + 2; c++) for (let r = r0 - 2; r <= r0 + 2; r++) { const p = pos(c, r), x = Math.hypot(p.x - a.x, p.y - a.y); if (x > 1 && x < d) d = x; }
    const vecs = [];
    for (let c = c0 - 2; c <= c0 + 2; c++) for (let r = r0 - 2; r <= r0 + 2; r++) { const p = pos(c, r); if (Math.hypot(p.x - a.x, p.y - a.y) < d * 1.05 && (c !== c0 || r !== r0)) vecs.push([p.x - a.x, p.y - a.y]); }
    if (vecs.length !== 6) throw new Error('expected 6 adjacency vectors, got ' + vecs.length);
    const dist = new Map([[c0 + ',' + r0, 0]]); let frontier = [[c0, r0]];
    for (let i = 1; i <= R; i++) {
      const next = [];
      for (const [fc, fr] of frontier) { const p = pos(fc, fr);
        for (const [vx, vy] of vecs) { const n = byPix.get(key(p.x + vx, p.y + vy)); if (!n) continue;
          const k = n[0] + ',' + n[1]; if (!dist.has(k)) { dist.set(k, i); next.push(n); } } }
      frontier = next;
    }
    return dist;
  }`;

  for (const [W, H] of [[451, 451], [450, 451], [451, 450], [12, 10], [13, 9]]) {
    test(`brush disc equals the unclipped pixel reference (radii 0..12, corners, edges) on ${W}x${H} (K3)`, async ({ page }) => {
      const res = await page.evaluate(([W, H, ref]) => {
        const refFn = eval(ref as string);
        const save = [MAP_WIDTH, MAP_HEIGHT];
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        const bad: string[] = [];
        const w = W as number, h = H as number, cx = w >> 1, cy = h >> 1;
        const centres = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [cx, 0], [cx, h - 1], [0, cy], [w - 1, cy], [cx, cy], [cx, cy + 1], [cx + 1, cy]];
        for (const [c, r] of centres) {
          const dist = refFn(c, r, 12);
          for (let R = 0; R <= 12; R++) {
            Brush.setSize(R);
            const got = Brush.getAffectedTiles(c, r).map((t: any) => t.col + ',' + t.row).sort().join('|');
            const want = [...dist].filter(([k, d]: any) => {
              if (d > R) return false;
              const [kc, kr] = k.split(',').map(Number);
              return kc >= 0 && kc < w && kr >= 0 && kr < h;
            }).map(([k]: any) => k).sort().join('|');
            if (got !== want) bad.push(`R${R}@${c},${r}`);
          }
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

  test('hover preview draws the painted set as one path (fill/stroke counts) and only with a cursor', async ({ page }) => {
    const pt = await cellPoint(page, 225, 224);
    await page.evaluate(() => { Brush.setSize(3); Canvas.setZoom(100); });
    const count = () => page.evaluate(() => {
      const P = CanvasRenderingContext2D.prototype, of = P.fill, os = P.stroke, oa = Brush.getAffectedTiles;
      let f = 0, s = 0, calls = 0;
      P.fill = function (this: any, ...a: any[]) { f++; return of.apply(this, a as any); };
      P.stroke = function (this: any, ...a: any[]) { s++; return os.apply(this, a as any); };
      Brush.getAffectedTiles = (c: number, r: number) => { calls++; return oa(c, r); };
      Canvas.render();
      P.fill = of; P.stroke = os; Brush.getAffectedTiles = oa;
      return { f, s, calls };
    });
    await page.evaluate(() => document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave')));
    const off = await count();
    await page.mouse.move(pt.x, pt.y);
    const on = await count();
    expect(off.calls).toBe(0);
    expect(on.calls).toBe(1);
    expect(on.f - off.f).toBe(1);
    expect(on.s - off.s).toBe(1);
    expect(await page.evaluate(() => Brush.getAffectedTiles(225, 224).length)).toBe(37);
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

  test('the shortcut still works right after using the slider (focus is not trapped)', async ({ page }) => {
    await page.locator('#brush-size-range').fill('7');
    await page.keyboard.press('BracketRight');
    expect(await page.evaluate(() => Brush.getSize())).toBe(8);
    // even if the slider keeps focus, range inputs do not swallow the key
    await page.evaluate(() => (document.getElementById('brush-size-range') as HTMLInputElement).focus());
    await page.keyboard.press('BracketLeft');
    expect(await page.evaluate(() => Brush.getSize())).toBe(7);
  });

  test('a real text input still blocks the shortcut', async ({ page }) => {
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('BracketRight');
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
  });

  test('label uses the singular for one tile; held key (repeat) is ignored', async ({ page }) => {
    expect(await page.evaluate(() => document.getElementById('brush-size-label')!.textContent)).toBe('Radius 0 (1 tile)');
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight', key: ']', repeat: true, bubbles: true })));
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
  });
});

test.describe('shape tools (T2.4)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const water = async (page: any) => page.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < mapData.length; i++) if (mapData[i] === 'Water_1') out.push((i % MAP_WIDTH) + ',' + Math.floor(i / MAP_WIDTH));
    return out.sort();
  });
  const undoSize = (page: any) => page.evaluate(() => History.undoSize());
  const hl = (page: any) => page.evaluate(() => Canvas.hasHighlight('shape'));
  const select = (page: any, tool: string) => page.evaluate((t: string) => { UI.selectTerrain('Water_1'); Tools.setActive(t); }, tool);
  const triangle = (page: any) => page.evaluate(() => {
    const a = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
    return [a, { q: a.q + 5, r: a.r, s: a.s - 5 }, { q: a.q, r: a.r + 5, s: a.s - 5 }].map(c => HexUtils.fromCube(c, MAP_WIDTH, MAP_HEIGHT));
  });

  test('Line tool paints exactly HexUtils.lineCells and undoes in one step', async ({ page }) => {
    const a = { col: 222, row: 219 }, b = { col: 228, row: 228 };
    await select(page, 'line');
    const before = await undoSize(page);
    await dragCells(page, a, b);
    const want = await page.evaluate(([a, b]) =>
      HexUtils.lineCells(a, b, MAP_WIDTH, MAP_HEIGHT).map((c: any) => c.col + ',' + c.row).sort(), [a, b]);
    expect(await water(page)).toEqual(want);
    expect(await undoSize(page)).toBe(before + 1);
    expect(await hl(page)).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await water(page)).toEqual([]);
  });

  test('Line thickness follows the brush radius', async ({ page }) => {
    await page.evaluate(() => Brush.setSize(1));
    await select(page, 'line');
    await dragCells(page, { col: 222, row: 219 }, { col: 228, row: 228 });
    const want = await page.evaluate(() => {
      const s = new Set<string>();
      for (const c of HexUtils.lineCells({ col: 222, row: 219 }, { col: 228, row: 228 }, MAP_WIDTH, MAP_HEIGHT))
        for (const t of HexUtils.discCells(c.col, c.row, 1, MAP_WIDTH, MAP_HEIGHT)) s.add(t.col + ',' + t.row);
      return [...s].sort();
    });
    expect(await water(page)).toEqual(want);
  });

  test('Circle tool draws a ring of 6*radius cells and Shift fills the disc', async ({ page }) => {
    await select(page, 'circle');
    const edge = await page.evaluate(() => {
      const c = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
      return HexUtils.fromCube({ q: c.q - 4, r: c.r, s: c.s + 4 }, MAP_WIDTH, MAP_HEIGHT);
    });
    await dragCells(page, { col: 225, row: 224 }, edge);
    expect((await water(page)).length).toBe(24);
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 225])).toBe('Plain_1');
    await page.evaluate(() => History.undo());
    await dragCells(page, { col: 225, row: 224 }, edge, { shift: true });
    expect((await water(page)).length).toBe(61);
  });

  test('Polygon tool: three clicks and Enter fill the triangle, one undo step', async ({ page }) => {
    await select(page, 'polygon');
    const verts = await triangle(page);
    const before = await undoSize(page);
    for (const v of verts) await clickCell(page, v.col, v.row);
    expect(await hl(page)).toBe(true);
    expect(await undoSize(page)).toBe(before);
    await page.keyboard.press('Enter');
    const want = await page.evaluate((verts) => {
      const cubes = verts.map((v: any) => HexUtils.toCube(v.col, v.row, MAP_WIDTH, MAP_HEIGHT));
      return HexUtils.polygonCells(cubes, MAP_WIDTH, MAP_HEIGHT, true).map((c: any) => c.col + ',' + c.row).sort();
    }, verts);
    expect(await water(page)).toEqual(want);
    expect(want.length).toBeGreaterThan(20);
    expect(await undoSize(page)).toBe(before + 1);
    expect(await hl(page)).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await water(page)).toEqual([]);
  });

  test('Polygon: Shift+Enter draws the outline only; double-click closes', async ({ page }) => {
    await select(page, 'polygon');
    const verts = await triangle(page);
    for (const v of verts) await clickCell(page, v.col, v.row);
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    const outline = await water(page);
    const want = await page.evaluate((verts) => {
      const cubes = verts.map((v: any) => HexUtils.toCube(v.col, v.row, MAP_WIDTH, MAP_HEIGHT));
      return HexUtils.polygonCells(cubes, MAP_WIDTH, MAP_HEIGHT, false).map((c: any) => c.col + ',' + c.row).sort();
    }, verts);
    expect(outline).toEqual(want);
    await page.evaluate(() => History.undo());
    const before = await undoSize(page);
    await clickCell(page, verts[0].col, verts[0].row);
    await clickCell(page, verts[1].col, verts[1].row);
    const p = await cellPoint(page, verts[2].col, verts[2].row);
    await page.mouse.dblclick(p.x, p.y);
    expect((await water(page)).length).toBeGreaterThan(20);
    expect(await undoSize(page)).toBe(before + 1);
  });

  test('Escape cancels every shape without a history step and clears the highlight', async ({ page }) => {
    const before = await undoSize(page);
    await select(page, 'polygon');
    const verts = await triangle(page);
    for (const v of verts) await clickCell(page, v.col, v.row);
    expect(await hl(page)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await hl(page)).toBe(false);
    await page.keyboard.press('Enter');          // nothing pending any more
    await select(page, 'line');
    const pa = await cellPoint(page, 222, 219), pb = await cellPoint(page, 228, 228);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await hl(page)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await hl(page)).toBe(false);
    await page.mouse.up();
    expect(await water(page)).toEqual([]);
    expect(await undoSize(page)).toBe(before);
  });

  test('tool switch clears the preview and drops pending polygon corners', async ({ page }) => {
    await select(page, 'polygon');
    const verts = await triangle(page);
    for (const v of verts) await clickCell(page, v.col, v.row);
    await page.keyboard.press('KeyL');
    expect(await hl(page)).toBe(false);
    await page.keyboard.press('KeyG');
    await page.keyboard.press('Enter');
    expect(await water(page)).toEqual([]);
  });

  test('mouseup outside the canvas finishes the line cleanly (no stuck state)', async ({ page }) => {
    await select(page, 'line');
    const before = await undoSize(page);
    const pa = await cellPoint(page, 222, 219), pb = await cellPoint(page, 228, 228);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    await page.mouse.move(pb.x, 5000, { steps: 3 });         // leave the canvas / window while held
    await page.mouse.up();
    expect(await undoSize(page)).toBe(before + 1);
    expect(await hl(page)).toBe(false);
    expect((await water(page)).length).toBeGreaterThan(5);
    await page.mouse.move(pa.x, pa.y);                        // moving afterwards draws nothing
    await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await hl(page)).toBe(false);
    expect(await undoSize(page)).toBe(before + 1);
  });

  test('a zero-length line paints one cell; clicks off the map or with the right button do nothing', async ({ page }) => {
    await select(page, 'line');
    const before = await undoSize(page);
    await clickCell(page, 225, 224);
    expect(await water(page)).toEqual(['225,224']);
    expect(await undoSize(page)).toBe(before + 1);
    const p = await cellPoint(page, 230, 230);
    await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(p.x + 40, p.y, { steps: 3 }); await page.mouse.up({ button: 'right' });
    expect(await undoSize(page)).toBe(before + 1);
    expect(await hl(page)).toBe(false);
  });

  test('a single polygon corner plus Enter is discarded without a history step', async ({ page }) => {
    await select(page, 'polygon');
    const before = await undoSize(page);
    await clickCell(page, 225, 224);
    await page.keyboard.press('Enter');
    expect(await undoSize(page)).toBe(before);
    expect(await hl(page)).toBe(false);
    expect(await water(page)).toEqual([]);
  });

  test('shape input is ignored while a fill runs', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const canvas = document.getElementById('map-canvas')!, rc = canvas.getBoundingClientRect();
      const ev = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); return new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, bubbles: true }); };
      const p = Tools.fill(225, 225);                      // whole blank map: runs time-sliced
      const busy = Tools.isFillBusy();
      const before = History.undoSize();
      const out: any = { busy, hl: [] as boolean[] };
      for (const tool of ['line', 'circle', 'polygon']) {
        Tools.setActive(tool);
        canvas.dispatchEvent(ev('mousedown', 222, 219)); canvas.dispatchEvent(ev('mousemove', 228, 228));
        out.hl.push(Canvas.hasHighlight('shape'));
        canvas.dispatchEvent(ev('mouseup', 228, 228));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      out.sizeDuring = History.undoSize() - before;
      await p;
      out.hlAfter = Canvas.hasHighlight('shape');
      return out;
    });
    expect(r.busy).toBe(true);
    expect(r.hl).toEqual([false, false, false]);
    expect(r.sizeDuring).toBe(0);
    expect(r.hlAfter).toBe(false);
  });

  test('highlight adds exactly one path (one fill, one stroke) at LOD 0/1 and one fill at LOD 2 (675-cell diagonal)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cells = HexUtils.lineCells({ col: 0, row: 0 }, { col: 449, row: 449 }, MAP_WIDTH, MAP_HEIGHT);
      const ctx = Canvas.getCtx(); const out: any = { n: cells.length };
      const os = ctx.stroke.bind(ctx), of = ctx.fill.bind(ctx);
      const count = () => {
        let strokes = 0, fills = 0;
        ctx.stroke = () => { strokes++; os(); }; ctx.fill = () => { fills++; of(); };
        Canvas.render();
        ctx.stroke = os; ctx.fill = of;
        return { strokes, fills };
      };
      for (const lod of [0, 1, 2]) {
        Canvas._test.setLod(lod);
        Canvas.setZoom(lod === 2 ? 5 : lod === 1 ? 15 : 100);
        Canvas.setHighlight('shape', null);
        Canvas.render();
        const base = count();
        Canvas.setHighlight('shape', cells, { stroke: 'rgba(255,0,0,1)', fill: 'rgba(255,0,0,0.2)' });
        const withHl = count();
        out['lod' + lod] = { dStrokes: withHl.strokes - base.strokes, dFills: withHl.fills - base.fills };
        Canvas.setHighlight('shape', null);
      }
      Canvas._test.setLod(null);
      return out;
    });
    expect(r.n).toBe(675);
    expect(r.lod0).toEqual({ dStrokes: 1, dFills: 1 });
    expect(r.lod1).toEqual({ dStrokes: 1, dFills: 1 });
    expect(r.lod2).toEqual({ dStrokes: 0, dFills: 1 });
  });

  for (const tool of ['line', 'circle', 'rect']) {
    test(`switching tool mid ${tool} drag leaves no stuck drag (Paint writes nothing, no stray history)`, async ({ page }) => {
      await select(page, tool);
      const before = await undoSize(page);
      const pa = await cellPoint(page, 222, 219), pm = await cellPoint(page, 225, 224), pb = await cellPoint(page, 228, 228);
      await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pm.x, pm.y, { steps: 3 });
      await page.keyboard.press('KeyP');
      expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
      await page.mouse.move(pb.x, pb.y, { steps: 5 });
      await page.mouse.up();
      expect(await water(page)).toEqual([]);
      expect(await undoSize(page)).toBe(before);
      expect(await hl(page)).toBe(false);
    });
  }

  test('one mousemove during a line drag or a polygon hover is ONE full render', async ({ page }) => {
    const fullRenders = () => page.evaluate(() => (window as any).__full);
    await page.evaluate(() => {
      const ctx = Canvas.getCtx(), cv = document.getElementById('map-canvas') as HTMLCanvasElement, of = ctx.fillRect.bind(ctx);
      (window as any).__full = 0;
      ctx.fillRect = (x: number, y: number, w: number, h: number) => { if (x === 0 && y === 0 && w === cv.width && h === cv.height) (window as any).__full++; of(x, y, w, h); };
    });
    await select(page, 'line');
    const pa = await cellPoint(page, 222, 219), pb = await cellPoint(page, 228, 228);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down();
    const b0 = await fullRenders();
    await page.mouse.move(pb.x, pb.y);
    expect((await fullRenders()) - b0).toBe(1);
    await page.mouse.up();
    await select(page, 'polygon');
    await clickCell(page, 222, 219);
    const b1 = await fullRenders();
    await page.mouse.move(pb.x, pb.y);
    expect((await fullRenders()) - b1).toBe(1);
  });

  test('a right-button release during a left drag does not commit the shape early', async ({ page }) => {
    await select(page, 'line');
    const before = await undoSize(page);
    const pa = await cellPoint(page, 222, 219), pb = await cellPoint(page, 228, 228);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    expect(await undoSize(page)).toBe(before);
    expect(await hl(page)).toBe(true);
    await page.mouse.up();
    expect(await undoSize(page)).toBe(before + 1);      // (the right click is the eyedropper, so the terrain may have changed)
    expect(await hl(page)).toBe(false);
  });

  test('replacing the map clears a pending shape preview, mouse moves do not resurrect it, Enter says why', async ({ page }) => {
    await select(page, 'polygon');
    const verts = await triangle(page);
    for (const v of verts.slice(0, 2)) await clickCell(page, v.col, v.row);
    expect(await hl(page)).toBe(true);
    await page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
    await page.evaluate(() => { IO.newMap(true); Canvas.render(); });
    expect(await hl(page)).toBe(false);
    const p = await cellPoint(page, 230, 230);
    await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 30, p.y + 10, { steps: 3 });
    expect(await hl(page)).toBe(false);
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Shape cancelled — the map changed');
    await page.keyboard.press('Enter');
    expect(await water(page)).toEqual([]);
  });

  test('Enter after a map replacement (no mouse move) cancels with a message', async ({ page }) => {
    await select(page, 'polygon');
    const verts = await triangle(page);
    for (const v of verts) await clickCell(page, v.col, v.row);
    await page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; IO.newMap(true); Canvas.render(); });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Shape cancelled — the map changed');
    expect(await water(page)).toEqual([]);
  });

  for (const vp of [{ width: 1400, height: 900 }, { width: 1100, height: 700 }]) {
    test(`shape tool buttons exist, are visible inside ${vp.width}x${vp.height} and clickable (placed outside the toolbar)`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      for (const tool of ['line', 'circle', 'polygon', 'rect']) {
        const btn = page.locator(`.tool-btn[data-tool="${tool}"]`);
        await expect(btn).toBeVisible();
        const box = (await btn.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width); expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
        await btn.click();
        expect(await page.evaluate(() => Tools.getActive())).toBe(tool);
        await expect(btn).toHaveClass(/active/);
      }
      // Placement guard: the toolbar's width sets the page (and canvas) width, so the shape buttons must not be in #map-tools.
      expect(await page.evaluate(() => [!!document.querySelector('#map-tools [data-tool=line]'), !!document.querySelector('#shape-tools [data-tool=line]'),
        !!document.querySelector('#map-tools [data-tool=polygon]'), !!document.querySelector('#shape-tools [data-tool=polygon]')])).toEqual([false, true, false, true]);
    });
  }

  test('canvas width at 1400x900 equals the perf-hash baseline width (1491)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width)).toBe(1491);
  });

  for (const button of [3, 4]) {
    test(`side mouse button ${button} down/up never starts Paint or leaves it stuck`, async ({ page }) => {
      await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('paint'); });
      const before = await undoSize(page);
      const r = await page.evaluate(async (button) => {
        const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
        const ev = (t: string, dx: number, buttons: number, b = 0) => new MouseEvent(t, { clientX: rc.left + p.x + dx, clientY: rc.top + p.y, button: b, buttons, bubbles: true });
        cv.dispatchEvent(ev('mousedown', 0, 1 << button, button)); cv.dispatchEvent(ev('mouseup', 0, 0, button));
        for (let i = 0; i < 20; i++) cv.dispatchEvent(ev('mousemove', i * 7, 0));
        let w = 0; for (const x of mapData) if (x === 'Water_1') w++;
        return w;
      }, button);
      expect(r).toBe(0);
      expect(await undoSize(page)).toBe(before);
    });
  }

  test('side button during Rect leaves no stuck preview', async ({ page }) => {
    await select(page, 'rect');
    const r = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
      const ev = (t: string, dx: number, buttons: number, b = 0) => new MouseEvent(t, { clientX: rc.left + p.x + dx, clientY: rc.top + p.y, button: b, buttons, bubbles: true });
      cv.dispatchEvent(ev('mousedown', 0, 8, 3)); cv.dispatchEvent(ev('mouseup', 0, 0, 3));
      for (let i = 0; i < 10; i++) cv.dispatchEvent(ev('mousemove', i * 9, 0));
      return _toolsRectPreview;
    });
    expect(r).toBeNull();
  });

  test('a lost mouseup (move with no button held) finishes the drag and nothing paints afterwards', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); Tools.setActive('paint'); });
    const r = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
      const ev = (t: string, dx: number, buttons: number) => new MouseEvent(t, { clientX: rc.left + p.x + dx, clientY: rc.top + p.y, button: 0, buttons, bubbles: true });
      const count = () => { let w = 0; for (const x of mapData) if (x === 'Water_1') w++; return w; };
      cv.dispatchEvent(ev('mousedown', 0, 1));
      const down = count();
      cv.dispatchEvent(ev('mousemove', 70, 0));           // button released elsewhere: no mouseup was delivered
      const afterLost = count();
      for (let i = 0; i < 15; i++) cv.dispatchEvent(ev('mousemove', 80 + i * 9, 0));
      return { down, afterLost, end: count() };
    });
    expect(r.down).toBe(1);
    expect(r.end).toBe(r.afterLost);
  });

  test('L, O, G select the shape tools by physical key and respect text focus', async ({ page }) => {
    for (const [code, tool] of [['KeyL', 'line'], ['KeyO', 'circle'], ['KeyG', 'polygon']]) {
      await page.keyboard.press(code);
      expect(await page.evaluate(() => Tools.getActive())).toBe(tool);
    }
    await page.evaluate(() => Tools.setActive('paint'));
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyL');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-in')!.remove());
    await page.keyboard.press('Control+KeyL');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  });
});

// In-page helpers (evaluated inside page.evaluate): independent pixel-geometry mirror of cells about the centre cell.
const SYM_HELPERS = `(() => {
  const key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);
  const cx = Math.floor(MAP_WIDTH / 2), cy = Math.floor((MAP_HEIGHT - 1) / 2);
  const mid = Canvas.hexCenterWorld(cx, cy);
  const byPix = new Map();
  for (let c = Math.max(0, cx - 60); c <= Math.min(MAP_WIDTH - 1, cx + 60); c++)
    for (let r = Math.max(0, cy - 60); r <= Math.min(MAP_HEIGHT - 1, cy + 60); r++) { const p = Canvas.hexCenterWorld(c, r); byPix.set(key(p.x, p.y), [c, r]); }
  const mirrorH = (col, row) => { const p = Canvas.hexCenterWorld(col, row); const h = byPix.get(key(2 * mid.x - p.x, p.y)); return h ? { col: h[0], row: h[1] } : null; };
  const cellsWith = id => { const o = []; for (let i = 0; i < mapData.length; i++) if (mapData[i] === id) o.push({ col: i % MAP_WIDTH, row: Math.floor(i / MAP_WIDTH) }); return o; };
  const mirrorClosed = id => { const cs = cellsWith(id); const set = new Set(cs.map(c => c.col + ',' + c.row)); return cs.length > 0 && cs.every(c => { const m = mirrorH(c.col, c.row); return m && set.has(m.col + ',' + m.row); }); };
  return { key, mid, byPix, mirrorH, cellsWith, mirrorClosed };
})()`;

test.describe('symmetry (T2.5)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('each mode multiplies a single off-axis stroke', async ({ page }) => {
    const counts = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const c = HexUtils.toCube(225, 224, W, H);
      const p = HexUtils.fromCube({ q: c.q + 3, r: c.r - 1, s: c.s - 2 }, W, H);
      const out: Record<string, number> = {};
      for (const mode of ['none', 'h', 'v', 'hv', 'rot3', 'rot6']) {
        mapData.fill('Plain_1');
        Tools.setSymmetry(mode);
        Tools.applyTerrainCells([p], 'Water_1');
        out[mode] = mapData.filter((id: string) => id === 'Water_1').length;
      }
      Tools.setSymmetry('none');
      return out;
    });
    expect(counts).toEqual({ none: 1, h: 2, v: 2, hv: 4, rot3: 3, rot6: 6 });
  });

  test("mode 'h' is a true left/right mirror in screen pixels, and Y cycles", async ({ page }) => {
    const ok = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const c = HexUtils.toCube(225, 224, W, H);
      const p = HexUtils.fromCube({ q: c.q + 3, r: c.r - 1, s: c.s - 2 }, W, H);
      Tools.setSymmetry('h');
      Tools.applyTerrainCells([p], 'Water_1');
      const pts: any[] = [];
      mapData.forEach((id: string, i: number) => { if (id === 'Water_1') pts.push(Canvas.hexCenterWorld(i % W, Math.floor(i / W))); });
      const mid = Canvas.hexCenterWorld(225, 224);
      Tools.setSymmetry('none');
      return pts.length === 2 && Math.abs((pts[0].x + pts[1].x) / 2 - mid.x) < 1e-6 && Math.abs(pts[0].y - pts[1].y) < 1e-6;
    });
    expect(ok).toBe(true);
    await page.keyboard.press('y');
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('h');
  });

  // Independent reference: the images of each cell's pixel centre (reflection / clockwise rotation about the
  // centre cell's pixel centre) must be exactly the centres of the cells symmetryCells returns, including clipping.
  for (const [W, H] of [[12, 10], [13, 9], [9, 13], [10, 12], [12, 11], [11, 12], [451, 451], [450, 451], [451, 450], [450, 450]]) {
    test(`symmetryCells matches the pixel-geometry reference on ${W}x${H}`, async ({ page }) => {
      const bad = await page.evaluate(([W, H]) => {
        const save = [MAP_WIDTH, MAP_HEIGHT];
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        const w = W as number, h = H as number, cx = Math.floor(w / 2), cy = Math.floor((h - 1) / 2);
        const key = (x: number, y: number) => Math.round(x * 100) + ',' + Math.round(y * 100);
        const byPix = new Map<string, number[]>();
        const big = w > 100;
        const c0 = big ? cx - 40 : 0, c1 = big ? cx + 40 : w - 1, r0 = big ? cy - 40 : 0, r1 = big ? cy + 40 : h - 1;
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const p = Canvas.hexCenterWorld(c, r); byPix.set(key(p.x, p.y), [c, r]); }
        const mid = Canvas.hexCenterWorld(cx, cy);
        const imgs = (mode: string, x: number, y: number) => {
          const dx = x - mid.x, dy = y - mid.y;
          const rot = (k: number) => { const a = k * Math.PI / 3, co = Math.cos(a), si = Math.sin(a); return [mid.x + co * dx - si * dy, mid.y + si * dx + co * dy]; };
          switch (mode) {
            case 'h': return [[x, y], [mid.x - dx, y]];
            case 'v': return [[x, y], [x, mid.y - dy]];
            case 'hv': return [[x, y], [mid.x - dx, y], [x, mid.y - dy], [mid.x - dx, mid.y - dy]];
            case 'rot3': return [rot(0), rot(2), rot(4)];
            default: return [0, 1, 2, 3, 4, 5].map(rot);
          }
        };
        const bad: string[] = [];
        const span = big ? 20 : 99;
        const cells: any[] = [];
        for (let c = Math.max(c0, cx - span); c <= Math.min(c1, cx + span); c += big ? 3 : 1)
          for (let r = Math.max(r0, cy - span); r <= Math.min(r1, cy + span); r += big ? 3 : 1) cells.push({ col: c, row: r });
        for (const mode of ['h', 'v', 'hv', 'rot3', 'rot6']) {
          for (const cell of cells) {
            const p = Canvas.hexCenterWorld(cell.col, cell.row);
            const want = new Set<string>();
            for (const [x, y] of imgs(mode, p.x, p.y)) { const hit = byPix.get(key(x, y)); if (hit) want.add(hit.join(',')); }
            const got = HexUtils.symmetryCells([cell], mode, { col: cx, row: cy }, w, h).map((t: any) => t.col + ',' + t.row);
            if (new Set(got).size !== got.length || got.length !== want.size || got.some((g: string) => !want.has(g))) bad.push(`${mode}@${cell.col},${cell.row}`);
          }
        }
        MAP_WIDTH = save[0]; MAP_HEIGHT = save[1];
        return bad.slice(0, 10);
      }, [W, H]);
      expect(bad).toEqual([]);
    });
  }

  test('symmetryCells agrees with the cube-based symmetryCubes and dedups a multi-cell brush', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT, ctr = { col: 225, row: 224 };
      Brush.setSize(12);
      const cells = Brush.getAffectedTiles(ctr.col + 4, ctr.row - 5);
      Brush.setSize(0);
      const bad: string[] = [];
      for (const mode of ['h', 'v', 'hv', 'rot3', 'rot6']) {
        const got = HexUtils.symmetryCells(cells, mode, ctr, W, H);
        const cen = HexUtils.toCube(ctr.col, ctr.row, W, H);
        const ref = HexUtils.cellsFromCubes(cells.flatMap((c: any) => HexUtils.symmetryCubes(HexUtils.toCube(c.col, c.row, W, H), mode, cen)), W, H);
        const a = got.map((t: any) => t.col + ',' + t.row).sort().join('|'), b = ref.map((t: any) => t.col + ',' + t.row).sort().join('|');
        if (a !== b || new Set(got.map((t: any) => t.col + ',' + t.row)).size !== got.length) bad.push(mode);
      }
      return { bad, n: cells.length, none: HexUtils.symmetryCells(cells, 'none', ctr, W, H) === cells };
    });
    expect(r).toEqual({ bad: [], n: 469, none: true });
  });

  test('a brush on the axis and on the centre is not doubled; one undo step for all copies', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.setSymmetry('rot6');
      mapData.fill('Plain_1');
      Tools.applyTerrainCells([{ col: 225, row: 224 }], 'Water_1');
      const centre = mapData.filter((id: string) => id === 'Water_1').length;
      Tools.setSymmetry('none');
      return centre;
    });
    expect(r).toBe(1);
    await page.evaluate(() => { Tools.setSymmetry('hv'); mapData.fill('Plain_1'); });
    const before = await page.evaluate(() => History.undoSize());
    await clickCell(page, 230, 220);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 1);
    expect(await page.evaluate(() => mapData.filter((id: string) => id === 'Plain_1').length)).toBe(450 * 450);   // Plain_1 selected: same id; use water below
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await clickCell(page, 230, 220);
    expect(await page.evaluate(() => mapData.filter((id: string) => id === 'Water_1').length)).toBe(4);
    expect(await page.evaluate(() => History.undoSize())).toBe(before + 2);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => mapData.filter((id: string) => id === 'Water_1').length)).toBe(0);
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  test('copies that fall off the map are skipped, the rest still painted', async ({ page }) => {
    const n = await page.evaluate(() => {
      mapData.fill('Plain_1');
      Tools.setSymmetry('rot6');
      const p = { col: 0, row: 0 };   // map corner: most rotations fall outside
      const want = HexUtils.symmetryCells([p], 'rot6', { col: 225, row: 224 }, MAP_WIDTH, MAP_HEIGHT).length;
      const wrote = Tools.applyTerrainCells([p], 'Water_1').length;
      Tools.setSymmetry('none');
      return { want, wrote, water: mapData.filter((id: string) => id === 'Water_1').length };
    });
    expect(n.wrote).toBe(n.want);
    expect(n.water).toBe(n.want);
    expect(n.want).toBeLessThan(6);
    expect(n.want).toBeGreaterThan(0);
  });

  test('opts.noSymmetry and multi-tile terrain bypass the expansion', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.setSymmetry('h');
      mapData.fill('Plain_1');
      const p = { col: 230, row: 220 };
      const a = Tools.applyTerrainCells([p], 'Water_1', { noSymmetry: true }).length;
      const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
      let b = -1;
      if (multi) { Tools.setSymmetry('h'); b = Tools.applyTerrainCells([p], multi.id).length; }
      Tools.setSymmetry('none');
      return { a, hasMulti: !!multi, b };
    });
    expect(r.a).toBe(1);
    expect(r.hasMulti).toBe(true);
    expect(r.b).toBe(1);
  });

  test('shape tools and Rectangle write all copies (one step), and the preview shows them', async ({ page }) => {
    await page.evaluate(() => { Tools.setSymmetry('h'); UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
    const before = await page.evaluate(() => History.undoSize());
    await dragCells(page, { col: 226, row: 220 }, { col: 228, row: 222 });
    const res = await page.evaluate(() => ({
      water: mapData.filter((id: string) => id === 'Forest_1').length, steps: History.undoSize(),
      hl: Canvas.hasHighlight('shape'),
    }));
    expect(res.water).toBe(18);
    expect(res.steps).toBe(before + 1);
    expect(res.hl).toBe(false);   // preview layer dropped after commit
    // mid-drag: the preview layer holds exactly both copies (9 + 9 cells) at the pixel-geometry positions
    await page.evaluate(() => { mapData.fill('Plain_1'); });
    const pa = await cellPoint(page, 226, 220), pb = await cellPoint(page, 228, 222);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    const pv = await page.evaluate((H) => {
      const h = eval(H as string);
      const pts = Canvas.getHighlightPoints('shape');
      const want = new Set<string>();
      for (let c = 226; c <= 228; c++) for (let r = 220; r <= 222; r++) {
        const p = Canvas.hexCenterWorld(c, r);
        want.add(h.key(p.x, p.y)); want.add(h.key(2 * h.mid.x - p.x, p.y));
      }
      const got = new Set<string>();
      for (let i = 0; i < pts.n; i++) got.add(h.key(pts.xs[i], pts.ys[i]));
      return { n: pts.n, same: got.size === want.size && [...got].every(k => want.has(k)) };
    }, SYM_HELPERS);
    expect(pv).toEqual({ n: 18, same: true });
    await page.mouse.up();
    await page.evaluate(() => { Tools.setSymmetry('none'); Tools.setActive('paint'); });
  });

  test('turning symmetry off mid-rectangle clears the stale copies and commits only the rectangle', async ({ page }) => {
    await page.evaluate(() => { Tools.setSymmetry('h'); UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
    const pa = await cellPoint(page, 226, 220), pb = await cellPoint(page, 228, 222);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    expect(await page.evaluate(() => Canvas.getHighlightPoints('shape')?.n)).toBe(18);
    await page.evaluate(() => Tools.setSymmetry('none'));
    expect(await page.evaluate(() => Canvas.hasHighlight('shape'))).toBe(false);
    await page.mouse.move(pb.x + 1, pb.y, { steps: 2 });
    expect(await page.evaluate(() => Canvas.hasHighlight('shape'))).toBe(false);
    await page.mouse.up();
    expect(await page.evaluate(() => mapData.filter((id: string) => id === 'Forest_1').length)).toBe(9);
  });

  test('a map replaced during a rectangle drag cancels it with a toast (no write, no history step)', async ({ page }) => {
    await page.evaluate(() => { Tools.setSymmetry('h'); UI.selectTerrain('Forest_1'); Tools.setActive('rect'); });
    const pa = await cellPoint(page, 226, 220), pb = await cellPoint(page, 228, 222);
    await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 3 });
    const before = await page.evaluate(() => { IO.newMap(true); (window as any).__t = 0; return History.undoSize(); });
    await page.mouse.move(pb.x + 3, pb.y, { steps: 2 });
    await page.mouse.up();
    const r = await page.evaluate(() => ({ forest: mapData.filter((id: string) => id === 'Forest_1').length, steps: History.undoSize(), hl: Canvas.hasHighlight('shape'),
      toast: document.body.innerText.includes('Shape cancelled') }));
    expect(r.forest).toBe(0);
    expect(r.steps).toBe(before);
    expect(r.hl).toBe(false);
    expect(r.toast).toBe(true);
  });

  test('Line, Circle and Polygon commits and previews are mirrored, one history step each', async ({ page }) => {
    await page.evaluate(() => { Tools.setSymmetry('h'); UI.selectTerrain('Forest_1'); });
    const shapes: Array<[string, any, any]> = [['line', { col: 226, row: 219 }, { col: 230, row: 221 }], ['circle', { col: 228, row: 220 }, { col: 230, row: 220 }]];
    for (const [tool, a, b] of shapes) {
      await page.evaluate((t) => { mapData.fill('Plain_1'); Tools.setActive(t as string); }, tool);
      const before = await page.evaluate(() => History.undoSize());
      const pa = await cellPoint(page, a.col, a.row), pb = await cellPoint(page, b.col, b.row);
      await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pb.x, pb.y, { steps: 4 });
      const prev = await page.evaluate((H) => { const h = eval(H as string); const pts = Canvas.getHighlightPoints('shape'); const set = new Set<string>(); for (let i = 0; i < pts.n; i++) set.add(h.key(pts.xs[i], pts.ys[i]));
        let closed = true; for (let i = 0; i < pts.n; i++) if (!set.has(h.key(2 * h.mid.x - pts.xs[i], pts.ys[i]))) closed = false; return { n: pts.n, closed }; }, SYM_HELPERS);
      await page.mouse.up();
      const res = await page.evaluate((H) => { const h = eval(H as string); return { n: h.cellsWith('Forest_1').length, closed: h.mirrorClosed('Forest_1'), steps: History.undoSize() }; }, SYM_HELPERS);
      expect(res.closed, tool).toBe(true);
      expect(res.steps, tool).toBe(before + 1);
      expect(prev.closed, tool).toBe(true);
      expect(prev.n, tool).toBe(res.n);
      expect(res.n, tool).toBeGreaterThan(4);
    }
    // polygon: three corners then Enter; the preview after the third corner already shows both copies
    await page.evaluate(() => { mapData.fill('Plain_1'); Tools.setActive('polygon'); });
    const before = await page.evaluate(() => History.undoSize());
    for (const c of [{ col: 226, row: 219 }, { col: 230, row: 219 }, { col: 228, row: 222 }]) { const p = await cellPoint(page, c.col, c.row); await page.mouse.click(p.x, p.y); }
    const pv = await page.evaluate((H) => { const h = eval(H as string); const pts = Canvas.getHighlightPoints('shape'); const set = new Set<string>(); for (let i = 0; i < pts.n; i++) set.add(h.key(pts.xs[i], pts.ys[i]));
      let closed = true; for (let i = 0; i < pts.n; i++) if (!set.has(h.key(2 * h.mid.x - pts.xs[i], pts.ys[i]))) closed = false; return { n: pts.n, closed }; }, SYM_HELPERS);
    expect(pv.closed).toBe(true);
    await page.keyboard.press('Enter');
    const res = await page.evaluate((H) => { const h = eval(H as string); return { n: h.cellsWith('Forest_1').length, closed: h.mirrorClosed('Forest_1'), steps: History.undoSize() }; }, SYM_HELPERS);
    expect(res.closed).toBe(true);
    expect(res.steps).toBe(before + 1);
    expect(res.n).toBeGreaterThan(pv.n - 1);
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  test('an axis cell under hv paints 2 cells, not 4; the centre cell paints 1', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.setSymmetry('hv');
      const out: number[] = [];
      for (const c of [{ col: 225, row: 230 }, { col: 232, row: 224 }, { col: 225, row: 224 }]) {
        mapData.fill('Plain_1');
        out.push(Tools.applyTerrainCells([c], 'Water_1').length);
      }
      Tools.setSymmetry('none');
      return out;
    });
    expect(r).toEqual([2, 2, 1]);
  });

  test('a far copy has its neighbours re-resolved (directional river tiles), together with the near one', async ({ page }) => {
    const r = await page.evaluate((H) => {
      const h = eval(H as string);
      const W = MAP_WIDTH;
      const river = HexDB.getAll().find((x: any) => x.type === 'Rivers' && Array.isArray(x.edgeFaces) && x.edgeFaces.length > 0).id;
      const c = { col: 228, row: 220 }, far = h.mirrorH(c.col, c.row);
      const nbs = HexUtils.neighbors(c.col, c.row, W, MAP_HEIGHT);
      const nb = nbs[0], nbFar = h.mirrorH(nb.col, nb.row);
      for (const p of [c, far, nb, nbFar]) mapData[p.row * W + p.col] = river;
      const seen: string[] = [];
      const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (col: number, row: number, ...rest: any[]) => { seen.push(col + ',' + row); return orig(col, row, ...rest); };
      Tools.setSymmetry('h');
      Tools.applyTerrainCells([c], 'Plain_1');
      Tools.setSymmetry('none');
      EdgeTiling.resolveEdgeTile = orig;
      return { seen, nb: nb.col + ',' + nb.row, nbFar: nbFar.col + ',' + nbFar.row, farPainted: mapData[far.row * W + far.col] };
    }, SYM_HELPERS);
    expect(r.farPainted).toBe('Plain_1');
    expect(r.seen).toContain(r.nb);
    expect(r.seen).toContain(r.nbFar);
  });

  test('hover preview draws every copy in one path; the guide only exists while a mode is active', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ctx = (document.getElementById('map-canvas') as HTMLCanvasElement).getContext('2d')!;
      const counts = { stroke: 0, dash: 0 };
      const os = ctx.stroke.bind(ctx), od = ctx.setLineDash.bind(ctx);
      ctx.stroke = () => { counts.stroke++; return os(); };
      ctx.setLineDash = (d: number[]) => { if (d.length) counts.dash++; return od(d); };
      const run = (mode: string) => { Tools.setSymmetry(mode); counts.stroke = 0; counts.dash = 0; Canvas.render(); return { ...counts }; };
      const off = run('none'), on = run('hv'), rot = run('rot6');
      Tools.setSymmetry('none');
      return { off, on, rot, guide: Canvas.getSymmetryGuide() };
    });
    expect(r.on.dash).toBe(r.off.dash + 1);
    expect(r.rot.dash).toBe(r.off.dash + 1);
    expect(r.on.stroke).toBe(r.off.stroke + 2);   // guide lines + centre ring
    expect(r.guide).toBe('none');
  });

  test('the hover cursor draws the copies: +3 hexes (1 moveTo each) and +2 guide lines for hv', async ({ page }) => {
    const p = await cellPoint(page, 230, 220);
    await page.mouse.move(p.x, p.y);
    const r = await page.evaluate(() => {
      const ctx = (document.getElementById('map-canvas') as HTMLCanvasElement).getContext('2d')!;
      let n = 0; const om = ctx.moveTo.bind(ctx);
      ctx.moveTo = (x: number, y: number) => { n++; return om(x, y); };
      const run = (m: string) => { Tools.setSymmetry(m); n = 0; Canvas.render(); return n; };
      const off = run('none'), on = run('hv');
      Tools.setSymmetry('none');
      return { off, on };
    });
    expect(r.on - r.off).toBe(5);
  });

  test('the cursor preview expands once per cursor cell: pan/zoom renders reuse it; radius 12 x rot6 sizes', async ({ page }) => {
    const p = await cellPoint(page, 230, 220);
    await page.mouse.move(p.x, p.y);
    const r = await page.evaluate(() => {
      let calls = 0; const orig = Tools.expandSymmetry;
      Tools.expandSymmetry = (c: any) => { calls++; return orig(c); };
      Brush.setSize(12);
      const cells = Brush.getAffectedTiles(240, 200);
      const exp = HexUtils.symmetryCells(cells, 'rot6', { col: 225, row: 224 }, MAP_WIDTH, MAP_HEIGHT);
      Tools.setSymmetry('rot6'); Canvas.render();   // the first expansion for this cursor cell / mode / radius
      const first = calls;
      for (let i = 0; i < 5; i++) Canvas.render();   // unchanged cursor: cache hits
      const afterSame = calls;
      Brush.setSize(11); Canvas.render();            // radius change: a new expansion
      const afterRadius = calls;
      Tools.expandSymmetry = orig;
      Tools.setSymmetry('none'); Brush.setSize(0);
      return { n: cells.length, m: exp.length, first, afterSame, afterRadius };
    });
    expect(r.n).toBe(469);
    expect(r.m).toBeGreaterThan(469 * 5);
    expect(r.m).toBeLessThanOrEqual(469 * 6);
    expect(r.first).toBe(1);
    expect(r.afterSame).toBe(1);
    expect(r.afterRadius).toBe(2);
  });

  test('palette control sits in the left palette and keeps the perf-hash canvas width (1491 at 1400x900)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect(await page.evaluate(() => !!document.querySelector('#palette-panel #symmetry-select') && !document.querySelector('#map-tools #symmetry-select'))).toBe(true);
    await page.evaluate(() => Tools.setSymmetry('rot6'));
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width)).toBe(1491);
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  test('Y cycles (also with the select focused); typing in a text field, Ctrl+Y and modifiers do not', async ({ page }) => {
    await page.selectOption('#symmetry-select', 'rot3');
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('rot3');
    await page.focus('#symmetry-select');
    await page.keyboard.press('y');                       // select focused (opened/closed without change): Y still cycles
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('rot6');
    expect(await page.evaluate(() => (document.getElementById('symmetry-select') as HTMLSelectElement).value)).toBe('rot6');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('y');
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('rot6');
    await page.evaluate(() => { document.getElementById('tmp-in')!.remove(); (document.activeElement as HTMLElement)?.blur?.(); });
    await page.keyboard.press('Shift+Y');
    await page.keyboard.press('Alt+y');
    expect(await page.evaluate(() => Tools.getSymmetry())).toBe('rot6');
    // Ctrl+Y is redo and must leave the mode alone: set up an undone step first
    await page.evaluate(() => { Tools.setSymmetry('none'); UI.selectTerrain('Forest_1'); History.push(); mapData[0] = 'Forest_1'; History.undo(); Tools.setSymmetry('h'); });
    expect(await page.evaluate(() => [History.redoSize(), mapData[0]])).toEqual([1, 'Plain_1']);
    await page.keyboard.press('Control+y');
    expect(await page.evaluate(() => [History.redoSize(), mapData[0], Tools.getSymmetry()])).toEqual([0, 'Forest_1', 'h']);
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  test('map replaced by a DIFFERENT size: the centre follows the live map (pixel reference), mode kept', async ({ page }) => {
    const r = await page.evaluate((H) => {
      Tools.setSymmetry('h');
      const old = Tools.expandSymmetry([{ col: 230, row: 220 }]).map((c: any) => c.col + ',' + c.row);
      MAP_WIDTH = 12; MAP_HEIGHT = 11; mapData = new Array(132).fill('Plain_1');
      const h = eval(H as string);                       // pixel geometry of the NEW map
      const cell = { col: 8, row: 7 };
      const got = Tools.expandSymmetry([cell]).map((c: any) => c.col + ',' + c.row).sort();
      const m = h.mirrorH(cell.col, cell.row);
      const want = [cell.col + ',' + cell.row, m.col + ',' + m.row].sort();
      return { old, got, want, mode: Tools.getSymmetry(), centre: [h.mid.x, h.mid.y] };
    }, SYM_HELPERS);
    expect(r.old.length).toBe(2);
    expect(r.got).toEqual(r.want);
    expect(r.got.length).toBe(2);
    expect(r.mode).toBe('h');
  });
});

// ── Eraser (T2.6) ─────────────────────────────────────────────────────────────────────────────
// Independent reference: hex distance BFS over an UNCLIPPED virtual lattice found by pixel adjacency (hexCenterWorld).
const DISC_REF = `(c0, r0, R) => {
  const pos = (c, r) => Canvas.hexCenterWorld(c, r);
  const key = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
  const a = pos(c0, r0), byPix = new Map(), W2 = 2 * R + 3;
  for (let c = c0 - W2; c <= c0 + W2; c++) for (let r = r0 - W2; r <= r0 + W2; r++) { const p = pos(c, r); byPix.set(key(p.x, p.y), [c, r]); }
  let d = Infinity;
  for (let c = c0 - 2; c <= c0 + 2; c++) for (let r = r0 - 2; r <= r0 + 2; r++) { const p = pos(c, r), x = Math.hypot(p.x - a.x, p.y - a.y); if (x > 1 && x < d) d = x; }
  const vecs = [];
  for (let c = c0 - 2; c <= c0 + 2; c++) for (let r = r0 - 2; r <= r0 + 2; r++) { const p = pos(c, r); if (Math.hypot(p.x - a.x, p.y - a.y) < d * 1.05 && (c !== c0 || r !== r0)) vecs.push([p.x - a.x, p.y - a.y]); }
  const dist = new Map([[c0 + ',' + r0, 0]]); let frontier = [[c0, r0]];
  for (let i = 1; i <= R; i++) {
    const next = [];
    for (const [fc, fr] of frontier) { const p = pos(fc, fr);
      for (const [vx, vy] of vecs) { const n = byPix.get(key(p.x + vx, p.y + vy)); if (!n) continue;
        const k = n[0] + ',' + n[1]; if (!dist.has(k)) { dist.set(k, i); next.push(n); } } }
    frontier = next;
  }
  return dist;
}`;

test.describe('eraser (T2.6)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const undoSize = (page: any) => page.evaluate(() => History.undoSize());
  const toasts = (page: any) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
  const forestCount = (page: any) => page.evaluate(() => { let n = 0; for (const x of mapData) if (x === 'Forest_1') n++; return n; });

  test('eraseCells resets terrain and removes building, road, bridge and under-terrain', async ({ page }) => {
    const r = await page.evaluate(() => {
      const k = '226,224', idx = 224 * MAP_WIDTH + 226;
      mapData[idx] = 'Water_1';
      objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' }; tileExtras[k] = { underTerrainId: 'Water_1' };
      bridgesData.push({ col: 226, row: 224, axis: 0 });
      const n = Tools.eraseCells([{ col: 226, row: 224 }]);
      return { n, def: DEFAULT_TILE_ID, id: mapData[idx], o: k in objectsData, rd: k in roadsData, x: k in tileExtras, br: bridgesData.length };
    });
    expect(r).toEqual({ n: 1, def: 'Plain_1', id: 'Plain_1', o: false, rd: false, x: false, br: 0 });
  });

  test('only the erased cells lose their overlays; neighbours keep theirs', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cells = [[225, 220], [226, 220], [227, 220]];
      for (const [c, rw] of cells) {
        const k = c + ',' + rw;
        mapData[rw * MAP_WIDTH + c] = 'Forest_1'; objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' };
        tileExtras[k] = { underTerrainId: 'Water_1' }; bridgesData.push({ col: c, row: rw, axis: 1 });
      }
      Tools.eraseCells([{ col: 226, row: 220 }]);
      return cells.map(([c, rw]) => { const k = c + ',' + rw; return [mapData[rw * MAP_WIDTH + c], k in objectsData, k in roadsData, k in tileExtras, bridgesData.some((b: any) => b.col === c && b.row === rw)]; });
    });
    expect(r).toEqual([['Forest_1', true, true, true, true], ['Plain_1', false, false, false, false], ['Forest_1', true, true, true, true]]);
  });

  for (const [W, H] of [[450, 450], [451, 451], [450, 451]]) {
    test(`erased cells are exactly the brush disc (independent pixel reference), radii 0..4, corner and centre, on ${W}x${H}`, async ({ page }) => {
      const bad = await page.evaluate(([W, H, ref]) => {
        const refFn = eval(ref as string);
        MAP_WIDTH = W as number; MAP_HEIGHT = H as number;
        mapData = new Array(MAP_WIDTH * MAP_HEIGHT).fill('Forest_1');
        invalidateSatelliteMap();
        const out: string[] = [];
        for (const [c, r] of [[0, 0], [(W as number) >> 1, (H as number) >> 1], [(W as number) - 1, (H as number) - 1]]) {
          const dist = refFn(c, r, 4);
          for (let R = 0; R <= 4; R++) {
            mapData.fill('Forest_1');
            Brush.setSize(R);
            Tools.eraseCells(Brush.getAffectedTiles(c, r));
            const got: string[] = [];
            for (let i = 0; i < mapData.length; i++) if (mapData[i] !== 'Forest_1') got.push((i % MAP_WIDTH) + ',' + Math.floor(i / MAP_WIDTH));
            const want = [...dist].filter(([k, d]: any) => { const [kc, kr] = k.split(',').map(Number); return d <= R && kc >= 0 && kc < MAP_WIDTH && kr >= 0 && kr < MAP_HEIGHT; }).map(([k]: any) => k);
            if (got.sort().join('|') !== want.sort().join('|')) out.push(`R${R}@${c},${r}`);
            if (R === 4 && got.length < 37 && c === ((W as number) >> 1)) out.push('too few');
          }
        }
        Brush.setSize(0);
        return out;
      }, [W, H, DISC_REF]);
      expect(bad).toEqual([]);
    });
  }

  test('a click with the real tool erases the brush disc and one Ctrl+Z restores terrain, building, road, bridge and extras', async ({ page }) => {
    await page.evaluate(() => {
      Brush.setSize(1);
      for (const [c, rw] of [[225, 220], [226, 220]]) {
        const k = c + ',' + rw;
        mapData[rw * MAP_WIDTH + c] = 'Water_1'; objectsData[k] = 'Grain_1'; roadsData[k] = { type: 'road_hex' };
        tileExtras[k] = { underTerrainId: 'Forest_1' }; bridgesData.push({ col: c, row: rw, axis: 0 });
      }
      mapData[222 * MAP_WIDTH + 225] = 'Forest_1';
    });
    const snap = () => page.evaluate(() => JSON.stringify([mapData.slice(215 * MAP_WIDTH, 230 * MAP_WIDTH), objectsData, roadsData, tileExtras, bridgesData]));
    const before = await snap();
    await page.keyboard.press('KeyX');
    const u = await undoSize(page);
    await clickCell(page, 225, 220);
    expect(await undoSize(page)).toBe(u + 1);
    const r = await page.evaluate(() => ({ a: mapData[220 * MAP_WIDTH + 225], b: mapData[220 * MAP_WIDTH + 226], o: Object.keys(objectsData).length, rd: Object.keys(roadsData).length,
      x: Object.keys(tileExtras).length, br: bridgesData.length, far: mapData[222 * MAP_WIDTH + 225] }));
    expect(r).toEqual({ a: 'Plain_1', b: 'Plain_1', o: 0, rd: 0, x: 0, br: 0, far: 'Forest_1' });
    await page.keyboard.press('Control+KeyZ');
    expect(await snap()).toBe(before);
  });

  test('a drag stroke over many cells is one undo step', async ({ page }) => {
    await page.evaluate(() => { for (let c = 222; c <= 230; c++) mapData[224 * MAP_WIDTH + c] = 'Forest_1'; Tools.setActive('eraser'); });
    const u = await undoSize(page);
    await dragCells(page, { col: 222, row: 224 }, { col: 230, row: 224 });
    expect(await undoSize(page)).toBe(u + 1);
    expect(await forestCount(page)).toBe(0);
    await page.keyboard.press('Control+KeyZ');
    expect(await forestCount(page)).toBe(9);
  });

  test('settlements, the city marker and zones are not touched (terrain under them is reset like Paint)', async ({ page }) => {
    const r = await page.evaluate(() => {
      settlements.push({ col: 226, row: 224, type: 'settlement' });
      const zl = ZonePainter.getZoneLayer(), zi = 224 * MAP_WIDTH + 225;
      const zoneBefore = 5;
      zl[zi] = zoneBefore;
      mapData[224 * MAP_WIDTH + 226] = 'Forest_1';
      const s0 = JSON.stringify(settlements);
      Brush.setSize(2);
      Tools.eraseCells(Brush.getAffectedTiles(225, 224));
      return { same: JSON.stringify(settlements) === s0, hasCity: settlements.some((s: any) => s.type === 'city' && s.col === 225 && s.row === 224),
        zone: zl[zi] === zoneBefore, terrain: mapData[224 * MAP_WIDTH + 226] };
    });
    expect(r).toEqual({ same: true, hasCity: true, zone: true, terrain: 'Plain_1' });
  });

  test('multi-tile footprints: a satellite cell is skipped, the anchor alone removes the footprint, anchor+satellite erases both', async ({ page }) => {
    const r = await page.evaluate(() => {
      const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
      if (!multi) return null;
      const A = { col: 225, row: 230 };
      const fresh = () => {
        mapData.fill('Plain_1');
        mapData[A.row * MAP_WIDTH + A.col] = multi.id; invalidateSatelliteMap();
        const sats: any[] = [];
        for (let c = A.col - 2; c <= A.col + 2; c++) for (let r = A.row - 3; r <= A.row + 3; r++) {
          const an = getSatelliteAnchor(c, r); if (an && an.col === A.col && an.row === A.row) { sats.push({ col: c, row: r }); mapData[r * MAP_WIDTH + c] = 'Forest_1'; }
        }
        return sats;
      };
      const sats = fresh(), S = sats[0];
      const at = (c: any) => mapData[c.row * MAP_WIDTH + c.col];
      const out: any = { sats: sats.length };
      out.satOnly = Tools.eraseCells([S]); out.satOnlyTerrain = at(S); out.satOnlyAnchor = at(A);
      fresh();
      out.anchorOnly = Tools.eraseCells([A]); out.anchorOnlyAnchor = at(A);
      out.footprintGone = sats.every(s => getSatelliteAnchor(s.col, s.row) === null);
      out.satKeptTerrain = at(S);
      fresh();
      out.both = Tools.eraseCells([A, ...sats]); out.bothAnchor = at(A); out.bothSats = sats.every(s => at(s) === 'Plain_1');
      out.multiId = multi.id;
      return out;
    });
    expect(r).not.toBeNull();
    expect(r.sats).toBeGreaterThan(0);
    expect(r.satOnly).toBe(0); expect(r.satOnlyTerrain).toBe('Forest_1'); expect(r.satOnlyAnchor).toBe(r.multiId);
    expect(r.anchorOnly).toBe(1); expect(r.anchorOnlyAnchor).toBe('Plain_1'); expect(r.footprintGone).toBe(true); expect(r.satKeptTerrain).toBe('Forest_1');
    expect(r.both).toBe(1 + r.sats); expect(r.bothAnchor).toBe('Plain_1'); expect(r.bothSats).toBe(true);
  });

  test('edge re-resolution: river tiles next to an erased cell match resolveEdgeTile on the final map (and do change)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const rivers = HexDB.getAll().filter((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0);
      const faces = (id: string) => { const e = Terrain.byHexId(id); return e && Array.isArray(e.edgeFaces) ? e.edgeFaces.slice().sort().join('') : ''; };
      const fallback = HexDB.getAll().find((h: any) => h.id === 'Water_1').id;
      const origRandom = Math.random; Math.random = () => 0.5;
      const out: any[] = [];
      try {
        for (const P of [{ col: 225, row: 224 }, { col: 225, row: 225 }]) {
          mapData.fill('Plain_1');
          const band: any[] = [];
          for (let row = 218; row <= 232; row++) for (let col = 224; col <= 226; col++) band.push({ col, row });
          for (const b of band) mapData[b.row * W + b.col] = rivers[0].id;
          Tools.autoResolveEdgesAround(band);
          const cands = new Map<string, any>();
          for (const n of HexUtils.neighbors(P.col, P.row, W, H)) cands.set(n.col + ',' + n.row, n);
          for (const o of EdgeTiling.legacyOffsets(P.row, H)) cands.set((P.col + o[0]) + ',' + (P.row + o[1]), { col: P.col + o[0], row: P.row + o[1] });
          const before = new Map([...cands].map(([k, c]) => [k, faces(mapData[c.row * W + c.col])]));
          Tools.eraseCells([P]);
          let changed = 0, bad = 0, checked = 0;
          for (const [k, c] of cands) {
            const id = mapData[c.row * W + c.col];
            if (id === 'Plain_1') continue;                      // not a water/river tile
            checked++;
            const want = faces(EdgeTiling.resolveEdgeTile(c.col, c.row, W, H, mapData, ['Water', 'Rivers'], () => 0, [fallback]));
            if (faces(id) !== want) bad++;
            if (faces(id) !== before.get(k)) changed++;
          }
          out.push({ P: P.col + ',' + P.row, checked, changed, bad });
        }
      } finally { Math.random = origRandom; }
      return out;
    });
    for (const x of r) { expect(x.checked, JSON.stringify(x)).toBeGreaterThan(0); expect(x.changed, JSON.stringify(x)).toBeGreaterThan(0); expect(x.bad, JSON.stringify(x)).toBe(0); }
  });

  test('symmetry: the eraser mirrors like Paint (pixel-reference mirror, one undo step) and opts.noSymmetry bypasses it', async ({ page }) => {
    await page.evaluate(() => { mapData.fill('Forest_1'); Tools.setSymmetry('h'); Tools.setActive('eraser'); });
    const ref = await page.evaluate(() => {
      const c = HexUtils.toCube(225, 224, MAP_WIDTH, MAP_HEIGHT);
      const p = HexUtils.fromCube({ q: c.q + 3, r: c.r - 1, s: c.s - 2 }, MAP_WIDTH, MAP_HEIGHT);
      const mid = Canvas.hexCenterWorld(225, 224), pw = Canvas.hexCenterWorld(p.col, p.row);
      return { p, mx: 2 * mid.x - pw.x, my: pw.y };
    });
    const u = await undoSize(page);
    await clickCell(page, ref.p.col, ref.p.row);
    expect(await undoSize(page)).toBe(u + 1);
    const got = await page.evaluate(() => { const o: any[] = []; for (let i = 0; i < mapData.length; i++) if (mapData[i] !== 'Forest_1') { const w = Canvas.hexCenterWorld(i % MAP_WIDTH, Math.floor(i / MAP_WIDTH)); o.push({ x: w.x, y: w.y }); } return o; });
    expect(got.length).toBe(2);
    const pw = await page.evaluate(([c, r]) => Canvas.hexCenterWorld(c, r), [ref.p.col, ref.p.row]);
    const hasPt = (x: number, y: number) => got.some((g: any) => Math.abs(g.x - x) < 1e-6 && Math.abs(g.y - y) < 1e-6);
    expect(hasPt(pw.x, pw.y)).toBe(true);
    expect(hasPt(ref.mx, ref.my)).toBe(true);
    await page.keyboard.press('Control+KeyZ');
    expect(await forestCount(page)).toBe(450 * 450);
    const n = await page.evaluate((p) => Tools.eraseCells([p], { noSymmetry: true }), ref.p);
    expect(n).toBe(1);
    expect(await forestCount(page)).toBe(450 * 450 - 1);
    await page.evaluate(() => Tools.setSymmetry('none'));
  });

  // Overlay caches (T1.4) revalidate against the live objects: after erasing, the frame must equal a state in
  // which those overlays never existed, and the cache must have rebuilt.
  test('overlay caches stay correct: after erasing, the canvas equals the pristine state; undo restores the decorated one', async ({ page }) => {
    const r = await page.evaluate(() => {
      const hash = () => { Canvas.render(); return (document.getElementById('map-canvas') as HTMLCanvasElement).toDataURL(); };
      const bld = BldDB.getAll()[0].id;
      const cells = [[226, 224], [227, 224], [226, 225]];
      const decorate = () => { for (const [c, rw] of cells) { const k = c + ',' + rw; objectsData[k] = bld; roadsData[k] = { type: 'road_hex' }; bridgesData.push({ col: c, row: rw, axis: 0 }); mapData[rw * MAP_WIDTH + c] = 'Water_1'; } };
      decorate(); hash();                                                    // warm the caches and sprite loads
      Tools.eraseCells(cells.map(([col, row]) => ({ col, row }))); hash();
      const pristine = hash();
      decorate();
      const decorated = hash();
      const rb = Canvas.getStats().overlayRebuilds;
      History.push();
      Tools.eraseCells(cells.map(([col, row]) => ({ col, row })));
      const erased = hash();
      const rebuilt = Canvas.getStats().overlayRebuilds > rb;
      History.undo();
      const undone = hash();
      return { differs: decorated !== pristine, erasedIsPristine: erased === pristine, rebuilt, undoRestores: undone === decorated };
    });
    expect(r).toEqual({ differs: true, erasedIsPristine: true, rebuilt: true, undoRestores: true });
  });

  test('road neighbours re-autotile after a road cell is erased (bitmask and pixels)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const hash = () => { Canvas.render(); return (document.getElementById('map-canvas') as HTMLCanvasElement).toDataURL(); };
      const A = { col: 227, row: 224 };
      const B = Roads.getNeighbors(A.col, A.row)[0];
      const kB = B.col + ',' + B.row, kA = A.col + ',' + A.row;
      roadsData[kB] = { type: 'road_hex' }; hash();
      const maskAlone = Roads.calcBitmask(B.col, B.row), hAlone = hash();
      roadsData[kA] = { type: 'road_hex' };
      const maskJoined = Roads.calcBitmask(B.col, B.row), hJoined = hash();
      Tools.eraseCells([A]);
      return { joinedDiffers: maskJoined !== maskAlone && hJoined !== hAlone, maskAfter: Roads.calcBitmask(B.col, B.row) === maskAlone, pixelsAfter: hash() === hAlone, keptB: kB in roadsData, gone: !(kA in roadsData) };
    });
    expect(r).toEqual({ joinedDiffers: true, maskAfter: true, pixelsAfter: true, keptB: true, gone: true });
  });

  test('X selects the eraser by physical key and respects typing, modifiers and Y/symmetry', async ({ page }) => {
    await page.keyboard.press('KeyX');
    expect(await page.evaluate(() => Tools.getActive())).toBe('eraser');
    expect(await page.evaluate(() => document.querySelector('.tool-btn[data-tool="eraser"]')!.classList.contains('active'))).toBe(true);
    await page.evaluate(() => Tools.setActive('paint'));
    await page.keyboard.press('Shift+KeyX'); await page.keyboard.press('Alt+KeyX'); await page.keyboard.press('Control+KeyX');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyX');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-in')!.remove());
    // no collision: the existing letter shortcuts still select their tools
    for (const [k, t] of [['KeyP', 'paint'], ['KeyF', 'fill'], ['KeyR', 'rect'], ['KeyE', 'eye'], ['KeyS', 'select'], ['KeyT', 'settlement'], ['KeyD', 'erase'], ['KeyZ', 'zone']]) {
      await page.keyboard.press(k);
      expect(await page.evaluate(() => Tools.getActive())).toBe(t);
    }
  });

  test('the eraser button sits in the left palette, is clickable, and the canvas width is unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const b = document.querySelector('.tool-btn[data-tool="eraser"]') as HTMLElement;
      const rc = b.getBoundingClientRect();
      return { inPalette: !!b.closest('#palette-panel'), inToolbar: !!b.closest('#map-tools'), visible: rc.width > 0 && rc.right <= 220 && rc.bottom < innerHeight, cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width };
    });
    expect(r).toEqual({ inPalette: true, inToolbar: false, visible: true, cw: 1491 });
    await page.locator('.tool-btn[data-tool="eraser"]').click();
    expect(await page.evaluate(() => Tools.getActive())).toBe('eraser');
  });

  const press = (page: any, p: { x: number; y: number }) => page.mouse.move(p.x, p.y).then(() => page.mouse.down());

  test('side and right buttons never erase; a tool switch mid-stroke stops the stroke', async ({ page }) => {
    await page.evaluate(() => { mapData.fill('Forest_1'); Tools.setActive('eraser'); });
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    for (const button of ['middle', 'right'] as const) { await page.mouse.move(p.x, p.y); await page.mouse.down({ button }); await page.mouse.move(p.x + 30, p.y, { steps: 3 }); await page.mouse.up({ button }); }
    await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(225, 224);
      for (const b of [3, 4]) for (const t of ['mousedown', 'mousemove', 'mouseup']) cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + q.x, clientY: rc.top + q.y, button: b, buttons: 0, bubbles: true }));
    });
    expect(await undoSize(page)).toBe(u);
    expect(await forestCount(page)).toBe(450 * 450);
    // tool switch mid-stroke
    await press(page, p);
    const after1 = await forestCount(page);
    await page.keyboard.press('KeyP');
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    const p2 = await cellPoint(page, 229, 224);
    await page.mouse.move(p2.x, p2.y, { steps: 4 });
    await page.mouse.up();
    expect(after1).toBe(450 * 450 - 1);
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(false);
    expect(await page.evaluate(() => mapData.filter((x: string) => x === 'Water_1').length)).toBe(0);   // the old drag did not paint with Paint
    expect(await page.evaluate(() => mapData[224 * MAP_WIDTH + 229])).toBe('Forest_1');
  });

  test('a lost mouseup finishes the stroke; leaving the canvas (mouseleave) and window blur end it cleanly', async ({ page }) => {
    await page.evaluate(() => { mapData.fill('Forest_1'); Tools.setActive('eraser'); });
    const lost = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
      const ev = (t: string, dx: number, buttons: number) => new MouseEvent(t, { clientX: rc.left + p.x + dx, clientY: rc.top + p.y, button: 0, buttons, bubbles: true });
      const count = () => { let w = 0; for (const x of mapData) if (x !== 'Forest_1') w++; return w; };
      cv.dispatchEvent(ev('mousedown', 0, 1));
      const down = count();
      cv.dispatchEvent(ev('mousemove', 70, 0));
      const afterLost = count();
      for (let i = 0; i < 12; i++) cv.dispatchEvent(ev('mousemove', 80 + i * 9, 0));
      return { down, afterLost, end: count() };
    });
    expect(lost.down).toBe(1);
    expect(lost.end).toBe(lost.afterLost);
    // pointer leaves the page with the button held: Chrome fires mouseleave on the canvas first, which ends the stroke
    await page.evaluate(() => mapData.fill('Forest_1'));
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.mouse.move(p.x, 5000, { steps: 3 });
    await page.mouse.up();
    const n0 = await forestCount(page);
    await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    expect(await forestCount(page)).toBe(n0);
    expect(await undoSize(page)).toBe(u + 1);
    // blur mid-stroke
    await page.evaluate(() => mapData.fill('Forest_1'));
    await press(page, p);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(false);
    const n1 = await forestCount(page);
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    await page.mouse.up();
    expect(await forestCount(page)).toBe(n1);
  });

  test('Escape cancels a stroke: terrain and buildings restored, no history step and no redo entry', async ({ page }) => {
    await page.evaluate(() => {
      mapData.fill('Forest_1'); objectsData['225,224'] = 'Grain_1'; roadsData['226,224'] = { type: 'road_hex' };
      bridgesData.push({ col: 226, row: 224, axis: 1 }); tileExtras['227,224'] = { underTerrainId: 'Water_1' };
      ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 228] = 4;
      Tools.setActive('eraser');
    });
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    expect(await forestCount(page)).toBeLessThan(450 * 450);
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => ({ forest: mapData.filter((x: string) => x === 'Forest_1').length, o: '225,224' in objectsData, rd: '226,224' in roadsData, steps: History.undoSize(), redo: History.redoSize(),
      br: JSON.stringify(bridgesData), x: JSON.stringify(tileExtras), z: ZonePainter.getZoneLayer()[224 * MAP_WIDTH + 228] }));
    expect(r).toEqual({ forest: 450 * 450, o: true, rd: true, steps: u, redo: 0, br: JSON.stringify([{ col: 226, row: 224, axis: 1 }]), x: JSON.stringify({ '227,224': { underTerrainId: 'Water_1' } }), z: 4 });
    await page.mouse.move(p.x + 120, p.y, { steps: 4 });         // the stroke is over even though the button is held
    await page.mouse.up();
    expect(await forestCount(page)).toBe(450 * 450);
    expect(await undoSize(page)).toBe(u);
  });

  test('a map replaced mid-stroke stops the eraser with a toast and writes nothing', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('eraser'); });
    await toasts(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    const u = await page.evaluate(() => { IO.newMap(true); mapData.fill('Forest_1'); return History.undoSize(); });
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    await page.mouse.up();
    expect(await forestCount(page)).toBe(450 * 450);
    expect(await undoSize(page)).toBe(u);
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Eraser stopped — the map changed');
  });

  test('eraser input is ignored while a fill runs (and eraseCells refuses)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const canvas = document.getElementById('map-canvas')!, rc = canvas.getBoundingClientRect();
      const ev = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); return new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: t === 'mouseup' ? 0 : 1, bubbles: true }); };
      const pr = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      const before = History.undoSize();
      Tools.setActive('eraser');
      canvas.dispatchEvent(ev('mousedown', 225, 224)); canvas.dispatchEvent(ev('mousemove', 228, 224)); canvas.dispatchEvent(ev('mouseup', 228, 224));
      const n = Tools.eraseCells([{ col: 225, row: 224 }]);
      const during = History.undoSize() - before;
      await pr;
      return { busy, during, n, cell: mapData[224 * MAP_WIDTH + 225] };
    });
    expect(r).toEqual({ busy: true, during: 0, n: 0, cell: 'Forest_1' });
  });

  test('hover preview: the brush disc plus symmetric copies as one highlight layer, cleared on every exit', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('eraser'); Brush.setSize(2); });
    const p = await cellPoint(page, 225, 224);
    await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.getHighlightPoints('eraser')!.n)).toBe(19);
    await page.evaluate(() => { Tools.setSymmetry('hv'); });
    await page.mouse.move(p.x + 80, p.y + 60);
    const got = await page.evaluate(() => { const h = Canvas.getHighlightPoints('eraser')!; return { n: h.n, keys: h.xs.map((x: number, i: number) => Math.round(x * 100) + ',' + Math.round(h.ys[i] * 100)).sort() }; });
    // independent reference: pixel disc about the hovered cell (DISC_REF), each cell's centre mirrored in x and/or y about the centre cell's pixel
    const want = await page.evaluate(([ref]) => {
      const refFn = eval(ref as string);
      const q = Canvas.hexScreenPos(225, 224);
      const h = Canvas.screenToHex(q.x + 80, q.y + 60);
      const mid = Canvas.hexCenterWorld(225, 224), keys = new Set<string>();
      for (const k of refFn(h.col, h.row, 2).keys()) {
        const [c, r] = k.split(',').map(Number), w = Canvas.hexCenterWorld(c, r);
        for (const [x, y] of [[w.x, w.y], [2 * mid.x - w.x, w.y], [w.x, 2 * mid.y - w.y], [2 * mid.x - w.x, 2 * mid.y - w.y]]) keys.add(Math.round(x * 100) + ',' + Math.round(y * 100));
      }
      return [...keys].sort();
    }, [DISC_REF]);
    const n = got.n;
    expect(got.keys).toEqual(want);
    expect(n).toBeGreaterThan(19);
    await page.evaluate(() => Tools.setSymmetry('none'));
    // brush resize refreshes the preview
    await page.keyboard.press('BracketRight');
    expect(await page.evaluate(() => Canvas.getHighlightPoints('eraser')!.n)).toBe(37);
    // exit paths: leave the canvas, switch tool, map replacement
    await page.evaluate(() => document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave')));
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(false);
    await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(true);
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(false);
    await page.keyboard.press('KeyX'); await page.mouse.move(p.x + 5, p.y + 40);
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(true);
    await page.evaluate(() => { IO.newMap(true); Canvas.render(); });
    expect(await page.evaluate(() => Canvas.hasHighlight('eraser'))).toBe(false);
  });

  test('hover costs one recompute per cell change, draws one fill + one stroke path, and 3px marks at LOD 2', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('eraser'); Brush.setSize(3); });
    const p = await cellPoint(page, 225, 224);
    const count = () => page.evaluate(() => {
      const P = CanvasRenderingContext2D.prototype, of = P.fill, os = P.stroke, orc = P.rect, oa = Brush.getAffectedTiles;
      let f = 0, s = 0, rects = 0, calls = 0;
      P.fill = function (this: any, ...a: any[]) { f++; return of.apply(this, a as any); };
      P.stroke = function (this: any, ...a: any[]) { s++; return os.apply(this, a as any); };
      P.rect = function (this: any, ...a: any[]) { rects++; return orc.apply(this, a as any); };
      Brush.getAffectedTiles = (c: number, r: number) => { calls++; return oa(c, r); };
      for (let i = 0; i < 4; i++) Canvas.render();
      P.fill = of; P.stroke = os; P.rect = orc; Brush.getAffectedTiles = oa;
      return { f, s, rects, calls };
    });
    await page.evaluate(() => document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave')));
    const off = await count();
    await page.mouse.move(p.x, p.y);
    const on = await count();
    expect(on.calls).toBe(0);                                  // four renders reuse the cached layer: no recompute
    expect(on.f - off.f).toBe(4 * 1);                          // one fill per frame for the hover layer
    expect(on.s - off.s).toBe(4 * 1);                          // and one stroke
    await page.evaluate(() => Canvas.setZoom(5));
    const lod2 = await count();
    expect(await page.evaluate(() => Canvas.getStats().lod)).toBe(2);
    expect(lod2.rects).toBeGreaterThan(0);
  });

  test('old erase tools are unchanged: Erase Settlement (D) still removes only a non-city settlement', async ({ page }) => {
    const r = await page.evaluate(() => {
      settlements.push({ col: 230, row: 224, type: 'settlement' });
      Tools.setActive('erase');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const hit = (c: number, rw: number) => { const q = Canvas.hexScreenPos(c, rw); const o = { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true }; cv.dispatchEvent(new MouseEvent('mousedown', o)); cv.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 })); };
      hit(230, 224); hit(225, 224);
      return { settle: settlements.some((s: any) => s.col === 230), city: settlements.some((s: any) => s.type === 'city') };
    });
    expect(r).toEqual({ settle: false, city: true });
  });

  test('Ctrl+Z / undo is ignored during an eraser stroke, so Escape cancels only its own step', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Water_1'); });
    await clickCell(page, 230, 230);                                  // an earlier gesture (Paint)
    await page.evaluate(() => { mapData.fill('Forest_1'); mapData[230 * MAP_WIDTH + 230] = 'Water_1'; Tools.setActive('eraser'); });
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.keyboard.press('Control+KeyZ');                       // mid-stroke: ignored
    await page.evaluate(() => History.undo());                       // also through the API
    expect(await undoSize(page)).toBe(u + 1);
    await page.mouse.move(p.x + 60, p.y, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await undoSize(page)).toBe(u);
    expect(await forestCount(page)).toBe(450 * 450 - 1);              // state before the stroke, previous step intact
    expect(await page.evaluate(() => mapData[230 * MAP_WIDTH + 230])).toBe('Water_1');
    await page.evaluate(() => History.undo());                        // the earlier Paint step is still undoable
    expect(await page.evaluate(() => mapData[230 * MAP_WIDTH + 230])).toBe('Plain_1');   // the Paint step's pre-state
  });

  test('History.rollback(token) acts only on its own step (undone / overtaken steps are left alone)', async ({ page }) => {
    const r = await page.evaluate(() => {
      mapData.fill('Forest_1');
      History.push(); mapData[0] = 'Water_1';                          // an earlier user step
      const t = History.push(); mapData[1] = 'Water_1';
      History.undo();                                                  // the token's step is gone
      const sizeAfterUndo = History.undoSize(), redoAfterUndo = History.redoSize();
      const a = History.rollback(t);
      const unchanged = History.undoSize() === sizeAfterUndo && History.redoSize() === redoAfterUndo;
      const t2 = History.push(); History.push();                       // overtaken by another push
      const b = History.rollback(t2);
      return { a, unchanged, b, none: History.rollback(null) };
    });
    expect(r).toEqual({ a: false, unchanged: true, b: false, none: false });
  });

  test('Escape with a full history restores the evicted oldest step; the redo stack survives an escaped stroke', async ({ page }) => {
    const r = await page.evaluate(() => {
      mapData.fill('Plain_1');
      History.clear();
      for (let i = 0; i < 50; i++) { History.push(); mapData[i] = 'Forest_1'; }     // bottom snapshot has 0 forests
      Tools.setActive('eraser');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(225, 224);
      const o = { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true };
      const full = History.undoSize();
      cv.dispatchEvent(new MouseEvent('mousedown', o));
      const during = History.undoSize();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      const after = History.undoSize();
      for (let i = 0; i < 50; i++) History.undo();
      let forests = 0; for (const x of mapData) if (x === 'Forest_1') forests++;
      cv.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
      return { full, during, after, forests, redo: History.redoSize() };
    });
    expect(r).toEqual({ full: 50, during: 50, after: 50, forests: 0, redo: 50 });
    // redo preserved by an escaped stroke
    const r2 = await page.evaluate(() => {
      mapData.fill('Plain_1'); History.clear();
      History.push(); mapData[0] = 'Forest_1'; History.undo();
      const before = History.redoSize();
      Tools.setActive('eraser');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(225, 224);
      const o = { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true };
      cv.dispatchEvent(new MouseEvent('mousedown', o));
      const during = History.redoSize();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      cv.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
      const after = History.redoSize();
      History.redo();
      return { before, during, after, redone: mapData[0] };
    });
    expect(r2).toEqual({ before: 1, during: 0, after: 1, redone: 'Forest_1' });
  });

  test('Escape after erasing a multi-tile anchor restores the footprint map (Paint cannot write under it)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
      const A = { col: 225, row: 230 };
      mapData.fill('Plain_1'); mapData[A.row * MAP_WIDTH + A.col] = multi.id; invalidateSatelliteMap();
      let sat: any = null;
      for (let c = A.col - 2; c <= A.col + 2 && !sat; c++) for (let r = A.row - 3; r <= A.row + 3; r++) { const an = getSatelliteAnchor(c, r); if (an && an.col === A.col && an.row === A.row) { sat = { col: c, row: r }; break; } }
      Tools.setActive('eraser');
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(A.col, A.row);
      const o = { clientX: rc.left + q.x, clientY: rc.top + q.y, button: 0, buttons: 1, bubbles: true };
      cv.dispatchEvent(new MouseEvent('mousedown', o));
      const goneDuring = getSatelliteAnchor(sat.col, sat.row) === null;      // rebuilds the map without A
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      cv.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
      const back = getSatelliteAnchor(sat.col, sat.row);
      const painted = Tools.applyTerrainCells([sat], 'Water_1').length;
      return { goneDuring, back: back && back.col === A.col && back.row === A.row, painted, satTerrain: mapData[sat.row * MAP_WIDTH + sat.col] };
    });
    expect(r).toEqual({ goneDuring: true, back: true, painted: 0, satTerrain: 'Plain_1' });
  });

  test('undo and redo also refresh the footprint map (restore invalidates it)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
      const A = { col: 225, row: 230 };
      mapData.fill('Plain_1'); invalidateSatelliteMap();
      History.push();
      mapData[A.row * MAP_WIDTH + A.col] = multi.id; invalidateSatelliteMap();
      let sat: any = null;
      for (let c = A.col - 2; c <= A.col + 2 && !sat; c++) for (let r = A.row - 3; r <= A.row + 3; r++) if (getSatelliteAnchor(c, r)) { sat = { col: c, row: r }; break; }
      History.undo();
      const afterUndo = getSatelliteAnchor(sat.col, sat.row);
      History.redo();
      return { afterUndo, afterRedo: !!getSatelliteAnchor(sat.col, sat.row) };
    });
    expect(r).toEqual({ afterUndo: null, afterRedo: true });
  });

  test('satellite buildings: erasing the anchor removes its satellite ring only; erasing a satellite keeps the anchor', async ({ page }) => {
    const r = await page.evaluate(() => {
      const orig = BldDB.getAll;
      BldDB.getAll = () => orig.call(BldDB).concat([{ id: 'T_A', spawnsSatellites: [{ buildingId: 'T_S', radius: 1, maxCount: 6 }] }, { id: 'T_S', canBuild: false }] as any);
      try {
        const A = { col: 225, row: 224 };
        const ring = HexUtils.neighbors(A.col, A.row, MAP_WIDTH, MAP_HEIGHT);
        const setup = () => {
          for (const k of Object.keys(objectsData)) delete objectsData[k];
          objectsData['225,224'] = 'T_A';
          ring.forEach((n: any, i: number) => { objectsData[n.col + ',' + n.row] = i === 0 ? 'Grain_1' : 'T_S'; });
          objectsData['230,224'] = 'T_S';                                  // a satellite-type object far outside the ring
        };
        setup();
        Tools.eraseCells([A]);
        const ringLeft = ring.filter((n: any, i: number) => i > 0 && (n.col + ',' + n.row) in objectsData).length;
        const out: any = { anchorGone: !('225,224' in objectsData), ringLeft, grainKept: objectsData[ring[0].col + ',' + ring[0].row] === 'Grain_1', farKept: objectsData['230,224'] === 'T_S' };
        setup();
        Tools.eraseCells([ring[1]]);
        out.anchorKept = objectsData['225,224'] === 'T_A';
        out.ringOthers = ring.filter((n: any, i: number) => i > 1 && objectsData[n.col + ',' + n.row] === 'T_S').length;
        return out;
      } finally { BldDB.getAll = orig; }
    });
    expect(r).toEqual({ anchorGone: true, ringLeft: 0, grainKept: true, farKept: true, anchorKept: true, ringOthers: 4 });
  });

  test('hover recompute happens once per cursor-cell change (not per mousemove) and the symmetric hover is cached', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('eraser'); Brush.setSize(2); Tools.setSymmetry('hv'); (window as any).__calls = 0; const oa = Brush.getAffectedTiles; Brush.getAffectedTiles = (c: number, r: number) => { (window as any).__calls++; return oa(c, r); }; });
    const calls = () => page.evaluate(() => (window as any).__calls);
    const p = await cellPoint(page, 226, 222);
    await page.mouse.move(p.x, p.y);
    const c1 = await calls();
    for (let i = 0; i < 6; i++) await page.mouse.move(p.x + (i % 3) - 1, p.y + 1);   // sub-pixel jitter inside the same cell
    expect(await calls()).toBe(c1);
    expect(c1).toBeGreaterThan(0);
    const p2 = await cellPoint(page, 228, 222);
    await page.mouse.move(p2.x, p2.y);
    expect(await calls()).toBe(c1 + 1);
    await page.mouse.move(p2.x + 1, p2.y);
    expect(await calls()).toBe(c1 + 1);
    await page.evaluate(() => { Tools.setSymmetry('none'); Brush.getAffectedTiles = Object.getPrototypeOf(Brush).getAffectedTiles || Brush.getAffectedTiles; });
  });

  test('plain-terrain strokes never rebuild the footprint map (radius 12, rot6); erasing a multi-tile anchor does', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(12); Tools.setSymmetry('rot6');
      const orig = invalidateSatelliteMap; let n = 0;
      invalidateSatelliteMap = () => { n++; orig(); };
      try {
        for (const [c, rw] of [[226, 222], [230, 226], [224, 228]]) { Tools.eraseCells(Brush.getAffectedTiles(c, rw)); }
        const plain = n;
        const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
        mapData[230 * MAP_WIDTH + 225] = multi.id;
        Tools.eraseCells([{ col: 225, row: 230 }]);
        return { plain, withAnchor: n - plain };
      } finally { invalidateSatelliteMap = orig; Tools.setSymmetry('none'); Brush.setSize(0); }
    });
    expect(r).toEqual({ plain: 0, withAnchor: 1 });
  });
});

test.describe('scatter (T2.7)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });
  const undoSize = (page: any) => page.evaluate(() => History.undoSize());
  const toasts = (page: any) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
  const FOREST = /^Forest_[123]$/;
  // seeded generator for the tests (independent of the editor's own RNG)
  const SEEDED = `(seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }`;
  const press = (page: any, p: { x: number; y: number }) => page.mouse.move(p.x, p.y).then(() => page.mouse.down());
  const region = (page: any) => page.evaluate(() => JSON.stringify(mapData.slice(205 * MAP_WIDTH, 245 * MAP_WIDTH)));
  const nonPlain = (page: any) => page.evaluate(() => { let n = 0; for (const x of mapData) if (x !== 'Plain_1') n++; return n; });
  const setupScatter = (page: any, o: { density?: number; seed?: string; radius?: number; terrain?: string } = {}) => page.evaluate(([d, s, r, t]: any) => {
    UI.selectTerrain(t); Brush.setSize(r); Tools.setActive('scatter');
    (document.getElementById('scatter-density') as HTMLInputElement).value = String(d);
    (document.getElementById('scatter-seed') as HTMLInputElement).value = s;
  }, [o.density ?? 100, o.seed ?? '4242', o.radius ?? 0, o.terrain ?? 'Forest_1']);

  test('scatterPick: same seed gives the same picks, only given ids, density 0 none and 100 all', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      const seeded = eval(mk as string);
      const cells = HexUtils.discCells(225, 224, 6, MAP_WIDTH, MAP_HEIGHT);
      const ids = ['A', 'B', 'C'];
      const a = HexUtils.scatterPick(cells, ids, 50, seeded(9)), b = HexUtils.scatterPick(cells, ids, 50, seeded(9)), c = HexUtils.scatterPick(cells, ids, 50, seeded(10));
      return { same: JSON.stringify(a) === JSON.stringify(b), differs: JSON.stringify(a) !== JSON.stringify(c), only: a.every((p: any) => ids.includes(p.id)),
        none: HexUtils.scatterPick(cells, ids, 0, seeded(1)).length, all: HexUtils.scatterPick(cells, ids, 100, seeded(1)).length, n: cells.length,
        inCells: a.every((p: any) => cells.some((q: any) => q.col === p.col && q.row === p.row)), distinct: new Set(a.map((p: any) => p.id)).size };
    }, [SEEDED]);
    expect(r).toEqual({ same: true, differs: true, only: true, none: 0, all: 127, n: 127, inCells: true, distinct: 3 });
  });

  test('scatterPick density statistics: counts stay within 4.5 sigma of the binomial for several densities and seeds', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      const seeded = eval(mk as string);
      const cells = HexUtils.discCells(225, 224, 12, MAP_WIDTH, MAP_HEIGHT);   // 469 cells
      const N = cells.length, out: any[] = [];
      for (const d of [10, 30, 50, 80]) {
        const p = d / 100, sd = Math.sqrt(N * p * (1 - p));
        let pooled = 0, bad = 0;
        for (let s = 1; s <= 12; s++) { const k = HexUtils.scatterPick(cells, ['A', 'B'], d, seeded(s * 7919)).length; pooled += k; if (Math.abs(k - N * p) > 4.5 * sd) bad++; }
        out.push({ d, bad, pooledOk: Math.abs(pooled / 12 - N * p) < 4.5 * sd / Math.sqrt(12) });
      }
      return { N, out };
    }, [SEEDED]);
    expect(r.N).toBe(469);
    expect(r.out).toEqual([10, 30, 50, 80].map(d => ({ d, bad: 0, pooledOk: true })));
  });

  test('HexUtils.makeRng is reproducible, in [0,1) and roughly uniform', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = HexUtils.makeRng(77), b = HexUtils.makeRng(77), c = HexUtils.makeRng(78);
      const xs: number[] = [], ys: number[] = [], zs: number[] = [];
      for (let i = 0; i < 4000; i++) { xs.push(a()); ys.push(b()); zs.push(c()); }
      const lo = xs.filter(x => x < 0.5).length;
      return { same: xs.every((x, i) => x === ys[i]), diff: xs.some((x, i) => x !== zs[i]), range: xs.every(x => x >= 0 && x < 1), lo };
    });
    expect(r.same && r.diff && r.range).toBe(true);
    expect(Math.abs(r.lo - 2000)).toBeLessThan(4.5 * Math.sqrt(4000 * 0.25));
  });

  test('scatterCells places only variants of the active family (no Test/Kaiju entries); density 0 places nothing', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      Tools.setScatterRng(eval(mk as string)(12345));
      const W = MAP_WIDTH;
      const cells = HexUtils.discCells(225, 224, 3, W, MAP_HEIGHT);
      const n = Tools.scatterCells(cells, 'Forest_1', 100);
      const ids = [...new Set(cells.map((c: any) => mapData[c.row * W + c.col]))].sort();
      const none = Tools.scatterCells(cells, 'Water_1', 0);
      return { n, ids, none, group: Tools.scatterVariants('Forest_1'), water: Tools.scatterVariants('Water_1'), plain: Tools.scatterVariants('Plain_1') };
    }, [SEEDED]);
    expect(r.n).toBe(37);
    expect(r.none).toBe(0);
    expect(r.group).toEqual(['Forest_1', 'Forest_2', 'Forest_3']);
    expect(r.ids.every((id: string) => FOREST.test(id))).toBe(true);
    expect(r.ids.length).toBeGreaterThan(1);
    expect(r.water.some((id: string) => /_test|kaiju|chicken/i.test(id))).toBe(false);
    expect(r.water).toContain('Water_1');
    expect(r.plain).toEqual(['Plain_1', 'Plain_2']);   // Plain_Flat_1 (Special), Plain_TEST/Kaiju are other types / excluded
  });

  test('a click scatters at the left-palette density; the same seed reproduces the stamp, another seed differs, one undo restores it', async ({ page }) => {
    await setupScatter(page, { density: 60, radius: 3, seed: '4242' });
    await page.keyboard.press('KeyA');
    expect(await page.evaluate(() => Tools.getActive())).toBe('scatter');
    const before = await region(page), u = await undoSize(page);
    await clickCell(page, 225, 224);
    expect(await undoSize(page)).toBe(u + 1);
    const first = await region(page);
    await page.keyboard.press('Control+KeyZ');
    expect(await region(page)).toBe(before);
    expect(await undoSize(page)).toBe(u);
    await clickCell(page, 225, 224);
    expect(await region(page)).toBe(first);
    await page.keyboard.press('Control+KeyZ');
    await page.fill('#scatter-seed', '4243');
    await clickCell(page, 225, 224);
    expect(await region(page)).not.toBe(first);
    const ids = await page.evaluate(() => [...new Set(mapData)].sort());
    expect(ids.every((id: string) => id === 'Plain_1' || /^Forest_[123]$/.test(id))).toBe(true);
    // redo restores the same stamp (the seed is not re-rolled by undo/redo)
    await page.keyboard.press('Control+KeyZ'); await page.keyboard.press('Control+KeyY');
    expect(await region(page)).not.toBe(before);
  });

  test('an empty seed rolls a fresh seed per stroke, records it, and typing the recorded seed reproduces the stroke', async ({ page }) => {
    await setupScatter(page, { density: 60, radius: 3, seed: '' });
    await clickCell(page, 225, 224);
    const s1 = await page.evaluate(() => Tools.getLastScatterSeed());
    const r1 = await region(page);
    await page.keyboard.press('Control+KeyZ');
    await clickCell(page, 225, 224);
    const s2 = await page.evaluate(() => Tools.getLastScatterSeed());
    expect(typeof s1).toBe('number'); expect(s2).not.toBe(s1);
    await page.keyboard.press('Control+KeyZ');
    await page.fill('#scatter-seed', String(s1));
    await clickCell(page, 225, 224);
    expect(await region(page)).toBe(r1);
    expect(await page.evaluate(() => Tools.getLastScatterSeed())).toBe(s1);
  });

  test('a stroke places each cell with the chosen density (binomial tolerance) and only chosen variants', async ({ page }) => {
    const r = await page.evaluate(() => {
      Brush.setSize(12);
      const cells = Brush.getAffectedTiles(225, 224);
      UI.selectTerrain('Forest_1'); Tools.setActive('scatter');
      const N = cells.length, out: any[] = [];
      for (const [d, seed] of [[20, 5], [50, 6], [75, 7]]) {
        mapData.fill('Plain_1');
        (document.getElementById('scatter-density') as HTMLInputElement).value = String(d);
        (document.getElementById('scatter-seed') as HTMLInputElement).value = String(seed);
        const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
        const ev = (t: string) => new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: t === 'mouseup' ? 0 : 1, bubbles: true });
        cv.dispatchEvent(ev('mousedown')); cv.dispatchEvent(ev('mouseup'));
        let n = 0; const ids = new Set<string>();
        for (const c of cells) { const id = mapData[c.row * MAP_WIDTH + c.col]; if (id !== 'Plain_1') { n++; ids.add(id); } }
        const outside = mapData.filter((x: string) => x !== 'Plain_1').length - n;
        const sd = Math.sqrt(N * (d / 100) * (1 - d / 100));
        out.push({ d, ok: Math.abs(n - N * d / 100) <= 4.5 * sd, outside, ids: [...ids].sort() });
      }
      return { N, out };
    });
    expect(r.N).toBe(469);
    for (const o of r.out) { expect(o.ok).toBe(true); expect(o.outside).toBe(0); expect(o.ids).toEqual(['Forest_1', 'Forest_2', 'Forest_3']); }
  });

  test('variant chips choose the set: unchecked variants never appear; none checked toasts and writes nothing', async ({ page }) => {
    await toasts(page);
    await setupScatter(page, { density: 100, radius: 3 });
    const chips = await page.evaluate(() => [...document.querySelectorAll('#scatter-variants input[type=checkbox]')].map(i => (i as HTMLInputElement).dataset.id));
    expect(chips).toEqual(['Forest_1', 'Forest_2', 'Forest_3']);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('scatter-row')!).display)).not.toBe('none');
    await page.locator('#scatter-variants input[data-id="Forest_2"]').uncheck();
    await clickCell(page, 225, 224);
    let ids = await page.evaluate(() => { const s = new Set<string>(); for (const x of mapData) if (x !== 'Plain_1') s.add(x); return [...s].sort(); });
    expect(ids).toEqual(['Forest_1', 'Forest_3']);
    await page.keyboard.press('Control+KeyZ');
    await page.locator('#scatter-variants input[data-id="Forest_1"]').uncheck();
    await page.locator('#scatter-variants input[data-id="Forest_3"]').uncheck();
    const u = await undoSize(page);
    await clickCell(page, 225, 224);
    expect(await undoSize(page)).toBe(u);
    expect(await nonPlain(page)).toBe(0);
    expect(await page.evaluate(() => (window as any).__toasts.some((m: string) => /variant/i.test(m)))).toBe(true);
    // the chip list follows the selected terrain
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    const w = await page.evaluate(() => [...document.querySelectorAll('#scatter-variants input[type=checkbox]')].map(i => (i as HTMLInputElement).dataset.id));
    expect(w).toContain('Water_1'); expect(w.some((i: any) => /Forest/.test(i))).toBe(false);
  });

  test('density 0 or an empty density toasts and writes nothing; densities clamp to 0..100; a stroke that places nothing adds no step', async ({ page }) => {
    await toasts(page);
    await setupScatter(page, { density: 0, radius: 2 });
    const u = await undoSize(page);
    await clickCell(page, 225, 224);
    expect(await undoSize(page)).toBe(u); expect(await nonPlain(page)).toBe(0);
    await page.fill('#scatter-density', '');
    await clickCell(page, 225, 224);
    expect(await undoSize(page)).toBe(u); expect(await nonPlain(page)).toBe(0);
    expect(await page.evaluate(() => (window as any).__toasts.filter((m: string) => /density/i.test(m)).length)).toBe(2);
    // out-of-range density clamps: 250 acts as 100 (all 19 cells), -5 as 0
    await page.fill('#scatter-density', '250');
    await clickCell(page, 225, 224);
    expect(await nonPlain(page)).toBe(19);
    await page.keyboard.press('Control+KeyZ');
    // every roll fails (rng 0.99, density 50): the stroke touches no cell and leaves no history step
    await page.evaluate(() => Tools.setScatterRng(() => 0.99));
    await page.fill('#scatter-density', '50');
    const u2 = await undoSize(page);
    await clickCell(page, 225, 224);
    expect(await undoSize(page)).toBe(u2); expect(await nonPlain(page)).toBe(0);
    await page.evaluate(() => Tools.setScatterRng(null));
  });

  test('overlapping stamps in one stroke visit each cell once: no re-roll, cells keep their first variant', async ({ page }) => {
    const r = await page.evaluate(async ([ref, mk]) => {
      const refFn = eval(ref as string);
      let calls = 0; const base = eval(mk as string)(31);
      Tools.setScatterRng(() => { calls++; return base(); });
      UI.selectTerrain('Forest_1'); Brush.setSize(2); Tools.setActive('scatter');
      (document.getElementById('scatter-density') as HTMLInputElement).value = '100';
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect();
      const ev = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); return new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: t === 'mouseup' ? 0 : 1, bubbles: true }); };
      const path = [[225, 224], [226, 224], [227, 224], [227, 225], [226, 225], [225, 224]];
      cv.dispatchEvent(ev('mousedown', 225, 224));
      const first = new Map<string, string>();
      const snapDisc = () => { for (const k of refFn(225, 224, 2).keys()) { const [c, rw] = k.split(',').map(Number); if (!first.has(k)) first.set(k, mapData[rw * MAP_WIDTH + c]); } };
      snapDisc();
      for (const [c, rw] of path.slice(1)) cv.dispatchEvent(ev('mousemove', c, rw));
      cv.dispatchEvent(ev('mouseup', 227, 225));
      const union = new Set<string>();
      for (const [c, rw] of path) for (const k of refFn(c, rw, 2).keys()) union.add(k);
      const stable = [...first].every(([k, id]) => { const [c, rw] = k.split(',').map(Number); return mapData[rw * MAP_WIDTH + c] === id; });
      const painted = mapData.filter((x: string) => x !== 'Plain_1').length;
      Tools.setScatterRng(null);
      return { calls, union: union.size, painted, stable, steps: History.undoSize() };
    }, [DISC_REF, SEEDED]);
    expect(r.painted).toBe(r.union);
    expect(r.calls).toBe(2 * r.union);          // exactly one density roll and one variant pick per distinct cell
    expect(r.stable).toBe(true);
    expect(r.union).toBeGreaterThan(19);
  });

  test('cells rejected by the density roll are not re-rolled by later stamps either', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      let calls = 0; const base = eval(mk as string)(99);
      Tools.setScatterRng(() => { calls++; return base(); });
      const cells = HexUtils.discCells(225, 224, 2, MAP_WIDTH, MAP_HEIGHT);
      const visited = new Set<number>();
      const a = Tools.scatterCells(cells, 'Forest_1', 30, { visited });
      const callsA = calls;
      const b = Tools.scatterCells(cells, 'Forest_1', 30, { visited });
      Tools.setScatterRng(null);
      return { a, b, callsA, calls, n: cells.length };
    }, [SEEDED]);
    expect(r.b).toBe(0);
    expect(r.calls).toBe(r.callsA);
    expect(r.callsA).toBeGreaterThanOrEqual(r.n);
  });

  test('symmetry decision: the area is mirrored, each mirrored cell rolls independently (not identical copies)', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      Tools.setScatterRng(eval(mk as string)(5));
      Tools.setSymmetry('h');
      const centre = { col: 225, row: 224 };
      const stamp = Brush.getAffectedTiles(228, 232);        // radius 0: one cell; use a disc instead
      const cells = HexUtils.discCells(228, 232, 1, MAP_WIDTH, MAP_HEIGHT);
      const expanded = Tools.expandSymmetry(cells);
      const n = Tools.scatterCells(cells, 'Forest_1', 100);
      const ids = expanded.map((c: any) => mapData[c.row * MAP_WIDTH + c.col]);
      Tools.setSymmetry('none');
      // mirrored partner of each source cell: same index in the expansion order is not guaranteed, so compare multisets by position pairs
      const src = cells.map((c: any) => mapData[c.row * MAP_WIDTH + c.col]);
      const mirrored = expanded.filter((c: any) => !cells.some((q: any) => q.col === c.col && q.row === c.row)).map((c: any) => mapData[c.row * MAP_WIDTH + c.col]);
      Tools.setScatterRng(null);
      return { n, exp: expanded.length, src, mirrored, ids, written: mapData.filter((x: string) => x !== 'Plain_1').length, steps: History.undoSize() };
    }, [SEEDED]);
    expect(r.exp).toBe(14);
    expect(r.n).toBe(14);
    expect(r.written).toBe(14);
    expect(r.ids.every((id: string) => FOREST.test(id))).toBe(true);
    expect(JSON.stringify(r.src)).not.toBe(JSON.stringify(r.mirrored));      // independent picks, not copies
  });

  test('with symmetry off the same stamp writes only the brush disc', async ({ page }) => {
    const n = await page.evaluate(([mk]) => {
      Tools.setScatterRng(eval(mk as string)(5));
      const k = Tools.scatterCells(HexUtils.discCells(228, 232, 1, MAP_WIDTH, MAP_HEIGHT), 'Forest_1', 100);
      Tools.setScatterRng(null);
      return [k, mapData.filter((x: string) => x !== 'Plain_1').length];
    }, [SEEDED]);
    expect(n).toEqual([7, 7]);
  });

  test('a stamp clipped by the map corner writes exactly the in-bounds disc and does not throw', async ({ page }) => {
    const r = await page.evaluate(([ref]) => {
      const refFn = eval(ref as string);
      UI.selectTerrain('Forest_1'); Brush.setSize(3);
      const n = Tools.scatterCells(Brush.getAffectedTiles(0, 0), 'Forest_1', 100);
      const want = [...refFn(0, 0, 3)].filter(([k, d]: any) => { const [c, rw] = k.split(',').map(Number); return d <= 3 && c >= 0 && c < MAP_WIDTH && rw >= 0 && rw < MAP_HEIGHT; }).length;
      return { n, want, written: mapData.filter((x: string) => x !== 'Plain_1').length };
    }, [DISC_REF]);
    expect(r.n).toBe(r.want); expect(r.written).toBe(r.want); expect(r.want).toBeLessThan(37);
  });

  test('multi-tile footprints are never written and never chosen as variants; bridges on written cells go; edges next to scattered water re-resolve', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      Tools.setScatterRng(eval(mk as string)(3));
      const multi = HexDB.getAll().find((h: any) => Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length > 0);
      const A = { col: 225, row: 230 };
      mapData[A.row * MAP_WIDTH + A.col] = multi.id; invalidateSatelliteMap();
      const sats: any[] = [];
      for (let c = A.col - 3; c <= A.col + 3; c++) for (let rw = A.row - 4; rw <= A.row + 4; rw++) {
        const an = getSatelliteAnchor(c, rw); if (an && an.col === A.col && an.row === A.row && !(c === A.col && rw === A.row)) { sats.push({ col: c, row: rw }); mapData[rw * MAP_WIDTH + c] = 'Water_1'; }
      }
      const cells = HexUtils.discCells(A.col, A.row, 4, MAP_WIDTH, MAP_HEIGHT);
      bridgesData.push({ col: A.col + 1, row: A.row + 3, axis: 0 });
      const inDisc = (c: any) => cells.some((q: any) => q.col === c.col && q.row === c.row);
      const n = Tools.scatterCells(cells, 'Forest_1', 100);
      const protectedOk = sats.every(s => mapData[s.row * MAP_WIDTH + s.col] === 'Water_1');   // the anchor cell itself is replaceable like Paint
      const variantsHaveMulti = ['Forest_1', 'Water_1', 'Plain_1'].some(id => Tools.scatterVariants(id).some((v: string) => { const e = HexDB.getAll().find((h: any) => h.id === v); return e && e.occupiedOffsets && e.occupiedOffsets.length; }));
      // a multi-tile id selected: its group never contains multi-tile members
      const groupOfMulti = Tools.scatterVariants(multi.id);
      // edge re-resolution: a river cell next to a scattered water cell is re-resolved
      const river = HexDB.getAll().find((h: any) => h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length > 0).id;
      const t = { col: 225, row: 210 }, nb = HexUtils.neighbors(t.col, t.row, MAP_WIDTH, MAP_HEIGHT)[0];
      mapData[nb.row * MAP_WIDTH + nb.col] = river;
      const seen: string[] = []; const orig = EdgeTiling.resolveEdgeTile;
      EdgeTiling.resolveEdgeTile = (c: number, rw: number, ...rest: any[]) => { seen.push(c + ',' + rw); return orig(c, rw, ...rest); };
      const w = Tools.scatterCells([t], 'Water_1', 100);
      EdgeTiling.resolveEdgeTile = orig;
      Tools.setScatterRng(null);
      return { multiId: multi.id, groupOfMulti, n, sats: sats.length, expected: cells.length - sats.length, anchorNow: mapData[A.row * MAP_WIDTH + A.col], protectedOk, variantsHaveMulti, groupOfMulti, bridge: bridgesData.length, w, seen, nb: nb.col + ',' + nb.row, inDisc: inDisc(sats[0]) };
    }, [SEEDED]);
    expect(r.sats).toBeGreaterThan(0);
    expect(r.inDisc).toBe(true);
    expect(r.n).toBe(r.expected);
    expect(r.protectedOk).toBe(true);
    expect(r.anchorNow).toMatch(FOREST);
    expect(r.variantsHaveMulti).toBe(false);
    expect(r.groupOfMulti).not.toContain(r.multiId);
    expect(r.bridge).toBe(0);
    expect(r.w).toBe(1);
    expect(r.seen).toContain(r.nb);
  });

  test('a multi-tile entry of the same family is not a variant (fabricated Forest_9 with a footprint)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const all = HexDB.getAll(), base = all.find((h: any) => h.id === 'Forest_1');
      const fake = { ...base, id: 'Forest_9', occupiedOffsets: [[1, 0]] };
      all.push(fake);
      try { return { group: Tools.scatterVariants('Forest_1'), present: HexDB.getAll().some((h: any) => h.id === 'Forest_9') }; }
      finally { all.splice(all.indexOf(fake), 1); }
    });
    expect(r.present).toBe(true);
    expect(r.group).toEqual(['Forest_1', 'Forest_2', 'Forest_3']);
  });

  test('A selects the tool by physical key, respects typing/modifiers, and no existing shortcut changed', async ({ page }) => {
    await page.keyboard.press('KeyA');
    expect(await page.evaluate(() => Tools.getActive())).toBe('scatter');
    expect(await page.evaluate(() => document.querySelector('.tool-btn[data-tool="scatter"]')!.classList.contains('active'))).toBe(true);
    await page.evaluate(() => Tools.setActive('paint'));
    await page.keyboard.press('Shift+KeyA'); await page.keyboard.press('Alt+KeyA'); await page.keyboard.press('Control+KeyA');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('KeyA');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
    await page.evaluate(() => document.getElementById('tmp-in')!.remove());
    for (const [k, t] of [['KeyP', 'paint'], ['KeyF', 'fill'], ['KeyR', 'rect'], ['KeyE', 'eye'], ['KeyS', 'select'], ['KeyT', 'settlement'], ['KeyD', 'erase'], ['KeyZ', 'zone'],
                          ['KeyL', 'line'], ['KeyO', 'circle'], ['KeyG', 'polygon'], ['KeyX', 'eraser']]) {
      await page.keyboard.press(k);
      expect(await page.evaluate(() => Tools.getActive())).toBe(t);
    }
    await page.evaluate(() => Tools.setActive('paint'));
    // typing in the density field does not switch tools; Enter hands the focus back
    await page.keyboard.press('KeyA');
    await page.focus('#scatter-density');
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => Tools.getActive())).toBe('scatter');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement!.tagName)).not.toBe('INPUT');
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  });

  test('the button and the controls live in the left palette; the canvas width is unchanged with scatter active at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.locator('.tool-btn[data-tool="scatter"]').click();
    expect(await page.evaluate(() => Tools.getActive())).toBe('scatter');
    const r = await page.evaluate(() => {
      const b = document.querySelector('.tool-btn[data-tool="scatter"]') as HTMLElement, rc = b.getBoundingClientRect(), pal = document.getElementById('palette-panel')!.getBoundingClientRect();
      const inp = (id: string) => { const e = document.getElementById(id)!; const q = e.getBoundingClientRect(); return { inPalette: !!e.closest('#palette-panel'), inToolbar: !!e.closest('#map-tools'), fits: q.width > 0 && q.right <= pal.right + 0.5 && q.left >= pal.left - 0.5 }; };
      return { btn: { inPalette: !!b.closest('#palette-panel'), inToolbar: !!b.closest('#map-tools'), fits: rc.width > 0 && rc.right <= pal.right + 0.5 }, density: inp('scatter-density'), seed: inp('scatter-seed'), cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width, ch: (document.getElementById('map-canvas') as HTMLCanvasElement).height };
    });
    expect(r.btn).toEqual({ inPalette: true, inToolbar: false, fits: true });
    expect(r.density).toEqual({ inPalette: true, inToolbar: false, fits: true });
    expect(r.seed).toEqual({ inPalette: true, inToolbar: false, fits: true });
    expect([r.cw, r.ch]).toEqual([1491, 808]);
    await page.evaluate(() => Tools.setActive('paint'));
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('scatter-row')!).display)).toBe('none');
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width)).toBe(1491);
  });

  test('side and right buttons never scatter; a tool switch mid-stroke stops the stroke', async ({ page }) => {
    await setupScatter(page, { density: 100, radius: 1 });
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    for (const button of ['middle', 'right'] as const) { await page.mouse.move(p.x, p.y); await page.mouse.down({ button }); await page.mouse.move(p.x + 30, p.y, { steps: 3 }); await page.mouse.up({ button }); }
    await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), q = Canvas.hexScreenPos(225, 224);
      for (const b of [3, 4]) for (const t of ['mousedown', 'mousemove', 'mouseup']) cv.dispatchEvent(new MouseEvent(t, { clientX: rc.left + q.x, clientY: rc.top + q.y, button: b, buttons: 0, bubbles: true }));
    });
    expect(await undoSize(page)).toBe(u);
    expect(await nonPlain(page)).toBe(0);
    await press(page, p);
    const after1 = await nonPlain(page);
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => Tools.isStroking())).toBe(false);   // undo is not blocked by the abandoned stroke
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    const p2 = await cellPoint(page, 232, 224);
    await page.mouse.move(p2.x, p2.y, { steps: 4 });
    await page.mouse.up();
    expect(after1).toBe(7);
    expect(await nonPlain(page)).toBe(7);                    // neither more scatter nor Paint from the old drag
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(false);
    expect(await undoSize(page)).toBe(u + 1);
  });

  test('a lost mouseup finishes the stroke; mouseleave and window blur end it cleanly; autosave is scheduled', async ({ page }) => {
    await setupScatter(page, { density: 100, radius: 0 });
    await page.evaluate(() => { (window as any).__saves = 0; const o = IO.scheduleAutoSave; IO.scheduleAutoSave = () => { (window as any).__saves++; return o.call(IO); }; });
    const lost = await page.evaluate(() => {
      const cv = document.getElementById('map-canvas')!, rc = cv.getBoundingClientRect(), p = Canvas.hexScreenPos(225, 224);
      const ev = (t: string, dx: number, buttons: number) => new MouseEvent(t, { clientX: rc.left + p.x + dx, clientY: rc.top + p.y, button: 0, buttons, bubbles: true });
      const count = () => mapData.filter((x: string) => x !== 'Plain_1').length;
      cv.dispatchEvent(ev('mousedown', 0, 1));
      const down = count();
      cv.dispatchEvent(ev('mousemove', 70, 0));
      const afterLost = count();
      for (let i = 0; i < 12; i++) cv.dispatchEvent(ev('mousemove', 80 + i * 9, 0));
      return { down, afterLost, end: count(), strokingAfter: Tools.isStroking(), saves: (window as any).__saves };
    });
    expect(lost.down).toBe(1);
    expect(lost.end).toBe(lost.afterLost);
    expect(lost.strokingAfter).toBe(false);
    expect(lost.saves).toBeGreaterThan(0);
    // pointer leaves the page with the button held: mouseleave ends the stroke
    await page.evaluate(() => mapData.fill('Plain_1'));
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.mouse.move(p.x, 5000, { steps: 3 });
    await page.mouse.up();
    const n0 = await nonPlain(page);
    await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    expect(await nonPlain(page)).toBe(n0);
    expect(await undoSize(page)).toBe(u + 1);
    // blur mid-stroke
    await page.evaluate(() => { mapData.fill('Plain_1'); (window as any).__saves = 0; });
    await press(page, p);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter') || Tools.isStroking())).toBe(false);
    expect(await page.evaluate(() => (window as any).__saves)).toBeGreaterThan(0);
    const n1 = await nonPlain(page);
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    await page.mouse.up();
    expect(await nonPlain(page)).toBe(n1);
  });

  test('Escape rolls back the stroke through its own token: map, no step, no redo entry; autosave scheduled', async ({ page }) => {
    await setupScatter(page, { density: 100, radius: 1 });
    await page.evaluate(() => { objectsData['225,224'] = 'Grain_1'; Brush.setSize(1); History.push(); History.undo(); (window as any).__saves = 0; const o = IO.scheduleAutoSave; IO.scheduleAutoSave = () => { (window as any).__saves++; return o.call(IO); }; });
    const redo0 = await page.evaluate(() => History.redoSize());
    const u = await undoSize(page);
    const before = await region(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    expect(await nonPlain(page)).toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => ({ steps: History.undoSize(), redo: History.redoSize(), o: objectsData['225,224'], saves: (window as any).__saves, stroking: Tools.isStroking() }));
    expect(r.steps).toBe(u); expect(r.redo).toBe(redo0); expect(r.o).toBe('Grain_1'); expect(r.saves).toBeGreaterThan(0); expect(r.stroking).toBe(false);
    expect(await region(page)).toBe(before);
    await page.mouse.move(p.x + 120, p.y, { steps: 4 });    // the stroke is over although the button is held
    await page.mouse.up();
    expect(await region(page)).toBe(before);
    expect(await undoSize(page)).toBe(u);
  });

  test('undo and redo are ignored mid-stroke, so Escape cancels only its own step', async ({ page }) => {
    await setupScatter(page, { density: 100, radius: 1 });
    await page.evaluate(() => { Tools.scatterCells([{ col: 240, row: 240 }], 'Forest_1', 100); });
    await page.evaluate(() => History.push());       // an earlier step (empty change) the Ctrl+Z must not consume
    const u = await undoSize(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    await page.keyboard.press('Control+KeyZ');
    expect(await undoSize(page)).toBe(u + 1);
    await page.keyboard.press('Escape');
    expect(await undoSize(page)).toBe(u);
    await page.mouse.up();
    expect(await page.evaluate(() => mapData[240 * MAP_WIDTH + 240])).toMatch(FOREST);
  });

  test('a map replaced mid-stroke stops scatter with a toast and writes nothing', async ({ page }) => {
    await setupScatter(page, { density: 100, radius: 1 });
    await toasts(page);
    const p = await cellPoint(page, 225, 224);
    await press(page, p);
    const u = await page.evaluate(() => { IO.newMap(true); return History.undoSize(); });
    await page.mouse.move(p.x + 60, p.y, { steps: 4 });
    await page.mouse.up();
    expect(await nonPlain(page)).toBe(0);
    expect(await undoSize(page)).toBe(u);
    expect(await page.evaluate(() => (window as any).__toasts)).toContain('Scatter stopped — the map changed');
  });

  test('scatter input is ignored while a fill runs (and scatterCells refuses)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      UI.selectTerrain('Forest_1');
      const canvas = document.getElementById('map-canvas')!, rc = canvas.getBoundingClientRect();
      const ev = (t: string, c: number, rw: number) => { const p = Canvas.hexScreenPos(c, rw); return new MouseEvent(t, { clientX: rc.left + p.x, clientY: rc.top + p.y, button: 0, buttons: t === 'mouseup' ? 0 : 1, bubbles: true }); };
      const pr = Tools.fill(225, 225);
      const busy = Tools.isFillBusy();
      Tools.setActive('scatter');
      (document.getElementById('scatter-density') as HTMLInputElement).value = '100';
      const before = History.undoSize();
      canvas.dispatchEvent(ev('mousedown', 225, 224)); canvas.dispatchEvent(ev('mousemove', 228, 224)); canvas.dispatchEvent(ev('mouseup', 228, 224));
      const n = Tools.scatterCells([{ col: 225, row: 224 }], 'Forest_2', 100);
      const during = History.undoSize() - before;
      await pr;
      return { busy, during, n, cell: mapData[224 * MAP_WIDTH + 225] };
    });
    expect(r).toEqual({ busy: true, during: 0, n: 0, cell: 'Forest_1' });
  });

  test('hover preview shows the brush area only, as one highlight layer, and is not re-rolled by mouse movement; cleared on every exit', async ({ page }) => {
    await page.evaluate(() => { UI.selectTerrain('Forest_1'); Tools.setActive('scatter'); Brush.setSize(2); });
    const p = await cellPoint(page, 225, 224);
    const mapBefore = await region(page);
    await page.mouse.move(p.x, p.y);
    const a = await page.evaluate(([ref]) => {
      const h = Canvas.getHighlightPoints('scatter')!, refFn = eval(ref as string);
      const got = h.xs.map((x: number, i: number) => Math.round(x * 100) + ',' + Math.round(h.ys[i] * 100)).sort();
      const want = [...refFn(225, 224, 2).keys()].map((k: string) => { const [c, r] = k.split(',').map(Number), w = Canvas.hexCenterWorld(c, r); return Math.round(w.x * 100) + ',' + Math.round(w.y * 100); }).sort();
      return { n: h.n, same: JSON.stringify(got) === JSON.stringify(want), eraser: Canvas.hasHighlight('eraser') };
    }, [DISC_REF]);
    expect(a).toEqual({ n: 19, same: true, eraser: false });
    expect(await region(page)).toBe(mapBefore);                  // hover never writes or rolls anything
    await page.keyboard.press('BracketRight');
    expect(await page.evaluate(() => Canvas.getHighlightPoints('scatter')!.n)).toBe(37);
    await page.evaluate(() => document.getElementById('map-canvas')!.dispatchEvent(new MouseEvent('mouseleave')));
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(false);
    await page.mouse.move(p.x, p.y);
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(true);
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(false);
    await page.keyboard.press('KeyA'); await page.mouse.move(p.x + 5, p.y + 40);
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(false);
    await page.mouse.move(p.x, p.y);
    await page.evaluate(() => { IO.newMap(true); Canvas.render(); });
    expect(await page.evaluate(() => Canvas.hasHighlight('scatter'))).toBe(false);
  });
});
