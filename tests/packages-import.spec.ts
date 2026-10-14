import { test, expect, Page } from '@playwright/test';
import { openEditor, buildZip, packageZip, hexRec, bldRec, TINY_PNG, FakeGitHub, waitForLastWrite, seedServerPackage } from './helpers';

// T5.8: import is all-or-nothing (local DBs/sprites/trash reverted, server writes compensated, registry written LAST),
// reskin ids survive, cross-references follow renamed ids, and a same-id import asks Replace / Merge / Cancel.

const NEW = 'new-pack';
const P = `packages/${NEW}`;
const REG = 'packages/registry.json';

const importZip = () => packageZip('old', 'Old Pack', {
  hexes: [
    hexRec('Old_Tile', 'old', { spriteName: 'S1' }),
    hexRec('Old_Other', 'old', { spriteName: 'S1', destroyTransformTo: 'Old_Tile', incomeTransformTo: '__parent__', destroySource: ['Old_Tile', 'Plain_1'] }),
    hexRec('Plain_1', 'old', { spriteName: 'S1' }),             // reskin of a postapoc id: id must stay
  ],
  buildings: [bldRec('Old_Farm', 'old', { spriteName: 'S2', destroyTransformTo: 'Old_Tile', requiredHex: ['Old_Tile'] })],
  sprites: { 'hex/S1.png': TINY_PNG, 'buildings/S2.png': TINY_PNG },
});

async function boot(page: Page, seed?: (gh: FakeGitHub) => void) {
  const gh = new FakeGitHub();
  seed?.(gh);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => (window as any).__startupSyncDone);
  return gh;
}

const snap = (page: Page) => page.evaluate(async () => ({
  hex: JSON.stringify(HexDB.getData().hexes),
  bld: JSON.stringify(BldDB.getAll()),
  sprites: JSON.stringify((await SpriteStore.loadAll()).sort((a: any, b: any) => a.name < b.name ? -1 : 1)),
  trash: localStorage.getItem('pkg_trash'),
  registry: JSON.stringify(Packages.getAll()),
}));

async function pick(page: Page, buf: Buffer, id: string) {
  await page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  await page.fill('#pkg-import-id', id);
}
const clickImport = (page: Page) => page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
const status = (page: Page) => page.evaluate(() => (Packages as any).getImportResult());
const settled = (page: Page) => expect.poll(async () => (await status(page))?.status).not.toMatch(/^(running|undefined)$/);

test('_rewriteAll: reskin ids stay, prefixed ids are re-prefixed, references follow, unknown ids are untouched', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => { const o = (Packages as any)._rewriteAll(
    [
      { id: 'Old_Tile', package: 'old', underTerrainId: 'Old_Water' },
      { id: 'Old_Water', package: 'old', destroyTransformTo: 'Old_Tile', incomeTransformTo: '__parent__', destroySource: ['Old_Tile', 'Plain_1', 'Mystery'] },
      { id: 'Plain_1', package: 'old' },
      { id: 'Loose', package: 'old', destroyTransformTo: 'Plain_1' },
    ],
    [{ id: 'Old_Farm', package: 'old', destroyTransformTo: 'Old_Tile', destroySources: ['Old_Water'], upgradeTo: ['Old_Farm', 'Gone'], requiredHex: ['Old_Tile'], parents: ['Loose'], storageUpgradeId: 'Old_Farm', incomeTransformTo: 'Old_Tile' }],
    'old', 'new-pack', new Set(['Plain_1'])); return { ...o, idMap: [...o.idMap.entries()] }; });
  expect(r.hexes.map((h: any) => h.id)).toEqual(['NewPack_Tile', 'NewPack_Water', 'Plain_1', 'NewPack_Loose']);
  expect(r.hexes[0].underTerrainId).toBe('NewPack_Water');
  expect(r.hexes[1]).toMatchObject({ destroyTransformTo: 'NewPack_Tile', incomeTransformTo: '__parent__', destroySource: ['NewPack_Tile', 'Plain_1', 'Mystery'] });
  expect(r.hexes[3].destroyTransformTo).toBe('Plain_1');
  expect(r.hexes.every((h: any) => h.package === 'new-pack')).toBe(true);
  expect(r.buildings[0]).toMatchObject({ id: 'NewPack_Farm', destroyTransformTo: 'NewPack_Tile', destroySources: ['NewPack_Water'], upgradeTo: ['NewPack_Farm', 'Gone'],
    requiredHex: ['NewPack_Tile'], parents: ['NewPack_Loose'], storageUpgradeId: 'NewPack_Farm', incomeTransformTo: 'NewPack_Tile' });
  expect(r.idMap.sort()).toEqual([['Loose', 'NewPack_Loose'], ['Old_Farm', 'NewPack_Farm'], ['Old_Tile', 'NewPack_Tile'], ['Old_Water', 'NewPack_Water']]);
});

