import { test, expect } from '@playwright/test';
import { FakeGitHub, openEditor } from './helpers';

// ClickUp 869fpymm6: maps deleted in the Content Manager came back after a publish / Refresh, and non-ASCII names turned into
// mojibake. The list is now read through the Contents API (UTF-8 decoded), never from the lagging Pages CDN.

const LIST = { maps: [{ name: 'Карта Á', fileName: 'a.json' }, { name: 'Друга', fileName: 'b.json' }] };
const seed = (gh: FakeGitHub) => { gh.setJson('maps/map_list.json', LIST); gh.write('maps/a.json', '{}'); gh.write('maps/b.json', '{}'); };
const del = async (page: any, file: string, name: string) => {
  // the helpers dismiss native dialogs, so the confirm is answered in the page
  await page.evaluate(([f, n]: string[]) => { window.confirm = () => true; return GitHubSync._cmDeleteMap(f, n); }, [file, name]);
};
const names = (gh: FakeGitHub) => gh.json('maps/map_list.json').maps.map((m: any) => m.name);

test('delete keeps the other names intact (UTF-8) and removes only the deleted map', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  await del(page, 'a.json', 'Карта Á');
  await expect.poll(() => names(gh)).toEqual(['Друга']);
});

test('a publish right after a delete does not bring the deleted map back (Pages CDN still stale)', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  gh.pagesLag = true;                                  // the CDN keeps serving the list from before the delete
  await del(page, 'a.json', 'Карта Á');
  await expect.poll(() => names(gh)).toEqual(['Друга']);
  await page.evaluate(() => { GitHubSync.publishMap(); });
  await page.fill('#dialog-input', 'new_map');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => names(gh).includes('new_map')).toBe(true);
  expect(names(gh)).toEqual(['Друга', 'new_map']);
});

test('a failed read of map_list.json aborts the delete instead of writing an empty list', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  gh.failGet = p => p === 'maps/map_list.json';
  await del(page, 'a.json', 'Карта Á');
  await page.waitForTimeout(500);
  expect(gh.writeLog.some(w => w.path === 'maps/map_list.json')).toBe(false);
  expect(names(gh)).toEqual(['Карта Á', 'Друга']);
});
