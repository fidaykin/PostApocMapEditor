import { test, expect, Page } from '@playwright/test';
import { openEditor, openSection } from './helpers';
import { freshEditorAuto } from './editor-helpers';

// UI structure: the left palette is ordered, labelled groups (tools in Draw / Select / Place rows, a tool-options strip with the
// brush and symmetry, the tiles, then the secondary sections under View / Edit / Check & share); the top map toolbar holds only
// the File and View groups; the right panel holds the minimap and the settlements (plus the contextual inspectors).

const TOOL_ROWS: [string, string, string[]][] = [
  ['draw', 'Draw', ['paint', 'fill', 'rect', 'line', 'circle', 'polygon', 'eraser', 'scatter', 'replace', 'zone']],
  ['select', 'Select', ['marquee', 'select', 'eye']],
  ['place', 'Place', ['object', 'erase-object', 'road', 'road-connect', 'erase-road', 'bridge', 'settlement', 'erase']],
];
const SECTION_GROUPS: [string, string, string[]][] = [
  ['view', 'View', ['minimap', 'goto', 'bookmarks']],
  ['edit', 'Edit', ['zones', 'stamps', 'layers', 'history']],
  ['check', 'Check & share', ['validator', 'export', 'design', 'help']],
];
// tools whose result depends on the brush radius / that write symmetric copies
const BRUSH_TOOLS = ['paint', 'eraser', 'scatter', 'line', 'circle', 'zone'];
const SYM_TOOLS = ['paint', 'rect', 'line', 'circle', 'polygon', 'eraser', 'scatter'];

const SPY = () => { (window as any).__toasts = []; if (!(UI as any).__spied) { (UI as any).__spied = true; const t = UI.toast; (UI as any).toast = (m: any, o: any) => { (window as any).__toasts.push(String(m)); return t.call(UI, m, o); }; } };
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts.slice());

async function startAt(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await openEditor(page, { storage: { rightPanelMode: 'auto' } });
  await page.waitForFunction(() => document.querySelectorAll('#palette-scroll .tile-btn').length > 20);
}

