import { test, expect } from '@playwright/test';
import { seedRoadsWorld } from './roads-fixtures';

// Roads/Bridges V1, editor phase F5: Reskin+ and Copy/Paste carry the road fields; a same-id override that differs from the
// base road permissions is flagged (spec 6.7).
async function world(page: any) {
  const w = await seedRoadsWorld(page);
  await page.evaluate(() => {
    HexDB.setAllowedRoads('postapoc::Plain_1', ['road']);
    HexDB.setAllowedRoads('postapoc::Plain_Kaiju_1', ['road', 'road_2']);
    Packages.setActive('decameroon');
  });
  return w;
}
const rec = (page: any, id: string, pkg: string) => page.evaluate(([id, pkg]: string[]) => {
  const h = HexDB.getAll().find((h: any) => h.id === id && (h.package || 'postapoc') === pkg);
  return h ? { has: 'allowedRoads' in h, ar: h.allowedRoads, ra: h.roadAllowed } : null;
}, [id, pkg]);
async function selectHex(page: any, id: string) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.evaluate(() => { const t = document.getElementById('hexdb-search') as HTMLInputElement; t.value = ''; t.dispatchEvent(new Event('input')); });
  await page.locator('.hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
  await expect(page.locator('#hexdb-roads')).toBeVisible();
}

