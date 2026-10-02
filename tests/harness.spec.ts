import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

test('editor loads with its modules, a 30x30 map and no native dialogs', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  const info = await page.evaluate(() => ({
    hex: HexDB.getAll().length,
    bld: BldDB.getAll().length,
    w: MAP_WIDTH, h: MAP_HEIGHT, cells: mapData.length,
    io: typeof IO.loadFromJSON,
  }));
  expect(info.hex).toBeGreaterThan(50);
  expect(info.bld).toBeGreaterThan(0);
  expect([info.w, info.h, info.cells]).toEqual([30, 30, 900]);
  expect(info.io).toBe('function');
  expect(nativeDialogs).toEqual([]);
});

test('FakeGitHub serves repo files and records PUTs', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.setRegistry([{ id: 'demo', name: 'Demo' }]);
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('demo'));
  await page.evaluate(() => GitHubSync._putText('packages/demo/package.json', '{"id":"demo"}', 'test'));
  expect(gh.putPaths()).toEqual(['packages/demo/package.json']);
  expect(gh.json('packages/demo/package.json')).toEqual({ id: 'demo' });
});