test.describe('left palette groups', () => {
  test('the palette is four labelled groups in order: tools, tool options, tiles, sections', async ({ page }) => {
    await freshEditorAuto(page);
    const r = await page.evaluate(() => [...document.querySelectorAll('#palette-panel > [data-pal-group]')].map(g => ({
      key: (g as HTMLElement).dataset.palGroup, label: g.getAttribute('aria-label'), role: g.getAttribute('role'),
    })));
    expect(r).toEqual([
      { key: 'tools', label: 'Tools', role: 'group' },
      { key: 'options', label: 'Tool options', role: 'group' },
      { key: 'tiles', label: 'Tiles', role: 'group' },
      { key: 'sections', label: 'Panels', role: 'group' },
    ]);
    // the tiles group has a visible caption next to the package filter chips
    await expect(page.locator('#palette-tiles .pal-caption')).toHaveText('Tiles');
  });

  test('tools are in labelled Draw / Select / Place rows; every button has the same size, a title and an accessible name', async ({ page }) => {
    await freshEditorAuto(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#shape-tools .tool-row')].map(row => ({
      key: (row as HTMLElement).dataset.row,
      label: row.querySelector('.tool-row-label')!.textContent,
      labelVisible: (row.querySelector('.tool-row-label') as HTMLElement).getBoundingClientRect().width > 0,
      tools: [...row.querySelectorAll('.tool-btn[data-tool]')].map(b => (b as HTMLElement).dataset.tool),
    })));
    expect(rows).toEqual(TOOL_ROWS.map(([key, label, tools]) => ({ key, label, labelVisible: true, tools })));
    const btns = await page.evaluate(() => [...document.querySelectorAll('#shape-tools .tool-btn[data-tool]')].map(b => {
      const r = b.getBoundingClientRect();
      return { tool: (b as HTMLElement).dataset.tool, w: r.width, h: r.height, title: (b as HTMLElement).title, aria: b.getAttribute('aria-label'), tag: b.tagName, tabindex: b.getAttribute('tabindex') };
    }));
    for (const b of btns) {
      expect([b.w, b.h], b.tool).toEqual([24, 24]);
      expect(b.title.length, b.tool).toBeGreaterThan(3);
      expect((b.aria || '').length, b.tool).toBeGreaterThan(2);
      expect(b.tag).toBe('BUTTON');
      expect(b.tabindex).toBeNull();
    }
    // the moved buttons keep their shortcut hint in the tooltip
    const t = await page.evaluate(() => Object.fromEntries(['paint', 'fill', 'rect', 'eye', 'select', 'settlement', 'erase', 'zone'].map(k => [k, (document.querySelector(`.tool-btn[data-tool="${k}"]`) as HTMLElement).title])));
    expect(t).toEqual({ paint: 'Paint (P)', fill: 'Fill (F)', rect: 'Rectangle (R)', eye: 'Eyedropper (E)', select: 'Select Tile (S)', settlement: 'Place Settlement (T)', erase: 'Erase Settlement (D)', zone: 'Zone Painter (Z)' });
    // a click on a palette tool button activates it, the active state is visible
    await page.locator('#shape-tools .tool-btn[data-tool="fill"]').click();
    expect(await page.evaluate(() => Tools.getActive())).toBe('fill');
    await expect(page.locator('#shape-tools .tool-btn[data-tool="fill"]')).toHaveClass(/active/);
    await expect(page.locator('#shape-tools .tool-btn[data-tool="paint"]')).not.toHaveClass(/active/);
  });

  test('no tool button is duplicated, and the top toolbar holds none', async ({ page }) => {
    await freshEditorAuto(page);
    const r = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.tool-btn[data-tool]')].map(b => (b as HTMLElement).dataset.tool!);
      const dup = all.filter((t, i) => all.indexOf(t) !== i);
      return { dup, inToolbar: [...document.querySelectorAll('#toolbar [data-tool]')].map(b => (b as HTMLElement).dataset.tool) };
    });
    expect(r).toEqual({ dup: [], inToolbar: [] });
  });

  test('the sections are grouped under View / Edit / Check & share headings, single-open still holds', async ({ page }) => {
    await freshEditorAuto(page);
    const r = await page.evaluate(() => [...document.querySelectorAll('#palette-acc > .pal-acc-group')].map(g => ({
      key: (g as HTMLElement).dataset.group, heading: g.querySelector('.pal-acc-group-h')!.textContent,
      labelled: g.getAttribute('role') === 'group' && document.getElementById(g.getAttribute('aria-labelledby')!) === g.querySelector('.pal-acc-group-h'),
      sections: [...g.querySelectorAll('.pal-acc-btn')].map(b => (b as HTMLElement).dataset.acc),
    })));
    expect(r).toEqual(SECTION_GROUPS.map(([key, heading, sections]) => ({ key, heading, labelled: true, sections })));
    await page.locator('.pal-acc-btn[data-acc="minimap"]').click();
    await page.locator('.pal-acc-btn[data-acc="validator"]').click();
    expect(await page.evaluate(() => [...document.querySelectorAll('.pal-acc-btn[aria-expanded="true"]')].map(b => (b as HTMLElement).dataset.acc))).toEqual(['validator']);
  });
});

