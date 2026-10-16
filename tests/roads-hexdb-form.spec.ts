import { test, expect } from '@playwright/test';
import { FakeGitHub } from './helpers';
import { seedRoadsWorld, seedRoadsServer, BASE_HEXES, bldRoads } from './roads-fixtures';

// Roads/Bridges V1, editor phase E: the data model (E2) and the Hex DB form block (E3).
test.describe('allowedRoads data model', () => {
  test('HexDB.add() creates a record with allowedRoads [] and roadAllowed false', async ({ page }) => {
    await seedRoadsWorld(page);
    const rec = await page.evaluate(() => { HexDB.add(); const all = HexDB.getAll(); return all[all.length - 1]; });
    expect(rec.allowedRoads).toEqual([]);
    expect(rec.roadAllowed).toBe(false);
  });

  test('a record loaded WITHOUT allowedRoads keeps no such property (load and mergeFromServer); positive control: with it, it stays', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(({ hexes }) => {
      const mk = (id: string, extra: object = {}) => ({ id, type: 'Plains', spriteName: id, ...extra });
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('NoField'), mk('WithField', { allowedRoads: ['road'] })] }));
      const viaLoad = HexDB.getAll().map((h: any) => ({ id: h.id, has: 'allowedRoads' in h, ar: h.allowedRoads }));
      HexDB.mergeFromServer('postapoc', { version: 1, hexes: [mk('SrvNo'), mk('SrvWith', { allowedRoads: ['bridge'] })] });
      const viaMerge = HexDB.getAll().filter((h: any) => h.id.startsWith('Srv')).map((h: any) => ({ id: h.id, has: 'allowedRoads' in h }));
      return { viaLoad, viaMerge };
    }, { hexes: BASE_HEXES });
    expect(r.viaLoad.find((x: any) => x.id === 'NoField')!.has).toBe(false);
    expect(r.viaLoad.find((x: any) => x.id === 'WithField')).toMatchObject({ has: true, ar: ['road'] });
    expect(r.viaMerge.find((x: any) => x.id === 'SrvNo')!.has).toBe(false);
    expect(r.viaMerge.find((x: any) => x.id === 'SrvWith')!.has).toBe(true);
  });

  test('migration normalises a list (dedupe, non-strings out) and removes a non-array value instead of turning it into []', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, ar: any) => ({ id, type: 'Plains', spriteName: id, allowedRoads: ar });
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('A', ['road', 'road', 7, '']), mk('B', 'road'), mk('C', {}), mk('D', null), mk('E', [])] }));
      return Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, 'allowedRoads' in h ? h.allowedRoads : 'ABSENT']));
    });
    expect(r).toEqual({ A: ['road'], B: 'ABSENT', C: 'ABSENT', D: 'ABSENT', E: [] });
  });

  test('roadAllowed is re-derived from the list when the field is an array (D2), and keeps the boolean normalisation when absent', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const mk = (id: string, extra: object) => ({ id, type: 'Plains', spriteName: id, ...extra });
      HexDB.load(JSON.stringify({ version: 1, hexes: [
        mk('Road', { allowedRoads: ['road'], roadAllowed: false }), mk('BridgeOnly', { allowedRoads: ['bridge'], roadAllowed: true }),
        mk('Empty', { allowedRoads: [], roadAllowed: true }), mk('Unknown', { allowedRoads: ['road_old'], roadAllowed: true }),
        mk('LegacyTrue', { roadAllowed: true }), mk('LegacyJunk', { roadAllowed: 'yes' })] }));
      return Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
    });
    expect(r).toEqual({ Road: true, BridgeOnly: false, Empty: false, Unknown: false, LegacyTrue: true, LegacyJunk: false });
  });

  test('autosave restore with a wrong derived flag: after startup the flag follows the list', async ({ page }) => {
    const gh = new FakeGitHub();
    seedRoadsServer(gh);
    // the stored session has a tile listing "road" with a wrong derived flag; the stale checkout Building DB has no "road" record
    const stored = { version: 1, dbVersion: 5, common: { goldPerTap: 10 }, hexes: [{ ...BASE_HEXES[0], allowedRoads: ['road'], roadAllowed: false }, ...BASE_HEXES.slice(1)] };
    const { openEditor } = await import('./helpers');
    await openEditor(page, { gh, pat: true, storage: { hexdb_autosave: JSON.stringify(stored) } });
    await expect.poll(() => page.evaluate(() => BldDB.getAll().some((b: any) => b.id === 'road'))).toBe(true);
    await expect.poll(() => page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').roadAllowed)).toBe(true);
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads)).toEqual(['road']);
  });

  test('refreshDerived corrects the legacy flag once the Building DB knows the road types (load-order guard)', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate((blds) => {
      const mk = (id: string, ar: string[]) => ({ id, type: 'Plains', spriteName: id, allowedRoads: ar });
      // Building DB without the road types yet (only a bridge): "road" is unknown, the flag derives to false
      BldDB.load(JSON.stringify({ version: 2, buildings: blds.filter((b: any) => b.id === 'bridge') }));
      HexDB.load(JSON.stringify({ version: 1, hexes: [mk('R', ['road']), mk('B', ['bridge'])] }));
      const before = Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
      BldDB.load(JSON.stringify({ version: 2, buildings: blds }));
      const rev0 = HexDB.getRev();
      const changed = HexDB.refreshDerived();
      const after = Object.fromEntries(HexDB.getAll().map((h: any) => [h.id, h.roadAllowed]));
      return { before, changed, after, revDelta: HexDB.getRev() - rev0, again: HexDB.refreshDerived() };
    }, bldRoads());
    expect(r.before).toEqual({ R: false, B: false });
    expect(r.changed).toBe(1);
    expect(r.after).toEqual({ R: true, B: false });
    expect(r.revDelta).toBe(1);
    expect(r.again).toBe(0);
  });

  test('setAllowedRoads / getAllowedRoads: sorts by Building DB order, dedupes, derives roadAllowed, one autosave; accepts record, index and key', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const all = HexDB.getAll();
      const rec = all.find((h: any) => h.id === 'Decameroon_Plain_1');
      const rev0 = HexDB.getRev();
      HexDB.setAllowedRoads(rec, ['bridge_2', 'road_2', 'road', 'road', 'zzz']);
      const rev1 = HexDB.getRev();
      const afterRec = { ar: rec.allowedRoads, ra: rec.roadAllowed, get: HexDB.getAllowedRoads(rec) };
      const idx = all.indexOf(all.find((h: any) => h.id === 'Decameroon_Water_1'));
      HexDB.setAllowedRoads(idx, ['bridge_2']);
      const byIdx = { ar: all[idx].allowedRoads, ra: all[idx].roadAllowed };
      HexDB.setAllowedRoads('decameroon::Decameroon_Rubble_1', ['road']);
      const byKey = HexDB.getAllowedRoads('decameroon::Decameroon_Rubble_1');
      HexDB.setAllowedRoads('Plain_1', ['road']);
      const byBare = HexDB.getAllowedRoads('postapoc::Plain_1');
      return { d: rev1 - rev0, afterRec, byIdx, byKey, byBare, missing: HexDB.getAllowedRoads('Nope') };
    });
    expect(r.d).toBe(1);
    expect(r.afterRec).toEqual({ ar: ['road', 'road_2', 'bridge_2', 'zzz'], ra: true, get: ['road', 'road_2', 'bridge_2', 'zzz'] });
    expect(r.byIdx).toEqual({ ar: ['bridge_2'], ra: false });
    expect(r.byKey).toEqual(['road']);
    expect(r.byBare).toEqual(['road']);
    expect(r.missing).toBeNull();
  });
});

