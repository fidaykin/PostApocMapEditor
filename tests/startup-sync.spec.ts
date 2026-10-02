import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub } from './helpers';

test('a hex added locally survives a reload (the reproduced bug)', async ({ page }) => {
  await openEditor(page);
  const before = await page.evaluate(() => { HexDB.add(); BldDB.add(); return [HexDB.getAll().length, BldDB.getAll().length]; });
  await reloadEditor(page);
  const after = await page.evaluate(() => [HexDB.getAll().length, BldDB.getAll().length,
    HexDB.getAll().some(h => /^NewHex_/.test(h.id)), BldDB.getAll().some(b => /^NewBuild_/.test(b.id))]);
  expect(after).toEqual([before[0], before[1], true, true]);
});

test('a local edit of a server entry survives a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    HexDB.getData().hexes.find(h => h.id === 'Plain_2').effects = 'LOCAL_EDIT';
    localStorage.setItem('hexdb_autosave', JSON.stringify(HexDB.getData()));
  });
  await reloadEditor(page);
  const effects = await page.evaluate(() => HexDB.getAll().find(h => h.id === 'Plain_2').effects);
  expect(effects).toBe('LOCAL_EDIT');
  const sum = await page.evaluate(() => window.__lastSyncSummary);
  expect(sum.conflicts).toContain('hex postapoc::Plain_2');
});

test('a server update to an entry the user never touched is applied', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh });
  const db = gh.json('packages/postapoc/hex_database.json');
  db.hexes.find((h: any) => h.id === 'Plain_2').effects = 'SERVER_NEW';
  gh.setJson('packages/postapoc/hex_database.json', db);
  await reloadEditor(page);
  expect(await page.evaluate(() => HexDB.getAll().find(h => h.id === 'Plain_2').effects)).toBe('SERVER_NEW');
});

test('entries of every registry package are merged; a package without files is not an error', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'extra', name: 'Extra' }, { id: 'empty', name: 'Empty' }]);
  gh.setJson('packages/extra/hex_database.json', { version: 1, package: 'extra', hexes: [{ id: 'Extra_Hex_1', package: 'extra', spriteName: 'Extra_Hex_1', type: 'Plains' }] });
  gh.setJson('packages/extra/building_database.json', { version: 1, package: 'extra', buildings: [{ id: 'Extra_Bld_1', package: 'extra', spriteName: 'Extra_Bld_1' }] });
  await openEditor(page, { gh });
  const r = await page.evaluate(() => ({
    hex: HexDB.getAll().find(h => h.id === 'Extra_Hex_1'),
    bld: BldDB.getAll().find(b => b.id === 'Extra_Bld_1'),
    sum: window.__lastSyncSummary,
  }));
  expect(r.hex.package).toBe('extra');
  expect(r.bld.package).toBe('extra');
  expect(r.sum.packages).toEqual(['postapoc', 'extra', 'empty']);
  expect(r.sum.failed).toEqual([]);
});
