import { Page } from '@playwright/test';
import { openEditor } from './helpers';

export type Cell = { col: number; row: number };

/** Opens the editor on a blank 450x450 map, city centred on screen, Paint tool, brush radius 0. */
export async function freshEditor(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openEditor(page);
  await page.waitForFunction(() => HexDB.getAll().length > 0 && BldDB.getAll().length > 0);
  await page.evaluate(() => {
    IO.newMap(true);                              // silent: blank 450x450 map, city at centre
    window.dispatchEvent(new Event('resize'));
    UI.selectTerrain('Plain_1');
    Tools.setActive('paint');
    Brush.setSize(0);
    Canvas.centerOnCity();                        // also renders
  });
}

/** Page coordinates of a cell centre (the city cell, col 225 row 224, is near the canvas centre). */
export async function cellPoint(page: Page, col: number, row: number) {
  return page.evaluate(([c, r]) => {
    const p = Canvas.hexScreenPos(c, r);
    const b = document.getElementById('map-canvas')!.getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y };
  }, [col, row]);
}

export async function clickCell(page: Page, col: number, row: number) {
  const p = await cellPoint(page, col, row);
  await page.mouse.click(p.x, p.y);
}

export async function dragCells(page: Page, a: Cell, b: Cell, opts: { shift?: boolean; alt?: boolean } = {}) {
  const pa = await cellPoint(page, a.col, a.row);
  const pb = await cellPoint(page, b.col, b.row);
  if (opts.shift) await page.keyboard.down('Shift');
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 4 });
  await page.mouse.move(pb.x, pb.y, { steps: 4 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
  if (opts.shift) await page.keyboard.up('Shift');
}

export async function idAt(page: Page, col: number, row: number): Promise<string> {
  return page.evaluate(([c, r]) => mapData[r * MAP_WIDTH + c], [col, row]);
}
