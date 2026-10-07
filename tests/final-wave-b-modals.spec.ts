import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Final wave B1: ONE stacking scheme for UI.showModal overlays and the shared dialogs (#dialog-modal, #confirm-modal,
// #newmap-modal): the most recently opened is on top, Escape acts on the topmost only, and the map shortcuts that
// change or replace the map (Ctrl+Z/Y/S/N/O) are inert while any modal is open.

const gate = (page: Page) => page.locator('#validator-gate-modal');
const topId = (page: Page, sel: string) => page.evaluate(s => {
  const box = document.querySelector(s + ' .modal-box')!.getBoundingClientRect();
  const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!el && !!el.closest(s);
}, sel);

test.describe('modal layering', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('a showModal opened over the shared dialog is on top and Escape closes it first', async ({ page }) => {
    await page.evaluate(() => { (window as any).__d = 'pending'; UI.showDialog({ title: 'Shared', message: 'm' }).then(r => { (window as any).__d = r; }); });
    await page.evaluate(() => { UI.showModal({ id: 'over', title: 'Over', body: 'x', actions: [{ label: 'Close', onClick: c => c() }] }); });
    expect(await topId(page, '#over-modal')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#over-modal')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__d)).toBe('pending');            // the shared dialog was NOT cancelled
    await expect(page.locator('#dialog-modal')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => (window as any).__d)).toEqual({ button: null, input: undefined });
  });

  test('a shared dialog opened over a showModal is visible on top and Escape closes it first', async ({ page }) => {
    await page.evaluate(() => { UI.showModal({ id: 'under', title: 'Under', body: 'x', actions: [{ label: 'Close', onClick: c => c() }] }); });
    await page.evaluate(() => { (window as any).__d = 'pending'; UI.showDialog({ title: 'Shared', message: 'm' }).then(r => { (window as any).__d = r; }); });
    expect(await topId(page, '#dialog-modal')).toBe(true);                              // RED before: the shared overlay (z 500) hid under the modal (z 600+)
    await page.keyboard.press('Escape');
    await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#under-modal')).toHaveCount(1);                           // the modal below survived the first Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#under-modal')).toHaveCount(0);
  });

  test('the confirm overlay opened over a showModal is on top (one scheme for every overlay)', async ({ page }) => {
    await page.evaluate(() => { UI.showModal({ id: 'under2', title: 'Under', body: 'x', actions: [{ label: 'Close', onClick: c => c() }] }); });
    await page.evaluate(() => { UI.showConfirm('Sure?', 'msg', () => {}); });
    expect(await topId(page, '#confirm-modal')).toBe(true);
  });

  test('Ctrl+N does not open the New Map dialog (invisibly or not) under another modal', async ({ page }) => {
    await page.evaluate(() => { UI.showModal({ id: 'blocker', title: 'Blocker', body: 'x', actions: [{ label: 'Close', onClick: c => c() }] }); });
    await page.keyboard.press('Control+n');
    await expect(page.locator('#newmap-modal')).not.toHaveClass(/open/);
    await page.evaluate(() => { (window as any).__d = 0; UI.showDialog({ title: 'Shared', message: 'm' }); });
    await page.keyboard.press('Control+n');
    await expect(page.locator('#newmap-modal')).not.toHaveClass(/open/);
    // positive control: with nothing open, Ctrl+N does open it
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay.open')).toHaveCount(0);
    await page.keyboard.press('Control+n');
    await expect(page.locator('#newmap-modal')).toHaveClass(/open/);
  });
});

test.describe('shortcuts and the export gate while a modal is open', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Ctrl+Z / Ctrl+Y do nothing while the validator gate is open (and work again afterwards)', async ({ page }) => {
    await page.evaluate(() => {
      History.push('one'); mapData[5 * MAP_WIDTH + 5] = 'Hills_1';
      History.push('two'); mapData[6 * MAP_WIDTH + 6] = 'Hills_1';
      mapData[10 * MAP_WIDTH + 10] = 'Nope_1';
      IO.saveMap();
    });
    await expect(gate(page)).toBeVisible();
    const sizes = () => page.evaluate(() => [History.undoSize(), History.redoSize()]);
    const before = await sizes();
    await page.keyboard.press('Control+z');
    expect(await sizes()).toEqual(before);                                              // undo is inert
    await page.evaluate(() => { History.undo(); });                                       // programmatic undo makes a redo available
    const mid = await sizes();
    expect(mid).toEqual([before[0] - 1, before[1] + 1]);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+y');
    expect(await sizes()).toEqual(mid);                                                 // redo is inert
    await page.evaluate(() => { History.redo(); });
    await gate(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(gate(page)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    expect(await sizes()).toEqual([before[0] - 1, before[1] + 1]);                       // positive control
  });

  test('Ctrl+S while a modal is open does not export', async ({ page }) => {
    await page.evaluate(() => { UI.showModal({ id: 'blocker', title: 'Blocker', body: 'x', actions: [{ label: 'Close', onClick: c => c() }] }); });
    const dl: string[] = []; page.on('download', d => dl.push(d.suggestedFilename()));
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+Shift+s');
    await expect(page.locator('.toast', { hasText: 'Map saved' })).toHaveCount(0);
    await page.locator('#blocker-modal').getByRole('button', { name: 'Close' }).click();
    expect(dl).toEqual([]);
    const [d] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);   // positive control
    expect(d.suggestedFilename()).toMatch(/\.json$/);
  });

  test("an in-place change while the summary is open cancels 'Export anyway'", async ({ page }) => {
    await page.evaluate(() => {
      History.push('paint'); mapData[5 * MAP_WIDTH + 5] = 'Hills_1';
      mapData[10 * MAP_WIDTH + 10] = 'Nope_1';
      IO.saveMap();
    });
    await expect(gate(page)).toBeVisible();
    await page.evaluate(() => { History.undo(); });                       // in place: mapData identity is unchanged
    expect(await page.evaluate(() => mapData[5 * MAP_WIDTH + 5])).not.toBe('Hills_1');
    const dl: string[] = []; page.on('download', d => dl.push(d.suggestedFilename()));
    await gate(page).getByRole('button', { name: 'Export anyway' }).click();
    await expect(page.locator('.toast', { hasText: 'changed while the summary was open' })).toBeVisible();
    await expect(gate(page)).toHaveCount(0);
    expect(dl).toEqual([]);
  });
});
