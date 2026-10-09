import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor, reloadEditor, FakeGitHub, ROOT, seedServerPackage, waitForLastWrite } from './helpers';

// Owner report (live build f22f9b9, Decameroon package): "it duplicated all buildings again" after the workflow
// 1) Publish HexDB, 2) Publish Buildings DB, 3) Publish package. Root cause: the base-DB publish wrote EVERY package's
// entries into hex_database.json / building_database.json (root and packages/postapoc), and the startup merge of the
// postapoc file then added those foreign entries next to the package's own copies (same package + id twice).
// The fixtures are small and hand-built in the shape of the live data (prefixed ids, package 'decameroon').

const PKG = 'decameroon';
const decHex = (id: string, extra: object = {}) => ({ id, type: 'Plains', spriteName: id, package: PKG, edgeFaces: [], ...extra });
const decBld = (id: string, extra: object = {}) => ({ id, spriteName: id, package: PKG, buildingCategory: 'Production', ...extra });
const DEC_HEXES = [decHex('Decameroon_Plain_1'), decHex('Decameroon_Forest_1', { type: 'Forests' }), decHex('Decameroon_Water_1', { type: 'Water', spriteName: 'Decameroon_Water' })];
const DEC_BLDS = [decBld('Decameroon_Farm_1'), decBld('Decameroon_Mill_1')];

const diskJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const pkgOf = (e: any) => e.package || 'postapoc';
const keysOf = (list: any[]) => list.map(e => `${pkgOf(e)}::${e.id}`);
const dupes = (list: any[]) => { const seen = new Set<string>(), d: string[] = []; for (const k of keysOf(list)) { if (seen.has(k)) d.push(k); seen.add(k); } return d; };

async function editorLists(page: Page) {
  return page.evaluate(() => ({ hexes: HexDB.getAll().map((h: any) => ({ id: h.id, package: h.package, effects: h.effects })),
                                blds: BldDB.getAll().map((b: any) => ({ id: b.id, package: b.package, buildingCategory: b.buildingCategory })) }));
}

async function publishHexDb(page: Page, gh: FakeGitHub) {
  const n = gh.writeLog.length;
  await page.locator('#btn-publish-all').click();
  await page.getByRole('button', { name: '☁ Publish HexDB' }).click();
  await expect.poll(() => gh.writeLog.slice(n).some(w => w.path === 'hex_database.json'), { timeout: 10_000 }).toBe(true);
}
async function publishBldDb(page: Page, gh: FakeGitHub) {
  const n = gh.writeLog.length;
  await page.locator('#btn-publish-all').click();
  await page.getByRole('button', { name: '☁ Publish Buildings DB' }).click();
  await expect.poll(() => gh.writeLog.slice(n).some(w => w.path === 'building_database.json'), { timeout: 10_000 }).toBe(true);
}
async function publishPackage(page: Page, gh: FakeGitHub) {
  const n = gh.writeLog.length;
  await page.evaluate(id => { Packages.openPublishConfirm(id); }, PKG);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();          // step one: the diff
  await page.getByRole('button', { name: /^Publish (now|anyway)$/ }).click();      // step two: version, changelog
  await expect.poll(() => gh.writeLog.slice(n).some(w => w.path === `packages/${PKG}/package.json`), { timeout: 15_000 }).toBe(true);
}

/** Every server DB file holds only its own package's entries. */
function expectServerClean(gh: FakeGitHub) {
  for (const f of ['hex_database.json', 'packages/postapoc/hex_database.json']) {
    const pk = gh.json(f).hexes.map(pkgOf);
    expect(pk.filter((p: string) => p !== 'postapoc'), f).toEqual([]);
  }
  for (const f of ['building_database.json', 'packages/postapoc/building_database.json']) {
    const pk = gh.json(f).buildings.map(pkgOf);
    expect(pk.filter((p: string) => p !== 'postapoc'), f).toEqual([]);
  }
  expect(gh.json(`packages/${PKG}/hex_database.json`).hexes.map(pkgOf).filter((p: string) => p !== PKG)).toEqual([]);
  expect(gh.json(`packages/${PKG}/building_database.json`).buildings.map(pkgOf).filter((p: string) => p !== PKG)).toEqual([]);
}

/** Editor after a reload: no (package,id) twice, and per package exactly what the server files hold. */
async function expectEditorMatchesServer(page: Page, gh: FakeGitHub) {
  const { hexes, blds } = await editorLists(page);
  expect(dupes(hexes), 'duplicate hex entries').toEqual([]);
  expect(dupes(blds), 'duplicate building entries').toEqual([]);
  const srvDecHex = gh.json(`packages/${PKG}/hex_database.json`).hexes.map((h: any) => h.id).sort();
  const srvDecBld = gh.json(`packages/${PKG}/building_database.json`).buildings.map((b: any) => b.id).sort();
  expect(hexes.filter(h => h.package === PKG).map(h => h.id).sort()).toEqual(srvDecHex);
  expect(blds.filter(b => b.package === PKG).map(b => b.id).sort()).toEqual(srvDecBld);
  const srvBaseHex = gh.json('packages/postapoc/hex_database.json').hexes.length;
  expect(hexes.filter(h => pkgOf(h) === 'postapoc').length).toBe(srvBaseHex);
}

