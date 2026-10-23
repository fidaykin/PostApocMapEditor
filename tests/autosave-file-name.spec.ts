import { test, expect } from '@playwright/test';
import { openEditor, reloadEditor } from './helpers';

// The map name shown in the status bar (and used by Save) survives a page reload: the autosave copy stores it.
const label = (page: any) => page.locator('#map-file-label');

async function openNamed(page: any, name: string) {
  await openEditor(page);
  await page.evaluate(n => { IO.newMap(true); IO.setFileName(n); }, name);
  await page.evaluate(() => IO.autoSave());          // flush now instead of waiting for the timer
}

test('a named map keeps its name after a reload', async ({ page }) => {
  await openNamed(page, 'Decameroon_test_19.102');
  await expect(label(page)).toHaveText('Decameroon_test_19.102');
  await reloadEditor(page);
  await expect(label(page)).toHaveText('Decameroon_test_19.102');
});

test('Save after the reload downloads the map under its own name', async ({ page }) => {
  await openNamed(page, 'Decameroon_test_19.102');
  await reloadEditor(page);
  const dl = page.waitForEvent('download');
  await page.evaluate(() => IO.saveMap());
  expect((await dl).suggestedFilename()).toBe('Decameroon_test_19.102.json');
});

test('renaming alone (no map edit) is stored too', async ({ page }) => {
  await openNamed(page, 'First');
  await page.evaluate(() => IO.setFileName('Second'));
  await page.evaluate(() => IO.autoSave());
  await reloadEditor(page);
  await expect(label(page)).toHaveText('Second');
});

test('an unnamed map still shows (autosave) after a reload', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { IO.newMap(true); });
  await page.evaluate(() => IO.autoSave());
  await reloadEditor(page);
  await expect(label(page)).toHaveText('(autosave)');
});
