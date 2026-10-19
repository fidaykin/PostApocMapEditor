import { test, expect, Page } from '@playwright/test';
import { FakeGitHub, seedServerPackage } from './helpers';
import { seedRoadsWorld, seedRoadsServer } from './roads-fixtures';

// ClickUp 869fjvua7: the id (its package prefix) decides which package a record belongs to, however the id was made.
const MED = 'medieval-2-0';
const FARM = { package: 'decameroon', buildingCategory: 'Standard', canBuild: true, availableTiles: [] as string[], spriteName: 'Decameroon_Farm_1' };

async function world(page: Page) {
  const gh = new FakeGitHub();
  seedRoadsServer(gh);
  seedServerPackage(gh, MED, { name: 'Medieval 2.0' });
  await seedRoadsWorld(page, gh);
  await page.evaluate(f => BldDB.addEntries([{ ...f, id: 'Decameroon_Farm_1' }]), FARM);
  await page.evaluate(() => Packages.setActive('medieval-2-0'));
}
async function selectBld(page: Page, id: string) {
  await page.evaluate(() => App.setMode('buildings'));
  await page.evaluate(() => { const t = document.getElementById('bld-search') as HTMLInputElement | null; if (t) { t.value = ''; t.dispatchEvent(new Event('input')); } });
  await page.locator('#bld-list .hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
  await expect(page.locator('#bld-f-id')).toHaveValue(id);
}
const blds = (page: Page) => page.evaluate(() => BldDB.getAll().map((b: any) => ({ id: b.id, package: b.package || 'postapoc' })));
async function renameBld(page: Page, to: string) {
  await page.locator('#bld-f-id').fill(to);
  await page.locator('#bld-f-id').blur();
}

test.describe('Building DB: the id prefix decides the package', () => {
  test('Copy a Decameroon building, Paste while Medieval 2.0 is active: it lands in Medieval 2.0 with that prefix', async ({ page }) => {
    await world(page);
    await selectBld(page, 'Decameroon_Farm_1');
    await page.evaluate(() => BldDB.copy());
    await page.evaluate(() => BldDB.paste());
    expect(await blds(page)).toContainEqual({ id: 'Medieval20_Farm_1_copy', package: MED });
    expect(await blds(page)).toContainEqual({ id: 'Decameroon_Farm_1', package: 'decameroon' });
  });

  test('pasting twice numbers the second copy, ids stay unique inside the package', async ({ page }) => {
    await world(page);
    await selectBld(page, 'Decameroon_Farm_1');
    await page.evaluate(() => BldDB.copy());
    await page.evaluate(() => { BldDB.paste(); BldDB.paste(); });
    const ids = (await blds(page)).filter(b => b.package === MED).map(b => b.id);
    expect(ids.sort()).toEqual(['Medieval20_Farm_1_copy', 'Medieval20_Farm_1_copy2']);
  });

  test('pasting inside the base package keeps id + _copy and the base package', async ({ page }) => {
    await world(page);
    await page.evaluate(() => { BldDB.addEntries([{ id: 'house_1', package: 'postapoc', buildingCategory: 'Standard', canBuild: true, availableTiles: [], spriteName: 'house_1' }]); Packages.setActive('postapoc'); });
    await selectBld(page, 'house_1');
    await page.evaluate(() => BldDB.copy());
    await page.evaluate(() => BldDB.paste());
    expect(await blds(page)).toContainEqual({ id: 'house_1_copy', package: 'postapoc' });
  });

  test('typing another package\'s prefix into the id moves the building there (the QA steps: Copy, Paste, Change ID)', async ({ page }) => {
    await world(page);
    await page.evaluate(() => Packages.setActive('decameroon'));
    await selectBld(page, 'Decameroon_Farm_1');
    await page.evaluate(() => BldDB.copy());
    await page.evaluate(() => BldDB.paste());                       // lands in Decameroon (active)
    await page.locator('#bld-list .hexdb-list-row', { hasText: /^Decameroon_Farm_1_copy$/ }).first().click();
    await renameBld(page, 'Medieval20_Building_1');
    expect(await blds(page)).toContainEqual({ id: 'Medieval20_Building_1', package: MED });
    await expect(page.locator('#bld-f-package')).toHaveText(MED);
  });

  test('an id with the record\'s own package prefix, or no package prefix, moves nothing', async ({ page }) => {
    await world(page);
    await selectBld(page, 'Decameroon_Farm_1');
    await renameBld(page, 'Decameroon_Farm_2');
    await renameBld(page, 'Plain_Farm');
    expect((await blds(page)).filter(b => b.id === 'Plain_Farm')).toEqual([{ id: 'Plain_Farm', package: 'decameroon' }]);
  });

  test('a clash with an entry of the target package: the building stays and says why', async ({ page }) => {
    await world(page);
    await page.evaluate(() => BldDB.addEntries([{ id: 'Medieval20_Farm_1', package: 'medieval-2-0', buildingCategory: 'Standard', canBuild: true, availableTiles: [], spriteName: 'x' }]));
    await selectBld(page, 'Decameroon_Farm_1');
    await renameBld(page, 'Medieval20_Farm_1');
    const same = (await blds(page)).filter(b => b.id === 'Medieval20_Farm_1');
    expect(same.map(b => b.package).sort()).toEqual(['decameroon', MED]);
  });

  test('a road or a bridge never leaves the base package by its id', async ({ page }) => {
    await world(page);
    await selectBld(page, 'road');
    await renameBld(page, 'Medieval20_road');
    expect(await blds(page)).toContainEqual({ id: 'Medieval20_road', package: 'postapoc' });
  });

  test('the form shows the package of the record', async ({ page }) => {
    await world(page);
    await selectBld(page, 'Decameroon_Farm_1');
    await expect(page.locator('#bld-f-package')).toHaveText('decameroon');
  });
});

test.describe('HEX DB: the id prefix decides the package', () => {
  const sel = async (page: Page, id: string) => {
    await page.evaluate(() => App.setMode('hexdb'));
    await page.evaluate(() => { const t = document.getElementById('hexdb-search') as HTMLInputElement | null; if (t) { t.value = ''; t.dispatchEvent(new Event('input')); } });
    await page.locator('#hexdb-list .hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
    await expect(page.locator('#hexdb-id')).toHaveValue(id);
  };
  const hexes = (page: Page) => page.evaluate(() => HexDB.getAll().map((h: any) => ({ id: h.id, package: h.package || 'postapoc' })));

  test('Paste while Medieval 2.0 is active gives a Medieval20_ copy in that package', async ({ page }) => {
    await world(page);
    await sel(page, 'Decameroon_Plain_1');
    await page.evaluate(() => HexDB.copy());
    await page.evaluate(() => HexDB.paste());
    expect(await hexes(page)).toContainEqual({ id: 'Medieval20_Plain_1_copy', package: MED });
  });

  test('typing the Medieval20_ prefix into a Decameroon tile id moves it to Medieval 2.0 and the form shows it', async ({ page }) => {
    await world(page);
    await page.evaluate(() => Packages.setActive('decameroon'));
    await sel(page, 'Decameroon_Plain_2');
    await page.evaluate(() => HexDB.copy());
    await page.evaluate(() => HexDB.paste());
    await page.locator('#hexdb-list .hexdb-list-row', { hasText: /^Decameroon_Plain_2_copy$/ }).first().click();
    await page.locator('#hexdb-id').fill('Medieval20_Plain_2');
    await page.locator('#hexdb-id').blur();
    expect(await hexes(page)).toContainEqual({ id: 'Medieval20_Plain_2', package: MED });
    await expect(page.locator('#hexdb-package-label')).toHaveText(MED);
  });
});

test('packageForId: a registered package prefix followed by a name, nothing else', async ({ page }) => {
  await world(page);
  const r = await page.evaluate(() => [Packages.packageForId('Medieval20_Farm_1'), Packages.packageForId('Medieval20_'), Packages.packageForId('Plain_1'), Packages.packageForId('Decameroon_Water_1')]);
  expect(r).toEqual([MED, '', '', 'decameroon']);
});