test.describe('tool options strip', () => {
  test('the brush size lives in the left tool-options strip (not the right panel) and works with presets, the slider and [ / ]', async ({ page }) => {
    await freshEditorAuto(page);
    const where = await page.evaluate(() => {
      const p = document.getElementById('brush-panel')!;
      return { inOptions: !!p.closest('#tool-options'), inPalette: !!p.closest('#palette-panel'), inRight: !!p.closest('#right-panel'),
               sym: !!document.getElementById('symmetry-select')!.closest('#tool-options'), rail: RightPanel.getEffective() };
    });
    expect(where).toEqual({ inOptions: true, inPalette: true, inRight: false, sym: true, rail: 'rail' });
    // usable while the right panel is collapsed (the default at 1400x900)
    await page.locator('#brush-sizes .brush-btn[data-brush="2"]').click();
    expect(await page.evaluate(() => Brush.getSize())).toBe(2);
    await expect(page.locator('#brush-size-label')).toHaveText('Radius 2 (19 tiles)');
    await page.mouse.move(700, 450);
    await page.keyboard.press(']');
    expect(await page.evaluate(() => Brush.getSize())).toBe(3);
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    expect(await page.evaluate(() => Brush.getSize())).toBe(1);
    await expect(page.locator('#brush-sizes .brush-btn[data-brush="1"]')).toHaveClass(/active/);
    await page.locator('#brush-size-range').fill('7');
    expect(await page.evaluate(() => Brush.getSize())).toBe(7);
    await expect(page.locator('#brush-size-label')).toHaveText('Radius 7 (169 tiles)');
  });

  test('brush and symmetry options are dimmed (still present and usable) for tools that do not use them', async ({ page }) => {
    await freshEditorAuto(page);
    const st = (tool: string) => page.evaluate((t) => {
      Tools.setActive(t);
      const b = document.getElementById('brush-panel')!, s = document.getElementById('symmetry-row')!;
      return { brush: b.dataset.relevant, brushOp: Number(getComputedStyle(b).opacity), brushTip: b.title,
               sym: s.dataset.relevant, symOp: Number(getComputedStyle(s).opacity), symTip: s.title };
    }, tool);
    for (const t of ['paint', 'fill', 'rect', 'line', 'circle', 'polygon', 'eraser', 'scatter', 'replace', 'zone', 'marquee', 'select', 'eye', 'object', 'road', 'bridge', 'settlement']) {
      const r = await st(t);
      const b = BRUSH_TOOLS.includes(t), s = SYM_TOOLS.includes(t);
      expect(r.brush, t).toBe(String(b));
      expect(r.sym, t).toBe(String(s));
      if (b) expect(r.brushOp, t).toBe(1); else { expect(r.brushOp, t).toBeLessThan(0.7); expect(r.brushTip, t).toMatch(/not used by/i); }
      if (s) expect(r.symOp, t).toBe(1); else { expect(r.symOp, t).toBeLessThan(0.7); expect(r.symTip, t).toMatch(/not used by/i); }
    }
    // dimmed, not disabled: a preset still sets the size for the next brush tool
    await page.evaluate(() => Tools.setActive('fill'));
    await page.locator('#brush-sizes .brush-btn[data-brush="3"]').click();
    expect(await page.evaluate(() => Brush.getSize())).toBe(3);
    expect(await page.evaluate(() => (document.getElementById('brush-size-range') as HTMLInputElement).disabled || (document.getElementById('symmetry-select') as HTMLSelectElement).disabled)).toBe(false);
  });
});

test.describe('zone actions in the Zones section', () => {
  test('Randomize & Fill, its patch slider, Fill Zones, Overlay and Clear Zones live in the Zones section, not the toolbar', async ({ page }) => {
    await freshEditorAuto(page);
    const ids = ['btn-zone-randomize', 'rnd-zone-scale', 'btn-zone-fill', 'btn-zone-overlay', 'btn-zone-clear'];
    const r = await page.evaluate((list) => list.map(i => { const e = document.getElementById(i); return !!e && !!e.closest('#zone-panel') && !e.closest('#toolbar'); }), ids);
    expect(r).toEqual(ids.map(() => true));
    // the inline handlers are kept
    expect(await page.evaluate(() => ['btn-zone-randomize', 'btn-zone-fill', 'btn-zone-overlay', 'btn-zone-clear'].map(i => document.getElementById(i)!.getAttribute('onclick'))))
      .toEqual(['ZonePainter._randomizeFillUI()', 'ZonePainter._fillAllZones()', 'ZonePainter._toggleOverlayUI()', 'ZonePainter._clearZonesUI()']);
    await openSection(page, 'zones');
    for (const i of ids) await expect(page.locator('#' + i)).toBeVisible();
  });

  test('the Overlay button stays in sync with the Layers panel; Fill Zones with no zones toasts; Randomize & Fill respects locks', async ({ page }) => {
    await freshEditorAuto(page);
    await page.evaluate(SPY);
    await openSection(page, 'zones');
    await page.click('#btn-zone-overlay');
    expect(await page.evaluate(() => [Layers.isVisible('zones'), ZonePainter.isOverlayVisible(), document.getElementById('btn-zone-overlay')!.style.opacity])).toEqual([false, false, '0.4']);
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'false');
    await page.click('#btn-zone-overlay');
    expect(await page.evaluate(() => Layers.isVisible('zones'))).toBe(true);
    await expect(page.locator('.layer-row[data-layer="zones"] .layer-eye')).toHaveAttribute('aria-pressed', 'true');
    // Randomize & Fill with Terrain and Settlements locked: zones only
    await page.evaluate(() => { Layers.setLocked('terrain', true); Layers.setLocked('settlements', true); });
    const m0 = await page.evaluate(() => mapData.join('|'));
    await page.click('#btn-zone-randomize');
    expect(await toasts(page)).toContain('Terrain and Settlements are locked: randomised zones only');
    expect(await page.evaluate(() => mapData.join('|'))).toBe(m0);
    expect(await page.evaluate(() => ZonePainter.getZoneLayer().some((v: number) => v > 0))).toBe(true);
    // Fill Zones runs from its new place (zones exist now; terrain locked -> refused with a toast, nothing written)
    const n1 = (await toasts(page)).length;
    await page.click('#btn-zone-fill');
    expect(await page.evaluate(() => mapData.join('|'))).toBe(m0);
    expect((await toasts(page)).slice(n1).some(t => /lock/i.test(t))).toBe(true);
  });
});

