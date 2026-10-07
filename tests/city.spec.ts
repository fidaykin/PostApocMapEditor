import { test, expect } from '@playwright/test';
import { freshEditor, clickCell } from './editor-helpers';
import { openSection } from './helpers';

// T3.5: configurable city position. The city is the settlement with type 'city'; getCityCol/getCityRow, the distance
// readouts, the rings, the slot labels and the generator's flatten/exclusion centre all follow it.

const cityOf = (page: any) => page.evaluate(() => [getCityCol(), getCityRow()]);
const steps = (page: any): Promise<number> => page.evaluate(() => History.undoSize());
const SPY = `window.__toasts = []; if (!UI.__spied) { UI.__spied = true; const t = UI.toast; UI.toast = (m, o) => { window.__toasts.push(String(m)); return t.call(UI, m, o); }; }`;
const toasts = (page: any): Promise<string[]> => page.evaluate(() => (window as any).__toasts.slice());

test.describe('configurable city (T3.5)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await page.evaluate(SPY); });

  test('moveCity relocates the city; distances follow it (independent cube reference); it survives save/load', async ({ page }) => {
    const r = await page.evaluate(() => {
      const moved = Tools.moveCity(240, 230);
      const out: any = { moved, col: getCityCol(), row: getCityRow(), d0: cityDistance(240, 230),
        d1: HexUtils.neighbors(240, 230, MAP_WIDTH, MAP_HEIGHT).map((n: any) => cityDistance(n.col, n.row)),
        legacy: _hexDistFromCity(240, 230) };
      // independent reference: HexUtils cube distance from the new city to a sample of cells
      const c0 = HexUtils.toCube(240, 230, MAP_WIDTH, MAP_HEIGHT);
      out.mismatch = 0; out.maxD = 0;
      for (let col = 200; col < 280; col += 3) for (let row = 190; row < 270; row += 3) {
        const ref = HexUtils.cubeDistance(HexUtils.toCube(col, row, MAP_WIDTH, MAP_HEIGHT), c0);
        if (cityDistance(col, row) !== ref) out.mismatch++;
        out.maxD = Math.max(out.maxD, ref);
      }
      out.cities = settlements.filter((s: any) => s.type === 'city').length;
      IO.loadFromJSON(JSON.parse(IO.getMapJson()));
      out.after = { col: getCityCol(), row: getCityRow(), cities: settlements.filter((s: any) => s.type === 'city').length };
      return out;
    });
    expect(r.moved).toBe(true);
    expect([r.col, r.row]).toEqual([240, 230]);
    expect(r.d0).toBe(0);
    expect(r.legacy).toBe(0);
    expect(r.d1).toHaveLength(6);
    expect(r.d1.every((d: number) => d === 1)).toBe(true);
    expect(r.maxD).toBeGreaterThan(20);         // the comparison covers real distances
    expect(r.mismatch).toBe(0);
    expect(r.cities).toBe(1);
    expect(r.after).toEqual({ col: 240, row: 230, cities: 1 });
  });

  test('default city keeps default distances (225,224 is distance 0, as before)', async ({ page }) => {
    const r = await page.evaluate(() => ({ c: [getCityCol(), getCityRow()], d: cityDistance(225, 224), e: cityDistance(235, 224), old: Canvas.hexDist((MAP_HEIGHT - 1 - 224) - 225 + 10, 0) }));
    expect(r.c).toEqual([225, 224]);
    expect(r.d).toBe(0);
    expect(r.e).toBe(10);
    expect(r.old).toBe(10);
  });

  test('one History step, undo/redo restore the city; refused positions leave nothing behind and toast', async ({ page }) => {
    const s0 = await steps(page);
    expect(await page.evaluate(() => Tools.moveCity(228, 226))).toBe(true);
    expect(await steps(page)).toBe(s0 + 1);
    expect(await cityOf(page)).toEqual([228, 226]);
    await page.evaluate(() => History.undo());
    expect(await cityOf(page)).toEqual([225, 224]);
    await page.evaluate(() => History.redo());
    expect(await cityOf(page)).toEqual([228, 226]);
    const s1 = await steps(page);
    for (const [c, r] of [[-1, 5], [5, -1], [450, 5], [5, 450], [NaN, 3], [3.5, 4], [undefined as any, 4]]) {
      await page.evaluate(() => { (window as any).__toasts = []; });
      expect(await page.evaluate(([c, r]: any) => Tools.moveCity(c, r), [c, r]), `refuse ${c},${r}`).toBe(false);
      expect((await toasts(page)).length, `toast for ${c},${r}`).toBe(1);
    }
    await page.evaluate(() => { (window as any).__toasts = []; });
    expect(await page.evaluate(() => Tools.moveCity(228, 226)), 'same cell').toBe(false);
    expect((await toasts(page)).length).toBe(1);
    expect(await steps(page)).toBe(s1);
    expect(await cityOf(page)).toEqual([228, 226]);
  });

  test('a settlement on the target is replaced by the city (undo brings it back); other settlements and zones stay', async ({ page }) => {
    const r = await page.evaluate(() => {
      settlements.push({ col: 230, row: 230, type: 'settlement' }, { col: 100, row: 100, type: 'settlement' });
      const zid = ZonePainter.addZone('Z'); ZonePainter.setSelectedZoneId(zid);
      ZonePainter.getZoneLayer()[230 * MAP_WIDTH + 230] = zid;
      Tools.moveCity(230, 230);
      const out: any = { s: settlements.map((s: any) => s.type + ':' + s.col + ',' + s.row).sort(), zone: ZonePainter.getZoneLayer()[230 * MAP_WIDTH + 230] === zid };
      History.undo();
      out.undo = settlements.map((s: any) => s.type + ':' + s.col + ',' + s.row).sort();
      return out;
    });
    expect(r.s).toEqual(['city:230,230', 'settlement:100,100']);
    expect(r.zone).toBe(true);
    expect(r.undo).toEqual(['city:225,224', 'settlement:100,100', 'settlement:230,230']);
  });

  test('refused while the settlements layer is locked, while a fill runs and during a stroke', async ({ page }) => {
    await page.evaluate(() => Layers.setLocked('settlements', true));
    const s0 = await steps(page);
    expect(await page.evaluate(() => Tools.moveCity(230, 230))).toBe(false);
    expect((await toasts(page)).some(t => /locked/i.test(t))).toBe(true);
    expect(await steps(page)).toBe(s0);
    expect(await cityOf(page)).toEqual([225, 224]);
    await page.evaluate(() => Layers.setLocked('settlements', false));
    // wrong-layer control: another lock does not stop it
    await page.evaluate(() => Layers.setLocked('terrain', true));
    expect(await page.evaluate(() => Tools.moveCity(230, 230))).toBe(true);
    await page.evaluate(() => Layers.setLocked('terrain', false));
    // a gesture in progress refuses
    await page.evaluate(() => { (window as any).__toasts = []; Tools.setActive('eraser'); });
    const { x, y } = await page.evaluate(() => { const p = Canvas.hexScreenPos(226, 224); const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; });
    await page.mouse.move(x, y); await page.mouse.down();
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
    expect(await page.evaluate(() => Tools.moveCity(231, 231))).toBe(false);
    await page.mouse.up();
    expect(await cityOf(page)).toEqual([230, 230]);
  });

  test('City tool in the left palette (Map design): click moves the city, one undo step, Esc not needed; canvas stays 1491 px', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const d = document.getElementById('map-design');
      const b = document.querySelector('.tool-btn[data-tool="city"]') as HTMLElement | null;
      return { sec: !!d, inPalette: !!d && !!d.closest('#palette-panel') && !d.closest('#toolbar') && !d.closest('#map-tools'),
               btnIn: !!b && !!b.closest('#map-design'), cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width,
               layer: Tools.toolLayers().map.city };
    });
    expect(r.sec).toBe(true);
    expect(r.inPalette).toBe(true);
    expect(r.btnIn).toBe(true);
    expect(r.layer).toBe('settlements');
    expect(r.cw).toBe(1491);
    await openSection(page, 'design');
    await page.evaluate(() => Canvas.centerOnCity());
    await page.click('.tool-btn[data-tool="city"]');
    expect(await page.evaluate(() => Tools.getActive())).toBe('city');
    const s0 = await steps(page);
    await clickCell(page, 228, 226);
    expect(await cityOf(page)).toEqual([228, 226]);
    expect(await steps(page)).toBe(s0 + 1);
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(false);
    await page.evaluate(() => History.undo());
    expect(await cityOf(page)).toEqual([225, 224]);
  });

  test('status bar distance is city-relative', async ({ page }) => {
    await page.evaluate(() => Tools.moveCity(240, 230));
    await page.evaluate(() => Canvas.centerOnCity());
    const p = await page.evaluate(() => { const q = Canvas.hexScreenPos(240, 236); const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; });
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 1, p.y + 1);
    const d = await page.evaluate(() => document.getElementById('st-dist')!.textContent);
    const tile = await page.evaluate(() => document.getElementById('st-tile')!.textContent);
    expect(tile).toBe('240, 236');
    expect(d).toBe(String(await page.evaluate(() => HexUtils.cubeDistance(HexUtils.toCube(240, 236, MAP_WIDTH, MAP_HEIGHT), HexUtils.toCube(240, 230, MAP_WIDTH, MAP_HEIGHT)))));
    expect(d).not.toBe('0');
  });

  test('city entry is memoised: 2000 reads do not rescan a 450-entry settlement list, and every change is still seen', async ({ page }) => {
    const r = await page.evaluate(() => {
      const base: any[] = []; for (let i = 0; i < 450; i++) base.push({ col: i % 400, row: 300 + (i % 100), type: 'settlement' });
      base.splice(300, 0, { col: 10, row: 20, type: 'city' });
      let gets = 0;
      const prox = new Proxy(base, { get(t: any, k: any) { if (typeof k === 'string' && /^\d+$/.test(k)) gets++; return t[k]; } });
      settlements = prox as any;
      for (let i = 0; i < 2000; i++) { getCityCol(); getCityRow(); }
      const memo = gets;
      // changes through every route are still seen
      settlements = [{ col: 5, row: 6, type: 'city' }];
      const a = [getCityCol(), getCityRow()];
      settlements.unshift({ col: 7, row: 8, type: 'city' });
      const b = [getCityCol(), getCityRow()];
      settlements.shift();
      const c = [getCityCol(), getCityRow()];
      settlements[0].col = 9;
      const d = [getCityCol(), getCityRow()];
      settlements = [];
      const e = [getCityCol(), getCityRow()];
      return { memo, a, b, c, d, e };
    });
    expect(r.memo).toBeLessThan(5000);   // unmemoised: 4000 scans x ~300 entries
    expect(r.a).toEqual([5, 6]);
    expect(r.b).toEqual([7, 8]);
    expect(r.c).toEqual([5, 6]);
    expect(r.d).toEqual([9, 6]);
    expect(r.e).toEqual([225, 224]);
  });

  // ── every site that installs a map builds the city from the NEW map's default, never from the old map's city ──────────
  test('New Map (silent and dialog) and Load without settlements use the new default centre, not the old moved city', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out: any = {};
      Tools.moveCity(300, 300);
      (document.getElementById('newmap-w') as HTMLInputElement).value = '100';
      (document.getElementById('newmap-h') as HTMLInputElement).value = '60';
      IO.applyNewMap();
      out.dialog = { size: [MAP_WIDTH, MAP_HEIGHT], city: [getCityCol(), getCityRow()], n: settlements.length };
      Tools.moveCity(90, 50);
      IO.newMap(true);
      out.silent = { size: [MAP_WIDTH, MAP_HEIGHT], city: [getCityCol(), getCityRow()], n: settlements.length };
      Tools.moveCity(400, 400);
      const json = JSON.parse(IO.getMapJson());
      const small = { ...json, width: 40, height: 40, data: json.data.slice(0, 40).map((r: any) => r.slice(0, 40)), settlements: [] };
      delete small.zoneMap; delete small.zones;
      IO.loadFromJSON(small);
      out.loadNone = { size: [MAP_WIDTH, MAP_HEIGHT], city: [getCityCol(), getCityRow()], n: settlements.length };
      return out;
    });
    expect(r.dialog).toEqual({ size: [100, 60], city: [50, 29], n: 1 });
    expect(r.silent).toEqual({ size: [450, 450], city: [225, 224], n: 1 });
    expect(r.loadNone).toEqual({ size: [40, 40], city: [20, 19], n: 1 });
  });

  test('Load keeps a moved city, never adds a second one at the centre; an old map (city at centre / no city entry) loads as before', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out: any = {};
      Tools.moveCity(240, 230);
      const json = JSON.parse(IO.getMapJson());
      IO.newMap(true);
      IO.loadFromJSON(json);
      out.moved = { city: [getCityCol(), getCityRow()], cities: settlements.filter((s: any) => s.type === 'city').length, total: settlements.length };
      // old file: city at the centre
      IO.newMap(true);
      const old = JSON.parse(IO.getMapJson());
      IO.loadFromJSON(old);
      out.centre = { city: [getCityCol(), getCityRow()], total: settlements.length };
      // old file: settlements without any city entry, one of them at the centre -> that one becomes the city
      const noCity = { ...old, settlements: [{ col: 225, row: 224, type: 'settlement' }, { col: 10, row: 10, type: 'settlement' }] };
      IO.loadFromJSON(noCity);
      out.noCity = { city: [getCityCol(), getCityRow()], types: settlements.map((s: any) => s.type + ':' + s.col + ',' + s.row) };
      // old file: settlements without the centre one -> a city is added at the centre
      IO.loadFromJSON({ ...old, settlements: [{ col: 10, row: 10, type: 'settlement' }] });
      out.added = { city: [getCityCol(), getCityRow()], total: settlements.length };
      // two cities in one file: the first wins, the other entry is dropped
      IO.loadFromJSON({ ...old, settlements: [{ col: 50, row: 60, type: 'city' }, { col: 70, row: 80, type: 'city' }, { col: 10, row: 10, type: 'settlement' }] });
      out.two = { city: [getCityCol(), getCityRow()], types: settlements.map((s: any) => s.type + ':' + s.col + ',' + s.row) };
      return out;
    });
    expect(r.moved).toEqual({ city: [240, 230], cities: 1, total: 1 });
    expect(r.centre).toEqual({ city: [225, 224], total: 1 });
    expect(r.noCity.city).toEqual([225, 224]);
    expect(r.noCity.types).toEqual(['city:225,224', 'settlement:10,10']);
    expect(r.added).toEqual({ city: [225, 224], total: 2 });
    expect(r.two.city).toEqual([50, 60]);
    expect(r.two.types).toEqual(['city:50,60', 'settlement:10,10']);
  });

  test('autosave restore and side-copy restore keep the moved city; a restore of an older map does not inherit it', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const out: any = {};
      Tools.moveCity(240, 230);
      const withCity = IO.getMapJson();
      IO.newMap(true);
      out.fresh = [getCityCol(), getCityRow()];
      out.ok = await IO.tryRestoreAutosave(withCity);
      out.restored = { city: [getCityCol(), getCityRow()], cities: settlements.filter((s: any) => s.type === 'city').length };
      // an autosave without settlements at a different size: default centre of THAT map, not the moved city
      const j = JSON.parse(withCity);
      const small = { ...j, width: 40, height: 40, data: j.data.slice(0, 40).map((r: any) => r.slice(0, 40)), settlements: [] };
      delete small.zoneMap; delete small.zones;
      out.ok2 = await IO.tryRestoreAutosave(JSON.stringify(small));
      out.small = { size: [MAP_WIDTH, MAP_HEIGHT], city: [getCityCol(), getCityRow()] };
      return out;
    });
    expect(r.fresh).toEqual([225, 224]);
    expect(r.ok).toBe(true);
    expect(r.restored).toEqual({ city: [240, 230], cities: 1 });
    expect(r.ok2).toBe(true);
    expect(r.small).toEqual({ size: [40, 40], city: [20, 19] });
  });

  test('Expand Map shifts the moved city with the map and the new default centre moves with it', async ({ page }) => {
    const r = await page.evaluate(() => {
      (document.getElementById('newmap-w') as HTMLInputElement).value = '100';
      (document.getElementById('newmap-h') as HTMLInputElement).value = '100';
      IO.applyNewMap();
      Tools.moveCity(60, 40);
      (document.getElementById('expandmap-amount') as HTMLInputElement).value = '10';
      IO.applyExpandMap();
      return { size: [MAP_WIDTH, MAP_HEIGHT], city: [getCityCol(), getCityRow()], n: settlements.length };
    });
    expect(r.size).toEqual([120, 120]);
    expect(r.city).toEqual([70, 50]);
    expect(r.n).toBe(1);
  });

  test('Auto-place settlements keeps the moved city and measures distances from it', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.moveCity(300, 300);
      settlementSlots = [{ minDist: 5, maxDist: 12, count: 6, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 34, midPct: 33, farPct: 33 }];
      autoPlaceSettlements();
      const placed = settlements.filter((s: any) => s.type !== 'city');
      const ds = placed.map((s: any) => HexUtils.cubeDistance(HexUtils.toCube(s.col, s.row, MAP_WIDTH, MAP_HEIGHT), HexUtils.toCube(300, 300, MAP_WIDTH, MAP_HEIGHT)));
      return { n: placed.length, min: Math.min(...ds), max: Math.max(...ds), city: [getCityCol(), getCityRow()] };
    });
    expect(r.n).toBeGreaterThan(3);
    expect(r.min).toBeGreaterThanOrEqual(5);
    expect(r.max).toBeLessThanOrEqual(12);
    expect(r.city).toEqual([300, 300]);
  });

  test('the city marker is drawn where the city is (minimap dot and centre-on-city follow)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Tools.moveCity(300, 280);
      Canvas.centerOnCity();
      const w = Canvas.hexCenterWorld(300, 280), cam = Canvas.getCamera(), sc = Canvas.getZoom() / 100;
      const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
      return { dx: Math.abs(w.x * sc - cam.x - cv.width / 2), dy: Math.abs(w.y * sc - cam.y - cv.height / 2) };
    });
    expect(r.dx).toBeLessThan(2);
    expect(r.dy).toBeLessThan(2);
  });
});

