import { test, expect } from '@playwright/test';
import { seedRoadsWorld } from './roads-fixtures';

// Roads/Bridges V1, editor phase F1: defaults by tile type (common.roadDefaults). Defaults are applied only explicitly.
async function selectHex(page: any, id: string) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.evaluate(() => { const t = document.getElementById('hexdb-search') as HTMLInputElement; t.value = ''; t.dispatchEvent(new Event('input')); });
  await page.locator('.hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
  await expect(page.locator('#hexdb-roads')).toBeVisible();
}
const list = (page: any, id: string) => page.evaluate((id: string) => HexDB.getAllowedRoads('decameroon::' + id), id);

test.describe('RoadPerms.defaultsFor', () => {
  test('initial values: Plains and Rubble road, Rivers bridge, everything else (Water too) nothing; custom presets win; unknown group is empty', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => ({
      plains: RoadPerms.defaultsFor('Plains'), rubble: RoadPerms.defaultsFor('Rubble'), rivers: RoadPerms.defaultsFor('Rivers'),
      water: RoadPerms.defaultsFor('Water'), forests: RoadPerms.defaultsFor('Forests'), nope: RoadPerms.defaultsFor('Nope'),
      custom: RoadPerms.defaultsFor('Forests', { Forests: ['road_2'] }), customMissing: RoadPerms.defaultsFor('Plains', { Forests: ['road_2'] }),
    }));
    expect(r).toEqual({ plains: ['road'], rubble: ['road'], rivers: ['bridge'], water: [], forests: [], nope: [], custom: ['road_2'], customMissing: [] });
  });
});

test.describe('apply type defaults (explicit only)', () => {
  test('the form button applies the default of the tile type; nothing is applied at load or by adding a tile', async ({ page }) => {
    await seedRoadsWorld(page);
    // positive control for "never silently": nothing in the loaded world got a list
    expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => 'allowedRoads' in h).length)).toBe(0);
    await selectHex(page, 'Decameroon_Plain_1');
    await page.locator('#hexdb-roads-defaults-btn').click();
    expect(await list(page, 'Decameroon_Plain_1')).toEqual(['road']);
    await selectHex(page, 'Decameroon_River_L_1');
    await page.locator('#hexdb-roads-defaults-btn').click();
    expect(await list(page, 'Decameroon_River_L_1')).toEqual(['bridge']);
    await selectHex(page, 'Decameroon_Forest_1');
    await page.locator('#hexdb-roads-defaults-btn').click();
    expect(await list(page, 'Decameroon_Forest_1')).toEqual([]);
    // a new blank tile starts with [] (spec 4.2), not with a default
    expect(await page.evaluate(() => { HexDB.add(); const a = HexDB.getAll(); return a[a.length - 1].allowedRoads; })).toEqual([]);
  });

  test('a Type change on a tile whose list is not the new default asks: Apply gives the new default, Keep leaves the list', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road']));
    await selectHex(page, 'Decameroon_Plain_1');
    await page.locator('#hexdb-right [data-field="type"]').selectOption('Rivers');
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await page.locator('#dialog-actions button[data-value="apply"]').click();
    expect(await list(page, 'Decameroon_Plain_1')).toEqual(['bridge']);
    // Keep
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_2', ['road']));
    await selectHex(page, 'Decameroon_Plain_2');
    await page.locator('#hexdb-right [data-field="type"]').selectOption('Rivers');
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await page.locator('#dialog-actions button[data-value="keep"]').click();
    expect(await list(page, 'Decameroon_Plain_2')).toEqual(['road']);
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_2').type)).toBe('Rivers');
  });

  test('a Type change does not ask when the list already equals the new default, and never touches an unset tile', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['bridge']));   // equals the Rivers default
    await selectHex(page, 'Decameroon_Plain_1');
    await page.locator('#hexdb-right [data-field="type"]').selectOption('Rivers');
    await expect(page.locator('#hexdb-roads')).toBeVisible();
    await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
    // unset tile: no dialog and still unset
    await selectHex(page, 'Decameroon_Plain_2');
    await page.locator('#hexdb-right [data-field="type"]').selectOption('Rivers');
    await expect(page.locator('#hexdb-roads')).toBeVisible();
    await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
    expect(await page.evaluate(() => 'allowedRoads' in HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_2'))).toBe(false);
  });

  test('master re-check with no remembered list applies the type default (Rivers tile gets the bridge, not the placeholder road)', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_River_L_1', []));
    await selectHex(page, 'Decameroon_River_L_1');
    await page.locator('#hexdb-roads-master').check();
    expect(await list(page, 'Decameroon_River_L_1')).toEqual(['bridge']);
  });
});

