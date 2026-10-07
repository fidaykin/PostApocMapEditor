import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

test('showDialog resolves with the clicked button and the input value', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__r = UI.showDialog({
      title: 'Name it', message: 'Pick a name', details: 'line1\nline2',
      input: { value: 'abc' },
      buttons: [{ label: 'Cancel', value: 'cancel', kind: 'cancel' }, { label: 'Save', value: 'save', kind: 'primary' }],
    });
  });
  await expect(page.locator('#dialog-modal')).toHaveClass(/open/);
  await expect(page.locator('#dialog-title')).toHaveText('Name it');
  await expect(page.locator('#dialog-details')).toHaveText('line1\nline2');
  await page.fill('#dialog-input', 'xyz');
  await page.locator('#dialog-actions').getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => (window as any).__r)).toEqual({ button: 'save', input: 'xyz' });
  await expect(page.locator('#dialog-modal')).not.toHaveClass(/open/);
});

test('UI.prompt returns null on Escape and the select value for options', async ({ page }) => {
  await page.evaluate(() => { (window as any).__p = UI.prompt('Reskin', 'Pick', 'b', ['a', 'b', 'c']); });
  await page.locator('#dialog-input').selectOption('c');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__p)).toBe('c');

  await page.evaluate(() => { (window as any).__p2 = UI.prompt('Name', 'Type', 'x'); });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__p2)).toBeNull();
});

test('UI.confirm resolves true only for OK; UI.alert resolves on OK', async ({ page }) => {
  await page.evaluate(() => { (window as any).__c = UI.confirm('Sure?', 'Really', 'detail', 'Do it'); });
  await page.getByRole('button', { name: 'Do it' }).click();
  expect(await page.evaluate(() => (window as any).__c)).toBe(true);
  await page.evaluate(() => { (window as any).__c = UI.confirm('Sure?', 'Really'); });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => (window as any).__c)).toBe(false);
  await page.evaluate(() => { (window as any).__a = UI.alert('Oops', 'It broke', 'stack'); });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.evaluate(() => (window as any).__a);
});

test('toast shows detail and sticky toasts survive until clicked', async ({ page }) => {
  await page.evaluate(() => UI.toast('Saved', { detail: 'extra line', sticky: true }));
  const t = page.locator('.toast.sticky');
  await expect(t).toContainText('Saved');
  await expect(t.locator('.toast-detail')).toHaveText('extra line');
  await page.waitForTimeout(2600);
  await expect(t).toBeVisible();
  await t.click();
  await expect(t).toHaveCount(0);
});
