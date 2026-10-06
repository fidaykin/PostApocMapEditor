import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Final fix wave B (remaining Minor findings): validator (B3), History / PNG / layout (B4), generation (B5), UI (B6).

test.describe('B3 validator', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  // A settlement ringed by `wallId` (true hex adjacency) must be reported as unreachable from the city.
  const walled = (page: Page, wallId: string) => page.evaluate((id) => {
    const sc = 231, sr = 224;
    settlements.push({ col: sc, row: sr, type: 'settlement' } as any);
    for (const n of HexUtils.neighbors(sc, sr, MAP_WIDTH, MAP_HEIGHT)) mapData[n.row * MAP_WIDTH + n.col] = id;
    return MapValidator.run().issues.map((i: any) => i.id);
  }, wallId);

  test('Mountain_Kaiju_1 and _2 block like Mountain_1; Hills_1 does not (hand-written list)', async ({ page }) => {
    expect(await walled(page, 'Mountain_Kaiju_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_Kaiju_2')).toContain('unreachable-settlement');
    expect(await walled(page, 'Mountain_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Hills_1')).not.toContain('unreachable-settlement');       // positive control: the same ring of a passable tile
  });

  test('a HexDB entry whose TYPE is Volcanic/Rift or Rivers blocks without being in a hard-coded id list', async ({ page }) => {
    await page.evaluate(() => {
      HexDB.getAll().push({ id: 'Magma_Custom_1', type: 'Volcanic/Rift', spriteName: '' } as any, { id: 'Brook_Custom_1', type: 'Rivers', spriteName: '' } as any, { id: 'Grass_Custom_1', type: 'Plains', spriteName: '' } as any);
    });
    expect(await walled(page, 'Magma_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Brook_Custom_1')).toContain('unreachable-settlement');
    expect(await walled(page, 'Grass_Custom_1')).not.toContain('unreachable-settlement');
  });

  for (const db of ['HexDB', 'BldDB'] as const) {
    test(`an edit to ${db} marks the validator panel 'Results outdated'`, async ({ page }) => {
      await page.evaluate(() => { MapValidator.runPanel(); });
      const sum = page.locator('#val-summary');
      await expect(sum).not.toContainText('outdated');
      await page.evaluate((d) => {
        if (d === 'HexDB') HexDB.addEntries([{ id: 'Fresh_Hex_1', type: 'Plains', spriteName: '' }]);
        else BldDB.addEntries([{ id: 'Fresh_Bld_1', buildingCategory: 'Other' }]);
      }, db);
      await expect(sum).toContainText('outdated');
    });
  }
});

// ---- B4: layout ----
import { openEditor } from './helpers';

