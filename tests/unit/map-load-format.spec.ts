// T6.3: IO.loadFromJSON validates with MapFormat before touching any state, folds the format warnings into the ONE
// "Map loaded with warnings" dialog (together with IO.analyzeMap's), and IO._buildJson stamps MapFormat's version.
import { test, expect } from '@playwright/test';
import { openEditor } from '../helpers';
import '../editor-globals.d';

declare const MapFormat: any;
const grid = (n: number, id = 'Plain_1') => Array.from({ length: n }, () => new Array(n).fill(id));
const dialogMsg = (page: any) => page.locator('#dialog-msg');

test('an unusable map (null entry in a list) is rejected before any state changes', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { mapData[0] = 'Sentinel_1'; });
  await page.evaluate(g => IO.loadFromJSON({ width: 12, height: 12, data: g, objects: [null] }), grid(12));
  await expect(page.locator('#dialog-title')).toHaveText('Failed to load map');
  await expect(page.locator('#dialog-msg')).toContainText('empty entry');
  // positive control: the loader really would have replaced the map (30x30 -> 12x12) had it been accepted
  expect(await page.evaluate(() => [mapData[0], MAP_WIDTH, MAP_HEIGHT])).toEqual(['Sentinel_1', 30, 30]);
});

test('a map from a newer editor still loads and says so in the one warnings dialog', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(g => IO.loadFromJSON({ version: 99, width: 12, height: 12, data: g }), grid(12));
  expect(await page.evaluate(() => MAP_WIDTH)).toBe(12);
  await expect(page.locator('#dialog-title')).toHaveText('Map loaded with warnings');
  await expect(dialogMsg(page)).toContainText('saved by a newer version of the editor');
});

test('a clean versionless old map loads silently (no nagging)', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(g => IO.loadFromJSON({ width: 30, height: 30, data: g, settlements: [] }), grid(30));
  expect(await page.evaluate(() => MAP_WIDTH)).toBe(30);
  await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  await expect(page.locator('.toast.sticky')).toHaveCount(0);
});

test('format and analyzeMap warnings merge into ONE dialog; the clamp is reported once', async ({ page }) => {
  await openEditor(page);
  const n = await page.evaluate(g => {
    const seen: string[] = [];
    const orig = UI.showDialog;
    UI.showDialog = (o: any) => { seen.push(o.title); return orig(o); };
    IO.loadFromJSON({ width: 600, height: 600, packages: ['postapoc', 'ghostpack'], data: [['Plain_1', 'Ghost_Tile_9']],
      settlements: [{ col: 999, row: 999, type: 'settlement' }] });
    UI.showDialog = orig;
    return seen;
  }, null);
  expect(n).toEqual(['Map loaded with warnings']);
  const msg = (await dialogMsg(page).textContent()) || '';
  expect(msg).toContain('ghostpack');                         // analyzeMap
  expect(msg).toContain('lie outside the map');               // MapFormat
  expect(msg).toContain('450×450');
  expect(msg).not.toContain('10-450');                        // MapFormat's own size warning is folded into analyzeMap's
  expect(msg.split('no version field').length - 1).toBe(1);   // the versionless note rides along once (this map has other news)
  expect(msg.split('supported 10–450').length - 1).toBe(1);
  await expect(page.locator('#dialog-details')).toContainText('Ghost_Tile_9 ×1');
});

test('when something else is reported, a versionless map gets one quiet note', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(g => IO.loadFromJSON({ width: 30, height: 30, data: g, packages: ['ghostpack'] }), grid(30));
  await expect(dialogMsg(page)).toContainText('ghostpack');
  await expect(dialogMsg(page)).toContainText('no version field');
});

test('text width/height is reported as text, not as a bogus clamp', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(g => IO.loadFromJSON({ version: 2, width: '30', height: '30', data: g }), grid(30));
  expect(await page.evaluate(() => MAP_WIDTH)).toBe(30);
  await expect(dialogMsg(page)).toContainText('stored as text');
  await expect(dialogMsg(page)).not.toContainText('supported 10');
});

test('saved maps carry MapFormat.CURRENT_VERSION (the stamp comes from MapFormat)', async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => MapFormat.CURRENT_VERSION)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(IO.getMapJson()).version)).toBe(2);
  // independent of the literal: stamp() is what writes the number, as the first key
  const r = await page.evaluate(() => {
    const orig = MapFormat.stamp;
    MapFormat.stamp = (o: any) => ({ ...orig(o), version: 77 });
    const j = IO.getMapJson(); MapFormat.stamp = orig;
    return JSON.parse(j).version;
  });
  expect(r).toBe(77);
  expect(await page.evaluate(() => Object.keys(JSON.parse(IO.getMapJson()))[0])).toBe('version');
});

test('autosave restore refuses an unusable map and leaves the current one', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { mapData[0] = 'Sentinel_1'; });
  const ok = await page.evaluate(g => IO.tryRestoreAutosave(JSON.stringify({ width: 12, height: 12, data: g.map(() => 'PPPPPPPPPPPP') })), grid(12));   // string rows: ungated, the loader would take them as garbage
  expect(ok).toBe(false);
  expect(await page.evaluate(() => [mapData[0], MAP_WIDTH])).toEqual(['Sentinel_1', 30]);
});
