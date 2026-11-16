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

test('the Content Manager lists the sprites of the active package and offers no upload/delete for a non-default one', async ({ page }) => {
  await openEditor(page, { gh: seed(), pat: true });
  await page.evaluate(() => Packages.setActive('hs'));
  await expect.poll(() => cm(page)).toContain('HS_FoodAmbar_1');
  const text = await cm(page);
  expect(text).toContain('HS_Plain_1');
  expect(text).not.toContain('PA_Farm_1');
  expect(await page.locator('#gh-cm-body .cm-file .cm-btn-del').count()).toBe(0);
  expect(await page.locator('#gh-cm-body .cm-section-title .cm-btn-up').count()).toBe(0);
});

test('the default package still lists its own sprites with upload and delete', async ({ page }) => {
  await openEditor(page, { gh: seed(), pat: true });
  await expect.poll(() => cm(page)).toContain('PA_Farm_1');
  expect(await page.locator('#gh-cm-body .cm-file .cm-btn-del').count()).toBeGreaterThan(0);
});
