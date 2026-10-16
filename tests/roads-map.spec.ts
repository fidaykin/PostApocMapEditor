import { test, expect, Page } from '@playwright/test';
import { seedRoadsWorld, applySpec8 } from './roads-fixtures';
import { clickCell } from './editor-helpers';

// Roads/Bridges V1, editor phase F6: the Bridge tool and the map validator follow the Hex DB road permissions.
// No overlay in V1 (owner decision): only the tool gate and the validator rule.
const spyToasts = (page: Page) => page.evaluate(() => { (window as any).__toasts = []; const t = UI.toast; UI.toast = (m: string) => { (window as any).__toasts.push(m); return t.call(UI, m); }; });
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts);
const undoSize = (page: Page) => page.evaluate(() => History.undoSize());
const obj = (page: Page, k: string) => page.evaluate((key) => objectsData[key] || null, k);
const tile = (page: Page, col: number, row: number, id: string) => page.evaluate(([c, r, h]) => { mapData[(r as number) * MAP_WIDTH + (c as number)] = h as string; }, [col, row, id]);
const bridgeTool = async (page: Page, id: string) => {
  await page.evaluate((b) => { Tools.setActive('bridge'); Tools.selectBuilding(b); }, id);
  await page.evaluate(() => { document.getElementById('obj-building-picker')!.style.display = 'none'; });
};
async function world(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedRoadsWorld(page);
  await page.evaluate(() => {
    App.setMode('map');
    IO.newMap(true);                              // blank 450x450 map, city at centre (as freshEditor does)
    window.dispatchEvent(new Event('resize'));
    Brush.setSize(0);
    Canvas.centerOnCity();
  });
  await spyToasts(page);
}
const NOT_ALLOWED = /is not allowed on .* \(Hex DB > Roads\/Bridges\)/;

test.describe('Bridge tool follows allowedRoads', () => {
  test('a listed bridge is placed (bridge_2 on water, bridge on a river); an unlisted one is refused with the Hex DB message and no history step', async ({ page }) => {
    await world(page);
    await applySpec8(page);
    await tile(page, 227, 224, 'Decameroon_Water_1');
    await tile(page, 228, 224, 'Decameroon_River_L_1');
    await tile(page, 229, 224, 'Decameroon_Plain_1');
    await bridgeTool(page, 'bridge_2');
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe('bridge_2');
    expect(await undoSize(page)).toBe(s0 + 1);
    await clickCell(page, 229, 224);                                   // Plain_1 does not list bridge_2
    expect(await obj(page, '229,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0 + 1);
    expect((await toasts(page)).filter(t => NOT_ALLOWED.test(t) && t.includes('bridge_2') && t.includes('Decameroon_Plain_1')).length).toBe(1);
    await bridgeTool(page, 'bridge');
    await clickCell(page, 228, 224);
    expect(await obj(page, '228,224')).toBe('bridge');
    await tile(page, 230, 224, 'Decameroon_Water_1');
    await clickCell(page, 230, 224);                                   // Water_1 lists bridge_2 only
    expect(await obj(page, '230,224')).toBe(null);
    expect((await toasts(page)).filter(t => NOT_ALLOWED.test(t) && t.includes('bridge ') && t.includes('Decameroon_Water_1')).length).toBe(1);
  });

  test('the list decides, not the Rivers type: a river tile that does not list the bridge is refused; a land tile that lists it is accepted', async ({ page }) => {
    await world(page);
    await applySpec8(page);
    await tile(page, 227, 224, 'Decameroon_River_D_3');                 // a Rivers tile in no bridge list (spec 8.6)
    await tile(page, 228, 224, 'Decameroon_Plain_1');
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road', 'bridge']));
    await bridgeTool(page, 'bridge');
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe(null);
    await clickCell(page, 228, 224);
    expect(await obj(page, '228,224')).toBe('bridge');
  });

  test('removing the same bridge works anywhere, even where the list no longer allows it', async ({ page }) => {
    await world(page);
    await applySpec8(page);
    await tile(page, 227, 224, 'Decameroon_Plain_1');
    await page.evaluate(() => { objectsData['227,224'] = 'bridge'; });
    await bridgeTool(page, 'bridge');
    const s0 = await undoSize(page);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe(null);
    expect(await undoSize(page)).toBe(s0 + 1);
  });

  test('with an unset record the tool behaves as before (Rivers only, old message); positive control: a set record on the same type changes the answer', async ({ page }) => {
    await world(page);
    await tile(page, 227, 224, 'Decameroon_River_L_1');                 // unset (fixture is not backfilled)
    await tile(page, 228, 224, 'Decameroon_Plain_1');                   // unset
    await bridgeTool(page, 'bridge');
    await page.evaluate(() => { Terrain.byHexId = (id: string) => { const h = HexDB.getAll().find((x: any) => x.id === id); return h ? { id: h.id, type: h.type } : null; }; });
    await clickCell(page, 228, 224);
    expect(await obj(page, '228,224')).toBe(null);
    expect((await toasts(page)).filter(t => t === 'Bridges can only be built on river tiles').length).toBe(1);
    await clickCell(page, 227, 224);
    expect(await obj(page, '227,224')).toBe('bridge');
    // set the list on the land tile: now it is decided by the list
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['bridge']));
    await clickCell(page, 228, 224);
    expect(await obj(page, '228,224')).toBe('bridge');
  });

  test('the road tools still ignore permissions (Unity does not import map roads)', async ({ page }) => {
    await world(page);
    await applySpec8(page);
    const n = await page.evaluate(() => Roads.getNeighbors(225, 224)[0]);
    await tile(page, n.col, n.row, 'Decameroon_Hills_1');              // list is [] after the section 8 state
    expect(await page.evaluate(() => HexDB.getAllowedRoads('decameroon::Decameroon_Hills_1'))).toEqual([]);
    await page.evaluate(() => Tools.setActive('road'));
    await clickCell(page, n.col, n.row);
    expect(await page.evaluate(([c, r]) => !!roadsData[c + ',' + r], [n.col, n.row])).toBe(true);
  });
});

