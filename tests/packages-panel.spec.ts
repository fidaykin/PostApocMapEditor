import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub, hexRec, bldRec, seedHexes, seedBuildings } from './helpers';


async function openTab(page: any, opts: { pat?: boolean; registry?: any[] } = {}) {
  const gh = new FakeGitHub();
  if (opts.registry) gh.setRegistry(opts.registry);
  await openEditor(page, { gh, pat: opts.pat ?? true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  if (opts.registry) await page.waitForFunction((n: number) => Packages.getAll().length >= n, opts.registry.length + 1);
  await page.click('#tab-packages');
  return gh;
}

test('empty state, help text and game notice; the packages PDF guide is not linked', async ({ page }) => {
  await openTab(page);
  await expect(page.locator('#pkg-help')).toContainText('content package');
  await expect(page.locator('#pkg-empty')).toContainText('No custom packages yet');
  await expect(page.locator('#pkg-game-notice')).toContainText('only after they are unlocked');
  await expect(page.locator('#pkg-guide-link')).toHaveCount(0);
  await expect(page.locator('#pkg-help a')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes('content-packages-editor-guide'))).toBe(false);
});

test('token warning shows without a token and is gone with one', async ({ page }) => {
  await openTab(page, { pat: false });
  await expect(page.locator('#pkg-pat-warn')).toContainText('GitHub token');
  await page.evaluate(() => GitHubSync.setPAT('t'));
  await page.evaluate(() => Packages.renderPanel());
  await expect(page.locator('#pkg-pat-warn')).toHaveCount(0);
});

test('rows show entry counts, tooltips and move the active marker', async ({ page }) => {
  await openTab(page, { registry: [{ id: 'medieval', name: 'Medieval Kingdom' }] });
  await seedHexes(page, [hexRec('Med_A', 'medieval'), hexRec('Med_B', 'medieval')]);
  await seedBuildings(page, [bldRec('Med_X', 'medieval')]);
  await page.evaluate(() => Packages.renderPanel());
  const row = page.locator('tr[data-pkg="medieval"]');
  await expect(row.locator('.pkg-hex-count')).toHaveText('2');
  await expect(row.locator('.pkg-bld-count')).toHaveText('1');
  await expect(page.locator('#pkg-empty')).toHaveCount(0);
  await expect(page.locator('tr[data-pkg="postapoc"] .pkg-active-dot')).toBeVisible();
  await expect(row.locator('.pkg-active-dot')).toHaveCount(0);
  const postHex = await page.evaluate(() => HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === 'postapoc').length);
  await expect(page.locator('tr[data-pkg="postapoc"] .pkg-hex-count')).toHaveText(String(postHex));
  await row.locator('.pkg-set-active').click();
  await expect(row.locator('.pkg-active-dot')).toBeVisible();
  await expect(page.locator('tr[data-pkg="postapoc"] .pkg-active-dot')).toHaveCount(0);
  expect(await page.evaluate(() => Packages.getActive())).toBe('medieval');
  for (const name of [/Export/, /Publish/, /Delete/]) await expect(row.getByRole('button', { name })).toHaveAttribute('title', /.{8,}/);
  await expect(page.getByRole('button', { name: /New Package/ })).toHaveAttribute('title', /.{8,}/);
  await expect(page.getByRole('button', { name: /Import Package/ })).toHaveAttribute('title', /.{8,}/);
});

test('package data is rendered as text, never as markup', async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await openTab(page, { registry: [{ id: 'evil', name: evil }] });
  await page.evaluate(() => Packages.renderPanel());
  await expect(page.locator('tr[data-pkg="evil"]')).toContainText(evil);
  expect(await page.locator('#pkg-panel img').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('the trash and restore UI from Phase 0 is still in the panel', async ({ page }) => {
  await openTab(page, { registry: [{ id: 'delpkg', name: 'Del Pkg' }] });
  await seedHexes(page, [hexRec('Delpkg_H', 'delpkg')]);
  await page.evaluate(() => Packages.renderPanel());
  await page.locator('tr[data-pkg="delpkg"]').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete and remove entries' }).click();
  await expect(page.locator('tr[data-pkg="delpkg"]')).toHaveCount(0);
  await expect(page.locator('#pkg-panel [data-trash-act="restore"][data-id="delpkg"]')).toBeVisible();
});
