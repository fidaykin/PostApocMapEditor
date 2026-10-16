import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedHexes, seedBuildings, hexRec, bldRec, dataUrl, TINY_PNG } from './helpers';

// Reskin+ from ANY package into the active one (source select in the picker).
const SPR = Buffer.concat([TINY_PNG, Buffer.from('decameroon-sprite')]);

async function open(page: Page, gh = new FakeGitHub(), extra: { id: string; name: string }[] = []) {
  gh.setRegistry([{ id: 'medieval', name: 'Medieval Kingdom' }, { id: 'decameroon', name: 'Decameroon' }, { id: 'empty-pack', name: 'Empty Pack' }, ...extra]);
  await openEditor(page, { gh, pat: true });
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(() => Packages.setActive('medieval'));
  return gh;
}
const items = (page: Page) => page.locator('#reskin-picker-modal .reskin-item');
const ids = (page: Page) => items(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
const source = (page: Page) => page.locator('#reskin-source');
const options = (page: Page) => source(page).locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
const modeRadio = (page: Page, m: 'prefix' | 'same') => page.locator(`#reskin-picker-modal [role="radio"][data-mode="${m}"]`);
const toastWith = (page: Page, t: string) => page.locator('#toast-container .toast', { hasText: t }).first();
const hexOf = (page: Page, id: string, pkg: string) =>
  page.evaluate(([i, p]) => HexDB.getAll().filter((h: any) => h.id === i && (h.package || 'postapoc') === p), [id, pkg] as const);
const bldOf = (page: Page, id: string, pkg: string) =>
  page.evaluate(([i, p]) => BldDB.getAll().filter((b: any) => b.id === i && (b.package || 'postapoc') === p), [id, pkg] as const);

async function seed(page: Page) {
  await seedHexes(page, [
    hexRec('Zq_Base', 'postapoc'),
    hexRec('Dec_Tile', 'decameroon', { spriteName: 'DecSp', gold: 7 }),
    hexRec('Dec_Other', 'decameroon'),
    hexRec('Medieval_Own', 'medieval', { spriteName: '' }),
  ]);
  await seedBuildings(page, [
    bldRec('Zq_Farm', 'postapoc', { buildingCategory: 'Standard', type: 'Ground Building' }),
    bldRec('Dec_Hall', 'decameroon', { spriteName: 'DecHall', buildingCategory: 'Standard', type: 'Ground Building' }),
  ]);
}

test('hex picker: a Source package select defaults to postapoc and lists only base entries', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await expect(source(page)).toHaveCount(1);
  await expect(source(page)).toHaveValue('postapoc');
  await page.locator('#reskin-search').fill('zq_base');
  expect(await ids(page)).toEqual(['Zq_Base']);
  await page.locator('#reskin-search').fill('dec_');
  expect(await ids(page)).toEqual([]);                       // other packages' entries are not offered by default
});

test('hex picker: the select lists packages with entries of this kind, never the active one or empty ones', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.promptReskin(); });
  expect(await options(page)).toEqual(['postapoc', 'decameroon']);   // not medieval (active), not empty-pack (no entries)
  await page.keyboard.press('Escape');
  // the building kind has its own set (decameroon has a building too, medieval none): same here, but a hex-only package is hidden
  await seedHexes(page, [hexRec('Only_Hex', 'hexonly')]);
  await page.evaluate(() => { BldDB.promptReskin(); });
  expect(await options(page)).toEqual(['postapoc', 'decameroon']);
});

test('hex picker: choosing another source re-filters list, search and count', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await source(page).selectOption('decameroon');
  expect(await ids(page)).toEqual(['Dec_Tile', 'Dec_Other']);
  await expect(page.locator('#reskin-count')).toHaveText('2 of 2');
  await page.locator('#reskin-search').fill('other');
  expect(await ids(page)).toEqual(['Dec_Other']);
  await source(page).selectOption('postapoc');
  expect(await ids(page)).toEqual([]);
});

test('hex picker: the select is a native, keyboard reachable control; ids/names are text only', async ({ page }) => {
  await open(page, new FakeGitHub(), [{ id: 'evil', name: '<img src=x onerror=window.__pwn=1>' }]);
  await seed(page);
  await seedHexes(page, [hexRec('<b>x</b>', 'evil')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  expect(await source(page).evaluate(e => e.tagName)).toBe('SELECT');
  expect(await source(page).evaluate(e => (e as HTMLSelectElement).disabled)).toBe(false);
  await source(page).focus();
  await expect(source(page)).toBeFocused();
  await source(page).selectOption('evil');
  await expect(items(page).first()).toContainText('<b>x</b>');
  expect(await page.locator('#reskin-picker-modal b').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
});

test('hex prefix copy from another package: id, fields, active package, source untouched, paintable', async ({ page }) => {
  await open(page); await seed(page);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await source(page).selectOption('decameroon');
  await page.locator('#reskin-search').fill('dec_tile');
  await items(page).first().click();
  await expect(page.locator('#reskin-picker-modal')).toHaveCount(0);
  const copy = await hexOf(page, 'Medieval_Dec_Tile', 'medieval');
  expect(copy).toHaveLength(1);
  expect(copy[0]).toMatchObject({ spriteName: 'DecSp', gold: 7, type: 'Plains', package: 'medieval' });
  expect(await hexOf(page, 'Dec_Tile', 'decameroon')).toHaveLength(1);
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0 + 1);
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual([]);   // prefix mode: no dependency
  await expect(toastWith(page, 'Medieval_Dec_Tile')).toContainText('prefixed copy');
  await expect(page.locator('#hexdb-list .selected, #hexdb-list .active').first()).toContainText('Medieval_Dec_Tile');
});

test('hex prefix copy is not doubled when the id already carries the active prefix', async ({ page }) => {
  await open(page);
  await seedHexes(page, [hexRec('Medieval_Keep', 'decameroon')]);
  await page.evaluate(() => { HexDB.addReskin('Medieval_Keep', 'prefix', 'decameroon'); });
  expect(await hexOf(page, 'Medieval_Keep', 'medieval')).toHaveLength(1);
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.id === 'Medieval_Medieval_Keep').length)).toBe(0);
});

