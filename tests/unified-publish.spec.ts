import { test, expect, Page } from '@playwright/test';
import * as crypto from 'crypto';
import { openEditor, FakeGitHub, seedSprites, TINY_PNG, dataUrl, quiesceAfterDialog } from './helpers';

// Unified Publish, stage 1 (docs/superpowers/plans/2026-10-23-unified-publish-stage1.md).
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const CHANGED_PNG = Buffer.concat([TINY_PNG, Buffer.from([0])]);   // same name, different bytes
const hex = (id: string, extra: object = {}) => ({ id, package: 'hashpkg', spriteName: id, type: 'Plains', ...extra });

async function setupPkg(page: Page, gh: FakeGitHub, opts: { manifest?: 'ok' | 'none' | 'corrupt' } = {}) {
  gh.setRegistry([{ id: 'hashpkg', name: 'Hash Pkg', version: '1.0.0' }]);
  gh.setJson('packages/hashpkg/package.json', { id: 'hashpkg', name: 'Hash Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/hashpkg/hex_database.json', { version: 1, package: 'hashpkg', hexes: [hex('Hashpkg_Same'), hex('Hashpkg_Changed')] });
  const mode = opts.manifest ?? 'ok';
  if (mode === 'ok') gh.setJson('packages/hashpkg/manifest.json', { schemaVersion: 1, id: 'hashpkg', version: '1.0.0', files: [
    { path: 'sprites/hex/Hashpkg_Same.png', sha256: sha(TINY_PNG), size: TINY_PNG.length },
    { path: 'sprites/hex/Hashpkg_Changed.png', sha256: sha(TINY_PNG), size: TINY_PNG.length },
  ] });
  if (mode === 'corrupt') gh.write('packages/hashpkg/manifest.json', '{ not json');
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('hashpkg'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(h => HexDB.addEntries(h), [hex('Hashpkg_Same'), hex('Hashpkg_Changed'), hex('Hashpkg_New')]);
  await seedSprites(page, [
    { name: 'Hashpkg_Same', category: 'hex', dataUrl: dataUrl(TINY_PNG) },
    { name: 'Hashpkg_Changed', category: 'hex', dataUrl: dataUrl(CHANGED_PNG) },
    { name: 'Hashpkg_New', category: 'hex', dataUrl: dataUrl(TINY_PNG) },
  ]);
}
const spritePuts = (gh: FakeGitHub) => gh.putPaths().filter(p => p.startsWith('packages/hashpkg/sprites/'));

test.describe('Task 1: unchanged sprites are skipped', () => {
  test('a sprite whose hash matches the server manifest is not uploaded', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh);
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toContain('packages/hashpkg/sprites/hex/Hashpkg_Changed.png');
    expect(spritePuts(gh)).toContain('packages/hashpkg/sprites/hex/Hashpkg_New.png');
    expect(spritePuts(gh)).not.toContain('packages/hashpkg/sprites/hex/Hashpkg_Same.png');
    expect(r.skipped).toBe(1);
  });

  test('no manifest on the server (first publish): every sprite uploads', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh, { manifest: 'none' });
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toHaveLength(3);
    expect(r.skipped).toBe(0);
  });

  test('a corrupt server manifest: every sprite uploads and nothing throws', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh, { manifest: 'corrupt' });
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toHaveLength(3);
    expect(r.skipped).toBe(0);
  });
});

test.describe('Task 2: the diff lists sprite changes', () => {
  test('new and changed sprites are listed, unchanged ones are not', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh);
    await page.evaluate(() => { Packages.openPublishConfirm('hashpkg'); });
    const details = page.locator('#dialog-details');
    await expect(details).toContainText('Sprites: 1 new, 1 changed');
    await expect(details).toContainText('+ sprite Hashpkg_New');
    await expect(details).toContainText('~ sprite Hashpkg_Changed');
    await expect(details).not.toContainText('Hashpkg_Same');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await quiesceAfterDialog(page);
    expect(gh.putPaths()).toEqual([]);
  });

  test('a sprite-only change is not reported as "no entry differs"', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh);
    await page.evaluate(() => { Packages.openPublishConfirm('hashpkg'); });
    await expect(page.locator('#dialog-msg')).not.toContainText('No entry differs');
  });
});

test.describe('Task 3: the base package publishes through the same dialog', () => {
  async function editBase(page: Page) {
    return page.evaluate(() => {
      const h = HexDB.getData().hexes.find((x: any) => !x.package || x.package === 'postapoc');
      h.effects = 'edited-by-test';
      return h.id as string;
    });
  }

  test('the diff and the base warning show; Cancel writes nothing', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    const id = await editBase(page);
    await page.evaluate(() => { Packages.openPublishConfirm('postapoc'); });
    const details = page.locator('#dialog-details');
    await expect(details).toContainText(`~ hex ${id}`);
    await expect(page.locator('#dialog-msg')).toContainText('every player and old game build');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await quiesceAfterDialog(page);
    expect(gh.putPaths()).toEqual([]);
  });

  test('confirming writes the package copy AND the root copy, then one manifest', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await editBase(page);
    await page.evaluate(() => { Packages.openPublishConfirm('postapoc'); });
    await page.getByRole('button', { name: 'Publish base package' }).click();
    await expect.poll(() => gh.putPaths()).toContain('packages/postapoc/manifest.json');   // written last of the data files
    const paths = gh.putPaths();
    expect(paths).toContain('hex_database.json');
    expect(paths).toContain('packages/postapoc/hex_database.json');
    expect(paths.filter(p => p === 'packages/postapoc/manifest.json')).toHaveLength(1);
  });

  test('records of another package never reach the base diff', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.evaluate(() => HexDB.addEntries([{ id: 'Other_Only_1', package: 'otherpkg', spriteName: 'x', type: 'Plains' }]));
    await page.evaluate(() => { Packages.openPublishConfirm('postapoc'); });
    await expect(page.locator('#dialog-details')).not.toContainText('Other_Only_1');
  });
});

