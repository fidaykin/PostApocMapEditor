import { test, expect } from '@playwright/test';
import { freshEditor, cellPoint } from './editor-helpers';
import { openSection } from './helpers';

// T3.8: placement helper (bunkers, mega cities, artifacts, ore clusters). A bulk writer driven from the LEFT palette
// 'Map design' section. Plan = pure read of the map; place = guard + ONE History step + write.
const SPY = `window.__toasts = []; if (!UI.__spied) { UI.__spied = true; const t = UI.toast; UI.toast = (m, o) => { window.__toasts.push(String(m)); return t.call(UI, m, o); }; }`;
const toasts = (page: any): Promise<string[]> => page.evaluate(() => (window as any).__toasts.slice());
const steps = (page: any): Promise<number> => page.evaluate(() => History.undoSize());
const SNAP = `window.__snap = () => JSON.stringify({ m: mapData.join('|'), o: objectsData, r: roadsData, b: bridgesData, s: settlements });`;
const snap = (page: any): Promise<string> => page.evaluate(() => (window as any).__snap());

// explicit config (ids passed in, not taken from the defaults)
const CFG = `{
  bunkers:    { count: 60, kind: 'settlement', id: 'bunker',   minCity: 6 },
  megaCities: { count: 5,  kind: 'settlement', id: 'megacity', minCity: 40 },
  artifacts:  { count: 12, kind: 'object',     id: 'Artefact_Test_1', minCity: 25 },
  ores: [{ name: 'gold', id: 'GoldVein_1', clusters: 4, size: 4 }, { name: 'uranium', id: 'Uranium_1', clusters: 3, size: 3 }],
}`;

