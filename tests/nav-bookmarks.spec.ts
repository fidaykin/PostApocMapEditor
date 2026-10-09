import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';
import { reloadEditor, openSection } from './helpers';

// T4.2 bookmarks: editor-only view positions in localStorage (never in the map). freshEditor = blank 450x450 map.
// Independent reference for the camera: Unity-axis hex geometry written out here (pitches 60 and 40*sqrt(3); odd worldX up).
const KEY = 'mapEditorBookmarks.v1';
const W = 450, H = 450, COLP = 60, ROWP = 40 * Math.sqrt(3), STAG = ROWP / 2;
function worldOf(col: number, row: number) {
  const wxi = H - 1 - row, wx = wxi - Math.floor(H / 2);
  return { x: wxi * COLP, y: (W - 1 - col) * ROWP + STAG - (Math.abs(wx) % 2 === 1 ? STAG : 0) };
}

const stored = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.getElementById('map-canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
const cam = (page: Page) => page.evaluate(() => Canvas.getCamera());
const hist = (page: Page) => page.evaluate(() => ({ u: History.undoSize(), r: History.redoSize(), m: mapData.join('|').length }));
const goRows = (page: Page) => page.locator('#bookmarks-list .bm-go');
async function viewAt(page: Page, col: number, row: number, zoom = 100) {
  await page.evaluate(([c, r, z]) => { Canvas.setZoom(z); Canvas.centerOnTile(c, r); }, [col, row, zoom]);
}
const addAt = async (page: Page, col: number, row: number, zoom = 100, name = '') => {
  await viewAt(page, col, row, zoom);
  await page.fill('#bm-name', name);
  await page.click('#bm-add-btn');
};

test.beforeEach(async ({ page }) => { await freshEditor(page); await openSection(page, 'bookmarks'); });   // collapsed by default; the open section is remembered across reloads

test('add stores the view centre and zoom, default name is the cell; the list is in the left palette', async ({ page }) => {
  await addAt(page, 120, 200, 50);
  await expect(goRows(page)).toHaveCount(1);
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('120,200');
  const s = await stored(page);
  expect(s.v).toBe(1);
  expect(s.items).toHaveLength(1);
  expect(s.items[0]).toMatchObject({ name: '120,200', col: 120, row: 200, zoom: 50 });
  expect(await page.evaluate(() => !!document.getElementById('palette-panel')!.contains(document.getElementById('bookmarks-panel')))).toBe(true);
});

test('jump restores zoom and centres the tile (camera equals the hand-computed value), two parities', async ({ page }) => {
  await addAt(page, 120, 200, 50);     // even worldX row
  await addAt(page, 121, 201, 100);    // odd worldX row
  await viewAt(page, 10, 10, 100);
  const { w, h } = await canvasSize(page);
  await goRows(page).nth(0).click();
  let p = worldOf(120, 200), c = await cam(page);
  expect(await page.evaluate(() => Canvas.getZoom())).toBe(50);
  expect(c.x).toBeCloseTo(p.x * 0.5 - w / 2, 4);
  expect(c.y).toBeCloseTo(p.y * 0.5 - h / 2, 4);
  await goRows(page).nth(1).click();
  p = worldOf(121, 201); c = await cam(page);
  expect(await page.evaluate(() => Canvas.getZoom())).toBe(100);
  expect(c.x).toBeCloseTo(p.x - w / 2, 4);
  expect(c.y).toBeCloseTo(p.y - h / 2, 4);
});

test('bookmarks survive a real reload and still jump', async ({ page }) => {
  await addAt(page, 120, 200, 100, 'Depot');
  await reloadEditor(page);
  await expect(goRows(page)).toHaveCount(1);
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('Depot');
  // the reloaded session may open a small map (then the bookmark is disabled: covered below); use a big one again
  await page.evaluate(() => { IO.newMap(true); window.dispatchEvent(new Event('resize')); });
  await expect(goRows(page).first()).toBeEnabled();
  await viewAt(page, 10, 10);
  await goRows(page).first().click();
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
});

test('names are text only (HTML-looking names render as text), trimmed, collapsed and capped', async ({ page }) => {
  await page.evaluate(() => { (window as any).__x = 0; });
  const evil = '<img src=x onerror="window.__x=1"><b>x</b>';
  await addAt(page, 100, 100, 100, evil);
  await addAt(page, 101, 100, 100, '   a \t\n  b   ');
  await addAt(page, 102, 100, 100, 'é'.repeat(80));
  const names = await page.locator('#bookmarks-list .bm-name').allTextContents();
  expect(names[0]).toBe(evil.slice(0, 40));
  expect(names[1]).toBe('a b');
  expect(Array.from(names[2])).toHaveLength(40);
  expect(await page.locator('#bookmarks-list img, #bookmarks-list b').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__x)).toBe(0);
  // the same through the API (no input maxlength in the way) and through a hand-edited stored value
  const api = await page.evaluate(() => { const id = Bookmarks.add('x'.repeat(500))!; return Bookmarks.list().find((b: any) => b.id === id).name.length; });
  expect(api).toBe(40);
});

