import { test, expect, Page } from '@playwright/test';
import { openEditor, seedSprites, TINY_PNG, dataUrl } from './helpers';

// A building added or edited in the Building Editor reaches its preview, the map palette and the map tiles without a
// reload (QA 869e52z74, 869e52qdp, 869e52qrn), and the Id field never downloads a file on blur (869fcn16p).
const SPRITE = 'Live_Sprite_1';
const palBtn = (page: Page, id: string) => page.locator(`.tile-btn[data-hex-id="${id}"]`);

async function seedLocalSprite(page: Page) {
  await seedSprites(page, [{ name: SPRITE, category: 'buildings', dataUrl: dataUrl(TINY_PNG) }]);
}
async function addAndSelect(page: Page) {
  await page.evaluate(() => App.setMode('buildings'));
  await page.evaluate(() => BldDB.add());
  await expect(page.locator('#bld-f-id')).toBeVisible();
}
async function setField(page: Page, sel: string, value: string) {
  const el = page.locator(sel);
  await el.fill(value);
  await el.dispatchEvent('change');
}
async function setIdAndSprite(page: Page, id: string) {
  await setField(page, '#bld-f-id', id);
  await setField(page, '#bld-f-spriteName', SPRITE);
}

test.describe('Building Editor: live propagation', () => {
  test('preview shows the sprite right after it is set, without re-selecting the record', async ({ page }) => {
    await openEditor(page);
    await seedLocalSprite(page);
    await addAndSelect(page);
    await setIdAndSprite(page, 'Live_Bld_1');
    const img = page.locator('#bld-right img').first();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(await img.evaluate((i: HTMLImageElement) => i.style.opacity)).toBe('');
  });

  test('a new building gets a palette button, and it follows an id change', async ({ page }) => {
    await openEditor(page);
    await seedLocalSprite(page);
    await addAndSelect(page);
    await setIdAndSprite(page, 'Live_Bld_2');
    await expect(palBtn(page, 'Live_Bld_2')).toHaveCount(1);
    await expect(palBtn(page, 'Live_Bld_2').locator('img')).toHaveJSProperty('complete', true);
    await setField(page, '#bld-f-id', 'Live_Bld_3');
    await expect(palBtn(page, 'Live_Bld_3')).toHaveCount(1);
    await expect(palBtn(page, 'Live_Bld_2')).toHaveCount(0);
  });

  test('a deleted building leaves the palette', async ({ page }) => {
    await openEditor(page);
    await seedLocalSprite(page);
    await addAndSelect(page);
    await setIdAndSprite(page, 'Live_Bld_4');
    await expect(palBtn(page, 'Live_Bld_4')).toHaveCount(1);
    await page.evaluate(() => BldDB.deleteSelected());
    await page.locator('.modal-ok, #confirm-ok, [data-confirm-ok]').first().click().catch(() => {});
    await expect(palBtn(page, 'Live_Bld_4')).toHaveCount(0);
  });

  test('the map sprite of a new building is loaded without a reload', async ({ page }) => {
    await openEditor(page);
    await seedLocalSprite(page);
    await addAndSelect(page);
    await setIdAndSprite(page, 'Live_Bld_5');
    await expect.poll(() => page.evaluate(() => Terrain.spriteState('Live_Bld_5'))).toBe('loaded');
  });

  test('Id blur downloads nothing and stores the trimmed id; Save DB still downloads once', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    const id = page.locator('#bld-f-id');
    await id.fill('  Trim_Me_1  ');
    await id.blur();
    await id.focus();
    await id.blur();
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);
    await expect(id).toHaveValue('Trim_Me_1');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blddb_autosave') || '{}').buildings.map((b: any) => b.id));
    expect(stored).toContain('Trim_Me_1');
    const dl = page.waitForEvent('download');
    await page.evaluate(() => BldDB.save());
    await dl;
  });

  test('Storage Upgrade ID blur downloads nothing and stores the trimmed value', async ({ page }) => {
    await openEditor(page);
    await addAndSelect(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    const f = page.locator('#bld-f-storage-upgrade-id');
    if (await f.count() === 0) test.skip(true, 'field is only rendered for storage buildings');
    await f.fill(' wh_1 ');
    await f.blur();
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => BldDB.getAll().some((b: any) => b.storageUpgradeId === 'wh_1'))).toBe(true);
  });

  test('the sprite picker lists the active package only; the base package is unchanged', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => { (window as any).__opts = null; UI.showSpritePicker = (_cb: any, o: any) => { (window as any).__opts = o; }; });
    await page.evaluate(() => BldDB.addEntries([
      { id: 'Base_B_1', package: 'postapoc', spriteName: 'Base_Sprite', buildingCategory: 'Standard' },
      { id: 'Dec_B_1', package: 'decameroon', spriteName: 'Dec_Sprite', buildingCategory: 'Standard' }]));
    await addAndSelect(page);
    await page.evaluate(() => BldDB.pickSprite());
    let o = await page.evaluate(() => (window as any).__opts);
    expect(o.folder).toBe('packages/postapoc/sprites/buildings');
    expect(o.packageOnly).toBe(false);
    await page.evaluate(() => { Packages.getActive = () => 'decameroon'; });
    await page.evaluate(() => BldDB.pickSprite());
    o = await page.evaluate(() => ({ ...(window as any).__opts, sprites: (window as any).__opts.getSprites() }));
    expect(o.folder).toContain('/packages/decameroon/sprites/buildings');
    expect(o.packageOnly).toBe(true);
    expect(o.sprites).toEqual(['Dec_Sprite']);
  });
});
