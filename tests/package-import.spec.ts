import { test, expect } from '@playwright/test';
import { openEditor, buildZip, TINY_PNG } from './helpers';

async function zipFor(id: string, name: string) {
  const prefix = id.charAt(0).toUpperCase() + id.slice(1) + '_';
  return buildZip({
    'package.json': JSON.stringify({ id, name, version: '1.0.0' }),
    'hex_database.json': JSON.stringify({ version: 1, package: id, hexes: [{ id: `${prefix}Hex_1`, package: id, spriteName: `${prefix}Hex_1`, type: 'Plains' }] }),
    'building_database.json': JSON.stringify({ version: 1, package: id, buildings: [{ id: `${prefix}Bld_1`, package: id, spriteName: `${prefix}Bld_1` }] }),
    ['sprites/hex/' + prefix + 'Hex_1.png']: TINY_PNG,
  });
}

async function pickZip(page: any, buf: Buffer) {
  await page.setInputFiles('#pkg-import-input', { name: 'p.zip', mimeType: 'application/zip', buffer: buf });
  await expect(page.locator('#pkg-import-modal')).toBeVisible();
}

test('importing a ZIP puts its hexes, buildings and sprites into the editor', async ({ page }) => {
  await openEditor(page, { pat: true });
  await pickZip(page, await zipFor('zipmod', 'Zip Mod'));
  await page.fill('#pkg-import-id', 'zipimp');
  await page.locator('#pkg-import-modal').getByRole('button', { name: 'Import' }).click();
  await expect.poll(() => page.evaluate(() => HexDB.getAll().some(h => h.id === 'Zipimp_Hex_1' && h.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(() => BldDB.getAll().some(b => b.id === 'Zipimp_Bld_1' && b.package === 'zipimp'))).toBe(true);
  expect(await page.evaluate(async () => (await SpriteStore.loadAll()).some(s => s.name === 'Zipmod_Hex_1' && s.category === 'hex'))).toBe(true);
  expect(await page.evaluate(() => typeof Terrain.getUploadedUrl('Zipmod_Hex_1'))).toBe('string');
});
