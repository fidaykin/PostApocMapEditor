import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor } from './helpers';

// The Help menu (T6.5): guide links, the shortcut list and no native dialogs. The guide files themselves are checked in
// docs-lint.spec.ts; here the links are followed against the served page.
const LINKS = [
  { id: 'help-guide-en', href: 'docs/guides/editor-guide.en.html', type: /text\/html/, heading: 'Map Editor Pro: user guide' },
  { id: 'help-guide-uk', href: 'docs/guides/editor-guide.uk.html', type: /text\/html/, heading: 'Map Editor Pro: посібник користувача' },
];

test('the Help menu lists the guides as safe new-tab links and the shortcut list', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  const info = await page.evaluate(() => {
    const item = document.getElementById('menu-help')!;
    return {
      label: item.firstChild!.textContent!.trim(),
      inMenubar: !!item.closest('#menubar'),
      links: [...item.querySelectorAll('a')].map(a => ({ id: a.id, href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent })),
      buttons: [...item.querySelectorAll('button')].map(b => b.textContent!.trim()),
    };
  });
  expect(info.label).toBe('Help');
  expect(info.inMenubar).toBe(true);
  expect(info.links.map(l => [l.id, l.href])).toEqual(LINKS.map(l => [l.id, l.href]));
  for (const l of info.links) {
    expect(l.target, l.id).toBe('_blank');
    expect(l.rel.split(/\s+/), l.id).toContain('noopener');
    expect(l.text!.trim().length, l.id).toBeGreaterThan(5);
  }
  expect(info.buttons).toEqual(['Keyboard Shortcuts…']);
  expect(info.links.some(l => /\.pdf$/i.test(l.href || ''))).toBe(false);   // the packages PDF guide is not shipped
  expect(nativeDialogs).toEqual([]);
});

test('every Help link resolves (200, right content type) against the served page', async ({ page, request }) => {
  await openEditor(page);
  for (const l of LINKS) {
    const url = await page.evaluate(id => (document.getElementById(id) as HTMLAnchorElement).href, l.id);   // resolved against the page (and a <base>)
    const r = await request.get(url);
    expect(r.status(), url).toBe(200);
    expect(r.headers()['content-type'], url).toMatch(l.type);
    const body = await r.body();
    expect(body.length, url).toBeGreaterThan(1000);
    expect(body.toString('utf8'), url).toContain(`<h1>${l.heading}</h1>`);
  }
});

test('clicking a guide link opens it in a new tab and leaves the editor untouched', async ({ page, context }) => {
  const { nativeDialogs } = await openEditor(page);
  await page.click('#menu-help');
  await expect(page.locator('#menu-help .menu-dropdown')).toBeVisible();
  const [tab] = await Promise.all([context.waitForEvent('page'), page.click('#help-guide-uk')]);
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/\/docs\/guides\/editor-guide\.uk\.html$/);
  await expect(tab.locator('h1')).toHaveText('Map Editor Pro: посібник користувача');
  expect(await tab.locator('html').getAttribute('lang')).toBe('uk');
  await tab.close();
  await expect(page.locator('#menu-help .menu-dropdown')).toBeHidden();      // the menu closed itself
  expect(page.url()).toMatch(/MapEditorPro\.html/);
  expect(nativeDialogs).toEqual([]);
});

test('Help > Keyboard Shortcuts opens the registry-generated list and closes the menu', async ({ page }) => {
  const { nativeDialogs } = await openEditor(page);
  await expect(page.locator('.shortcut-help-body')).toHaveCount(0);        // positive control: not open before
  await page.click('#menu-help');
  await page.click('#help-shortcuts');
  await expect(page.locator('.shortcut-help-body')).toBeVisible();
  await expect(page.locator('#menu-help .menu-dropdown')).toBeHidden();
  expect(await page.locator('.shortcut-help-body kbd').count()).toBeGreaterThan(30);
  expect(nativeDialogs).toEqual([]);
});

test('the menu bar entry does not change the canvas size (1491x808 at 1400x900)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);
  const size = await page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return [c.clientWidth, c.clientHeight]; });
  expect(size).toEqual([1491, 808]);
});

test('both guides list every key of the shortcut registry (tools, view, overlays) with the same text as the editor', async ({ page }) => {
  await openEditor(page);
  const reg: { group: string; display: string }[] = await page.evaluate(() => Shortcuts.getAll().map((d: any) => ({ group: d.group, display: d.display })));
  const wanted = reg.filter(d => ['Tools', 'View', 'Overlays', 'Brush', 'Edit', 'File', 'While pasting or moving'].includes(d.group));
  expect(wanted.length).toBeGreaterThan(40);
  expect(wanted.map(d => d.display)).toEqual(expect.arrayContaining(['P', 'U', 'Y', 'Ctrl+Z', '0', '1']));   // positive control: the registry is not empty
  // Shortcuts that share a row in the guide ("Ctrl+C / Ctrl+X / Ctrl+V", "Delete / Backspace") are matched part by part.
  for (const f of ['docs/guides/editor-guide.en.md', 'docs/guides/editor-guide.uk.md']) {
    const md = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const cells = new Set([...md.matchAll(/^\| ((?:`[^`|]+`(?: \/ )?)+(?: \+ [^|]+)?) \|/gm)].flatMap(m => [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1])));
    const missing: string[] = [];
    for (const d of wanted) {
      if (d.display.startsWith('Space +')) { if (!md.includes('`Space` + ')) missing.push(d.display); continue; }
      for (const part of d.display.split(' / ')) if (!cells.has(part)) missing.push(`${f}: ${part} (${d.group})`);
    }
    expect(missing).toEqual([]);
  }
});