const ORDERS: { name: string; steps: ('hex' | 'bld' | 'pkg')[] }[] = [
  { name: 'Hex DB, Buildings DB, package (the owner\'s order)', steps: ['hex', 'bld', 'pkg'] },
  { name: 'package, Hex DB, Buildings DB', steps: ['pkg', 'hex', 'bld'] },
  { name: 'Buildings DB, package, Hex DB', steps: ['bld', 'pkg', 'hex'] },
];

for (const order of ORDERS) {
  test(`publish ${order.name} with the package active leaves no duplicates after a reload`, async ({ page }) => {
    const gh = new FakeGitHub();
    seedServerPackage(gh, PKG, { name: 'Decameroon', hexes: DEC_HEXES, buildings: DEC_BLDS });
    await openEditor(page, { gh, pat: true });
    await page.evaluate(id => Packages.setActive(id), PKG);
    // the owner's session: a new decameroon tile and a new decameroon building made locally before publishing
    await page.evaluate(() => {
      HexDB.addEntries([{ id: 'Decameroon_Hills_1', type: 'Hills/Mountains', spriteName: 'Decameroon_Hills_1', package: 'decameroon' }]);
      BldDB.addEntries([{ id: 'Decameroon_Tower_1', spriteName: 'Decameroon_Tower_1', package: 'decameroon', buildingCategory: 'Military' }]);
    });
    for (const s of order.steps) {
      if (s === 'hex') await publishHexDb(page, gh);
      if (s === 'bld') await publishBldDb(page, gh);
      if (s === 'pkg') await publishPackage(page, gh);
    }
    expectServerClean(gh);
    await reloadEditor(page);
    await expectEditorMatchesServer(page, gh);
    await reloadEditor(page);   // a second session must not grow anything either
    await expectEditorMatchesServer(page, gh);
  });
}

// The live server today: the base DBs (root and packages/postapoc) carry decameroon-tagged copies next to the
// package's own DBs. Decameroon_OnlyInBase exists ONLY in the polluted base file (never published with the package).
function seedPollutedServer(gh: FakeGitHub) {
  const baseHex = diskJson('packages/postapoc/hex_database.json');
  const baseBld = diskJson('packages/postapoc/building_database.json');
  const pkgHexes = [...DEC_HEXES.slice(0, 2), decHex('Decameroon_Water_1', { type: 'Water', spriteName: 'Decameroon_Water', effects: 'package copy' })];
  const pollutedHexes = [...baseHex.hexes, ...DEC_HEXES, decHex('Decameroon_OnlyInBase')];
  const pollutedBlds = [...baseBld.buildings, ...DEC_BLDS];
  seedServerPackage(gh, PKG, { name: 'Decameroon', hexes: pkgHexes, buildings: DEC_BLDS });
  for (const f of ['hex_database.json', 'packages/postapoc/hex_database.json']) gh.setJson(f, { ...baseHex, hexes: pollutedHexes });
  for (const f of ['building_database.json', 'packages/postapoc/building_database.json']) gh.setJson(f, { ...baseBld, buildings: pollutedBlds });
  return { baseHexCount: baseHex.hexes.length, baseBldCount: baseBld.buildings.length, pollutedRoot: { ...baseHex, hexes: pollutedHexes } };
}
/** The live site serves the polluted root hex_database.json to the editor's own startup fetch too. */
async function servePollutedRoot(page: Page, root: object) {
  await page.route(/^http:\/\/localhost:\d+\/hex_database\.json(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(root) }));
}

test('a polluted server (package entries inside the base DBs) loads without duplicates and keeps base-only orphans', async ({ page }) => {
  const gh = new FakeGitHub();
  const { baseHexCount, pollutedRoot } = seedPollutedServer(gh);
  await servePollutedRoot(page, pollutedRoot);
  await openEditor(page, { gh, pat: true });
  const { hexes, blds } = await editorLists(page);
  expect(dupes(hexes)).toEqual([]);
  expect(dupes(blds)).toEqual([]);
  // the package's own copy wins over the stale copy in the base file
  expect(hexes.filter(h => h.id === 'Decameroon_Water_1')).toEqual([{ id: 'Decameroon_Water_1', package: PKG, effects: 'package copy' }]);
  // an entry that exists only in the polluted base file is kept, attributed to its package (no data loss)
  expect(hexes.filter(h => h.id === 'Decameroon_OnlyInBase').map(h => h.package)).toEqual([PKG]);
  expect(hexes.filter(h => pkgOf(h) === 'postapoc').length).toBe(baseHexCount);
  expect(blds.filter(b => b.package === PKG).map(b => b.id).sort()).toEqual(['Decameroon_Farm_1', 'Decameroon_Mill_1']);
  await reloadEditor(page);
  const again = await editorLists(page);
  expect(dupes(again.hexes)).toEqual([]);
  expect(again.hexes.length).toBe(hexes.length);
  expect(again.blds.length).toBe(blds.length);
});

