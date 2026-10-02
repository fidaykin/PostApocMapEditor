import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

async function breakStorage(page: any) {
  await page.evaluate(() => {
    (window as any).__origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
}
async function fixStorage(page: any) {
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__origSetItem; });
}

test('a full localStorage produces one sticky warning per saved thing', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  await page.evaluate(() => { HexDB.add(); HexDB.add(); BldDB.add(); });
  const hexToast = page.locator('.toast.sticky', { hasText: 'Hex DB autosave not saved: browser storage is full' });
  await expect(hexToast).toHaveCount(1);
  await expect(page.locator('.toast.sticky', { hasText: 'Buildings DB autosave not saved' })).toHaveCount(1);
  await expect(hexToast.locator('.toast-detail')).toContainText('Export your work');
});

test('a failing save never throws into the caller and returns false', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  const r = await page.evaluate(() => {
    let threw = false, ret: any;
    try { ret = StorageGuard.setItem('k', 'v', 'Thing'); } catch { threw = true; }
    let threw2 = false;
    try { HexDB.add(); } catch { threw2 = true; }
    return { threw, ret, threw2 };
  });
  expect(r).toEqual({ threw: false, ret: false, threw2: false });
});

test('non-quota errors get a generic title; warning survives a broken toast UI', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new Error('SecurityError denied'); };
  });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  const t = page.locator('.toast.sticky', { hasText: '⚠ Foo not saved' });
  await expect(t).toHaveCount(1);
  await expect(t).not.toContainText('storage is full');
  await expect(t.locator('.toast-detail')).toContainText('SecurityError denied');
  const threw = await page.evaluate(() => {
    const orig = UI.toast; UI.toast = () => { throw new Error('ui broken'); };
    try { StorageGuard._warn('Bar', new Error('x')); return false; } catch { return true; }
    finally { UI.toast = orig; }
  });
  expect(threw).toBe(false);
});

test('warns again after the 60 s window and clears state after a successful save', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  const warn = page.locator('.toast.sticky', { hasText: 'Foo not saved' });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);
  // 61 s later the same label warns again, replacing (not stacking on) the old toast
  await page.evaluate(() => { const n = Date.now(); Date.now = () => n + 61000; });
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);
  // a successful save removes the warning and resets the throttle
  await fixStorage(page);
  expect(await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'))).toBe(true);
  await expect(warn).toHaveCount(0);
  await breakStorage(page);
  await page.evaluate(() => StorageGuard.setItem('k', 'v', 'Foo'));
  await expect(warn).toHaveCount(1);   // immediately warns again: throttle was reset
});

test('map autosave failure is surfaced', async ({ page }) => {
  await openEditor(page);
  await breakStorage(page);
  await page.evaluate(() => IO.scheduleAutoSave());
  await expect(page.locator('.toast.sticky', { hasText: 'Map autosave not saved' })).toHaveCount(1);
});