test('limit: the 51st bookmark is refused with a message and nothing is stored', async ({ page }) => {
  const n = await page.evaluate(() => { let k = 0; for (let i = 0; i < 60; i++) if (Bookmarks.add('b' + i)) k++; return k; });
  expect(n).toBe(50);
  expect((await stored(page)).items).toHaveLength(50);
  await expect(goRows(page)).toHaveCount(50);
  await expect(page.locator('.toast').filter({ hasText: /limit is 50/ })).not.toHaveCount(0);
});

test('rename: a modal opens, Enter renames and persists, focus returns to the rename button; Escape cancels', async ({ page }) => {
  await addAt(page, 120, 200, 100, 'Old');
  await page.locator('#bookmarks-list .bm-ren').first().click();
  const modal = page.locator('#bookmark-rename-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('input')).toHaveValue('Old');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('Old');
  // keyboard route: focus the rename button, Enter
  await page.locator('#bookmarks-list .bm-ren').first().focus();
  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<i>New</i>');
  await page.keyboard.press('Enter');
  await expect(modal).toHaveCount(0);
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('<i>New</i>');
  expect((await stored(page)).items[0].name).toBe('<i>New</i>');
  await expect(page.locator('#bookmarks-list .bm-ren').first()).toBeFocused();
  // empty name is refused: the modal stays and the name is unchanged
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Delete'); await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('<i>New</i>');
});

test('delete by pointer and by keyboard; keyboard delete keeps focus inside the list', async ({ page }) => {
  await addAt(page, 100, 100, 100, 'one');
  await addAt(page, 101, 100, 100, 'two');
  await addAt(page, 102, 100, 100, 'three');
  await page.locator('#bookmarks-list .bm-del').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bookmarks-list .bm-name')).toHaveText(['one', 'three']);
  await expect(page.locator('#bookmarks-list .bm-go').nth(1)).toBeFocused();       // the row that took its place
  expect((await stored(page)).items.map((b: any) => b.name)).toEqual(['one', 'three']);
  await page.locator('#bookmarks-list .bm-del').first().click();                  // pointer
  await expect(page.locator('#bookmarks-list .bm-del').first()).not.toBeFocused();
  await expect(page.locator('#bookmarks-list .bm-name')).toHaveText(['three']);
  await page.locator('#bookmarks-list .bm-del').first().focus();
  await page.keyboard.press('Space');
  await expect(goRows(page)).toHaveCount(0);
  await expect(page.locator('#bm-name')).toBeFocused();                              // nothing left: the name field
  expect((await stored(page)).items).toEqual([]);
});

test('keyboard and pointer: Enter on a focused jump button jumps; pointer clicks return focus to the map; typing is not a shortcut', async ({ page }) => {
  await addAt(page, 120, 200, 100, 'Depot');
  await viewAt(page, 10, 10);
  const before = await hist(page);
  await goRows(page).first().focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  await viewAt(page, 10, 10);
  await goRows(page).first().click();
  await expect(goRows(page).first()).not.toBeFocused();
  await page.fill('#bm-name', 'x'); await page.click('#bm-add-btn');
  await expect(page.locator('#bm-add-btn')).not.toBeFocused();
  await page.evaluate(() => Tools.setActive('paint'));
  await page.focus('#bm-name');
  await page.keyboard.type('e l g');
  expect(await page.evaluate(() => Tools.getActive())).toBe('paint');
  await page.keyboard.press('Escape');
  await expect(page.locator('#bm-name')).not.toBeFocused();
  expect((await hist(page)).u).toBe(before.u);
});

test('Enter in the name field adds and blurs it; the field is cleared', async ({ page }) => {
  await viewAt(page, 120, 200);
  await page.fill('#bm-name', 'Typed');
  await page.press('#bm-name', 'Enter');
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('Typed');
  await expect(page.locator('#bm-name')).toHaveValue('');
  await expect(page.locator('#bm-name')).not.toBeFocused();
});

test('corrupt, hostile and oversized stored values are tolerated and sanitised', async ({ page }) => {
  await page.evaluate(k => localStorage.setItem(k, '{not json'), KEY);
  await reloadEditor(page);
  await expect(goRows(page)).toHaveCount(0);
  await addAt(page, 120, 200);
  expect((await stored(page)).items).toHaveLength(1);                                // the next save replaced the garbage
  const items: any[] = [
    null, 5, 'x', { col: 'a', row: 1 }, { col: 1.5, row: 1 }, { col: -1, row: 1 }, { col: 1, row: 1e9 },
    { id: 'dup', name: '<script>1</script>', col: 5, row: 6, zoom: 99999 },
    { id: 'dup', name: 'same id', col: 7, row: 8, zoom: 50 },
    { id: '"><x', name: '', col: 9, row: 10 },
    ...Array.from({ length: 100 }, (_, i) => ({ id: 'k' + i, name: 'n' + i, col: i, row: i, zoom: 100 })),
  ];
  for (const raw of [JSON.stringify({ v: 1, items }), JSON.stringify([1, 2]), 'null', '"str"', JSON.stringify({ v: 1, items: 'no' })]) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, raw]);
    await reloadEditor(page);
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ v: 1, items })]);
  await reloadEditor(page);
  const l = await page.evaluate(() => Bookmarks.list());
  expect(l).toHaveLength(50);                                                         // capped; invalid entries dropped first
  expect(new Set(l.map((b: any) => b.id)).size).toBe(50);                             // duplicate id made unique
  expect(l[0]).toMatchObject({ name: '<script>1</script>', col: 5, row: 6, zoom: 100 });   // bad zoom -> 100
  expect(l[1]).toMatchObject({ name: 'same id', col: 7, row: 8, zoom: 50 });
  expect(l[2]).toMatchObject({ name: '9,10' });                                       // empty name -> the cell
  expect(l.every((b: any) => /^[A-Za-z0-9_-]{1,40}$/.test(b.id))).toBe(true);
  expect(await page.locator('#bookmarks-list script').count()).toBe(0);
  await expect(goRows(page)).toHaveCount(50);
});