test('the default source stays postapoc for direct calls and an unknown source id is refused', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.addReskin('Zq_Base'); });
  expect(await hexOf(page, 'Medieval_Zq_Base', 'medieval')).toHaveLength(1);
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix'); });        // Dec_Tile is not a postapoc id
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix', 'medieval'); });   // source = active package
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
});

test('hex same-id mode from another package: warns, adds the dependency, tells the owner, creates the entry', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await source(page).selectOption('decameroon');
  await modeRadio(page, 'same').click();
  await expect(page.locator('#reskin-picker-modal')).toContainText('SAME id');
  await expect(page.locator('#reskin-picker-modal')).toContainText('the package that loads later');
  await expect(page.locator('#reskin-picker-modal')).toContainText('decameroon');
  await expect(page.locator('#reskin-picker-modal')).toContainText('load first');
  await page.locator('#reskin-search').fill('dec_tile');
  await items(page).first().click();
  expect(await hexOf(page, 'Dec_Tile', 'medieval')).toHaveLength(1);
  expect(await hexOf(page, 'Dec_Tile', 'decameroon')).toHaveLength(1);
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual(['decameroon']);
  await expect(toastWith(page, 'dependenc')).toContainText('decameroon');
});

test('same-id mode: an existing dependency (also with a range) is not duplicated; postapoc source adds nothing', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => Packages.updateDetails('medieval', { dependencies: ['decameroon@^1.0.0'] }));
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'same', 'decameroon'); });
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual(['decameroon@^1.0.0']);
  expect(await hexOf(page, 'Dec_Tile', 'medieval')).toHaveLength(1);
  await page.evaluate(() => { HexDB.addReskin('Zq_Base', 'same'); });
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual(['decameroon@^1.0.0']);
});

test('same-id mode that would create a dependency cycle is refused: no entry, no dependency, clear message', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => Packages.updateDetails('decameroon', { dependencies: ['medieval'] }));
  const n0 = await page.evaluate(() => HexDB.getAll().length);
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'same', 'decameroon'); });
  expect(await page.evaluate(() => HexDB.getAll().length)).toBe(n0);
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual([]);
  await expect(toastWith(page, 'cycle')).toBeVisible();
  // prefix mode has no load-order issue and still works
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix', 'decameroon'); });
  expect(await hexOf(page, 'Medieval_Dec_Tile', 'medieval')).toHaveLength(1);
});

test('picker disabling follows the chosen source and mode', async ({ page }) => {
  await open(page); await seed(page);
  await seedHexes(page, [hexRec('Medieval_Dec_Tile', 'medieval'), hexRec('Dec_Other', 'medieval')]);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await source(page).selectOption('decameroon');
  await expect(page.locator('.reskin-item[data-id="Dec_Tile"]')).toBeDisabled();     // prefixed copy exists
  await expect(page.locator('.reskin-item[data-id="Dec_Other"]')).toBeEnabled();
  await modeRadio(page, 'same').click();
  await expect(page.locator('.reskin-item[data-id="Dec_Tile"]')).toBeEnabled();
  await expect(page.locator('.reskin-item[data-id="Dec_Other"]')).toBeDisabled();    // same id exists
});

test('texts are source aware; with no other package entries a toast explains', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { HexDB.promptReskin(); });
  await expect(page.locator('#reskin-picker-modal')).toContainText('Source package');
  await source(page).selectOption('decameroon');
  await expect(page.locator('#reskin-picker-modal .reskin-hint').first()).toContainText('decameroon');
  await expect(page.locator('#reskin-picker-modal .reskin-hint').first()).not.toContainText('postapoc');
  await expect(page.locator('#reskin-picker-modal [role="radiogroup"]')).toContainText('Medieval_Plain_1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hexdb-add-reskin-btn')).not.toHaveAttribute('title', /postapoc id/);
  await page.evaluate(() => {
    HexDB.getAll().splice(0, HexDB.getAll().length, ...HexDB.getAll().filter((h: any) => h.package === 'medieval'));
    HexDB.promptReskin();
  });
  await expect(page.locator('#reskin-picker-modal')).toHaveCount(0);
  await expect(toastWith(page, 'No hex tiles in other packages')).toBeVisible();
});

