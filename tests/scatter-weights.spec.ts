import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Scatter weights: `scatterWeight` on a Hex DB record (default 1, 0 = never) weights the variant roll of the Scatter tool.

const SEEDED = `(seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }`;

test.describe('scatter weights', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('scatterPick: no weights, equal weights and a missing weights array give identical picks for a seed', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      const seeded = eval(mk as string);
      const cells = HexUtils.discCells(225, 224, 8, MAP_WIDTH, MAP_HEIGHT);
      const ids = ['A', 'B', 'C'];
      const base = JSON.stringify(HexUtils.scatterPick(cells, ids, 60, seeded(5)));
      return { equal: JSON.stringify(HexUtils.scatterPick(cells, ids, 60, seeded(5), [1, 1, 1])) === base,
               equalOther: JSON.stringify(HexUtils.scatterPick(cells, ids, 60, seeded(5), [4, 4, 4])) === base,
               wrongLength: JSON.stringify(HexUtils.scatterPick(cells, ids, 60, seeded(5), [1, 2])) === base };
    }, [SEEDED]);
    expect(r).toEqual({ equal: true, equalOther: true, wrongLength: true });
  });

  test('scatterPick: weight 0 is never picked, all-zero picks nothing, weights shape the shares', async ({ page }) => {
    const r = await page.evaluate(([mk]) => {
      const seeded = eval(mk as string);
      const cells = HexUtils.discCells(225, 224, 12, MAP_WIDTH, MAP_HEIGHT);   // 469 cells
      const count = (picks: any[]) => picks.reduce((m: any, p: any) => (m[p.id] = (m[p.id] || 0) + 1, m), {});
      const zero = count(HexUtils.scatterPick(cells, ['A', 'B', 'C'], 100, seeded(3), [1, 0, 1]));
      const none = HexUtils.scatterPick(cells, ['A', 'B'], 100, seeded(3), [0, 0]).length;
      let a = 0, b = 0;
      for (let s = 1; s <= 20; s++) { const c = count(HexUtils.scatterPick(cells, ['A', 'B'], 100, seeded(s * 7919), [3, 1])); a += c.A || 0; b += c.B || 0; }
      return { zeroB: zero.B || 0, zeroAC: (zero.A || 0) + (zero.C || 0), none, shareA: a / (a + b), n: cells.length };
    }, [SEEDED]);
    expect(r.zeroB).toBe(0);
    expect(r.zeroAC).toBe(r.n);
    expect(r.none).toBe(0);
    expect(Math.abs(r.shareA - 0.75)).toBeLessThan(0.03);                       // 9380 rolls: 4.5 sigma is about 0.02
  });

  test('the Hex DB field stores the weight, a weight of 1 leaves the record clean, and out-of-range values are clamped', async ({ page }) => {
    await page.evaluate(() => App.setMode('hexdb'));
    await page.locator('.hexdb-list-row', { hasText: /^Forest_2$/ }).click();
    const field = page.locator('#hexdb-right [data-field="scatterWeight"]');
    await expect(field).toHaveValue('1');
    const w = () => page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Forest_2').scatterWeight);
    await field.fill('3');
    expect(await w()).toBe(3);
    await field.fill('500');
    expect(await w()).toBe(100);
    await field.fill('1');
    expect(await w()).toBeUndefined();
    await field.fill('0');
    expect(await w()).toBe(0);
  });

  test('the Scatter tool follows the weights: a weight 0 variant is never written, chips show the weight', async ({ page }) => {
    const ids = await page.evaluate(() => Tools.scatterVariants('Forest_1'));
    expect(ids.length).toBeGreaterThan(2);
    const [keep, drop] = [ids[0], ids[1]];
    await page.evaluate(([d, k]) => {
      HexDB.getAll().find((h: any) => h.id === d).scatterWeight = 0;
      HexDB.getAll().find((h: any) => h.id === k).scatterWeight = 5;
      UI.selectTerrain('Forest_1'); Brush.setSize(6); Tools.setActive('scatter');
      (document.getElementById('scatter-density') as HTMLInputElement).value = '100';
      (document.getElementById('scatter-seed') as HTMLInputElement).value = '77';
    }, [drop, keep]);
    await expect(page.locator('#scatter-variants label', { hasText: `${keep} ×5` })).toHaveCount(1);
    await expect(page.locator('#scatter-variants label', { hasText: `${drop} ×0` })).toHaveCount(1);
    const p = await page.evaluate(() => { const q = Canvas.hexScreenPos(225, 230); const r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
    const used = await page.evaluate(() => { const s = new Set<string>(); for (const x of mapData) if (x !== 'Plain_1') s.add(x); return [...s]; });
    expect(used.length).toBeGreaterThan(0);
    expect(used).not.toContain(drop);
  });

  test('a tool run with every selected variant at weight 0 is refused with a message', async ({ page }) => {
    await page.evaluate(() => {
      for (const id of Tools.scatterVariants('Forest_1')) HexDB.getAll().find((h: any) => h.id === id).scatterWeight = 0;
      UI.selectTerrain('Forest_1'); Tools.setActive('scatter');
      (document.getElementById('scatter-density') as HTMLInputElement).value = '100';
    });
    const p = await page.evaluate(() => { const q = Canvas.hexScreenPos(225, 230); const r = document.getElementById('map-canvas')!.getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
    expect(await page.evaluate(() => mapData.filter((x: string) => x !== 'Plain_1').length)).toBe(0);
    await expect(page.getByText(/every selected variant has weight 0/)).toBeVisible();
  });
});