// ── E3: the ROADS / BRIDGES block of the Hex DB form ─────────────────────────────────────────────────────────────
async function selectHex(page: any, id: string) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.evaluate(() => { const t = document.getElementById('hexdb-search') as HTMLInputElement; t.value = ''; t.dispatchEvent(new Event('input')); });
  await page.locator('.hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).first().click();
  await expect(page.locator('#hexdb-roads')).toBeVisible();
}
const ar = (page: any, id: string) => page.evaluate((id: string) => { const h = HexDB.getAll().find((h: any) => h.id === id); return { ar: h.allowedRoads, has: 'allowedRoads' in h, ra: h.roadAllowed }; }, id);
const box = (page: any, rid: string) => page.locator(`#hexdb-roads input[data-road-id="${rid}"]`);

test.describe('Hex DB form: ROADS / BRIDGES block', () => {
  test('lists exactly the four fixture types in Building DB order, no data-field on them, old roadAllowed checkbox gone', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectHex(page, 'Decameroon_River_L_1');
    const ids = await page.locator('#hexdb-roads input[data-road-id]').evaluateAll((els: any[]) => els.map(e => e.dataset.roadId));
    expect(ids).toEqual(['road', 'road_2', 'bridge', 'bridge_2']);
    expect(await page.locator('#hexdb-roads [data-field]').count()).toBe(0);
    expect(await page.locator('#hexdb-right [data-field="roadAllowed"]').count()).toBe(0);
    await expect(page.locator('#hexdb-roads .hexdb-roads-roads')).toContainText('road (building_road, Gold 50)');
    await expect(page.locator('#hexdb-roads .hexdb-roads-bridges')).toContainText('bridge (bridge, Gold 6500)');
  });

  test('a 5th road type added to the Building DB appears after re-selecting the row, with no code change', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => BldDB.addEntries([{ id: 'road_3', package: 'postapoc', isRoad: true, buildingCategory: 'Standard', spriteName: 'road_hex_36_NS', price: [{ type: 'Gold', amount: 120 }], availableTiles: [] }]));
    await selectHex(page, 'Decameroon_Plain_1');
    const ids = await page.locator('#hexdb-roads input[data-road-id]').evaluateAll((els: any[]) => els.map(e => e.dataset.roadId));
    expect(ids).toEqual(['road', 'road_2', 'road_3', 'bridge', 'bridge_2']);
  });

  test('ticking bridge sets [bridge], roadAllowed false, exactly one autosave; ticking road makes roadAllowed true; no property named after the id', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectHex(page, 'Decameroon_River_L_1');
    expect(await ar(page, 'Decameroon_River_L_1')).toEqual({ ar: undefined, has: false, ra: false });   // fixture records are not backfilled
    const rev0 = await page.evaluate(() => HexDB.getRev());
    await box(page, 'bridge').check();
    expect(await ar(page, 'Decameroon_River_L_1')).toEqual({ ar: ['bridge'], has: true, ra: false });
    expect(await page.evaluate(() => HexDB.getRev())).toBe(rev0 + 1);
    await box(page, 'road').check();
    expect(await ar(page, 'Decameroon_River_L_1')).toEqual({ ar: ['road', 'bridge'], has: true, ra: true });
    expect(await page.evaluate(() => Object.keys(HexDB.getAll().find((h: any) => h.id === 'Decameroon_River_L_1')).filter(k => ['road', 'bridge'].includes(k)))).toEqual([]);
  });

  test('master: untick empties, retick restores the remembered list; master reflects the list', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road', 'road_2']));
    await selectHex(page, 'Decameroon_Plain_1');
    const master = page.locator('#hexdb-roads-master');
    await expect(master).toBeChecked();
    await master.uncheck();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual([]);
    await expect(box(page, 'road')).not.toBeChecked();
    await master.check();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual(['road', 'road_2']);
    await expect(box(page, 'road_2')).toBeChecked();
  });

  test('master retick with nothing remembered applies the type default (Plains: road)', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectHex(page, 'Decameroon_Plain_2');
    await expect(page.locator('#hexdb-roads-master')).not.toBeChecked();
    await page.locator('#hexdb-roads-master').check();
    expect((await ar(page, 'Decameroon_Plain_2')).ar).toEqual(['road']);   // the Plains default
  });

  test('editing another field (textId) leaves allowedRoads untouched (guards the _readRecord interaction)', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road']));
    await selectHex(page, 'Decameroon_Plain_1');
    await page.locator('#hexdb-right [data-field="textId"]').fill('plain_one');
    await page.locator('#hexdb-right [data-field="textId"]').dispatchEvent('change');
    const r = await page.evaluate(() => { const h = HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1'); return { t: h.textId, ar: h.allowedRoads, ra: h.roadAllowed }; });
    expect(r).toEqual({ t: 'plain_one', ar: ['road'], ra: true });
  });

  test('an unset record shows the notice and enabled boxes; the first tick sets the field and removes the notice', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { const h = HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1'); delete h.allowedRoads; HexDB.refreshDerived(); });
    await selectHex(page, 'Decameroon_Plain_1');
    await expect(page.locator('#hexdb-roads .hexdb-roads-unset')).toContainText('Backfill roads');
    await expect(box(page, 'road')).toBeEnabled();
    expect((await ar(page, 'Decameroon_Plain_1')).has).toBe(false);
    await box(page, 'road').check();
    expect(await ar(page, 'Decameroon_Plain_1')).toEqual({ ar: ['road'], has: true, ra: true });
    await expect(page.locator('#hexdb-roads .hexdb-roads-unset')).toHaveCount(0);
    // positive control: a set record never shows the notice
    await page.evaluate(() => HexDB.setAllowedRoads('decameroon::Decameroon_Plain_2', []));
    await selectHex(page, 'Decameroon_Plain_2');
    await expect(page.locator('#hexdb-roads .hexdb-roads-unset')).toHaveCount(0);
  });

  test('an unknown id is a red row; its remove button drops only that id', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['road', 'road_old', 'gone_too']); });
    await selectHex(page, 'Decameroon_Plain_1');
    await expect(page.locator('#hexdb-roads .hexdb-roads-unknown')).toHaveCount(2);
    await expect(page.locator('#hexdb-roads .hexdb-roads-unknown').first()).toContainText('road_old');
    await page.locator('#hexdb-roads .hexdb-roads-unknown button[data-road-remove="road_old"]').click();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual(['road', 'gone_too']);
    await expect(page.locator('#hexdb-roads .hexdb-roads-unknown')).toHaveCount(1);
  });

  test('a duplicate in the stored list is shown once and flagged; the next change dedupes it', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_1').allowedRoads = ['road', 'road']; });
    await selectHex(page, 'Decameroon_Plain_1');
    await expect(page.locator('#hexdb-roads input[data-road-id="road"]')).toHaveCount(1);
    await expect(box(page, 'road')).toBeChecked();
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn')).toContainText('duplicate');
    await box(page, 'road_2').check();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual(['road', 'road_2']);
  });

  test('bridge boxes are not disabled on land (D6); a bridge on land and a road on water show a hint; a clean tile shows none', async ({ page }) => {
    await seedRoadsWorld(page);
    await selectHex(page, 'Decameroon_Plain_1');
    await expect(box(page, 'bridge')).toBeEnabled();
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn')).toHaveCount(0);
    await box(page, 'bridge').check();
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn')).toContainText('bridge');
    await selectHex(page, 'Decameroon_River_L_1');
    await box(page, 'road').check();
    await expect(page.locator('#hexdb-roads .hexdb-roads-warn')).toContainText('road');
  });

  test('Copy from tile copies the list of a tile of another package', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { HexDB.setAllowedRoads('postapoc::Plain_1', ['road', 'road_2']); });
    await selectHex(page, 'Decameroon_Plain_1');
    await page.locator('#hexdb-roads-copy-from').fill('Plain_1');
    await page.locator('#hexdb-roads-copy-btn').click();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual(['road', 'road_2']);
    await expect(box(page, 'road_2')).toBeChecked();
    // an unknown source id changes nothing
    await page.locator('#hexdb-roads-copy-from').fill('Nope_9');
    await page.locator('#hexdb-roads-copy-btn').click();
    expect((await ar(page, 'Decameroon_Plain_1')).ar).toEqual(['road', 'road_2']);
  });

  test('ids from imported data are escaped in the block (no markup injection)', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => { HexDB.setAllowedRoads('decameroon::Decameroon_Plain_1', ['<img src=x id=pwn>']); });
    await selectHex(page, 'Decameroon_Plain_1');
    await expect(page.locator('#hexdb-roads .hexdb-roads-unknown')).toContainText('<img src=x id=pwn>');
    expect(await page.locator('#pwn').count()).toBe(0);
  });
});