test.describe('Reskin+ and Paste carry the road fields', () => {
  test('Reskin+ prefix and same keep allowedRoads and roadAllowed of the base tile; the base is untouched', async ({ page }) => {
    await world(page);
    await page.evaluate(() => { HexDB.addReskin('Plain_Kaiju_1', 'prefix'); HexDB.addReskin('Plain_1', 'same'); });
    expect(await rec(page, 'Decameroon_Plain_Kaiju_1', 'decameroon')).toEqual({ has: true, ar: ['road', 'road_2'], ra: true });
    expect(await rec(page, 'Plain_1', 'decameroon')).toEqual({ has: true, ar: ['road'], ra: true });
    expect(await rec(page, 'Plain_1', 'postapoc')).toEqual({ has: true, ar: ['road'], ra: true });
    // the lists are separate arrays: editing the copy does not change the base
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Plain_1', ['road', 'road_2']));
    expect((await rec(page, 'Plain_1', 'postapoc'))!.ar).toEqual(['road']);
  });

  test('a record WITHOUT the field stays without it after Reskin+ and Paste (no synthetic [])', async ({ page }) => {
    await world(page);
    await page.evaluate(() => HexDB.addReskin('Rubble_1', 'prefix'));      // the base Rubble_1 has no list
    expect((await rec(page, 'Rubble_1', 'postapoc'))!.has).toBe(false);
    expect(await rec(page, 'Decameroon_Rubble_1', 'decameroon')).toMatchObject({ has: false });
  });

  test('Paste carries the list; the copy has its own array (mutating it leaves the original alone)', async ({ page }) => {
    await world(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Forest_1', ['road_2']));
    await selectHex(page, 'Decameroon_Forest_1');
    await page.evaluate(() => { HexDB.copy(); HexDB.paste(); });
    expect(await rec(page, 'Decameroon_Forest_1_copy', 'decameroon')).toEqual({ has: true, ar: ['road_2'], ra: true });
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Forest_1_copy', ['road', 'road_2']));
    expect((await rec(page, 'Decameroon_Forest_1', 'decameroon'))!.ar).toEqual(['road_2']);
    // unset source: the copy stays unset
    await selectHex(page, 'Decameroon_Forest_2');
    await page.evaluate(() => { HexDB.copy(); HexDB.paste(); });
    expect(await rec(page, 'Decameroon_Forest_2_copy', 'decameroon')).toMatchObject({ has: false });
  });
});

test.describe('same-id override that differs from the base', () => {
  test('validate: a differing override warns (fix take-base); an identical one, and a prefixed copy, do not; an unset override of a set base warns too', async ({ page }) => {
    await world(page);
    await page.evaluate(() => { HexDB.addReskin('Plain_1', 'same'); HexDB.addReskin('Plain_Kaiju_1', 'prefix'); });
    const run = () => page.evaluate(() => RoadPerms.validate({ hexes: HexDB.getAll(), buildings: BldDB.getAll(), scope: {} }).warnings.filter((w: any) => w.rule === 'override-differs').map((w: any) => [w.hexId, w.pkg, w.fix]));
    expect(await run()).toEqual([]);                                       // positive control: identical list, prefix copy
    await page.evaluate(() => { HexDB.setAllowedRoads('decameroon::Plain_1', ['road', 'road_2']); HexDB.setAllowedRoads('decameroon::Decameroon_Plain_Kaiju_1', ['bridge']); });
    expect(await run()).toEqual([['Plain_1', 'decameroon', 'take-base']]);   // the prefixed copy differs too but has another id: no warning
    await page.evaluate(() => { delete HexDB.getAll().find((h: any) => h.id === 'Plain_1' && h.package === 'decameroon').allowedRoads; });
    expect(await run()).toEqual([['Plain_1', 'decameroon', 'take-base']]);   // created before backfill (unset) while the base is set
  });

  test('the form shows the warning with a "Take from base" button that copies the base list in one autosave', async ({ page }) => {
    await world(page);
    await page.evaluate(() => { HexDB.addReskin('Plain_1', 'same'); HexDB.setAllowedRoads('decameroon::Plain_1', ['road_2']); });
    await selectHex(page, 'Plain_1');
    // two rows named Plain_1 (base and override): click through them until the override's form is open
    const rows = page.locator('.hexdb-list-row', { hasText: /^Plain_1$/ });
    const n = await rows.count();
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await rows.nth(i).click();
      if (await page.locator('#hexdb-roads button[data-road-takebase]').count()) found = true;
    }
    expect(found).toBe(true);
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn')).toContainText('differs from the base');
    const rev0 = await page.evaluate(() => HexDB.getRev());
    await page.locator('#hexdb-roads button[data-road-takebase]').click();
    expect(await rec(page, 'Plain_1', 'decameroon')).toEqual({ has: true, ar: ['road'], ra: true });
    expect(await page.evaluate(() => HexDB.getRev())).toBe(rev0 + 1);
    await expect(page.locator('#hexdb-roads button[data-road-takebase]')).toHaveCount(0);
  });

  test('a prefixed copy shows no override warning in the form (positive control for the one above)', async ({ page }) => {
    await world(page);
    await page.evaluate(() => { HexDB.addReskin('Plain_Kaiju_1', 'prefix'); HexDB.setAllowedRoads('decameroon::Decameroon_Plain_Kaiju_1', ['bridge']); });
    await selectHex(page, 'Decameroon_Plain_Kaiju_1');
    await expect(page.locator('#hexdb-roads button[data-road-takebase]')).toHaveCount(0);
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn', { hasText: 'differs from the base' })).toHaveCount(0);
  });

  test('Publish Package lists the override in the confirm as a warning in stage and active mode (and writes nothing by itself)', async ({ page }) => {
    const { gh } = await world(page);
    await page.evaluate(() => {
      HexDB.addReskin('Plain_1', 'same'); HexDB.setAllowedRoads('decameroon::Plain_1', ['road_2']);
      RoadPerms.setWriteMode('stage');
    });
    const puts0 = gh.puts.length;
    await page.evaluate(() => { Packages.openPublishConfirm('decameroon'); });
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await expect(page.locator('#dialog-details')).toContainText('differs from the base tile');
    await page.locator('#dialog-actions button', { hasText: 'Cancel' }).click();
    expect(gh.puts.length).toBe(puts0);
    // positive control: an identical list shows no such line
    await page.evaluate(() => { HexDB.setAllowedRoads('decameroon::Plain_1', ['road']); Packages.openPublishConfirm('decameroon'); });
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    await expect(page.locator('#dialog-details')).not.toContainText('differs from the base tile');
  });
});
