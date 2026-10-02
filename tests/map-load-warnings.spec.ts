import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

test('analyzeMap (pure) reports clamp, missing packages and unknown ids with counts', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => IO.analyzeMap(
    { width: 600, height: 5, packages: ['postapoc', 'ghostpack'],
      data: [['Plain_1', 'Ghost_Tile_9'], ['Ghost_Tile_9', 'Plain_1']],
      objects: [{ col: 0, row: 0, id: 'Ghost_Bld' }] },
    { registryIds: ['postapoc'], knownIds: ['plain_1'] }));
  expect(r.clamped).toEqual({ from: [600, 5], to: [450, 10] });
  expect(r.missingPackages).toEqual(['ghostpack']);
  expect(r.unknownCount).toBe(3);
  expect(r.unknownIds).toEqual(['Ghost_Tile_9 ×2', 'Ghost_Bld ×1']);
});

test('analyzeMap skips the tile check for legacy integer maps', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => IO.analyzeMap(
    { width: 20, height: 20, data: [[0, 3], [9, 12]] }, { registryIds: ['postapoc'], knownIds: [] }));
  expect(r.unknownCount).toBe(0);
});

test('analyzeMap tolerates malformed input without throwing or mutating the map', async ({ page }) => {
  await openEditor(page);
  const out = await page.evaluate(() => {
    const ctx = { registryIds: ['postapoc'], knownIds: ['plain_1'] };
    const bad = { width: 20, height: 20, packages: 'ghostpack', objects: 'x',
      data: [['Plain_1', 7, { a: 1 }, null, '', 0, 'Plain_1'], 'notarow', null] };
    const before = JSON.stringify(bad);
    const a = IO.analyzeMap(bad, ctx);
    return { a, same: JSON.stringify(bad) === before,
      empty: IO.analyzeMap({ width: 20, height: 20, data: [] }, ctx),
      noObj: IO.analyzeMap(null, ctx),
      pk: IO.analyzeMap({ width: 20, height: 20, data: [], packages: ['Ghost', 'ghost', 42, 'POSTAPOC'] }, ctx),
      nullObj: IO.analyzeMap({ width: 20, height: 20, data: [], objects: [null, {}, { id: 'X_1' }] }, ctx) };
  });
  expect(out.same).toBe(true);
  expect(out.a.missingPackages).toEqual([]);                 // non-array packages is ignored
  expect(out.a.unknownIds).toEqual(['7 ×1', '{"a":1} ×1']);   // non-string ids reported; falsy ones are not ids
  expect(out.empty).toEqual({ clamped: null, missingPackages: [], unknownIds: [], unknownCount: 0 });
  expect(out.noObj.unknownCount).toBe(0);
  expect(out.pk.missingPackages).toEqual(['Ghost', '42']);    // deduped case-insensitively
  expect(out.nullObj.unknownIds).toEqual(['X_1 ×1']);
});

test('loading a 600x600 map with a ghost package and tile warns in a dialog', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => IO.loadFromJSON(
    { width: 600, height: 600, packages: ['postapoc', 'ghostpack'], data: [['Plain_1', 'Ghost_Tile_9']] }));
  const dlg = page.locator('#dialog-modal');
  await expect(dlg).toHaveClass(/open/);
  await expect(page.locator('#dialog-title')).toHaveText('Map loaded with warnings');
  await expect(page.locator('#dialog-msg')).toContainText('600×600');
  await expect(page.locator('#dialog-msg')).toContainText('450×450');
  await expect(page.locator('#dialog-msg')).toContainText('ghostpack');
  await expect(page.locator('#dialog-details')).toContainText('Ghost_Tile_9 ×1');
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([450, 450]);
});

test('a failing analysis still loads the map and surfaces a sticky toast', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { HexDB.getAll = () => []; BldDB.getAll = () => []; });
  await page.evaluate(() => IO.loadFromJSON({ width: 30, height: 30, data: [['Plain_1']] }));
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([30, 30]);
  const t = page.locator('.toast.sticky');
  await expect(t).toContainText('could not be checked');
  await expect(t.locator('.toast-detail')).toContainText('not available');
});

test('a real clean map and a map saved by the editor load without a dialog', async ({ page }) => {
  await openEditor(page);
  const clean = new FakeGitHub().json('maps/current_map.json');
  await page.evaluate(m => IO.loadFromJSON(m), clean);
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  await expect(page.locator('.toast.sticky')).toHaveCount(0);
  await page.evaluate(() => IO.loadFromJSON(JSON.parse(IO.getMapJson())));
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  await expect(page.locator('.toast.sticky')).toHaveCount(0);
});

test('a legacy integer map loads without an unknown-id dialog', async ({ page }) => {
  await openEditor(page);
  const legacy = new FakeGitHub().json('maps/current_map_02.json');
  test.skip(!legacy, 'no legacy sample map');
  await page.evaluate(m => IO.loadFromJSON(m), legacy);
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  await expect(page.locator('.toast.sticky')).toHaveCount(0);
});
