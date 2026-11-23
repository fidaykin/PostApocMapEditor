import { test, expect } from '@playwright/test';
import { FakeGitHub, openEditor } from './helpers';

// Zero-install: the client has no save yet and needs a map to load on the loading screen. autoLoad on a
// map_list.json entry marks that map. Only one map may be autoLoad at a time — checking one clears any other.

const LIST = { maps: [{ name: 'Alpha', fileName: 'a.json' }, { name: 'Beta', fileName: 'b.json' }] };
const seed = (gh: FakeGitHub) => { gh.setJson('maps/map_list.json', LIST); gh.write('maps/a.json', '{}'); gh.write('maps/b.json', '{}'); };
const setAutoLoad = async (page: any, file: string) =>
  page.evaluate((f: string) => GitHubSync._cmSetAutoLoadMap(f), file);
const maps = (gh: FakeGitHub) => gh.json('maps/map_list.json').maps;

test('checking a map sets autoLoad on it and leaves the other map untouched', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  await setAutoLoad(page, 'a.json');
  await expect.poll(() => maps(gh).find((m: any) => m.fileName === 'a.json')?.autoLoad).toBe(true);
  expect(maps(gh).find((m: any) => m.fileName === 'b.json')?.autoLoad).toBeFalsy();
});

test('checking a second map clears autoLoad on the first — only one at a time', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  await setAutoLoad(page, 'a.json');
  await expect.poll(() => maps(gh).find((m: any) => m.fileName === 'a.json')?.autoLoad).toBe(true);
  await setAutoLoad(page, 'b.json');
  await expect.poll(() => maps(gh).find((m: any) => m.fileName === 'b.json')?.autoLoad).toBe(true);
  expect(maps(gh).find((m: any) => m.fileName === 'a.json')?.autoLoad).toBeFalsy();
});

test('checking an already-autoLoad map clears it (toggle off)', async ({ page }) => {
  const gh = new FakeGitHub(); seed(gh);
  await openEditor(page, { gh, pat: true });
  await setAutoLoad(page, 'a.json');
  await expect.poll(() => maps(gh).find((m: any) => m.fileName === 'a.json')?.autoLoad).toBe(true);
  await setAutoLoad(page, 'a.json');
  await expect.poll(() => maps(gh).find((m: any) => m.fileName === 'a.json')?.autoLoad).toBeFalsy();
});

// Maps and their autoLoad flag are global (map_list.json at the repo root), not scoped to any content package — unlike
// sprite upload, which writes into the active package's own folder. The Content Manager's Maps row buttons must not
// require the base "postapoc" package to be active (they used to, by reusing the sprite-upload gate: ClickUp-less bug
// found by the owner — "так є але я натис зірочку а вона лишилася в тому ж стані" led to tracing it to the wrong gate).
test('the auto-load star and delete buttons show for maps even when a non-default package is active', async ({ page }) => {
  const gh = new FakeGitHub(); gh.setRegistry([{ id: 'hs', name: 'HS' }]); seed(gh);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => Packages.setActive('hs'));
  await page.evaluate(() => GitHubSync.openContentManager());
  const row = page.locator('[data-cm-id="map-a.json"]');
  await expect(row.locator('button[onclick*="_cmSetAutoLoadMap"]')).toBeVisible();
  await expect(row.locator('button[onclick*="_cmDeleteMap"]')).toBeVisible();
});
