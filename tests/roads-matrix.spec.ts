import { test, expect } from '@playwright/test';
import { seedRoadsWorld, BASE_HEXES, DEC_HEXES, SPEC8, SPEC8_EXCLUDED_RIVERS, ROAD_IDS } from './roads-fixtures';

// Roads/Bridges V1, editor phase F2/F3: the tiles x types matrix modal, its own undo stack (RoadsHistory) and the bulk actions.
const M = '#roads-matrix-modal';
async function openMatrix(page: any) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('#hexdb-roads-matrix-btn').click();
  await expect(page.locator(M)).toBeVisible();
  await expect.poll(() => page.locator(`${M} tbody tr`).count()).toBeGreaterThan(0);
}
const rowCount = (page: any) => page.locator(`${M} tbody tr[data-key]`).count();
async function setPkg(page: any, pkg: string, n?: number) {
  await page.locator(`${M} #rm-pkg`).selectOption(pkg);
  if (n !== undefined) await expect.poll(() => rowCount(page)).toBe(n);
}
const rec = (page: any, id: string) => page.evaluate((id: string) => { const h = HexDB.getAll().find((h: any) => h.id === id); return { has: 'allowedRoads' in h, ar: h.allowedRoads, ra: h.roadAllowed }; }, id);
const cellOf = (page: any, id: string, type: string) => page.locator(`${M} tr[data-key$="::${id}"] td[data-type-id="${type}"]`);
const depth = (page: any) => page.evaluate(() => RoadsHistory.depth());

test.describe('roads matrix modal: view, filter, per-cell edit', () => {
  test('one row per filtered tile and one column per type; the package filter shows the 60 Decameroon tiles; type filter narrows', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await expect.poll(() => rowCount(page)).toBe(BASE_HEXES.length + DEC_HEXES.length);
    expect(await page.locator(`${M} thead th[data-type-id]`).evaluateAll((e: any[]) => e.map(x => x.dataset.typeId))).toEqual(['road', 'road_2', 'bridge', 'bridge_2']);
    await setPkg(page, 'decameroon', 60);
    await page.locator(`${M} #rm-type`).selectOption('Rivers');
    await expect.poll(() => rowCount(page)).toBe(DEC_HEXES.filter(h => h.type === 'Rivers').length);
    await page.locator(`${M} #rm-search`).fill('Lake_');
    await expect.poll(() => rowCount(page)).toBe(7);
  });

  test('an unset cell first click sets [id]; toggling is one RoadsHistory step and one autosave; the map History is untouched', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    const h0 = await page.evaluate(() => ({ undo: History.undoSize(), rev: HexDB.getRev() }));
    expect(await depth(page)).toBe(0);
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    expect(await depth(page)).toBe(1);
    expect(await page.evaluate(() => HexDB.getRev())).toBe(h0.rev + 1);
    await cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input').check();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road', 'bridge'], ra: true });
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('input').uncheck();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['bridge'], ra: false });
    expect(await depth(page)).toBe(3);
    expect((await page.evaluate(() => ({ undo: History.undoSize(), rev: HexDB.getRev() }))).undo).toBe(h0.undo);
    // positive control: the other tiles stay unset
    expect((await rec(page, 'Decameroon_Plain_2')).has).toBe(false);
    await expect(cellOf(page, 'Decameroon_Plain_2', 'road').locator('button.rm-unset')).toBeVisible();
  });

  test('Undo restores exactly the previous value including "unset"; Redo re-applies; Ctrl+Z / Ctrl+Y work inside the modal', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    const mapUndo0 = await page.evaluate(() => History.undoSize());
    const before = await page.evaluate(() => structuredClone(HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1')));
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();
    await cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input').check();
    await page.locator(`${M} #rm-undo`).click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => structuredClone(HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1')))).toEqual(before);   // deep-equal: no property left behind
    await expect(cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset')).toBeVisible();
    await page.locator(`${M} #rm-redo`).click();
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });
    await page.keyboard.press('Control+y');
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road', 'bridge'], ra: true });
    await expect(cellOf(page, 'Decameroon_Plain_1', 'bridge').locator('input')).toBeChecked();
    // the global map shortcut did not run under the modal
    expect(await page.evaluate(() => History.undoSize())).toBe(mapUndo0);
  });

  test('51 steps evict the oldest', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    await cellOf(page, 'Decameroon_Plain_1', 'road').locator('button.rm-unset').click();      // the oldest step
    await cellOf(page, 'Decameroon_Plain_2', 'road').locator('button.rm-unset').click();
    for (let i = 0; i < 49; i++) await cellOf(page, 'Decameroon_Plain_2', 'bridge').locator('input').click();
    expect(await depth(page)).toBe(50);
    for (let i = 0; i < 60; i++) await page.locator(`${M} #rm-undo`).click({ force: true });
    expect(await depth(page)).toBe(0);
    expect(await rec(page, 'Decameroon_Plain_1')).toEqual({ has: true, ar: ['road'], ra: true });   // evicted: cannot be undone
    expect((await rec(page, 'Decameroon_Plain_2')).has).toBe(false);
  });

  test('closing the modal clears the history', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await cellOf(page, 'Plain_1', 'road').locator('button.rm-unset').click();
    expect(await depth(page)).toBe(1);
    await page.locator(M).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator(M)).toHaveCount(0);
    expect(await depth(page)).toBe(0);
    expect((await rec(page, 'Plain_1')).ar).toEqual(['road']);
  });

  test('600 tiles: the first chunk renders at once, the rest follow in chunks', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => {
      const hexes = Array.from({ length: 600 }, (_, i) => ({ id: 'Bulk_' + i, type: 'Plains', biome: 'Summer', spriteName: 'Plain_1', allowedRoads: [] }));
      HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes });
    });
    const first = await page.evaluate(() => { HexDB.openRoadsMatrix(); return document.querySelectorAll('#roads-matrix-modal tbody tr[data-key]').length; });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(100);
    await expect.poll(() => rowCount(page)).toBe(600);
  });
});

