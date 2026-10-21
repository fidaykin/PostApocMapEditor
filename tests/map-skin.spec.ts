import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage } from './helpers';

// Map "skin": the package that repaints the map in the game (visuals only). The key is absent when empty.
const PKG = 'skin-pkg';

async function setup(page: Page) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, PKG, { name: 'Skin Pkg' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
}
const mapJson = (page: Page) => page.evaluate(() => JSON.parse(IO.getMapJson()));

test.describe('map skin', () => {
  test('a fresh map has no skin key and the select offers none plus the packages', async ({ page }) => {
    await setup(page);
    expect('skin' in (await mapJson(page))).toBe(false);
    await page.evaluate(() => { document.getElementById("acc-btn-design").click(); });
    await page.locator("#map-skin-select").focus();
    const opts = await page.locator('#map-skin-select option').evaluateAll(o => o.map(x => (x as HTMLOptionElement).value));
    expect(opts).toContain('');
    expect(opts).toContain(PKG);
    expect(opts).not.toContain('postapoc');
  });

  test('choosing a skin writes it, clearing removes the key', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { document.getElementById("acc-btn-design").click(); });
    await page.locator("#map-skin-select").focus();
    await page.locator('#map-skin-select').selectOption(PKG);
    expect((await mapJson(page)).skin).toBe(PKG);
    await page.locator('#map-skin-select').selectOption('');
    expect('skin' in (await mapJson(page))).toBe(false);
  });

  test('a map file with a skin loads it back into the select; New map clears it', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { MapSkin.set('skin-pkg'); });
    const raw = await page.evaluate(() => IO.getMapJson());
    await page.evaluate(() => IO.newMap(true));
    expect(await page.evaluate(() => MapSkin.get())).toBe('');
    await page.evaluate(r => IO.loadFromJSON(JSON.parse(r)), raw);
    expect(await page.evaluate(() => MapSkin.get())).toBe(PKG);
    expect(await page.locator('#map-skin-select').inputValue()).toBe(PKG);
  });

  test('map format knows the key and warns about a non-text skin', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const base = JSON.parse(IO.getMapJson());
      return { known: MapFormat.KNOWN_KEYS.includes('skin'), bad: MapFormat.validate({ ...base, skin: 5 }).warnings };
    });
    expect(r.known).toBe(true);
    expect(r.bad.join(' ')).toContain('skin');
  });
});