// ── generator: flatten + exclusion circle follow the city; default output is unchanged ───────────────────────────────
test.describe('generator follows the city (T3.5)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('job params carry the city; default city leaves the output byte-identical to a job without city fields', async ({ page }) => {
    const r = await page.evaluate(() => {
      const job = Generator._buildJob({ skipExpensive: false });
      const a = MapJobs.generate(job);
      const bare = { ...job, p: { ...job.p } }; delete (bare.p as any).cityCol; delete (bare.p as any).cityRow;
      const b = MapJobs.generate(bare);
      return { c: [job.p.cityCol, job.p.cityRow], same: a.grid.every((v: number, i: number) => v === b.grid[i]) && a.names.join() === b.names.join(), n: a.grid.length };
    });
    expect(r.c).toEqual([225, 224]);
    expect(r.n).toBe(450 * 450);
    expect(r.same).toBe(true);
  });

  test('flatten centre follows the city: elevation at a moved city is the flatten target, at the old centre it is not', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH;
      const at = (cc: number, cr: number) => {
        Tools.moveCity(cc, cr);
        const job = Generator._buildJob({ skipExpensive: true, debug: true });
        const res = MapJobs.generate(job);
        // the flatten centre is the city shifted by the generator's historical +1 row (default: city 225,224 -> centre 225,225)
        return { city: res.elev[(cr + 1) * W + cc], centre: res.elev[225 * W + 225], p: [job.p.cityCol, job.p.cityRow] };
      };
      const def = at(225, 224);
      const moved = at(120, 130);
      return { def, moved };
    });
    expect(r.def.city).toBeCloseTo(0.46, 5);       // default: the target value sits at the default city (as before)
    expect(r.moved.p).toEqual([120, 130]);
    expect(r.moved.city).toBeCloseTo(0.46, 5);     // moved: the flatten target sits at the new city
    expect(Math.abs(r.moved.centre - 0.46)).toBeGreaterThan(1e-4);   // the old centre is natural terrain again (positive control)
  });

  test('ore and river exclusion follow the city', async ({ page }) => {
    const r = await page.evaluate(() => {
      (document.getElementById('gen-goldCount') as HTMLInputElement).max = '5000';
      (document.getElementById('gen-goldCount') as HTMLInputElement).value = '3000';
      (document.getElementById('gen-gold') as HTMLInputElement).checked = true;
      const W = MAP_WIDTH, infR = Math.min(450, 450) * 0.08;
      const count = (names: string[], grid: Uint16Array, cx: number, cy: number) => {
        const gi = names.map((n, i) => (n === 'GoldVein_1' || /^GoldVein/.test(n)) ? i : -1).filter(i => i >= 0);
        let near = 0, total = 0;
        for (let i = 0; i < grid.length; i++) if (gi.includes(grid[i])) { total++; const dx = (i % W) - cx, dy = Math.floor(i / W) - cy; if (dx * dx + dy * dy <= infR * infR) near++; }
        return { near, total };
      };
      const out: any = {};
      const run = (cc: number, cr: number) => { Tools.moveCity(cc, cr); const res = MapJobs.generate(Generator._buildJob({ skipExpensive: true })); return res; };
      let res = run(120, 120);
      out.atMoved = count(res.names, res.grid, 120, 121);   // exclusion centre = city + the historical +1 row
      out.atOldCentre = count(res.names, res.grid, 225, 225);
      Tools.moveCity(225, 224);
      res = MapJobs.generate(Generator._buildJob({ skipExpensive: true }));
      out.defCentre = count(res.names, res.grid, 225, 225);
      return out;
    });
    expect(r.atMoved.total).toBeGreaterThan(50);           // ore really generated
    expect(r.atMoved.near).toBe(0);                        // none inside the exclusion circle of the moved city
    expect(r.defCentre.near).toBe(0);                      // default: still excluded around the centre
    expect(r.atOldCentre.near, 'positive control: the old centre is no longer protected').toBeGreaterThan(0);
  });

  test('the real worker agrees with the main-thread job for a moved city', async ({ page }) => {
    const r = await page.evaluate(async () => {
      Tools.moveCity(150, 160);
      const job = Generator._buildJob({ skipExpensive: true });
      const viaWorker = await WorkerJobs.run('generate', job);
      const usedWorker = WorkerJobs.usingWorker();      // like perf-workers.spec.ts: the result must really come from a worker
      const direct = MapJobs.generate(Generator._buildJob({ skipExpensive: true }));
      const moved0 = MapJobs.generate({ ...job, p: { ...job.p, cityCol: 225, cityRow: 224 } });
      let diffDirect = 0, diffMoved = 0;
      for (let i = 0; i < direct.grid.length; i++) {
        if (viaWorker.names[viaWorker.grid[i]] !== direct.names[direct.grid[i]]) diffDirect++;
        if (moved0.names[moved0.grid[i]] !== direct.names[direct.grid[i]]) diffMoved++;
      }
      return { diffDirect, diffMoved, usedWorker, v: MapJobs.VERSION };
    });
    expect(r.usedWorker, 'a real worker produced the result').toBe(true);
    expect(r.diffDirect).toBe(0);
    expect(r.diffMoved, 'positive control: the city position changes the output').toBeGreaterThan(0);
  });
});