test('building picker: source select, prefix copy and same-id with dependency', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { BldDB.promptReskin(); });
  await expect(source(page)).toHaveValue('postapoc');
  expect(await options(page)).toEqual(['postapoc', 'decameroon']);
  await source(page).selectOption('decameroon');
  expect(await ids(page)).toEqual(['Dec_Hall']);
  await items(page).first().click();
  const copy = await bldOf(page, 'Medieval_Dec_Hall', 'medieval');
  expect(copy).toHaveLength(1);
  expect(copy[0]).toMatchObject({ spriteName: 'DecHall', buildingCategory: 'Standard' });
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual([]);
  await page.evaluate(() => { BldDB.addReskin('Dec_Hall', 'same', 'decameroon'); });
  expect(await bldOf(page, 'Dec_Hall', 'medieval')).toHaveLength(1);
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual(['decameroon']);
});

test('building same-id cycle is refused', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => Packages.updateDetails('decameroon', { dependencies: ['medieval'] }));
  const n0 = await page.evaluate(() => BldDB.getAll().length);
  await page.evaluate(() => { BldDB.addReskin('Dec_Hall', 'same', 'decameroon'); });
  expect(await page.evaluate(() => BldDB.getAll().length)).toBe(n0);
  await expect(toastWith(page, 'cycle')).toBeVisible();
});

test('existing behaviour: postapoc source with a dependency-free same-id still adds no dependency', async ({ page }) => {
  await open(page); await seed(page);
  await page.evaluate(() => { BldDB.addReskin('Zq_Farm', 'same'); });
  expect(await bldOf(page, 'Zq_Farm', 'medieval')).toHaveLength(1);
  expect(await page.evaluate(() => Packages.getDependencies('medieval'))).toEqual([]);
});

test.describe('publishing a package that holds a copy from another package', () => {
  test('hex: the sprite is uploaded into the copy\'s own hex folder (source sprite on the server)', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/decameroon/sprites/hex/DecSp.png', SPR);
    await open(page, gh); await seed(page);
    await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix', 'decameroon'); });
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ total: 1, pushed: 1, missing: [] });
    expect(gh.putPaths()).toContain('packages/medieval/sprites/hex/DecSp.png');
    expect(gh.putPaths()).not.toContain('packages/medieval/sprites/buildings/DecSp.png');
    expect(gh.read('packages/medieval/sprites/hex/DecSp.png')!.equals(SPR)).toBe(true);
  });

  test('building: the sprite goes to the buildings folder; a source sprite held only in the local store is used too', async ({ page }) => {
    const gh = new FakeGitHub();
    await open(page, gh); await seed(page);
    await page.evaluate(async d => { await SpriteStore.save('DecHall', d, 'buildings', 'decameroon'); }, dataUrl(SPR));
    await page.evaluate(() => { BldDB.addReskin('Dec_Hall', 'prefix', 'decameroon'); });
    expect(await page.evaluate(() => Packages.findMissingSprites('medieval'))).toEqual([]);
    const res = await page.evaluate(() => Packages.publishPackageSprites('medieval'));
    expect(res).toMatchObject({ total: 1, pushed: 1, missing: [] });
    expect(gh.putPaths()).toContain('packages/medieval/sprites/buildings/DecHall.png');
    expect(gh.read('packages/medieval/sprites/buildings/DecHall.png')!.equals(SPR)).toBe(true);
  });

  test('full publish: manifest lists the sprite from the right folder and nothing is reported missing', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.write('packages/decameroon/sprites/hex/DecSp.png', SPR);
    gh.write('packages/decameroon/sprites/buildings/DecHall.png', SPR);
    await open(page, gh); await seed(page);
    await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix', 'decameroon'); BldDB.addReskin('Dec_Hall', 'prefix', 'decameroon'); });
    const r = await page.evaluate(() => Packages.publishPackage('medieval', { bump: 'none' }));
    expect(r).toMatchObject({ ok: true });
    const man = gh.json('packages/medieval/manifest.json');
    const paths = man.files.map((f: any) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['sprites/hex/DecSp.png', 'sprites/buildings/DecHall.png', 'hex_database.json', 'building_database.json']));
    expect(gh.json('packages/medieval/hex_database.json').hexes.map((h: any) => h.id)).toEqual(expect.arrayContaining(['Medieval_Dec_Tile']));
    expect(gh.read('packages/medieval/sprites/hex/DecSp.png')!.equals(SPR)).toBe(true);
  });
});

test('the new copy renders its sprite at once (alias to the source package file)', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.write('packages/decameroon/sprites/hex/DecSp.png', SPR);
  await open(page, gh); await seed(page);
  await page.evaluate(() => { HexDB.addReskin('Dec_Tile', 'prefix', 'decameroon'); });
  const src = await page.evaluate(() => Packages.spriteSrc(HexDB.getAll().find((h: any) => h.id === 'Medieval_Dec_Tile'), 'hex'));
  expect(src).toContain('packages/decameroon/sprites/hex/DecSp.png');
});