test.describe('Road defaults modal', () => {
  test('edits persist in common.roadDefaults, survive a local snapshot round trip, are not written in mode off', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await page.locator('#hexdb-road-defaults-btn').click();
    const modal = page.locator('#road-defaults-modal');
    await expect(modal).toBeVisible();
    // one row per type group, one column per road/bridge type
    expect(await modal.locator('tr[data-group]').count()).toBeGreaterThan(5);
    expect(await modal.locator('thead th[data-type-id]').evaluateAll((e: any[]) => e.map(x => x.dataset.typeId))).toEqual(['road', 'road_2', 'bridge', 'bridge_2']);
    expect(await modal.locator('tr[data-group="Plains"] input[data-type-id="road"]').isChecked()).toBe(true);
    await modal.locator('tr[data-group="Forests"] input[data-type-id="road_2"]').check();
    await modal.locator('tr[data-group="Plains"] input[data-type-id="road"]').uncheck();
    const rev0 = await page.evaluate(() => HexDB.getRev());
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => HexDB.getRev())).toBe(rev0 + 1);
    const d = await page.evaluate(() => HexDB.getRoadDefaults());
    expect(d.Forests).toEqual(['road_2']);
    expect(d.Plains).toEqual([]);
    expect(d.Rivers).toEqual(['bridge']);
    const rt = await page.evaluate(() => {
      const json = JSON.stringify(HexDB.exportFor({ pkg: 'postapoc', mode: 'active', local: true }));
      const off = JSON.parse(JSON.stringify(HexDB.exportFor({ pkg: 'postapoc', mode: 'off' })));
      const local = JSON.parse(JSON.stringify(HexDB.exportFor({ pkg: 'postapoc', mode: 'off', local: true })));
      HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes: [] });
      const cleared = HexDB.getRoadDefaults().Forests;
      HexDB.loadFromObject(JSON.parse(json));
      return { active: JSON.parse(json).common.roadDefaults, offHas: 'roadDefaults' in off.common, localHas: !!local.common.roadDefaults, cleared, after: HexDB.getRoadDefaults().Forests };
    });
    expect(rt.active.Forests).toEqual(['road_2']);
    expect(rt.offHas).toBe(false);
    expect(rt.localHas).toBe(true);
    expect(rt.cleared).toEqual([]);
    expect(rt.after).toEqual(['road_2']);
  });

  test('Cancel changes nothing', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await page.locator('#hexdb-road-defaults-btn').click();
    await page.locator('#road-defaults-modal tr[data-group="Forests"] input[data-type-id="road"]').check();
    await page.locator('#road-defaults-modal').getByRole('button', { name: 'Cancel' }).click();
    expect((await page.evaluate(() => HexDB.getRoadDefaults())).Forests).toEqual([]);
    expect(await page.evaluate(() => 'roadDefaults' in HexDB.getData().common)).toBe(false);
  });
});

test.describe('mergeFromServer: common merged by key', () => {
  const merge = (page: any, local: any, server: any) => page.evaluate(({ local, server }: any) => {
    HexDB.loadFromObject({ version: 1, common: local, hexes: [] });
    HexDB.mergeFromServer('postapoc', { version: 1, common: server, hexes: [] });
    return HexDB.getData().common;
  }, { local, server });
  const RD = { Forests: ['road'] }, RS = { Rivers: ['bridge_2'] };

  test('pristine local takes the server common (unchanged rule), presets included', async ({ page }) => {
    await seedRoadsWorld(page);
    expect(await merge(page, { goldPerTap: 10 }, { goldPerTap: 25, roadDefaults: RS })).toEqual({ goldPerTap: 25, roadDefaults: RS });
  });
  test('local with only goldPerTap customised keeps it and receives the server roadDefaults', async ({ page }) => {
    await seedRoadsWorld(page);
    expect(await merge(page, { goldPerTap: 12 }, { goldPerTap: 25, roadDefaults: RS })).toEqual({ goldPerTap: 12, roadDefaults: RS });
  });
  test('local roadDefaults win; the server goldPerTap still arrives when the local one is the default 10', async ({ page }) => {
    await seedRoadsWorld(page);
    expect(await merge(page, { goldPerTap: 10, roadDefaults: RD }, { goldPerTap: 25, roadDefaults: RS })).toEqual({ goldPerTap: 25, roadDefaults: RD });
  });
  test('both customised: local wins entirely; server without presets leaves local presets alone', async ({ page }) => {
    await seedRoadsWorld(page);
    expect(await merge(page, { goldPerTap: 12, roadDefaults: RD }, { goldPerTap: 25, roadDefaults: RS })).toEqual({ goldPerTap: 12, roadDefaults: RD });
    expect(await merge(page, { goldPerTap: 10, roadDefaults: RD }, { goldPerTap: 10 })).toEqual({ goldPerTap: 10, roadDefaults: RD });
  });
});