// ── T3.6: configurable difficulty (distance) bands ─────────────────────────────────────────────────────────────────────
test.describe('distance bands (T3.6)', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await page.evaluate(SPY); });
  const bounds = (page: any) => page.evaluate(() => DistanceBands.getBounds());
  const commit = async (page: any, text: string) => {
    await openSection(page, 'design');
    const input = page.locator('#ring-bounds');
    await input.fill(text);
    await input.press('Enter');
    await input.blur();
  };

  test('explicit limits, band index, default from the interval input, JSON round trip', async ({ page }) => {
    const r = await page.evaluate(() => {
      DistanceBands.setBounds([30, 5, 12, 12, -3]);
      const bounds = DistanceBands.getBounds();
      const idx = [4, 5, 11, 12, 29, 30, 99].map(d => DistanceBands.bandIndex(d));
      const json = JSON.parse(IO.getMapJson());
      DistanceBands.setBounds([]);
      const def = DistanceBands.getBounds();
      (document.getElementById('ring-interval') as HTMLInputElement).value = '15';
      const def15 = DistanceBands.getBounds().slice(0, 3);
      const idx15 = [0, 14, 15, 29, 30, 500].map(d => DistanceBands.bandIndex(d));
      (document.getElementById('ring-interval') as HTMLInputElement).value = '10';
      const none = JSON.parse(IO.getMapJson());
      IO.loadFromJSON(json);
      return { bounds, idx, saved: json.distance_bands, def, def15, idx15, noKey: 'distance_bands' in none, after: DistanceBands.getBounds(), toJson: DistanceBands.toJson() };
    });
    expect(r.bounds).toEqual([5, 12, 30]);
    expect(r.idx).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(r.saved).toEqual([5, 12, 30]);
    expect(r.def).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(r.def15).toEqual([15, 30, 45]);
    expect(r.idx15).toEqual([0, 0, 1, 1, 2, 10]);
    expect(r.noKey).toBe(false);
    expect(r.after).toEqual([5, 12, 30]);
    expect(r.toJson).toEqual([5, 12, 30]);
  });

  test('hostile / old JSON: a missing key, non-array, junk entries and more than 10 values load safely', async ({ page }) => {
    const r = await page.evaluate(() => {
      const base = JSON.parse(IO.getMapJson());
      const out: any = {};
      for (const [k, v] of [['missing', undefined], ['string', '5,10'], ['object', { a: 1 }], ['junk', ['x', null, -4, 0, 7, 7, '9', 1e9]], ['many', Array.from({ length: 14 }, (_, i) => i + 1)]] as any[]) {
        DistanceBands.setBounds([3]);
        IO.loadFromJSON({ ...base, distance_bands: v });
        out[k] = DistanceBands.toJson();
      }
      return out;
    });
    expect(r.missing).toBeNull();
    expect(r.string).toBeNull();
    expect(r.object).toBeNull();
    expect(r.junk).toEqual([7, 9]);
    expect(r.many).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('the bands never leak into another map: New Map, dialog New Map, Load, autosave restore, side-copy restore, failed restore', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const out: any = {};
      const set = () => DistanceBands.setBounds([4, 9]);
      set(); IO.newMap(true); out.silent = DistanceBands.toJson();
      set(); (document.getElementById('newmap-w') as HTMLInputElement).value = '60'; (document.getElementById('newmap-h') as HTMLInputElement).value = '60'; IO.applyNewMap(); out.dialog = DistanceBands.toJson();
      const plain = JSON.parse(IO.getMapJson());
      set(); IO.loadFromJSON(plain); out.load = DistanceBands.toJson();
      set(); out.restoreOk = await IO.tryRestoreAutosave(JSON.stringify(plain)); out.restore = DistanceBands.toJson();
      DistanceBands.setBounds([5, 12, 30]); const withB = IO.getMapJson();
      DistanceBands.setBounds([]); out.restoreWith = await IO.tryRestoreAutosave(withB); out.restoreWithB = DistanceBands.toJson();
      // a restore that fails half way puts the previous map and its bands back exactly
      DistanceBands.setBounds([2, 3]);
      const clear = History.clear; History.clear = () => { History.clear = clear; throw new Error('boom'); };
      out.failed = await IO.tryRestoreAutosave(withB);
      History.clear = clear;
      out.afterFail = DistanceBands.toJson();
      return out;
    });
    expect(r.silent).toBeNull();
    expect(r.dialog).toBeNull();
    expect(r.load).toBeNull();
    expect(r.restoreOk).toBe(true);
    expect(r.restore).toBeNull();
    expect(r.restoreWith).toBe(true);
    expect(r.restoreWithB).toEqual([5, 12, 30]);
    expect(r.failed).toBe(false);
    expect(r.afterFail).toEqual([2, 3]);
  });

  test('Expand Map keeps the bands (distances are city-relative and the city moves with the map)', async ({ page }) => {
    const r = await page.evaluate(() => {
      (document.getElementById('newmap-w') as HTMLInputElement).value = '100'; (document.getElementById('newmap-h') as HTMLInputElement).value = '100'; IO.applyNewMap();
      DistanceBands.setBounds([6, 14]);
      (document.getElementById('expandmap-amount') as HTMLInputElement).value = '10'; IO.applyExpandMap();
      return DistanceBands.toJson();
    });
    expect(r).toEqual([6, 14]);
  });

  test('the Map design input commits on Enter / blur as ONE History step; undo and redo bring the bands back; no empty steps', async ({ page }) => {
    const s0 = await steps(page);
    await commit(page, '10, 20 35');
    expect(await bounds(page)).toEqual([10, 20, 35]);
    expect(await steps(page)).toBe(s0 + 1);
    await commit(page, '10,20,35');                       // same values: no step
    expect(await steps(page)).toBe(s0 + 1);
    await commit(page, '');                               // empty = back to the interval
    expect((await bounds(page))[0]).toBe(10);
    expect(await page.evaluate(() => DistanceBands.toJson())).toBeNull();
    expect(await steps(page)).toBe(s0 + 2);
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => DistanceBands.toJson())).toEqual([10, 20, 35]);
    expect(await page.inputValue('#ring-bounds')).toBe('10,20,35');
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => DistanceBands.toJson())).toBeNull();
    expect(await page.inputValue('#ring-bounds')).toBe('');
    await page.evaluate(() => History.redo());
    expect(await page.evaluate(() => DistanceBands.toJson())).toEqual([10, 20, 35]);
  });

  test('invalid input is refused with a toast and the old bands (and the text) stay', async ({ page }) => {
    await commit(page, '5,15');
    const s0 = await steps(page);
    for (const bad of ['abc', '5,-2', '0', '3,x,9', '1,2,3,4,5,6,7,8,9,10,11', '5.5', '1e9']) {
      await page.evaluate(() => { (window as any).__toasts = []; });
      await commit(page, bad);
      expect(await page.evaluate(() => DistanceBands.toJson()), 'kept for ' + bad).toEqual([5, 15]);
      expect(await page.inputValue('#ring-bounds'), 'text reset for ' + bad).toBe('5,15');
      expect((await toasts(page)).length, 'toast for ' + bad).toBe(1);
    }
    expect(await steps(page)).toBe(s0);
  });

  test('a committed change schedules an autosave; a refused one does not; a running stroke refuses the commit', async ({ page }) => {
    await page.evaluate(() => { (window as any).__as = 0; const f = IO.scheduleAutoSave; IO.scheduleAutoSave = () => { (window as any).__as++; return f.call(IO); }; });
    await commit(page, '8,16');
    expect(await page.evaluate(() => (window as any).__as)).toBe(1);
    await commit(page, 'nope');
    expect(await page.evaluate(() => (window as any).__as)).toBe(1);
    // a stroke in progress: the commit is refused (no History step inside the stroke) and the text is reset
    await page.evaluate(() => { Tools.setActive('eraser'); });
    const { x, y } = await page.evaluate(() => { const p = Canvas.hexScreenPos(226, 224); const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; });
    await page.mouse.move(x, y); await page.mouse.down();
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
    const ok = await page.evaluate(() => DistanceBands.commit('3,4'));
    await page.mouse.up();
    expect(ok).toBe(false);
    expect(await page.evaluate(() => DistanceBands.toJson())).toEqual([8, 16]);
  });

  test('the input lives in the left palette Map design section; canvas keeps 1491 px at 1400x900', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await page.evaluate(() => {
      const i = document.getElementById('ring-bounds');
      return { inSection: !!i && !!i.closest('#map-design') && !!i.closest('#palette-panel') && !i.closest('#map-tools') && !i.closest('#toolbar'), cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width };
    });
    expect(r.inSection).toBe(true);
    expect(r.cw).toBe(1491);
  });

  test('the tint follows the limits (pixels) and the bands are city-relative', async ({ page }) => {
    // reference: with the default interval 10 the band-1 colour is what a cell at distance 15 shows; with limits [5,12,30] a cell
    // at distance 8 must show that same colour, and at distance 8 the default shows the band-0 colour (positive control)
    const px = async (c: number, r: number) => page.evaluate(([c, r]: any) => {
      const p = Canvas.hexScreenPos(c, r), cv = document.getElementById('map-canvas') as HTMLCanvasElement;
      return Array.from(cv.getContext('2d')!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data);
    }, [c, r]);
    // terrain pixels vary by a unit or two between cells (sprite shading): compare with a small tolerance, the bands differ by far more
    const gap = (a: number[], b: number[]) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));
    await page.evaluate(() => { Canvas.setZoom(60); Canvas.toggleZones(); Canvas.centerOnCity(); Canvas.render(); });
    const defBand0 = await px(225, 224 - 8), defBand1 = await px(225, 224 - 15);
    expect(gap(defBand0, defBand1)).toBeGreaterThan(8);
    await page.evaluate(() => { DistanceBands.setBounds([5, 12, 30]); Canvas.render(); });
    expect(gap(await px(225, 224 - 8), defBand1)).toBeLessThan(4);
    expect(gap(await px(225, 224 - 3), defBand0)).toBeLessThan(4);        // below the first limit: band 0
    // move the city: the same cell is now measured from the new city
    await page.evaluate(() => { Tools.moveCity(225, 224 - 15); Canvas.centerOnCity(); Canvas.render(); });
    expect(gap(await px(225, 224 - 15 - 3), defBand0)).toBeLessThan(4);
    expect(gap(await px(225, 224 - 15 - 8), defBand1)).toBeLessThan(4);
  });
});
