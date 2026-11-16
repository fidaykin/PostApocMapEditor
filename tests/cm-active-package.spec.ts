import { test, expect } from '@playwright/test';
import { FakeGitHub, seedServerPackage, openEditor } from './helpers';

// ClickUp 869fpzvgj: the Content Manager listed packages/postapoc/ whatever package was active, so the hex and buildings of HS
// were missing. It lists the active package; upload and delete (default package only) are not offered for another one.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const seed = () => {
  const gh = new FakeGitHub();
  gh.write('packages/postapoc/sprites/buildings/PA_Farm_1.png', PNG);
  seedServerPackage(gh, 'hs', { sprites: { 'buildings/HS_FoodAmbar_1.png': PNG, 'hex/HS_Plain_1.png': PNG } });
  gh.write('packages/postapoc/sprites/hex/PA_Plain_1.png', PNG);
  return gh;
};
const cm = (page: any) => page.evaluate(async () => { await GitHubSync.openContentManager(); return document.getElementById('gh-cm-body')!.innerText; });

test('the Content Manager lists the sprites of the active package and offers delete but no upload for a non-default one', async ({ page }) => {
  await openEditor(page, { gh: seed(), pat: true });
  await page.evaluate(() => Packages.setActive('hs'));
  await expect.poll(() => cm(page)).toContain('HS_FoodAmbar_1');
  const text = await cm(page);
  expect(text).toContain('HS_Plain_1');
  expect(text).not.toContain('PA_Farm_1');
  expect(await page.locator('#gh-cm-body .cm-file .cm-btn-del').count()).toBe(2);
  expect(await page.locator('#gh-cm-body .cm-section-title .cm-btn-up').count()).toBe(0);
});

test('the default package still lists its own sprites with upload and delete', async ({ page }) => {
  await openEditor(page, { gh: seed(), pat: true });
  await expect.poll(() => cm(page)).toContain('PA_Farm_1');
  expect(await page.locator('#gh-cm-body .cm-file .cm-btn-del').count()).toBeGreaterThan(0);
});

test('deleting a sprite of a non-default package removes only its file, after a confirmation', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.setActive('hs'));
  await expect.poll(() => cm(page)).toContain('HS_Plain_1');
  // the helpers dismiss native dialogs, so the confirm is answered in the page
  await page.evaluate(() => { (window as any).__asked = ''; window.confirm = (m?: string) => { (window as any).__asked = m; return true; }; });
  await page.locator('[data-cm-id="sprite-hex-HS_Plain_1.png"] .cm-btn-del').click();
  await expect.poll(() => gh.read('packages/hs/sprites/hex/HS_Plain_1.png') !== null).toBe(false);
  expect(await page.evaluate(() => (window as any).__asked)).toContain('HS_Plain_1.png');
  expect(gh.read('packages/hs/sprites/buildings/HS_FoodAmbar_1.png') !== null).toBe(true);
  expect(gh.read('packages/postapoc/sprites/hex/PA_Plain_1.png') !== null).toBe(true);
});

test('a sprite that an entry of the package still uses is not deleted', async ({ page }) => {
  const gh = seed();
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => { HexDB.getData().hexes.push({ id: 'HS_Plain_1', package: 'hs', spriteName: 'HS_Plain_1' }); Packages.setActive('hs'); });
  await expect.poll(() => cm(page)).toContain('HS_Plain_1');
  await page.locator('[data-cm-id="sprite-hex-HS_Plain_1.png"] .cm-btn-del').click();
  await expect(page.locator('body')).toContainText('is used by 1 entry');
  expect(gh.read('packages/hs/sprites/hex/HS_Plain_1.png') !== null).toBe(true);
});