test('blocked storage: the editor starts, bookmarks work for the session, one warning toast', async ({ page }) => {
  await page.addInitScript(k => {
    const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) { if (key === k) throw new DOMException('denied', 'SecurityError'); return g.call(this, key); };
    Storage.prototype.setItem = function (key: string, v: string) { if (key === k) throw new DOMException('quota', 'QuotaExceededError'); return s.call(this, key, v); };
  }, KEY);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await reloadEditor(page);
  await expect(goRows(page)).toHaveCount(0);
  await addAt(page, 120, 200, 100, 'Mem');
  await addAt(page, 121, 200, 100, 'Mem2');
  await expect(goRows(page)).toHaveCount(2);
  await expect(page.locator('.toast').filter({ hasText: /could not be saved/ })).toHaveCount(1);   // warned once, not per save
  await viewAt(page, 10, 10);
  await goRows(page).first().click();
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 120, row: 200 });
  expect(errors).toEqual([]);
});

test('cells outside the current map are shown disabled, cannot be jumped to, can be renamed/deleted, and come back with a big map', async ({ page }) => {
  await addAt(page, 400, 400, 100, 'Far');
  await addAt(page, 10, 10, 100, 'Near');
  await page.evaluate(() => {
    (document.getElementById('newmap-w') as HTMLInputElement).value = '20';
    (document.getElementById('newmap-h') as HTMLInputElement).value = '20';
    IO.applyNewMap();
  });
  expect(await page.evaluate(() => [MAP_WIDTH, MAP_HEIGHT])).toEqual([20, 20]);
  await expect(goRows(page).nth(0)).toBeDisabled();
  await expect(goRows(page).nth(0)).toHaveAttribute('title', /Outside this map \(20 × 20\)/);
  await expect(goRows(page).nth(1)).toBeEnabled();                                   // positive control: (10,10) is inside 20x20
  const before = await cam(page);
  const far = await page.evaluate(() => Bookmarks.go(Bookmarks.list()[0].id));
  expect(far).toBe(false);
  expect(await cam(page)).toEqual(before);
  await expect(page.locator('#bookmarks-list .bm-ren').first()).toBeEnabled();
  await page.locator('#bookmarks-list .bm-ren').first().click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Far2'); await page.keyboard.press('Enter');
  await expect(goRows(page).first().locator('.bm-name')).toHaveText('Far2');
  await page.evaluate(() => IO.newMap(true));                                        // back to 450x450
  await expect(goRows(page).nth(0)).toBeEnabled();
  expect(await page.evaluate(() => Bookmarks.go(Bookmarks.list()[0].id))).toBe(true);
  expect(await page.evaluate(() => Canvas.getViewCenterTile())).toMatchObject({ col: 400, row: 400 });
});