test('one-time repair: Publish HexDB and Publish Buildings DB from a healthy editor rewrite the polluted base DBs filtered', async ({ page }) => {
  const gh = new FakeGitHub();
  const { baseHexCount, baseBldCount, pollutedRoot } = seedPollutedServer(gh);
  await servePollutedRoot(page, pollutedRoot);
  await openEditor(page, { gh, pat: true });
  await publishHexDb(page, gh);
  await publishBldDb(page, gh);
  for (const f of ['hex_database.json', 'packages/postapoc/hex_database.json']) {
    const list = gh.json(f).hexes;
    expect(list.filter((h: any) => pkgOf(h) !== 'postapoc').map((h: any) => h.id), f).toEqual([]);
    expect(list.length, f).toBe(baseHexCount);
  }
  for (const f of ['building_database.json', 'packages/postapoc/building_database.json']) {
    const list = gh.json(f).buildings;
    expect(list.filter((b: any) => pkgOf(b) !== 'postapoc').map((b: any) => b.id), f).toEqual([]);
    expect(list.length, f).toBe(baseBldCount);
  }
  // the package DBs were not touched by the base publish
  expect(gh.putPaths().filter(p => p.startsWith(`packages/${PKG}/`))).toEqual([]);
  await expect(page.locator('#toast-container')).toContainText(/not included|Publish Package/);
});

test('duplicate (package,id) entries already in the local autosave are merged on load, keeping the locally edited copy', async ({ page }) => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, PKG, { name: 'Decameroon', hexes: DEC_HEXES, buildings: DEC_BLDS });
  await openEditor(page, { gh, pat: true });   // a session that synced (the merge base is stored)
  // ...then got polluted by the old publish: Decameroon_Forest_1 twice (the FIRST copy edited locally, the second
  // equal to the server copy), Decameroon_Plain_1 twice (identical), Decameroon_Farm_1 twice. Written straight into
  // the autosave, as the old startup merge left it, then a new session starts.
  await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('hexdb_autosave')!);
    const forest = h.hexes.find((x: any) => x.id === 'Decameroon_Forest_1' && x.package === 'decameroon');
    const plain = h.hexes.find((x: any) => x.id === 'Decameroon_Plain_1' && x.package === 'decameroon');
    h.hexes.unshift({ ...forest, effects: 'my local edit' }, { ...plain });
    localStorage.setItem('hexdb_autosave', JSON.stringify(h));
    const b = JSON.parse(localStorage.getItem('blddb_autosave')!);
    b.buildings.unshift({ ...b.buildings.find((x: any) => x.id === 'Decameroon_Farm_1') });
    localStorage.setItem('blddb_autosave', JSON.stringify(b));
  });
  await reloadEditor(page);
  const { hexes, blds } = await editorLists(page);
  expect(dupes(hexes)).toEqual([]);
  expect(dupes(blds)).toEqual([]);
  expect(hexes.filter(h => h.id === 'Decameroon_Forest_1').map(h => h.effects)).toEqual(['my local edit']);
  await expect(page.locator('#toast-container')).toContainText('Hex DB: 2 duplicate entries merged');
  await expect(page.locator('#toast-container')).toContainText('Buildings DB: 1 duplicate entry merged');
  // the kept local edit survives the next session too (it is a normal local edit now: the sync keeps it)
  await reloadEditor(page);
  expect((await editorLists(page)).hexes.filter(h => h.id === 'Decameroon_Forest_1').map(h => h.effects)).toEqual(['my local edit']);
});

test('merge paths never create a second (package,id) copy: mergeFromServer with foreign entries, addEntries, restoreEntries', async ({ page }) => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, PKG, { name: 'Decameroon', hexes: DEC_HEXES, buildings: DEC_BLDS });
  await openEditor(page, { gh, pat: true });
  const r = await page.evaluate(([decH, decB]: any) => {
    const hexBase = { version: 1, package: 'postapoc', hexes: [...HexDB.getAll().filter((h: any) => !h.package), ...decH] };
    HexDB.mergeFromServer('postapoc', hexBase);
    BldDB.mergeFromServer('postapoc', { version: 1, package: 'postapoc', buildings: [...BldDB.getAll().filter((b: any) => !b.package), ...decB] });
    HexDB.addEntries([decH[0]]);
    HexDB.restoreEntries([...HexDB.getAll(), decH[1]]);
    BldDB.restoreEntries([...BldDB.getAll(), decB[0]]);
    return { hexes: HexDB.getAll().map((h: any) => ({ id: h.id, package: h.package })), blds: BldDB.getAll().map((b: any) => ({ id: b.id, package: b.package })) };
  }, [DEC_HEXES, DEC_BLDS]);
  expect(dupes(r.hexes)).toEqual([]);
  expect(dupes(r.blds)).toEqual([]);
  expect(r.hexes.filter(h => h.package === PKG).length).toBe(DEC_HEXES.length);
});
