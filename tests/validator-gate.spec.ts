import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import { FakeGitHub, openEditor } from './helpers';
import { freshEditor, clickCell } from './editor-helpers';

// T4.7: every map export (Save / Ctrl+S / File menu / HexDB-mode Save button, Export CSV, Publish Map) runs the validator
// ONCE, after the fill-idle wait and (publish) after the name prompt. Errors need 'Export anyway'; warnings only toast.
// freshEditor = blank 450x450, city at 225,224 (a clean map: no issues).

const modal = (page: Page) => page.locator('#validator-gate-modal');
const breakMap = (page: Page) => page.evaluate(() => { mapData[10 * MAP_WIDTH + 10] = 'Nope_1'; });          // 1 error (unknown id)
const warnMap = (page: Page) => page.evaluate(() => { roadsData['300,300'] = {}; });                          // 1 warning (orphan road)
async function counters(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__runs = 0; w.__busyAtRun = [];
    const orig = HexDB.getAll;                      // collectState() reads it exactly once per validator run
    HexDB.getAll = function (this: any, ...a: any[]) {
      if (new Error().stack!.includes('collectState')) { w.__runs++; w.__busyAtRun.push(Tools.isFillBusy()); }   // other callers (render) do not count
      return orig.apply(this, a as any);
    };
  });
}
const runs = (page: Page) => page.evaluate(() => (window as any).__runs as number);
const trigger = {
  save: (p: Page) => p.evaluate(() => { IO.saveMap(); }),
  ctrlS: (p: Page) => p.keyboard.press('Control+s'),
  menu: (p: Page) => p.evaluate(() => (document.querySelector('#menu-file button[onclick="IO.saveMap()"]') as HTMLElement).click()),
  hexdbBtn: (p: Page) => p.evaluate(() => (document.querySelector('.hexdb-tool-btn[onclick="IO.saveMap()"]') as HTMLElement).click()),
  csv: (p: Page) => p.evaluate(() => { IO.exportCSV(); }),
};
const downloads = (page: Page) => { const l: string[] = []; page.on('download', d => l.push(d.suggestedFilename())); return l; };

