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
