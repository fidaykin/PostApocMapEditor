import { test, expect, Page } from '@playwright/test';
import { FakeGitHub, openEditor, packageZip, hexRec, bldRec, quiesceAfterDialog } from './helpers';
import { seedRoadsWorld, BASE_HEXES } from './roads-fixtures';

// Roads/Bridges V1, E5 (validation gate before any publish write) and E6 (write mode, dual write). Everything runs against FakeGitHub.
const setMode = (page: Page, m: string) => page.evaluate((m) => localStorage.setItem('roadsWriteMode', m), m);
/** Gives every BASE record a list so the unset rule is satisfied (positive control for the gates). */
const backfillBase = (page: Page) => page.evaluate(() => {
  for (const h of HexDB.getAll()) if (!h.package || h.package === 'postapoc') HexDB.setAllowedRoads(h, h.type === 'Rivers' ? ['bridge'] : h.type === 'Plains' ? ['road'] : []);
});
const publishBase = (page: Page) => page.evaluate(() => GitHubSync.publishHexDbOnly({ skipManifest: true }));

test.describe('roads publish gate (E5)', () => {
  test('stage mode: a base record without the field aborts before any write; with the field everywhere both hex files are written', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await setMode(page, 'stage');
    expect(gh.puts.length).toBe(0);
    expect(await publishBase(page)).toBe(false);
    expect(gh.puts.length).toBe(0);                                   // nothing written
    await expect(page.locator('#toast-container')).toContainText('no road permissions');
    await backfillBase(page);
    expect(await publishBase(page)).toBe(true);
    expect(gh.putPaths()).toEqual(['packages/postapoc/hex_database.json', 'hex_database.json']);
  });

  test('off mode: the same unset records publish (positive control)', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    expect(await page.evaluate(() => localStorage.getItem('roadsWriteMode'))).toBeNull();
    expect(await publishBase(page)).toBe(true);
    expect(gh.putPaths()).toEqual(['packages/postapoc/hex_database.json', 'hex_database.json']);
  });

  test('active mode blocks like stage; an unknown road id blocks and the message names the id and the count', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await backfillBase(page);
    await page.evaluate(() => {
      HexDB.setAllowedRoads('postapoc::Plain_1', ['road_old']);
      HexDB.setAllowedRoads('postapoc::Plain_2', ['road', 'gone_too']);
    });
    for (const mode of ['stage', 'active']) {
      await setMode(page, mode);
      expect(await publishBase(page)).toBe(false);
    }
    expect(gh.puts.length).toBe(0);
    await expect(page.locator('#toast-container')).toContainText('road_old');
    await expect(page.locator('#toast-container')).toContainText('2 problems');
    // control: off mode publishes the same data
    await setMode(page, 'off');
    expect(await publishBase(page)).toBe(true);
  });

  test('a duplicate id offers "Fix and continue": confirming dedupes and publishes; Cancel writes nothing', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await backfillBase(page);
    await setMode(page, 'stage');
    await page.evaluate(() => { HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads = ['road', 'road']; });
    const p1 = publishBase(page);
    await page.locator('#dialog-modal.open button', { hasText: 'Cancel' }).click();
    expect(await p1).toBe(false);
    await quiesceAfterDialog(page);
    expect(gh.puts.length).toBe(0);
    const p2 = publishBase(page);
    await page.locator('#dialog-modal.open button', { hasText: 'Fix and continue' }).click();
    expect(await p2).toBe(true);
    expect(gh.putPaths()).toContain('hex_database.json');
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads)).toEqual(['road']);
  });

  test('a road defined in a package Building DB blocks Packages.publishPackage in stage/active, not in off; the other package data is fine', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
    gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'p.png', isDefault: false });
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => !!Packages.getEntry('pp'));
    await page.evaluate(() => {
      HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains', allowedRoads: [] }]);
      BldDB.addEntries([{ id: 'Pp_road', package: 'pp', isRoad: true, buildingCategory: 'Standard', spriteName: 'x' }]);
    });
    for (const mode of ['stage', 'active']) {
      await setMode(page, mode);
      const r = await page.evaluate(() => Packages.publishPackage('pp'));
      expect(r.ok).toBe(false);
      expect(r.error).toContain('Pp_road');
    }
    expect(gh.puts.length).toBe(0);
    await setMode(page, 'off');
    expect((await page.evaluate(() => Packages.publishPackage('pp'))).ok).toBe(true);
  });

  test('stage mode: a package hex without the field blocks the package publish; with the field it goes through', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
    gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'p.png', isDefault: false });
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => !!Packages.getEntry('pp'));
    await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
    await setMode(page, 'stage');
    const r = await page.evaluate(() => Packages.publishPackage('pp'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Pp_Hex_1');
    expect(gh.puts.length).toBe(0);
    await page.evaluate(() => HexDB.setAllowedRoads('pp::Pp_Hex_1', []));
    expect((await page.evaluate(() => Packages.publishPackage('pp'))).ok).toBe(true);
  });
});

test.describe('roads in imported packages (E5)', () => {
  const PICK = (page: Page, buffer: Buffer) => page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer });

  test('a ZIP whose Building DB has a road or a bridge is rejected in every mode; a house is accepted (positive control)', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => (window as any).__startupSyncDone);
    for (const mode of ['off', 'active']) {
      await setMode(page, mode);
      await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd')], buildings: [bldRec('Rd_road', 'rd', { isRoad: true }), bldRec('Rd_bridge', 'rd', { buildingCategory: 'Bridge' })] }));
      await expect(page.locator('#pkg-import-errors')).toContainText('Rd_road');
      await expect(page.locator('#pkg-import-errors')).toContainText('Rd_bridge');
      await expect(page.locator('#pkg-import-errors')).toContainText('global');
      await page.keyboard.press('Escape');
    }
    await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd')], buildings: [bldRec('Rd_house', 'rd', {})] }));
    await expect.poll(() => page.evaluate(() => !!Packages.getImportPlan())).toBe(true);
    await expect(page.locator('#pkg-import-errors')).toHaveCount(0);
    expect(await page.evaluate(() => Packages.getImportPlan().ok)).toBe(true);
  });

  test('an imported hex file with an unknown road id gives a warning in the plan, not an error', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    void gh;
    await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd', { allowedRoads: ['road', 'road_old'] }), hexRec('Rd_Plain_2', 'rd', { allowedRoads: ['road_old'] }), hexRec('Rd_Plain_3', 'rd', { allowedRoads: ['road'] })] }));
    await expect.poll(() => page.evaluate(() => !!Packages.getImportPlan())).toBe(true);
    const plan = await page.evaluate(() => { const p = Packages.getImportPlan(); return { ok: p.ok, errors: p.errors, warnings: p.warnings }; });
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join('\n')).toMatch(/2 tiles list road ids unknown here.*road_old/);
  });
});
