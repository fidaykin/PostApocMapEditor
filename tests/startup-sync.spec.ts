import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor, FakeGitHub, quiesceAfterDialog } from './helpers';

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

// The merge base says "the server had this at the last sync". It is only meaningful together with
// the local copy it was merged into; without that copy, every base entry would look deleted locally.
for (const kind of ['bld', 'hex'] as const) {
  const key = kind === 'bld' ? 'blddb_autosave' : 'hexdb_autosave';
  const count = kind === 'bld' ? () => BldDB.getAll().length : () => HexDB.getAll().length;

  test(`a corrupt ${key} next to a stored merge base does not drop the server entries`, async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh });
    const server = kind === 'bld'
      ? gh.json('packages/postapoc/building_database.json').buildings.length
      : gh.json('packages/postapoc/hex_database.json').hexes.length;
    expect(await page.evaluate(k => (SyncMerge.loadBase(k).postapoc || []).length, kind)).toBe(server);
    await page.evaluate(k => localStorage.setItem(k, '{corrupt'), key);
    await reloadEditor(page);
    expect(await page.evaluate(count)).toBeGreaterThanOrEqual(server);
  });

  test(`a missing ${key} next to a stored merge base does not drop the server entries`, async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh });
    const server = kind === 'bld'
      ? gh.json('packages/postapoc/building_database.json').buildings.length
      : gh.json('packages/postapoc/hex_database.json').hexes.length;
    await page.evaluate(k => localStorage.removeItem(k), key);
    await reloadEditor(page);
    expect(await page.evaluate(count)).toBeGreaterThanOrEqual(server);
  });

  test(`a failed ${key} write does not advance the ${kind} merge base`, async ({ page }) => {
    await openEditor(page);
    const r = await page.evaluate(([k, storeKey]) => {
      const db: any = k === 'bld' ? BldDB : HexDB;
      const field = k === 'bld' ? 'buildings' : 'hexes';
      const server = structuredClone(db.getAll().filter((e: any) => (e.package || 'postapoc') === 'postapoc'));
      server.push({ id: 'Server_Added_Later', type: 'Plains' });
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, v: string) {
        if (key === storeKey) throw new DOMException('full', 'QuotaExceededError');
        return orig.call(this, key, v);
      };
      try { db.mergeFromServer('postapoc', { [field]: server }); }
      finally { Storage.prototype.setItem = orig; }
      return (SyncMerge.loadBase(k).postapoc || []).some((e: any) => e.id === 'Server_Added_Later');
    }, [kind, key]);
    expect(r).toBe(false);
  });
}

test('Load Hex DB from server asks first; Cancel changes nothing', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => HexDB.add());
  const before = await page.evaluate(() => [HexDB.getAll().length, localStorage.getItem('sync_base_hex'), localStorage.getItem('sync_base_bld')]);
  expect(before[1]).not.toBeNull();
  await page.evaluate(() => { GitHubSync.loadHexDbIntoEditor(); });
  await expect(page.locator('#dialog-msg')).toContainText('Replace all local hexes');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await quiesceAfterDialog(page);
  expect(await page.evaluate(() => [HexDB.getAll().length, localStorage.getItem('sync_base_hex'), localStorage.getItem('sync_base_bld')])).toEqual(before);
});

test('Load Hex DB from server, confirmed, replaces the hexes and drops both merge bases', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh });
  await page.evaluate(() => HexDB.add());
  await page.evaluate(() => { GitHubSync.loadHexDbIntoEditor(); });
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => /^NewHex_/.test(h.id)))).toBe(false);
  expect(await page.evaluate(() => [localStorage.getItem('sync_base_hex'), localStorage.getItem('sync_base_bld')])).toEqual([null, null]);
  const server = gh.json('packages/postapoc/hex_database.json').hexes.length;
  expect(await page.evaluate(() => HexDB.getAll().length)).toBeLessThanOrEqual(server);
});

for (const bad of [{ hexes: [] }, { hexes: 'nope' }]) {
  test(`an unusable postapoc hex list (${JSON.stringify(bad.hexes)}) is skipped with a warning, never merged as "all deleted"`, async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh });
    const n = await page.evaluate(() => HexDB.getAll().length);
    gh.setJson('packages/postapoc/hex_database.json', { version: 1, ...bad });
    await reloadEditor(page);
    const r = await page.evaluate(() => ({
      n: HexDB.getAll().length,
      base: (SyncMerge.loadBase('hex').postapoc || []).length,
      failed: (window as any).__lastSyncSummary.failed,
    }));
    expect(r.n).toBe(n);
    expect(r.base).toBeGreaterThan(0);
    expect(r.failed.some((f: string) => f.startsWith('postapoc/hex_database.json'))).toBe(true);
  });
}