test.describe('B4 layout', () => {
  async function start(page: Page, w: number, h: number) {
    await page.setViewportSize({ width: w, height: h });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    await page.evaluate(() => {
      // every Canvas.resize() assigns canvas.width exactly once: count those assignments (the instance setter delegates to the real one)
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
      (window as any).__resizes = 0;
      Object.defineProperty(c, 'width', { configurable: true, get() { return desc.get!.call(c); }, set(v) { (window as any).__resizes++; desc.set!.call(c, v); } });
    });
  }
  const resizes = (page: Page) => page.evaluate(() => (window as any).__resizes as number);

  test('a window resize across the 1920 px threshold re-measures the canvas ONCE (not once per listener)', async ({ page }) => {
    await start(page, 1800, 900);
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('rail');
    await page.setViewportSize({ width: 2000, height: 900 });                       // rail -> inline: the layout class changes
    await expect.poll(() => page.evaluate(() => RightPanel.getEffective())).toBe('inline');
    await page.waitForTimeout(100);
    expect(await resizes(page)).toBe(1);
    const w = await page.evaluate(() => (document.getElementById('map-canvas') as HTMLCanvasElement).width);
    expect(w).toBe(2000 - 2 * 220);                                                   // and the canvas really follows the new layout
  });

  test('positive controls: a resize that stays on one side of the threshold, and the panel toggle, each re-measure once', async ({ page }) => {
    await start(page, 1800, 900);
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.waitForTimeout(100);
    expect(await resizes(page)).toBe(1);
    await page.evaluate(() => { (window as any).__resizes = 0; RightPanel.toggle(); });
    expect(await resizes(page)).toBe(1);
  });

  test('scrolling the toolbar closes the open MORE dropdown and re-places the hovered tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    expect(await page.evaluate(() => { const t = document.getElementById('toolbar')!; return t.scrollWidth > t.clientWidth + 100; })).toBe(true);   // there is something to scroll
    // MORE dropdown
    await page.locator('#tab-more').scrollIntoViewIfNeeded();
    await page.locator('#tab-more').click();
    await expect(page.locator('#more-dropdown')).toHaveClass(/open/);
    await page.evaluate(() => { const t = document.getElementById('toolbar')!; t.scrollLeft += t.scrollLeft > 150 ? -120 : 120; });
    await expect(page.locator('#more-dropdown')).not.toHaveClass(/open/);                 // RED before B4: it stayed open, detached from its tab
    // tooltip: hover a button, scroll 8 px (the pointer stays on it), the tooltip must follow the button
    await page.evaluate(() => { document.getElementById('toolbar')!.scrollLeft = 0; });
    const btn = page.locator('#map-tools .tool-btn').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await page.evaluate(() => { const t = document.getElementById('toolbar')!; t.scrollLeft += t.scrollLeft + 8 < t.scrollWidth - t.clientWidth ? 8 : -8; });   // the pointer stays on the same button
    await expect.poll(() => page.evaluate(() => {
      const hov = document.querySelector('#toolbar .tool-btn:hover');
      const tip = hov && (hov.querySelector('.tooltip') as HTMLElement | null);
      if (!tip) return 'no hovered tooltip';
      const r = hov!.getBoundingClientRect(), t = tip.getBoundingClientRect();
      return Math.abs((t.left + t.width / 2) - (r.left + r.width / 2)) < 2 && Math.abs(t.top - (r.bottom + 6)) < 2 ? 'ok' : `off by ${Math.round(t.left + t.width / 2 - (r.left + r.width / 2))},${Math.round(t.top - r.bottom)}`;
    })).toBe('ok');
  });

  test('the minimap buttons are disabled with an explanation while the right panel is collapsed, and work again when it opens', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openEditor(page, { storage: { rightPanelMode: 'auto' } });
    const info = () => page.evaluate(() => ['mm-size-btn', 'mm-zones-btn', 'mm-settle-btn'].map(id => { const b = document.getElementById(id) as HTMLButtonElement; return [b.disabled, b.title]; }));
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('rail');
    const collapsed = await info();
    for (const [dis, title] of collapsed) { expect(dis).toBe(true); expect(title).toBe('Expand the right panel to see the minimap'); }
    const before = await page.evaluate(() => Canvas.isMinimapBig());
    await page.locator('#mm-size-btn').click({ force: true });                             // a disabled button changes nothing
    expect(await page.evaluate(() => Canvas.isMinimapBig())).toBe(before);
    await page.evaluate(() => RightPanel.toggle());                                       // expanded (drawer on this narrow window)
    expect(await page.evaluate(() => RightPanel.getEffective())).toBe('drawer');
    const open = await info();
    for (const [dis, title] of open) { expect(dis).toBe(false); expect(title).not.toMatch(/Expand the right panel/); expect(title.length).toBeGreaterThan(10); }
    await page.locator('#mm-size-btn').click();
    expect(await page.evaluate(() => Canvas.isMinimapBig())).toBe(!before);               // positive control: it works when the minimap is visible
    await page.evaluate(() => RightPanel.toggle());                                       // collapse again: disabled again, original titles restored on the next open
    expect((await info()).every(([d]) => d === true)).toBe(true);
  });
});
