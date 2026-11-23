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