test('import writes package.json, DBs, sprites and the registry LAST; ids and references are rewritten on the server and locally', async ({ page }) => {
  const gh = await boot(page);
  await pick(page, await importZip(), NEW);
  await clickImport(page);
  await waitForLastWrite(gh, REG);
  expect(gh.writeLog.map(w => w.path)).toEqual([`${P}/package.json`, `${P}/hex_database.json`, `${P}/building_database.json`, `${P}/sprites/hex/S1.png`, `${P}/sprites/buildings/S2.png`, `${P}/manifest.json`, REG]);
  const hex = gh.json(`${P}/hex_database.json`).hexes;
  expect(hex.map((h: any) => h.id)).toEqual(['NewPack_Tile', 'NewPack_Other', 'Plain_1']);
  expect(hex[1]).toMatchObject({ destroyTransformTo: 'NewPack_Tile', incomeTransformTo: '__parent__', destroySource: ['NewPack_Tile', 'Plain_1'] });
  expect(gh.json(`${P}/building_database.json`).buildings[0]).toMatchObject({ id: 'NewPack_Farm', destroyTransformTo: 'NewPack_Tile', requiredHex: ['NewPack_Tile'], package: NEW });
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  const local = await page.evaluate(async () => ({
    hex: HexDB.getData().hexes.filter((h: any) => h.package === 'new-pack').map((h: any) => h.id),
    bld: BldDB.getAll().filter((b: any) => b.package === 'new-pack').map((b: any) => b.id),
    sprites: (await SpriteStore.loadForPackage('new-pack')).map((e: any) => e.name).sort(),
  }));
  expect(local).toEqual({ hex: ['NewPack_Tile', 'NewPack_Other', 'Plain_1'], bld: ['NewPack_Farm'], sprites: ['S1', 'S2'] });
  // the base entry Plain_1 (postapoc) is untouched next to the reskin
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.id === 'Plain_1').map((h: any) => h.package || 'postapoc').sort())).toEqual(['new-pack', 'postapoc']);
});

const STEPS: [string, string][] = [
  ['package.json', `${P}/package.json`], ['hex database', `${P}/hex_database.json`], ['building database', `${P}/building_database.json`],
  ['first sprite', `${P}/sprites/hex/S1.png`], ['last sprite', `${P}/sprites/buildings/S2.png`], ['manifest', `${P}/manifest.json`], ['registry', REG],
];
for (const [label, failPath] of STEPS) {
  test(`a failed ${label} write leaves no trace (local state identical, server compensated), and a retry succeeds`, async ({ page }) => {
    const gh = await boot(page);
    const before = await snap(page);
    const regBefore = gh.read(REG)!.toString();
    await pick(page, await importZip(), NEW);
    gh.failPut = p => p === failPath;
    await clickImport(page);
    await settled(page);
    expect((await status(page)).status).toBe('failed');
    expect((await status(page)).remaining).toEqual([]);
    // server: every file the import created was deleted again (DELETE log), the registry never changed
    const putOk = gh.writeLog.filter(w => w.op === 'PUT').map(w => w.path);
    expect(gh.deletes.slice().sort()).toEqual(putOk.slice().sort());
    expect(putOk).not.toContain(REG);
    expect([...(gh.list(P) ?? [])]).toEqual([]);
    expect(gh.read(REG)!.toString()).toBe(regBefore);
    expect(await snap(page)).toEqual(before);
    await expect(page.locator('#pkg-import-modal')).toBeVisible();     // still open: retry possible
    // retry
    gh.failPut = () => false;
    const n = gh.writeLog.length;
    await clickImport(page);
    await settled(page);
    expect((await status(page)).status).toBe('ok');
    expect(gh.writeLog.slice(n).map(w => w.path).at(-1)).toBe(REG);
    expect(gh.json(REG).packages.map((p: any) => p.id)).toContain(NEW);
    expect(await page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.package === 'new-pack'))).toBe(true);
  });
}