test.describe('validator rule road-not-allowed', () => {
  const issues = (page: Page) => page.evaluate(() => MapValidator.run().issues.filter((i: any) => i.id === 'road-not-allowed').map((i: any) => ({ key: i.key, sev: i.severity, total: i.total, cells: i.cells, message: i.message })));

  test('warns for a bridge on a tile that does not list it and for a road on a tile that lists no road; silent for the section 8 state and for unset tiles', async ({ page }) => {
    await world(page);
    await applySpec8(page);
    // the section 8 state: bridge on a listed river, bridge_2 on water, road on Plain_1 -> silent (positive control first)
    await tile(page, 227, 224, 'Decameroon_River_L_1'); await tile(page, 228, 224, 'Decameroon_Water_1'); await tile(page, 229, 224, 'Decameroon_Plain_1');
    await page.evaluate(() => { objectsData['227,224'] = 'bridge'; objectsData['228,224'] = 'bridge_2'; roadsData['229,224'] = { type: 'road_hex' }; });
    expect(await issues(page)).toEqual([]);
    // violations
    await tile(page, 230, 224, 'Decameroon_River_L_4'); await tile(page, 231, 224, 'Decameroon_Hills_1');
    await page.evaluate(() => { objectsData['230,224'] = 'bridge_2'; roadsData['231,224'] = { type: 'road_hex' }; });
    const r = await issues(page);
    expect(r.length).toBe(2);
    expect(r.every(i => i.sev === 'warning')).toBe(true);
    const br = r.find(i => i.key.endsWith('bridge'))!, rd = r.find(i => i.key.endsWith('road'))!;
    expect(br).toMatchObject({ total: 1, cells: [{ col: 230, row: 224 }] });
    expect(rd).toMatchObject({ total: 1, cells: [{ col: 231, row: 224 }] });
    // unset tiles are skipped (no noise before the backfill)
    await page.evaluate(() => { const h = HexDB.getAll().find((x: any) => x.id === 'Decameroon_Hills_1'); delete h.allowedRoads; const h2 = HexDB.getAll().find((x: any) => x.id === 'Decameroon_River_L_4'); delete h2.allowedRoads; });
    expect(await issues(page)).toEqual([]);
  });

  test('the rule is listed in RULE_ORDER after orphan-road and the pure validate() without permission data raises nothing', async ({ page }) => {
    await world(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, type: string) => ({ id, type, spriteName: id });
      const st: any = {
        width: 3, height: 3, data: ['Plain_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1', 'Plain_1'],
        settlements: [{ col: 1, row: 1, type: 'city' }], roads: { '0,0': { type: 'road_hex' }, '1,0': { type: 'road_hex' } }, objects: {}, bridges: [],
        hexById: new Map([['plain_1', mk('Plain_1', 'Plains')]]), bldById: new Map(), needRoad: new Set(), cityCol: 1, cityRow: 1, spriteState: () => 'loaded',
        neighbors: (c: number, r: number) => [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]].filter(([x, y]) => x >= 0 && x < 3 && y >= 0 && y < 3).map(([col, row]) => ({ col, row })),
      };
      const without = MapValidator.validate(st).map((i: any) => i.id);
      st.roadHex = new Map([['plain_1', { id: 'Plain_1', allowedRoads: ['bridge'] }]]);
      st.roadTypes = { roads: new Set(['road']), bridges: new Set(['bridge']) };
      const withData = MapValidator.validate(st).map((i: any) => i.id);
      return { without, withData };
    });
    expect(r.without).not.toContain('road-not-allowed');
    expect(r.withData).toContain('road-not-allowed');
  });
});