test.describe('top toolbar', () => {
  test('the map toolbar holds only the File and View groups, with visible labels', async ({ page }) => {
    await freshEditorAuto(page);
    const r = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('#toolbar [data-tb-group]')].filter(g => (g as HTMLElement).offsetParent !== null);
      const vis = (sel: string) => [...document.querySelectorAll(sel)].filter(e => (e as HTMLElement).offsetParent !== null);
      return {
        groups: groups.map(g => ({ key: (g as HTMLElement).dataset.tbGroup, label: g.querySelector('.tb-label')!.textContent, role: g.getAttribute('role'), aria: g.getAttribute('aria-label') })),
        file: vis('#map-io button').map(b => b.textContent!.trim()),
        view: vis('#map-tools button, #map-tools input, #map-tools select').map(e => e.id),
        others: vis('#toolbar button, #toolbar input, #toolbar select').filter(e => !e.closest('.mode-tabs') && !e.closest('[data-tb-group]')).length,
      };
    });
    expect(r).toEqual({
      groups: [{ key: 'file', label: 'File', role: 'group', aria: 'File' }, { key: 'view', label: 'View', role: 'group', aria: 'View' }],
      file: ['📂 Open', '💾 Save'],
      view: ['btn-zones', 'ring-interval', 'block-nav-input', 'btn-toggle-rulers', 'btn-toggle-coastline'],
      others: 0,
    });
    // the view controls still work from there
    await page.click('#btn-toggle-rulers');
    await page.click('#btn-zones');
    await expect(page.locator('#btn-zones')).toHaveClass(/active/);
  });

  test('classic layout keeps the canvas contract: 1491x808 at 1400x900, the toolbar row still 1931.3 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openEditor(page);   // classic (seeded by the helper)
    const r = await page.evaluate(() => ({ c: [(document.getElementById('map-canvas') as HTMLCanvasElement).width, (document.getElementById('map-canvas') as HTMLCanvasElement).height],
      tb: document.getElementById('toolbar')!.getBoundingClientRect().width, rp: document.getElementById('right-panel')!.getBoundingClientRect().left }));
    expect(r.c).toEqual([1491, 808]);
    expect(Math.abs(r.tb - 1931.3125)).toBeLessThan(0.05);
    expect(r.rp).toBeCloseTo(1711.3, 0);
  });
});