test('base sprites whose hash matches the base manifest are not uploaded again', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setJson('packages/postapoc/manifest.json', { schemaVersion: 1, id: 'postapoc', version: '1.0.0', files: [
    { path: 'sprites/hex/Basehash_Same.png', sha256: sha(TINY_PNG), size: TINY_PNG.length },
  ] });
  await openEditor(page, { gh, pat: true });
  await seedSprites(page, [
    { name: 'Basehash_Same', category: 'hex', dataUrl: dataUrl(TINY_PNG) },
    { name: 'Basehash_New', category: 'hex', dataUrl: dataUrl(CHANGED_PNG) },
  ]);
  await page.evaluate(() => GitHubSync.publishAllSprites({ skipManifest: true }));
  expect(gh.putPaths()).toContain('packages/postapoc/sprites/hex/Basehash_New.png');
  expect(gh.putPaths()).toContain('sprites/hex/Basehash_New.png');
  expect(gh.putPaths()).not.toContain('packages/postapoc/sprites/hex/Basehash_Same.png');
  expect(gh.putPaths()).not.toContain('sprites/hex/Basehash_Same.png');
});

test.describe('Task 4: Publish Common Data', () => {
  const payloads = (page: Page) => page.evaluate(() => ({
    upg: UpgDB.getJson(), com: CommonDB.export(), loc: JSON.stringify(LocalizationKeys.getExportData(), null, 2),
  }));
  const confirmBtn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

  test('lists changed and unchanged files and writes only the changed ones', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    const p = await payloads(page);
    gh.write('upgrade_database.json', p.upg);                 // same as local
    gh.write('localization.json', p.loc);                     // same as local
    gh.write('common_settings.json', '{"old":true}');         // differs
    await page.evaluate(() => { void GitHubSync.publishCommon(); });
    const details = page.locator('#dialog-details');
    await expect(details).toContainText('common_settings.json: changed');
    await expect(details).toContainText('upgrade_database.json: unchanged');
    await confirmBtn(page, 'Publish').click();
    await expect.poll(() => gh.putPaths()).toEqual(['common_settings.json']);
  });

  test('Cancel writes nothing', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    gh.write('common_settings.json', '{"old":true}');
    await page.evaluate(() => { void GitHubSync.publishCommon(); });
    await confirmBtn(page, 'Cancel').click();
    await quiesceAfterDialog(page);
    expect(gh.putPaths()).toEqual([]);
  });

  test('all three unchanged: only Close, no write', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    const p = await payloads(page);
    gh.write('upgrade_database.json', p.upg); gh.write('common_settings.json', p.com); gh.write('localization.json', p.loc);
    await page.evaluate(() => { void GitHubSync.publishCommon(); });
    await expect(page.locator('#dialog-msg')).toContainText('Nothing differs');
    await confirmBtn(page, 'Close').click();
    await quiesceAfterDialog(page);
    expect(gh.putPaths()).toEqual([]);
  });

  test('a failing second write names the file and the one already written', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    gh.write('upgrade_database.json', '{"old":1}'); gh.write('common_settings.json', '{"old":2}');
    gh.write('localization.json', (await payloads(page)).loc);
    gh.failPut = (p: string) => p === 'common_settings.json';
    await page.evaluate(() => { void GitHubSync.publishCommon(); });
    await confirmBtn(page, 'Publish').click();
    await expect.poll(() => gh.putPaths()).toContain('upgrade_database.json');
    await expect(page.locator('.toast, #toast').first()).toContainText(/common_settings\.json.*1 file\(s\) already written/);
  });
});

test.describe('Task 5: the Publish menu', () => {
  test('has Publish Package Data, Publish Common Data, Publish Map and the maintenance action only', async ({ page }) => {
    await openEditor(page, { gh: new FakeGitHub(), pat: true });
    await page.locator('#btn-publish-all').click();
    const labels = (await page.locator('#pub-drop button').allTextContents()).map(t => t.replace(/^[^A-Za-z]+/, '').trim());
    expect(labels).toEqual(['Publish Package Data', 'Publish Common Data', 'Publish Map', 'Clean Ghost Sprites']);
  });

  test('Publish opens the diff of the active package; the base package asks for its own confirmation', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh);
    await page.evaluate(() => Packages.setActive('hashpkg'));
    await page.locator('#btn-publish-all').click();
    await page.locator('#pub-drop button', { hasText: /^☁ Publish Package Data$/ }).click();
    await expect(page.locator('#dialog-title')).toHaveText('Publish Package');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await quiesceAfterDialog(page);
    await page.evaluate(() => Packages.setActive('postapoc'));
    await page.locator('#btn-publish-all').click();
    await page.locator('#pub-drop button', { hasText: /^☁ Publish Package Data$/ }).click();
    await expect(page.locator('#dialog-title')).toHaveText('Publish base package');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await quiesceAfterDialog(page);
    expect(gh.putPaths()).toEqual([]);
  });

  test('without a token Publish only says so', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh });
    await page.evaluate(() => { void GitHubSync.publish(); });
    await expect(page.locator('#dialog-title')).not.toBeVisible();
    expect(gh.putPaths()).toEqual([]);
  });
});