// ── F3: bulk actions, each one undo step ────────────────────────────────────────────────────────────────────────
const snapAll = (page: any) => page.evaluate(() => JSON.stringify(HexDB.getAll()));
const stepState = (page: any) => page.evaluate(() => ({ depth: RoadsHistory.depth(), rev: HexDB.getRev(), map: History.undoSize() }));
const listsOf = (page: any, pkg = 'decameroon') => page.evaluate((pkg: string) => Object.fromEntries(HexDB.getAll().filter((h: any) => h.package === pkg).map((h: any) => [h.id, h.allowedRoads])), pkg);
const colBtn = (page: any, type: string, act: string) => page.locator(`${M} th[data-type-id="${type}"] button[data-act="${act}"]`);
const toastText = (page: any) => page.locator('#toast-container .toast').allTextContents();
async function setupDec(page: any) {
  await seedRoadsWorld(page);
  await openMatrix(page);
  await setPkg(page, 'decameroon', 60);
}

test.describe('roads matrix: bulk actions', () => {
  test('Apply type defaults to filtered: Plains/Rubble road, Rivers bridge, others empty; a second run changes nothing and pushes no step', async ({ page }) => {
    await setupDec(page);
    const s0 = await stepState(page);
    await page.locator(`${M} #rm-bulk-defaults`).click();
    const s1 = await stepState(page);
    expect(s1).toEqual({ depth: s0.depth + 1, rev: s0.rev + 1, map: s0.map });
    const r = await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'decameroon').map((h: any) => [h.type, h.allowedRoads]));
    expect(r.length).toBe(60);
    for (const [type, list] of r) expect(list).toEqual(type === 'Plains' || type === 'Rubble' ? ['road'] : type === 'Rivers' ? ['bridge'] : []);
    expect((await toastText(page)).join(' ')).toContain('60');
    await page.locator(`${M} #rm-bulk-defaults`).click();
    expect(await stepState(page)).toEqual(s1);
    expect((await toastText(page)).join(' ')).toContain('0 tiles');
  });

  test('Allow X on all filtered, then Undo, returns to the exact previous state of all 60 records; Remove X from all filtered', async ({ page }) => {
    await setupDec(page);
    const before = await snapAll(page);
    const s0 = await stepState(page);
    await colBtn(page, 'road_2', 'allow').click();
    expect(await stepState(page)).toEqual({ depth: s0.depth + 1, rev: s0.rev + 1, map: s0.map });
    const lists = Object.values(await listsOf(page));
    expect(lists.every((l: any) => JSON.stringify(l) === '["road_2"]')).toBe(true);
    await page.locator(`${M} #rm-undo`).click();
    expect(await snapAll(page)).toBe(before);
    // remove: positive control (road_2 present on some tiles) and the rest untouched
    await page.evaluate(() => { HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road', 'road_2']); HexDB.setAllowedRoads('decameroon::Decameroon_Plain_2', ['road']); });
    await colBtn(page, 'road_2', 'remove').click();
    const after = await listsOf(page);
    expect(after['Decameroon_Plain_1']).toEqual(['road']);
    expect(after['Decameroon_Plain_2']).toEqual(['road']);
    expect(after['Decameroon_Forest_1']).toBeUndefined();   // unset stays unset on a remove
  });

  test('Add X wherever Y is allowed touches only the tiles that have Y', async ({ page }) => {
    await setupDec(page);
    await page.locator(`${M} #rm-bulk-defaults`).click();
    const before = await listsOf(page);
    await page.locator(`${M} #rm-aw-x`).selectOption('road_2');
    await page.locator(`${M} #rm-aw-y`).selectOption('road');
    const s0 = await stepState(page);
    await page.locator(`${M} #rm-bulk-addwhere`).click();
    expect(await stepState(page)).toEqual({ depth: s0.depth + 1, rev: s0.rev + 1, map: s0.map });
    const after = await listsOf(page);
    for (const id of Object.keys(before)) {
      if ((before[id] as string[]).includes('road')) expect(after[id]).toEqual(['road', 'road_2']);
      else expect(after[id]).toEqual(before[id]);
    }
    expect(Object.values(after).filter((l: any) => l.includes('road_2')).length).toBe(Object.values(before).filter((l: any) => l.includes('road')).length);
  });

  test('Copy from tile onto the selected rows (and onto the filtered rows when none is selected)', async ({ page }) => {
    await setupDec(page);
    await page.evaluate(() => HexDB.setAllowedRoads('postapoc::Plain_1', ['road', 'road_2']));
    await page.locator(`${M} tr[data-key="decameroon::Decameroon_Forest_1"] input.rm-sel`).check();
    await page.locator(`${M} tr[data-key="decameroon::Decameroon_Forest_2"] input.rm-sel`).check();
    await page.locator(`${M} #rm-copy-from`).fill('Plain_1');
    const s0 = await stepState(page);
    await page.locator(`${M} #rm-bulk-copy`).click();
    expect(await stepState(page)).toEqual({ depth: s0.depth + 1, rev: s0.rev + 1, map: s0.map });
    const a = await listsOf(page);
    expect(a['Decameroon_Forest_1']).toEqual(['road', 'road_2']);
    expect(a['Decameroon_Forest_2']).toEqual(['road', 'road_2']);
    expect(a['Decameroon_Forest_3']).toBeUndefined();          // not selected: untouched
    // none selected: the filtered rows
    await page.locator(`${M} tr[data-key="decameroon::Decameroon_Forest_1"] input.rm-sel`).uncheck();
    await page.locator(`${M} tr[data-key="decameroon::Decameroon_Forest_2"] input.rm-sel`).uncheck();
    await page.locator(`${M} #rm-bulk-copy`).click();
    expect(Object.values(await listsOf(page)).every((l: any) => JSON.stringify(l) === '["road","road_2"]')).toBe(true);
    // unknown source: nothing changes
    const s1 = await stepState(page);
    await page.locator(`${M} #rm-copy-from`).fill('Nope_9');
    await page.locator(`${M} #rm-bulk-copy`).click();
    expect(await stepState(page)).toEqual(s1);
  });

  test('Set X to exactly these ids, four runs, reproduce the spec section 8 lists; each run is one step; one Ctrl+Z reverts only the last', async ({ page }) => {
    await setupDec(page);
    for (const t of [ROAD_IDS.road, ROAD_IDS.road2, ROAD_IDS.bridge, ROAD_IDS.bridge2]) {
      const s0 = await stepState(page);
      await colBtn(page, t, 'exact').click();
      await expect(page.locator('#roads-exact-modal')).toBeVisible();
      await page.locator('#roads-exact-modal textarea').fill(SPEC8[t].join('\n'));
      await page.locator('#roads-exact-modal').getByRole('button', { name: 'Apply' }).click();
      await expect(page.locator('#roads-exact-modal')).toHaveCount(0);
      expect(await stepState(page)).toEqual({ depth: s0.depth + 1, rev: s0.rev + 1, map: s0.map });
    }
    const holders = async () => {
      const l = await listsOf(page);
      return Object.fromEntries(Object.values(ROAD_IDS).map(t => [t, Object.keys(l).filter(id => (l[id] || []).includes(t)).sort()]));
    };
    const want = Object.fromEntries(Object.values(ROAD_IDS).map(t => [t, [...SPEC8[t]].sort()]));
    expect(await holders()).toEqual(want);
    const l = await listsOf(page);
    for (const id of SPEC8_EXCLUDED_RIVERS) expect(l[id]).toEqual([]);
    expect(l['Decameroon_BrokenShip_1']).toEqual([]);
    expect(l['Decameroon_DestroyedBuilding_1']).toEqual([]);
    expect(Object.values(l).every(x => Array.isArray(x))).toBe(true);
    await page.keyboard.press('Control+z');
    expect(await holders()).toEqual({ ...want, [ROAD_IDS.bridge2]: [] });
    expect(await page.evaluate(() => RoadsHistory.depth())).toBe(3);
  });

  test('Set exactly lists the unknown ids and the ids outside the filter, and skips them', async ({ page }) => {
    await setupDec(page);
    await colBtn(page, 'road', 'exact').click();
    await page.locator('#roads-exact-modal textarea').fill('Decameroon_Plain_1\nNope_1\nPlain_1\nDecameroon_Plain_2');
    await page.locator('#roads-exact-modal').getByRole('button', { name: 'Apply' }).click();
    const l = await listsOf(page);
    expect(l['Decameroon_Plain_1']).toEqual(['road']);
    expect(l['Decameroon_Plain_2']).toEqual(['road']);
    expect((await page.evaluate(() => HexDB.getAllowedRoads('postapoc::Plain_1')))).toBeNull();   // outside the filter: untouched
    const t = (await toastText(page)).join(' ');
    expect(t).toContain('Nope_1');
    expect(t).toContain('Plain_1');
    expect(t).toContain('skipped');
  });

  test('a filtered subset only touches the filtered rows (the unfiltered rows are deep-equal before and after)', async ({ page }) => {
    await seedRoadsWorld(page);
    await openMatrix(page);
    await setPkg(page, 'decameroon', 60);
    await page.locator(`${M} #rm-type`).selectOption('Rivers');
    await expect.poll(() => rowCount(page)).toBe(DEC_HEXES.filter(h => h.type === 'Rivers').length);
    const other = (page: any) => page.evaluate(() => JSON.stringify(HexDB.getAll().filter((h: any) => !(h.package === 'decameroon' && h.type === 'Rivers'))));
    const before = await other(page);
    await page.locator(`${M} #rm-bulk-defaults`).click();
    expect(await other(page)).toBe(before);
    const rivers = await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'decameroon' && h.type === 'Rivers').map((h: any) => h.allowedRoads));
    expect(rivers.length).toBe(29);
    expect(rivers.every((x: any) => JSON.stringify(x) === '["bridge"]')).toBe(true);
  });
});