test('when compensation itself fails the error modal names exactly what remains and success is never claimed', async ({ page }) => {
  const gh = await boot(page);
  const before = await snap(page);
  await pick(page, await importZip(), NEW);
  gh.failPut = p => p === REG;
  gh.failDelete = p => p === `${P}/hex_database.json`;
  await clickImport(page);
  await settled(page);
  const st = await status(page);
  expect(st.status).toBe('failed');
  expect(st.remaining).toEqual([`${P}/hex_database.json`]);
  const modal = page.locator('#pkg-import-failed-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(`${P}/hex_database.json`);
  await expect(modal).not.toContainText(`${P}/package.json`);
  await expect(page.getByText(/imported/i).filter({ hasText: '✅' })).toHaveCount(0);
  expect((gh.list(P) ?? []).map((f: any) => f.name)).toEqual(['hex_database.json']);
  expect(await snap(page)).toEqual(before);
});

test('a concurrent second Import click does not start a second import', async ({ page }) => {
  const gh = await boot(page);
  await pick(page, await importZip(), NEW);
  await page.evaluate(() => { Packages.confirmImport(); Packages.confirmImport(); });
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect(gh.writeLog.map(w => w.path).filter(p => p === REG)).toHaveLength(1);
  expect(gh.writeLog.map(w => w.path).filter(p => p === `${P}/package.json`)).toHaveLength(1);
});

// ── same-id conflict ──
const seedOld = (gh: FakeGitHub) => seedServerPackage(gh, 'old', {
  name: 'Old Pack',
  hexes: [hexRec('Old_Tile', 'old', { spriteName: 'S1', label: 'server version' }), hexRec('Old_Gone', 'old', { spriteName: 'S1' })],
  buildings: [], sprites: { 'hex/S1.png': TINY_PNG },
});
const conflictModal = (page: Page) => page.locator('#pkg-import-conflict-modal');

test('conflict: Cancel writes nothing and changes nothing', async ({ page }) => {
  const gh = await boot(page, seedOld);
  expect(await page.evaluate(() => HexDB.getAll().some((h: any) => h.id === 'Old_Gone' && h.package === 'old'))).toBe(true);
  const before = await snap(page), n = gh.writeLog.length;
  await pick(page, await importZip(), 'old');
  await clickImport(page);
  await expect(conflictModal(page)).toBeVisible();
  await expect(conflictModal(page)).toContainText('already exists');
  await conflictModal(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(conflictModal(page)).toHaveCount(0);
  expect(gh.writeLog.length).toBe(n);
  expect(await snap(page)).toEqual(before);
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
  expect((await status(page))?.status).not.toBe('running');
});

test('conflict: Replace moves the old entries to the reversible trash; Restore brings back what the import did not replace', async ({ page }) => {
  const gh = await boot(page, seedOld);
  await pick(page, await importZip(), 'old');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Replace' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  const ids = await page.evaluate(() => HexDB.getData().hexes.filter((h: any) => h.package === 'old').map((h: any) => h.id));
  expect(ids).toEqual(['Old_Tile', 'Old_Other', 'Plain_1']);                 // Old_Gone is gone locally ...
  const trash = await page.evaluate(() => Packages.listTrash());
  expect(trash).toHaveLength(1);
  expect(trash[0].id).toBe('old');
  expect(trash[0].hexes.map((h: any) => h.id)).toEqual(['Old_Tile', 'Old_Gone']);   // ... and sits in the trash with the old data
  expect(trash[0].hexes[0].label).toBe('server version');
  expect(gh.json('packages/old/hex_database.json').hexes.map((h: any) => h.id)).toEqual(['Old_Tile', 'Old_Other', 'Plain_1']);
  expect(gh.json(REG).packages.filter((p: any) => p.id === 'old')).toHaveLength(1);
  // T0 restore UI
  await page.evaluate(() => Packages.restoreDeleted('old'));
  await expect.poll(() => page.evaluate(() => HexDB.getData().hexes.some((h: any) => h.id === 'Old_Gone' && h.package === 'old'))).toBe(true);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

test('conflict: Replace that fails restores local entries, trash and the overwritten server files', async ({ page }) => {
  const gh = await boot(page, seedOld);
  const before = await snap(page);
  const files = ['package.json', 'hex_database.json', 'building_database.json', 'sprites/hex/S1.png'].map(f => [f, gh.read(`packages/old/${f}`)?.toString('base64') ?? null]);
  await pick(page, await importZip(), 'old');
  gh.failPut = p => p === REG;
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Replace' }).click();
  await settled(page);
  expect((await status(page)).status).toBe('failed');
  expect((await status(page)).remaining).toEqual([]);
  expect(await snap(page)).toEqual(before);
  for (const [f, b64] of files) expect([f, gh.read(`packages/old/${f}`)?.toString('base64') ?? null]).toEqual([f, b64]);
  expect(gh.deletes.filter(p => p.startsWith('packages/old/')).sort()).toEqual([`packages/old/manifest.json`, `packages/old/sprites/buildings/S2.png`].sort());   // the manifest the import created is removed again too
});

test('conflict: Merge keeps local entries that differ, adds the new ones and writes the merged set', async ({ page }) => {
  const gh = await boot(page, seedOld);
  await pick(page, await importZip(), 'old');
  await clickImport(page);
  await conflictModal(page).getByRole('button', { name: 'Merge' }).click();
  await waitForLastWrite(gh, REG);
  await settled(page);
  expect((await status(page)).status).toBe('ok');
  const local = await page.evaluate(() => HexDB.getData().hexes.filter((h: any) => h.package === 'old').map((h: any) => [h.id, h.label ?? null]));
  expect(local).toEqual([['Old_Tile', 'server version'], ['Old_Gone', null], ['Old_Other', null], ['Plain_1', null]]);
  expect(gh.json('packages/old/hex_database.json').hexes.map((h: any) => h.id)).toEqual(['Old_Tile', 'Old_Gone', 'Old_Other', 'Plain_1']);
  expect(await page.evaluate(() => Packages.listTrash().length)).toBe(0);
});

test('a server-side id that is not in this editor is still refused (no conflict flow)', async ({ page }) => {
  const gh = await boot(page, g => g.setJson('packages/taken/package.json', { id: 'taken', name: 'Taken', version: '3.0.0' }));
  await pick(page, await importZip(), 'taken');
  await clickImport(page);
  await expect(page.locator('#pkg-import-error')).toContainText('already exists on the server');
  expect(gh.writeLog).toEqual([]);
});