test.describe('file exports', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  for (const [name, ext] of [['save', 'json'], ['ctrlS', 'json'], ['menu', 'json'], ['hexdbBtn', 'json'], ['csv', 'csv']] as const) {
    test(`${name}: errors show the summary; nothing is written until 'Export anyway'`, async ({ page }) => {
      await breakMap(page);
      const dl = downloads(page);
      await counters(page);
      await trigger[name](page);
      await expect(modal(page)).toBeVisible();
      await expect(modal(page)).toContainText('Nope_1');
      await expect(modal(page).getByRole('button', { name: 'Export anyway' })).toHaveClass(/btn-danger/);
      await page.waitForTimeout(200);
      expect(dl).toEqual([]);
      expect(await runs(page)).toBe(1);
      const [d] = await Promise.all([page.waitForEvent('download'), modal(page).getByRole('button', { name: 'Export anyway' }).click()]);
      expect(d.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
      await expect(modal(page)).toHaveCount(0);
      expect(await runs(page)).toBe(1);               // one validator run for the whole export
    });
  }

  test('Cancel and Escape write nothing and leave no History step or autosave', async ({ page }) => {
    await breakMap(page);
    const dl = downloads(page);
    const before = await page.evaluate(() => ({ undo: [History.undoSize(), History.redoSize()], json: IO.getMapJson(), name: document.title }));
    for (const how of ['button', 'escape'] as const) {
      await trigger.save(page);
      await expect(modal(page)).toBeVisible();
      if (how === 'button') await modal(page).getByRole('button', { name: 'Cancel' }).click(); else await page.keyboard.press('Escape');
      await expect(modal(page)).toHaveCount(0);
    }
    await trigger.csv(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(dl).toEqual([]);
    const after = await page.evaluate(() => ({ undo: [History.undoSize(), History.redoSize()], json: IO.getMapJson(), name: document.title }));
    expect(after).toEqual(before);
    await expect(page.locator('.toast', { hasText: 'Map saved' })).toHaveCount(0);
  });

  test('Show issues cancels the export, opens the panel with the report and jumps to the first error', async ({ page }) => {
    await breakMap(page);
    const dl = downloads(page);
    await counters(page);
    await trigger.save(page);
    await modal(page).getByRole('button', { name: 'Show issues' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator('#validator-panel')).toHaveJSProperty('open', true);
    await expect(page.locator('#val-list .val-row')).toHaveCount(1);
    await expect(page.locator('#val-list .val-row.sel')).toHaveCount(1);
    expect(await page.evaluate(() => Canvas.hasHighlight('validator'))).toBe(true);
    expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 10, row: 10 });
    expect(await runs(page)).toBe(1);               // the panel reuses the gate's report
    await page.waitForTimeout(200);
    expect(dl).toEqual([]);
  });

  test('a clean map exports silently, byte-identical to the map JSON; a warning only toasts', async ({ page }) => {
    const json = await page.evaluate(() => IO.getMapJson());
    let [d] = await Promise.all([page.waitForEvent('download'), trigger.save(page)]);
    expect(fs.readFileSync((await d.path())!, 'utf8')).toBe(json);
    await expect(modal(page)).toHaveCount(0);
    await warnMap(page);
    const json2 = await page.evaluate(() => IO.getMapJson());
    [d] = await Promise.all([page.waitForEvent('download'), trigger.save(page)]);
    expect(fs.readFileSync((await d.path())!, 'utf8')).toBe(json2);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator('.toast', { hasText: '1 validation warning' })).toBeVisible();
  });

  test('a second request while the summary is open does not stack another modal', async ({ page }) => {
    await breakMap(page);
    await trigger.save(page);
    await expect(modal(page)).toBeVisible();
    await trigger.save(page);
    await trigger.csv(page);
    await expect(page.locator('.ui-modal')).toHaveCount(1);
  });

  test('the gate waits for a running fill (never validates a half-filled map)', async ({ page }) => {
    await counters(page);
    await page.evaluate(() => { Tools.setActive('fill'); UI.selectTerrain('Water_1'); });
    await clickCell(page, 225, 224);
    expect(await page.evaluate(() => Tools.isFillBusy())).toBe(true);
    const [d] = await Promise.all([page.waitForEvent('download'), trigger.save(page)]);
    expect(d.suggestedFilename()).toMatch(/\.json$/);
    const busy = await page.evaluate(() => (window as any).__busyAtRun as boolean[]);
    expect(busy).toEqual([false]);                  // exactly one run, and the fill was idle
  });

  test('the map replaced while the summary is open: nothing is exported', async ({ page }) => {
    await breakMap(page);
    const dl = downloads(page);
    await trigger.save(page);
    await page.evaluate(() => { IO.newMap(true); });
    await modal(page).getByRole('button', { name: 'Export anyway' }).click();
    await page.waitForTimeout(300);
    expect(dl).toEqual([]);
    await expect(page.locator('.toast', { hasText: 'map changed' }).first()).toBeVisible();
  });
});

test.describe('publish', () => {
  async function setup(page: Page) {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => HexDB.getAll().length > 0);
    await page.evaluate(() => { IO.newMap(true); mapData[10 * MAP_WIDTH + 10] = 'Nope_1'; });
    await counters(page);
    return gh;
  }
  test('the gate runs AFTER the name prompt; Cancel uploads nothing; Export anyway uploads', async ({ page }) => {
    const gh = await setup(page);
    await page.evaluate(() => { GitHubSync.publishMap(); });
    await expect(page.locator('#dialog-modal.open')).toBeVisible();
    expect(await runs(page)).toBe(0);                // prompt first, no validation yet
    await page.fill('#dialog-input', 'gated');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(modal(page)).toBeVisible();
    await modal(page).getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(300);
    expect(gh.putPaths().filter(p => p.startsWith('maps/'))).toEqual([]);
    await page.evaluate(() => { GitHubSync.publishMap(); });
    await page.fill('#dialog-input', 'gated');
    await page.getByRole('button', { name: 'OK' }).click();
    await modal(page).getByRole('button', { name: 'Export anyway' }).click();
    await expect.poll(() => gh.putPaths()).toContain('maps/gated.json');
  });
  test('cancelling the name prompt never validates', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { GitHubSync.publishMap(); });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(200);
    expect(await runs(page)).toBe(0);
    await expect(modal(page)).toHaveCount(0);
  });
  test('Escape on the summary cancels the publish', async ({ page }) => {
    const gh = await setup(page);
    await page.evaluate(() => { GitHubSync.publishMap(); });
    await page.fill('#dialog-input', 'esc');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(gh.putPaths().filter(p => p.startsWith('maps/'))).toEqual([]);
  });
});