test.describe('placement helper (T3.8)', () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
    await page.evaluate(SPY + SNAP);
  });

  test('plan: counts, city distance, spread, ore clusters, blocked cells, unknown ids reported, nothing written', async ({ page }) => {
    const r = await page.evaluate(`(() => {
      // obstacles: a water band, a settlement, an object, a road, a multi-tile terrain anchor
      for (let row = 100; row < 130; row++) for (let col = 0; col < MAP_WIDTH; col++) mapData[row * MAP_WIDTH + col] = 'Water_1';
      settlements.push({ col: 300, row: 300, type: 'settlement' });
      objectsData['310,300'] = 'Grain_1';
      roadsData['320,300'] = { type: 'road_hex' };
      const multi = HexDB.getAll().find(h => h.occupiedOffsets && h.occupiedOffsets.length);
      mapData[200 * MAP_WIDTH + 100] = multi.id;
      invalidateSatelliteMap();
      const before = window.__snap();
      const cfg = ${CFG};
      const plan = Placement.plan(cfg, 99);
      const again = Placement.plan(cfg, 99), other = Placement.plan(cfg, 100);
      const city = HexUtils.toCube(getCityCol(), getCityRow(), MAP_WIDTH, MAP_HEIGHT);
      const cube = p => HexUtils.toCube(p.col, p.row, MAP_WIDTH, MAP_HEIGHT);
      const dcity = p => HexUtils.cubeDistance(cube(p), city);
      const blocked = new Set(['300,300', '310,300', '320,300', '100,200', getCityCol() + ',' + getCityRow()]);
      footprintCells(100, 200, multi).forEach(f => blocked.add(f.col + ',' + f.row));
      const all = [].concat(plan.settlements, plan.objects, plan.tiles);
      const keys = all.map(p => p.col + ',' + p.row);
      const mega = plan.settlements.filter(s => s.type === 'megacity');
      let minMega = Infinity;
      for (let i = 0; i < mega.length; i++) for (let j = i + 1; j < mega.length; j++) minMega = Math.min(minMega, HexUtils.cubeDistance(cube(mega[i]), cube(mega[j])));
      return {
        untouched: window.__snap() === before,
        bunkers: plan.settlements.filter(s => s.type === 'bunker').length, mega: mega.length, artifacts: plan.objects.length,
        gold: plan.tiles.filter(t => t.id === 'GoldVein_1').length,
        minCityMega: Math.min(...mega.map(dcity)), minMega,
        minCityArt: Math.min(...plan.objects.map(dcity)), minCityBunker: Math.min(...plan.settlements.filter(s => s.type === 'bunker').map(dcity)),
        minCityOre: Math.min(...plan.tiles.map(dcity)),
        inBounds: all.every(p => p.col >= 0 && p.col < MAP_WIDTH && p.row >= 0 && p.row < MAP_HEIGHT),
        onWater: all.filter(p => p.row >= 100 && p.row < 130).length,
        onBlocked: keys.filter(k => blocked.has(k)).length,
        distinct: new Set(keys).size === keys.length,
        deterministic: JSON.stringify(plan) === JSON.stringify(again), differs: JSON.stringify(plan) !== JSON.stringify(other),
        skipped: plan.skipped, placed: plan.placed,
      };
    })()`);
    expect(r.untouched).toBe(true);
    expect([r.bunkers, r.mega, r.artifacts]).toEqual([60, 5, 12]);
    expect(r.gold).toBe(16);                                  // 4 clusters x 4 tiles on open land: Poisson centres are 10 apart, so no overlap
    expect(r.minCityMega).toBeGreaterThanOrEqual(40);
    expect(r.minMega).toBeGreaterThanOrEqual(60);
    expect(r.minCityArt).toBeGreaterThanOrEqual(25);
    expect(r.minCityBunker).toBeGreaterThanOrEqual(6);
    expect(r.minCityOre).toBeGreaterThanOrEqual(8);            // centres >= 10 from the city, cluster cells within 2 of a centre
    expect(r.inBounds).toBe(true);
    expect(r.onWater).toBe(0);
    expect(r.onBlocked).toBe(0);
    expect(r.distinct).toBe(true);
    expect(r.deterministic).toBe(true);
    expect(r.differs).toBe(true);
    expect(r.skipped.map((x: any) => x.what)).toEqual(['uranium']);
    expect(r.skipped[0].reason).toMatch(/no tile/i);
  });

  test('plan: an unknown artifact building and a multi-tile ore tile are reported, not placed', async ({ page }) => {
    const r = await page.evaluate(`(() => {
      const multi = HexDB.getAll().find(h => h.occupiedOffsets && h.occupiedOffsets.length);
      const cfg = { bunkers: { count: 0, kind: 'settlement', id: 'bunker', minCity: 6 },
        megaCities: { count: 0, kind: 'settlement', id: 'megacity', minCity: 40 },
        artifacts: { count: 3, kind: 'object', id: 'No_Such_Building', minCity: 25 },
        ores: [{ name: 'big', id: multi.id, clusters: 2, size: 3 }] };
      const p = Placement.plan(cfg, 1);
      return { objects: p.objects.length, tiles: p.tiles.length, skipped: p.skipped.map(s => s.what) };
    })()`);
    expect(r.objects).toBe(0);
    expect(r.tiles).toBe(0);
    expect(r.skipped).toEqual(['artifacts', 'big']);
  });

  test('place: one History step, undo/redo restore exactly, written items are normal map data', async ({ page }) => {
    const before = await snap(page), s0 = await steps(page);
    const rep = await page.evaluate(`Placement.place(${CFG}, 99)`);
    const after = await snap(page);
    expect(rep.placed.bunkers).toBe(60);
    expect(await steps(page)).toBe(s0 + 1);
    const c = await page.evaluate(() => ({
      bunkers: settlements.filter((s: any) => s.type === 'bunker').length, mega: settlements.filter((s: any) => s.type === 'megacity').length,
      cities: settlements.filter((s: any) => s.type === 'city').length,
      art: Object.values(objectsData).filter(v => v === 'Artefact_Test_1').length, gold: mapData.filter((x: string) => x === 'GoldVein_1').length,
    }));
    expect(c).toEqual({ bunkers: 60, mega: 5, cities: 1, art: 12, gold: 16 });
    await page.evaluate(() => History.undo());
    expect(await snap(page)).toBe(before);
    await page.evaluate(() => History.redo());
    expect(await snap(page)).toBe(after);
    // same seed on the same map reproduces the same result
    await page.evaluate(() => History.undo());
    await page.evaluate(`Placement.place(${CFG}, 99)`);
    expect(await snap(page)).toBe(after);
    // saved map JSON round-trips (old format: no new keys)
    const rt = await page.evaluate(() => {
      const json = IO.getMapJson(); IO.loadFromJSON(JSON.parse(json));
      const a = JSON.parse(json), b = JSON.parse(IO.getMapJson());   // compared key by key (top-level key order may differ)
      return { same: JSON.stringify(a) === JSON.stringify(b), diff: Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])), keys: Object.keys(JSON.parse(json)) };
    });
    expect(rt.diff).toEqual([]);
    expect(rt.keys.some((k: string) => /placement/i.test(k))).toBe(false);
  });

  test('placed items stay editable with the normal tools (erase settlement, erase building, paint over ore)', async ({ page }) => {
    await page.evaluate(`Placement.place(${CFG}, 99)`);
    const target = await page.evaluate(() => {
      const b = settlements.find((s: any) => s.type === 'bunker')!;
      const o = Object.keys(objectsData).find(k => objectsData[k] === 'Artefact_Test_1')!.split(',').map(Number);
      const g = mapData.findIndex((x: string) => x === 'GoldVein_1');
      return { b: { col: b.col, row: b.row }, o: { col: o[0], row: o[1] }, g: { col: g % MAP_WIDTH, row: Math.floor(g / MAP_WIDTH) } };
    });
    const clickAt = async (c: { col: number; row: number }) => {
      await page.evaluate((c: any) => {      // centre the camera on the cell (independent of the placement code)
        const w = Canvas.hexCenterWorld(c.col, c.row), z = Canvas.getZoom() / 100, cv = document.getElementById('map-canvas') as HTMLCanvasElement;
        Canvas._test.setCamera(w.x * z - cv.width / 2, w.y * z - cv.height / 2); Canvas.render();
      }, c);
      const p = await cellPoint(page, c.col, c.row);
      await page.mouse.click(p.x, p.y);
    };
    await page.evaluate(() => Tools.setActive('erase'));
    await clickAt(target.b);
    expect(await page.evaluate((c: any) => settlements.some((s: any) => s.col === c.col && s.row === c.row), target.b)).toBe(false);
    await page.evaluate(() => Tools.setActive('erase-object'));
    await clickAt(target.o);
    expect(await page.evaluate((c: any) => objectsData[c.col + ',' + c.row] || null, target.o)).toBe(null);
    await page.evaluate(() => { UI.selectTerrain('Plain_1'); Tools.setActive('paint'); });
    await clickAt(target.g);
    expect(await page.evaluate((c: any) => mapData[c.row * MAP_WIDTH + c.col], target.g)).toBe('Plain_1');
  });

  test('nothing to place: no History step, a toast says why; a failure mid-write rolls the step back', async ({ page }) => {
    await page.evaluate(() => mapData.fill('Water_1'));
    const s0 = await steps(page), before = await snap(page);
    const rep = await page.evaluate(`Placement.place(${CFG}, 5)`);
    expect(rep.placed.bunkers || 0).toBe(0);
    expect(await steps(page)).toBe(s0);
    expect(await snap(page)).toBe(before);
    expect((await toasts(page)).some(t => /nothing/i.test(t))).toBe(true);
    // failure after the first write: token rollback, no step, map restored
    await page.evaluate(() => { mapData.fill('Plain_1'); (window as any).__toasts = []; (window as any).__orig = UI.updateSettlementCount; let n = 0; UI.updateSettlementCount = function () { if (n++ === 0) throw new Error('boom'); return (window as any).__orig.apply(UI, arguments); }; });
    const b2 = await snap(page), s1 = await steps(page);
    const res = await page.evaluate(`Placement.place(${CFG}, 5)`);
    await page.evaluate(() => { UI.updateSettlementCount = (window as any).__orig; });
    expect(res).toBe(false);
    expect(await steps(page)).toBe(s1);
    expect(await snap(page)).toBe(b2);
    expect((await toasts(page)).some(t => /failed/i.test(t))).toBe(true);
  });

  test('bulk-writer gates: stroke, running fill, lifted float, footprint cache', async ({ page }) => {
    // a lifted (moving) region counts as an active gesture for the shared guard: refused with a toast, no step, float kept
    await page.evaluate(() => { Selection.setCells([{ col: 226, row: 224 }]); Tools.beginMove(); (window as any).__toasts = []; });
    const sm = await steps(page), bm = await snap(page);
    expect(await page.evaluate(`Placement.place(${CFG}, 3)`)).toBe(false);
    expect([await steps(page), await snap(page), await page.evaluate(() => Tools.isMoving())]).toEqual([sm, bm, true]);
    expect((await toasts(page)).some(t => /stroke or move/i.test(t))).toBe(true);
    await page.evaluate(() => Tools.cancelFloat());
    // a paste preview does not block; the placement runs and bumps the footprint map
    await page.evaluate(() => { Selection.setCells([{ col: 226, row: 224 }]); Tools.copySelection(); Tools.beginPaste(Clipboard.get()); });
    const seq0 = await page.evaluate(() => _mapWriteSeq);
    const ok = await page.evaluate(`Placement.place(${CFG}, 3)`);
    expect(ok.placed.bunkers).toBe(60);
    expect(await page.evaluate(() => _mapWriteSeq)).toBeGreaterThan(seq0);      // footprint map invalidated
    await page.evaluate(() => { Tools.dropFloat; History.undo(); });
    // a running fill refuses
    const s0 = await steps(page);
    const f = await page.evaluate(async (cfg) => {
      UI.selectTerrain('Forest_1'); Tools.setActive('fill');
      const p = Tools.fill(240, 240);
      const busy = Tools.isFillBusy();
      (window as any).__toasts = [];
      const n0 = History.undoSize();
      const rep = (window as any).eval('Placement.place(' + cfg + ', 3)');
      const n1 = History.undoSize();
      await p;
      return { busy, rep, same: n0 === n1 };
    }, CFG);
    expect(f.busy).toBe(true);
    expect(f.rep).toBe(false);
    expect((await toasts(page)).some(t => /fill is still running/i.test(t))).toBe(true);
    expect(f.same).toBe(true);                                                  // the refused run pushed no step
    // an active stroke refuses
    await page.evaluate(() => { (window as any).__toasts = []; Tools.setActive('paint'); });
    const p = await cellPoint(page, 228, 224);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    const s1 = await steps(page);
    const rep = await page.evaluate(`Placement.place(${CFG}, 3)`);
    await page.mouse.up();
    expect(rep).toBe(false);
    expect(await steps(page)).toBe(s1);
    expect((await toasts(page)).some(t => /stroke/i.test(t))).toBe(true);
  });

  test('layer locks: a locked layer the run writes refuses the whole run; unused or other locks do not block', async ({ page }) => {
    const run = async (locked: string[], cfg = CFG) => {
      await page.evaluate(() => { IO.newMap(true); Layers.NAMES.forEach((n: string) => Layers.setLocked(n, false)); (window as any).__toasts = []; });
      await page.evaluate((l: string[]) => l.forEach(n => Layers.setLocked(n, true)), locked);
      const before = await snap(page), s0 = await steps(page);
      const rep = await page.evaluate(`Placement.place(${cfg}, 4)`);
      return { rep, same: (await snap(page)) === before, steps: (await steps(page)) - s0, locked: (await toasts(page)).filter(t => /locked/i.test(t)).length };
    };
    for (const layer of ['terrain', 'objects', 'settlements']) {
      const refused = await run([layer]);
      expect(refused.rep, layer).toBe(false);
      expect(refused.same, layer + ' unchanged').toBe(true);
      expect(refused.steps).toBe(0);
      expect(refused.locked).toBe(1);
    }
    const control = await run([]);
    expect([control.same, control.steps, control.locked]).toEqual([false, 1, 0]);
    const others = await run(['roads', 'zones']);
    expect([others.same, others.steps, others.locked]).toEqual([false, 1, 0]);
    // only settlements needed: a locked objects / terrain layer does not matter
    const onlyBunkers = CFG.replace('count: 5,', 'count: 0,').replace('count: 12,', 'count: 0,').replace('clusters: 4', 'clusters: 0').replace('clusters: 3', 'clusters: 0');
    const part = await run(['objects', 'terrain'], onlyBunkers as any);
    expect([part.same, part.steps, part.locked]).toEqual([false, 1, 0]);
  });

  test('left palette Map design controls; validated inputs; no alert(); canvas stays 1491 px at 1400x900', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const layout = await page.evaluate(() => {
      const ids = ['pl-seed', 'pl-bunkers', 'pl-megaCities', 'pl-artifacts', 'pl-apply'];
      const els = ids.map(i => document.getElementById(i));
      return { present: els.every(Boolean), inSection: els.every(e => !!e && !!e.closest('#map-design') && !!e.closest('#palette-panel') && !e.closest('#toolbar') && !e.closest('#right-panel')),
        open: !document.getElementById('map-design')!.hidden, cw: (document.getElementById('map-canvas') as HTMLCanvasElement).width, ch: (document.getElementById('map-canvas') as HTMLCanvasElement).height,
        ores: document.querySelectorAll('#map-design [id^="pl-ore-"]').length };
    });
    expect(layout.present).toBe(true);
    expect(layout.inSection).toBe(true);
    expect(layout.open).toBe(false);
    expect([layout.cw, layout.ch]).toEqual([1491, 808]);
    expect(layout.ores).toBe(4);
    await openSection(page, 'design');
    const set = (id: string, v: string) => page.fill('#' + id, v);
    // invalid input: toast naming the field, no step, no change, no native dialog
    for (const [id, v] of [['pl-bunkers', '12x'], ['pl-bunkers', '-1'], ['pl-bunkers', '1.5'], ['pl-bunkers', ''], ['pl-bunkers', '99999'], ['pl-megaCities', '1e3'], ['pl-seed', 'abc'], ['pl-seed', '-4'], ['pl-seed', '4294967296'], ['pl-ore-gold', '101']]) {
      await page.evaluate(() => { IO.newMap(true); (window as any).__toasts = []; });
      await page.evaluate(() => { for (const el of Array.from(document.querySelectorAll('#map-design input[id^="pl-"]'))) (el as HTMLInputElement).value = (el as any).dataset.def ?? (el as HTMLInputElement).value; });
      await set('pl-bunkers', '10'); await set('pl-megaCities', '1'); await set('pl-artifacts', '1'); await set('pl-seed', '');
      await set(id, v);
      const before = await snap(page), s0 = await steps(page);
      await page.click('#pl-apply');
      expect(await snap(page), `${id}=${v}`).toBe(before);
      expect(await steps(page)).toBe(s0);
      expect((await toasts(page)).filter(t => /whole number|between|from 0/i.test(t)).length, `${id}=${v} toast`).toBe(1);
    }
    // valid run: one step, summary toast, seed recorded when random, same seed reproduces
    await page.evaluate(() => { IO.newMap(true); (window as any).__toasts = []; });
    await set('pl-bunkers', '15'); await set('pl-megaCities', '2'); await set('pl-artifacts', '3'); await set('pl-seed', '77');
    for (const o of await page.$$('#map-design [id^="pl-ore-"]')) await o.fill('0');
    const s0 = await steps(page);
    await page.click('#pl-apply');
    expect(await steps(page)).toBe(s0 + 1);
    expect(await page.evaluate(() => settlements.length)).toBe(1 + 15 + 2);
    const first = await snap(page);
    await page.evaluate(() => History.undo());
    await page.click('#pl-apply');
    expect(await snap(page)).toBe(first);
    await set('pl-seed', '');
    await page.evaluate(() => History.undo());
    await page.click('#pl-apply');
    expect(await page.evaluate(() => /^\d+$/.test((document.getElementById('pl-seed') as HTMLInputElement).placeholder))).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('defaults are configured in one place: game-scale counts and the assumed ids', async ({ page }) => {
    const d = await page.evaluate(() => { const c = Placement.defaults(); return { b: c.bunkers.count, m: c.megaCities.count, a: c.artifacts.count, ids: [c.bunkers.id, c.megaCities.id, c.artifacts.id], kinds: [c.bunkers.kind, c.megaCities.kind, c.artifacts.kind], ores: c.ores.map((o: any) => o.name) }; });
    expect(d).toEqual({ b: 450, m: 5, a: 12, ids: ['bunker', 'megacity', 'Artefact_Test_1'], kinds: ['settlement', 'settlement', 'object'], ores: ['gold', 'copper', 'gems', 'uranium'] });
  });
});
