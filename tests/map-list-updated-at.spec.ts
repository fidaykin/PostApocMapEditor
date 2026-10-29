import { test, expect } from '@playwright/test';
import { FakeGitHub, openEditor } from './helpers';

// Publish Map writes updatedAt (full ISO time) beside uploadedTime (the date) so the game can tell a republished map.

test('Publish Map records updatedAt in map_list.json', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  const before = Date.now();
  await page.evaluate(() => { GitHubSync.publishMap(); });
  await page.fill('#dialog-input', 'my_map');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => gh.writeLog.some(w => w.path === 'maps/map_list.json')).toBe(true);

  const list = JSON.parse(gh.read('maps/map_list.json')!.toString());
  const entry = list.maps.find((m: any) => m.fileName === 'my_map.json');
  expect(entry).toBeTruthy();
  expect(entry.uploadedTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Date.parse(entry.updatedAt)).toBeGreaterThanOrEqual(before - 1000);
  expect(entry.updatedAt.startsWith(entry.uploadedTime)).toBe(true);
});

test('republishing a map moves updatedAt forward and keeps one entry', async ({ page }) => {
  const gh = new FakeGitHub();
  await openEditor(page, { gh, pat: true });
  const publish = async () => {
    const n = gh.writeLog.filter(w => w.path === 'maps/map_list.json').length;
    await page.evaluate(() => { GitHubSync.publishMap(); });
    await page.fill('#dialog-input', 'my_map');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect.poll(() => gh.writeLog.filter(w => w.path === 'maps/map_list.json').length).toBe(n + 1);
    return JSON.parse(gh.read('maps/map_list.json')!.toString()).maps.filter((m: any) => m.fileName === 'my_map.json');
  };
  const first = await publish();
  await page.waitForTimeout(20);
  const second = await publish();
  expect(second).toHaveLength(1);
  expect(Date.parse(second[0].updatedAt)).toBeGreaterThan(Date.parse(first[0].updatedAt));
});
