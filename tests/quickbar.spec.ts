import { test, expect } from '@playwright/test';
import { freshEditor, dragCells, idAt } from './editor-helpers';

// Quick bar over the canvas: tool, brush size and style presets (a second control for what the left panel holds).

test.describe('quick bar', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); await page.evaluate(() => QuickBar.open()); });   // the bar auto-hides: the specs below use it open

  test('tool buttons switch the tool and stay in step with the left panel', async ({ page }) => {
    await page.click('#quickbar [data-qtool="eraser"]');
    expect(await page.evaluate(() => Tools.getActive())).toBe('eraser');
    await expect(page.locator('#quickbar [data-qtool="eraser"]')).toHaveClass(/active/);
    await expect(page.locator('.tool-btn[data-tool="eraser"]')).toHaveClass(/active/);
    await page.evaluate(() => Tools.setActive('scatter'));                    // changed elsewhere: the bar follows
    await expect(page.locator('#quickbar [data-qtool="scatter"]')).toHaveClass(/active/);
    await expect(page.locator('#quickbar [data-qtool="eraser"]')).not.toHaveClass(/active/);
  });

  test('size buttons, the slider and the bracket keys all move the same radius, clamped to 0..12', async ({ page }) => {
    await page.click('#qb-larger');
    await page.click('#qb-larger');
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    await expect(page.locator('#qb-size')).toHaveText('2');
    await page.evaluate(() => Brush.setSize(5));                              // the slider / 3x3 buttons path
    await expect(page.locator('#qb-size')).toHaveText('5');
    await page.keyboard.press(']');
    await expect(page.locator('#qb-size')).toHaveText('6');
    await page.evaluate(() => Brush.setSize(0));
    await page.click('#qb-smaller');
    expect(await page.evaluate(() => Brush.getSize())).toBe(0);
    await page.evaluate(() => Brush.setSize(12));
    await page.click('#qb-larger');
    expect(await page.evaluate(() => Brush.getSize())).toBe(12);
  });

  test('Alt + wheel changes the radius and does not zoom; a plain wheel still zooms', async ({ page }) => {
    const box = (await page.locator('#map-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const z0 = await page.evaluate(() => Canvas.getZoom());
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, -100);                                          // wheel up = larger
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Alt');
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    expect(await page.evaluate(() => Canvas.getZoom())).toBe(z0);
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Alt');
    expect(await page.evaluate(() => Brush.getSize())).toBe(1);
    await page.mouse.wheel(0, -100);
    expect(await page.evaluate(() => Canvas.getZoom())).not.toBe(z0);
  });

  test('built-in presets apply tool, size, symmetry and density; the select shows the matching one', async ({ page }) => {
    await page.selectOption('#qb-preset', 'b:scatter');
    const r = await page.evaluate(() => ({ tool: Tools.getActive(), size: Brush.getSize(), d: (document.getElementById('scatter-density') as HTMLInputElement).value }));
    expect(r).toEqual({ tool: 'scatter', size: 2, d: '30' });
    await expect(page.locator('#qb-preset')).toHaveValue('b:scatter');
    await page.evaluate(() => Brush.setSize(7));                              // no preset matches any more
    await expect(page.locator('#qb-preset')).toHaveValue('');
    await page.selectOption('#qb-preset', 'b:wide');
    expect(await page.evaluate(() => [Tools.getActive(), Brush.getSize()])).toEqual(['paint', 3]);
  });

  test('a custom preset is saved with its symmetry, stored in localStorage and can be deleted; built-ins cannot be overwritten', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('paint'); Brush.setSize(4); Tools.setSymmetry('rot6'); });
    await page.click('#qb-save');
    await page.fill('#qb-name', 'Mine');
    await page.press('#qb-name', 'Enter');
    await expect(page.locator('#qb-preset')).toHaveValue('c:mine');
    await expect(page.locator('#qb-name')).toBeHidden();
    await page.evaluate(() => { Brush.setSize(0); Tools.setSymmetry('none'); });
    await page.selectOption('#qb-preset', 'c:mine');
    expect(await page.evaluate(() => [Brush.getSize(), Tools.getSymmetry()])).toEqual([4, 'rot6']);

    await page.click('#qb-save');                                             // a built-in name is refused
    await page.fill('#qb-name', 'wide');
    await page.press('#qb-name', 'Enter');
    expect(await page.evaluate(() => QuickBar.presets().filter((p: any) => p.name.toLowerCase() === 'wide').length)).toBe(1);
    await page.press('#qb-name', 'Escape');
    await expect(page.locator('#qb-name')).toBeHidden();

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quickbar_presets_v1')!).map((p: any) => p.name))).toEqual(['Mine']);
    await page.click('#qb-delete');
    expect(await page.evaluate(() => QuickBar.presets().length)).toBe(await page.evaluate(() => QuickBar.builtinCount()));
    await expect(page.locator('#qb-delete')).toBeDisabled();
  });

  test('a tool, size or preset change is refused while a stroke is running', async ({ page }) => {
    await page.evaluate(() => { Tools.setActive('eraser'); });
    // an erase stroke in flight: the press is down and the stroke flag is set until the mouse is released
    const p = await page.evaluate(() => { const b = (document.getElementById('map-canvas') as HTMLCanvasElement).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 + 80 }; });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
    await page.evaluate(() => QuickBar.setTool('paint'));
    await page.evaluate(() => QuickBar.step(1));
    await page.evaluate(() => QuickBar.applyPreset('b:wide'));
    expect(await page.evaluate(() => [Tools.getActive(), Brush.getSize()])).toEqual(['eraser', 0]);
    await page.mouse.up();
    await page.evaluate(() => QuickBar.setTool('paint'));
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  });

  test('painting with a preset writes the map like the left panel does', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await page.selectOption('#qb-preset', 'b:wide');                          // radius 3
    await dragCells(page, { col: 225, row: 230 }, { col: 225, row: 230 });
    expect(await idAt(page, 225, 230)).toBe('Water_1');
    expect(await idAt(page, 227, 230)).toBe('Water_1');                       // inside radius 3
    expect(await idAt(page, 225, 240)).not.toBe('Water_1');
  });

  test('the canvas keeps its size and a cell under the closed bar stays clickable', async ({ page }) => {
    const size = () => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.width, c.height]; });
    const w = await size();
    await page.evaluate(() => { document.getElementById('quickbar')!.classList.remove('qb-open'); });
    expect(await size()).toEqual(w);
    const top = await page.evaluate(() => { const b = document.getElementById('map-canvas')!.getBoundingClientRect(); return [b.left + b.width / 2, b.top + 20]; });
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.id, top)).toBe('map-canvas');   // closed: nothing covers the top rows
    await page.evaluate(() => QuickBar.open());
    expect(await size()).toEqual(w);
  });

  test('the bar opens at the top edge, closes when the pointer leaves, and stays closed while a button is held', async ({ page }) => {
    await page.evaluate(() => { document.getElementById('quickbar')!.classList.remove('qb-open'); });
    await expect(page.locator('#quickbar')).toBeHidden();
    const b = (await page.locator('#canvas-container').boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 3);                         // a stroke passing the top edge does not open it
    await page.mouse.up();
    await expect(page.locator('#quickbar')).toBeHidden();
    await page.mouse.move(b.x + b.width / 2, b.y + 4);                         // pointer at the top edge, no button
    await expect(page.locator('#quickbar')).toBeVisible();
    await page.mouse.move(b.x + b.width / 2, b.y + 400);
    await expect(page.locator('#quickbar')).toBeHidden();
  });

  test('the bar is hidden outside the MAP mode', async ({ page }) => {
    await expect(page.locator('#quickbar')).toBeVisible();
    await page.evaluate(() => App.setMode('hexdb'));
    await expect(page.locator('#quickbar')).toBeHidden();
  });
});
