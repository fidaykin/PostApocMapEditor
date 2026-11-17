import { test, expect } from '@playwright/test';
import { openEditor, FakeGitHub } from './helpers';

// Pattern brush tool (pattern-brush.js + Tools): paints a map fragment tiled on the map grid; one stroke = one Undo step.

const gh = () => new FakeGitHub();


test('the tool is registered, writes the terrain layer and is a brush and symmetry tool', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  const t = await page.evaluate(() => Tools.toolLayers());
  expect(t.map.pattern).toBe('terrain');
  expect(t.registered).toContain('pattern');
  await expect(page.locator('[data-tool="pattern"]')).toHaveCount(1);
});

test('paintPattern tiles the pattern on the map grid (same cell, same tile, whenever painted) and a second pass changes nothing', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  const r = await page.evaluate(() => {
    const ids = ['Plain_1', 'Forest_1', 'Water_1', 'Hills_1'];
    Tools.setPattern(PatternBrush.makePattern(2, 2, ids, 'p'));
    const cells = []; for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) cells.push({ col, row });
    const n = Tools.paintPattern(cells);
    const at = (c: number, rw: number) => mapData[rw * MAP_WIDTH + c];
    const first = [at(0, 0), at(1, 0), at(0, 1), at(1, 1), at(2, 0), at(3, 3)];
    const before = mapData.slice();
    Tools.paintPattern([{ col: 3, row: 3 }]);
    return { n, first, same: before.every((v: any, i: number) => v === mapData[i]) };
  });
  expect(r.n).toBe(16);
  expect(r.first).toEqual(['Plain_1', 'Forest_1', 'Water_1', 'Hills_1', 'Plain_1', 'Hills_1']);
  expect(r.same).toBe(true);
});

test('skip ids are not drawn and the offset shifts the pattern', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  const r = await page.evaluate(() => {
    Tools.setPattern(PatternBrush.makePattern(2, 1, ['Forest_1', 'Water_1'], 'p'));
    const before = mapData[0];
    const cells = [{ col: 0, row: 0 }, { col: 1, row: 0 }];
    const skipped = Tools.patternCells(cells, { skip: ['water_1'] }).map((c: any) => c.id);
    const shifted = Tools.patternCells(cells, { ox: 1 }).map((c: any) => c.id);
    return { skipped, shifted, before };
  });
  expect(r.skipped).toEqual(['Forest_1']);
  expect(r.shifted).toEqual(['Water_1', 'Forest_1']);
});

test('a stroke on the canvas needs a pattern; with one it paints and one Undo takes the whole stroke back', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  await page.evaluate(() => { Tools.setPattern(PatternBrush.makePattern(2, 2, ['Forest_1', 'Forest_1', 'Forest_1', 'Forest_1'], 'f')); Brush.setSize(1); Tools.setActive('pattern'); });
  const before = await page.evaluate(() => mapData.slice(0, 2000).join('|'));
  const box = await page.locator('#map-canvas, canvas').first().boundingBox();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 10, { steps: 6 }); await page.mouse.up();
  const painted = await page.evaluate(() => mapData.filter((v: any) => v === 'Forest_1').length);
  expect(painted).toBeGreaterThan(7);
  await page.evaluate(() => History.undo());
  expect(await page.evaluate(() => mapData.slice(0, 2000).join('|'))).toBe(before);
});

test('without a pattern a press only explains what to do and writes nothing', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  await page.evaluate(() => { Tools.setPattern(null); Tools.setActive('pattern'); });
  const before = await page.evaluate(() => mapData.join('|').length);
  const box = await page.locator('#map-canvas, canvas').first().boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator('body')).toContainText('choose a pattern first');
  expect(await page.evaluate(() => mapData.join('|').length)).toBe(before);
});

test('the selection becomes a pattern', async ({ page }) => {
  await openEditor(page, { gh: gh(), pat: true });
  const r = await page.evaluate(async () => {
    mapData[0] = 'Forest_1'; mapData[1] = 'Water_1';
    Selection.setCells([{ col: 0, row: 0 }, { col: 1, row: 0 }]);
    await Tools.patternFromSelection();
    const p = Tools.getPattern();
    return { w: p.w, h: p.h, ids: p.ids };
  });
  expect(r).toEqual({ w: 2, h: 1, ids: ['Forest_1', 'Water_1'] });
});