test.describe('right panel', () => {
  test.fixme('the right panel holds the minimap and the settlements; brush and the large active terrain are gone from it', async ({ page }) => {
    await freshEditorAuto(page);
    await page.locator('#right-panel-toggle').click();
    const r = await page.evaluate(() => {
      const rp = document.getElementById('right-panel')!;
      const shown = (id: string) => { const e = document.getElementById(id); return !!e && rp.contains(e) && (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height > 0; };
      return { minimap: shown('minimap'), count: shown('settlement-count'), slots: shown('slot-panel'),
               brush: !!rp.querySelector('#brush-panel, .brush-btn'), terrain: !!document.getElementById('right-active-terrain') || !!document.getElementById('right-terrain-name'),
               inspector: shown('tile-inspector'), zoneCfg: shown('zone-config-panel'), title: document.getElementById('right-panel-toggle')!.title };
    });
    expect(r).toMatchObject({ minimap: true, count: true, slots: true, brush: false, terrain: false, inspector: false, zoneCfg: false });
    expect(r.title).not.toMatch(/brush|terrain/i);
    // the compact active-terrain row in the palette still follows the selection
    await page.evaluate(() => UI.selectTerrain('Water_1'));
    await expect(page.locator('#palette-selected-name')).toHaveText(/Water/);
  });
});

test.describe('fit, focus and keyboard', () => {
  for (const [w, h] of [[1400, 900], [1100, 700]] as const) {
    test(`${w}x${h}: nothing in the palette overflows horizontally or overlaps; all collapsed fits at 1400x900`, async ({ page }) => {
      await startAt(page, w, h);
      const r = await page.evaluate(() => {
        const pal = document.getElementById('palette-panel')!, P = pal.getBoundingClientRect();
        const els = [...pal.querySelectorAll('#palette-tools *, #tool-options *, .tiles-head, .tiles-head *, #palette-selected, .pal-acc-h, .pal-acc-h *, .pal-acc-group-h')]
          .filter(e => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().width > 0);
        const out = els.filter(e => { const b = e.getBoundingClientRect(); return b.left < P.left - 0.5 || b.right > P.right - 1 + 0.5; }).map(e => e.id || e.className || e.tagName);
        const btns = [...pal.querySelectorAll('#shape-tools .tool-btn')].map(b => b.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i], b = btns[j];
          if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps++;
        }
        // text that does not fit must be truncated with an ellipsis and carry a tooltip
        const clipped = [...pal.querySelectorAll('.tool-row-label, .pal-caption, .pal-acc-label, .pal-acc-group-h, #brush-size-label, .pkg-chip, #palette-selected-name')]
          .filter(e => (e as HTMLElement).offsetParent !== null && e.scrollWidth > e.clientWidth + 1)
          .filter(e => !(getComputedStyle(e).textOverflow === 'ellipsis' && ((e as HTMLElement).title || e.closest('[title]'))))
          .map(e => e.className || e.id);
        return { sw: pal.scrollWidth, cw: pal.clientWidth, out, overlaps, clipped, vOver: pal.scrollHeight - pal.clientHeight,
                 region: document.getElementById('palette-tiles')!.getBoundingClientRect().height };
      });
      expect(r.sw).toBeLessThanOrEqual(r.cw);
      expect(r.out).toEqual([]);
      expect(r.overlaps).toBe(0);
      expect(r.clipped).toEqual([]);
      expect(r.region).toBeGreaterThanOrEqual(320);
      if (w === 1400) expect(r.vOver).toBeLessThanOrEqual(1);
    });
  }

  test('palette buttons show a visible focus ring for keyboard focus, and Enter / Space activate a focused tool button', async ({ page }) => {
    await freshEditorAuto(page);
    await page.keyboard.press('Shift');   // keyboard modality: programmatic focus is focus-visible
    for (const sel of ['#shape-tools .tool-btn[data-tool="fill"]', '#brush-sizes .brush-btn[data-brush="1"]', '.pal-acc-btn[data-acc="layers"]', '#btn-add-zone', '#map-io button', '#btn-toggle-rulers', '#right-panel-toggle']) {
      const r = await page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement; e.focus(); const c = getComputedStyle(e);
        return { fv: e.matches(':focus-visible'), style: c.outlineStyle, w: parseFloat(c.outlineWidth), shadow: c.boxShadow }; }, sel);
      expect(r.fv, sel).toBe(true);
      expect(r.style !== 'none' && r.w >= 1 || r.shadow !== 'none', sel).toBe(true);
    }
    await page.evaluate(() => (document.querySelector('#shape-tools .tool-btn[data-tool="rect"]') as HTMLElement).focus());
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Tools.getActive())).toBe('rect');
    await page.evaluate(() => (document.querySelector('#shape-tools .tool-btn[data-tool="line"]') as HTMLElement).focus());
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => Tools.getActive())).toBe('line');
    expect(await page.evaluate(() => (document.getElementById('map-canvas') as HTMLElement).style.cursor)).not.toBe('grab');
    // a pointer click does not keep focus on the tool button: Space pans the map again and letters stay tool shortcuts
    await page.locator('#shape-tools .tool-btn[data-tool="circle"]').click();
    expect(await page.evaluate(() => document.activeElement?.classList.contains('tool-btn'))).toBe(false);
    await page.keyboard.press('p');
    expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  });

  test('keyboard reachability: every tool, brush and toolbar view control is a focusable native control', async ({ page }) => {
    await freshEditorAuto(page);
    const r = await page.evaluate(() => [...document.querySelectorAll('#shape-tools .tool-btn, #brush-sizes .brush-btn, #brush-size-range, #symmetry-select, #map-io button, #map-tools button, #map-tools input')]
      .filter(e => !(e as HTMLButtonElement).disabled)
      .map(e => { (e as HTMLElement).focus(); return document.activeElement === e ? '' : (e.id || (e as HTMLElement).dataset.tool || e.textContent); }).filter(Boolean));
    expect(r).toEqual([]);
  });
});