test.describe('RoadPerms planners (pure)', () => {
  test('planAllow / planRemove / planApplyDefaults / planAddWhere / planCopyFrom / planSetExact', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, type: string, l?: string[]) => (l ? { id, type, allowedRoads: l } : { id, type });
      const hs = [mk('A', 'Plains', ['road']), mk('B', 'Rivers', []), mk('C', 'Plains'), mk('D', 'Forests', ['bridge']), mk('F', 'Plains')];
      const ids = (pl: any[]) => pl.map(c => [c.hex.id, c.list]);
      return {
        allow: ids(RoadPerms.planAllow(hs, 'road')), remove: ids(RoadPerms.planRemove(hs, 'road')),
        defaults: ids(RoadPerms.planApplyDefaults(hs)), addWhere: ids(RoadPerms.planAddWhere(hs, 'road_2', 'road')),
        copy: ids(RoadPerms.planCopyFrom(hs, ['road'])), copyUnset: RoadPerms.planCopyFrom(hs, null).length,
        exact: (() => { const x = RoadPerms.planSetExact(hs, 'road', ['A', 'C', 'Z', 'E'], [{ id: 'E' }]); return { c: ids(x.changes), unknown: x.unknown, outside: x.outside }; })(),
      };
    });
    expect(r.allow).toEqual([['B', ['road']], ['C', ['road']], ['D', ['bridge', 'road']], ['F', ['road']]]);
    expect(r.remove).toEqual([['A', []]]);
    expect(r.defaults).toEqual([['B', ['bridge']], ['C', ['road']], ['D', []], ['F', ['road']]]);
    expect(r.addWhere).toEqual([['A', ['road', 'road_2']]]);
    expect(r.copy).toEqual([['B', ['road']], ['C', ['road']], ['D', ['road']], ['F', ['road']]]);
    expect(r.copyUnset).toBe(0);
    expect(r.exact).toEqual({ c: [['C', ['road']], ['F', []]], unknown: ['Z'], outside: ['E'] });
  });
});