test('not a map edit: add, rename, delete and jump leave history, map and the saved map JSON alone', async ({ page }) => {
  const before = await hist(page);
  await page.evaluate(() => {
    (window as any).__saved = null;
    URL.createObjectURL = (b: any) => { (window as any).__saved = b; return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
  });
  const id = await page.evaluate(() => Bookmarks.add('SecretBookmarkName'));
  expect(id).not.toBeNull();
  await page.evaluate(i => { Bookmarks.rename(i!, 'SecretBookmarkName2'); Bookmarks.go(i!); }, id);
  expect(await hist(page)).toEqual(before);
  await page.evaluate(() => IO.saveMap());
  const json = await page.evaluate(async () => (window as any).__saved ? await (window as any).__saved.text() : '');
  expect(json).toContain('"width"');                                                  // positive control: a real map JSON was captured
  expect(json).not.toContain('SecretBookmarkName');
  expect(json.toLowerCase()).not.toContain('bookmark');
  await page.evaluate(i => Bookmarks.remove(i!), id);
  expect(await hist(page)).toEqual(before);
});

test('jumping works while a stroke is active and does not end it', async ({ page }) => {
  await addAt(page, 100, 100);
  await viewAt(page, 225, 224);
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 310, { steps: 3 });
  expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
  expect(await page.evaluate(() => Bookmarks.go(Bookmarks.list()[0].id))).toBe(true);
  expect(await page.evaluate(() => Tools.isStrokeActive())).toBe(true);
  await page.mouse.up();
});

test('layout: canvas stays 1491x808 at 1400x900; the panel controls are reachable at 1100x700 (the palette scrolls)', async ({ page }) => {
  for (const [vw, vh] of [[1400, 900], [1100, 700]] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    if (vw === 1400) expect(await canvasSize(page)).toEqual({ w: 1491, h: 808 });
    await page.locator('#bm-add-btn').scrollIntoViewIfNeeded();
    await expect(page.locator('#bm-add-btn')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#bm-name')).toBeInViewport({ ratio: 1 });
  }
  await page.evaluate(() => { for (let i = 0; i < 5; i++) Bookmarks.add('r' + i); });
  await page.locator('#bookmarks-list .bm-go').last().scrollIntoViewIfNeeded();
  await expect(page.locator('#bookmarks-list .bm-go').last()).toBeInViewport({ ratio: 1 });
});
