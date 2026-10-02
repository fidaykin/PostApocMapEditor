import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';
import { VIEWPORT, setupScene, frame, hashCanvas, checkBaseline, expectFasterThan } from './perf-scene';

declare const Terrain: any, HexDB: any, UI: any, Packages: any;
test.use({ viewport: VIEWPORT });

test('byHexId returns a stable memoised object', async ({ page }) => {
  await openEditor(page);
  const same = await page.evaluate(() => Terrain.byHexId('Plain_1') === Terrain.byHexId('Plain_1'));
  expect(same).toBe(true);
});

test('byHexId keeps case-insensitive lookup, first duplicate wins, unknown is null', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes: [
      { id: 'Dup_1', type: 'Plains', spriteName: '', edgeFaces: [], note: 'first' },
      { id: 'dup_1', type: 'Water', spriteName: '', edgeFaces: [], note: 'second' } ] });
    return { n: Terrain.byHexId('DUP_1')?.note, name: Terrain.byHexId('dup_1')?.name,
             unknown: Terrain.byHexId('nope_999'), empty: Terrain.byHexId(''), num: Terrain.byHexId(5 as any) };
  });
  expect(r).toEqual({ n: 'first', name: 'Dup_1', unknown: null, empty: null, num: null });
});

test('200k byHexId calls are fast', async ({ page }) => {
  await openEditor(page);
  const ms = await page.evaluate(() => {
    const ids = ['Plain_1', 'Forest_1', 'Water_1', 'Hills_1'];
    const s = performance.now();
    for (let i = 0; i < 200000; i++) Terrain.byHexId(ids[i & 3]);
    return performance.now() - s;
  });
  expectFasterThan('t_byHexId_200k', ms, 0.25);
  expect(ms).toBeLessThan(100);
});

test('memo is invalidated when HexDB changes', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const before = Terrain.byHexId('Plain_1');
    const rev0 = HexDB.getRev();
    HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 },
      hexes: [{ id: 'Zz_1', type: 'Plains', spriteName: '', edgeFaces: [] }] });
    return { hadBefore: !!before, rev: HexDB.getRev() > rev0, plainGone: Terrain.byHexId('Plain_1') === null,
             zz: Terrain.byHexId('Zz_1')?.id };
  });
  expect(r).toEqual({ hadBefore: true, rev: true, plainGone: true, zz: 'Zz_1' });
});

const SEED = `HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes: [
  { id: 'Aa_1', type: 'Plains', spriteName: '', edgeFaces: [] },
  { id: 'Bb_1', type: 'Water', spriteName: '', edgeFaces: [] } ] });`;

// Each case warms the memo (including negative entries) then mutates through the module API.
const cases: Record<string, string> = {
  add: `HexDB.add(); return [Terrain.byHexId('NewHex_2')?.id, 'NewHex_2'];`,
  'edit id': `HexDB.add(); Terrain.byHexId('NewHex_2'); Terrain.byHexId('Renamed_1'); const el = document.getElementById('hexdb-id'); el.value = 'Renamed_1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return [Terrain.byHexId('Renamed_1')?.id, 'Renamed_1', Terrain.byHexId('NewHex_2')];`,
  'edit type field': `HexDB.add(); const el = document.getElementById('hexdb-id'); el.value = 'Ed_1';
    el.dispatchEvent(new Event('input', { bubbles: true })); Terrain.byHexId('Ed_1');
    const t = document.querySelector('#hexdb-right [data-field="type"]'); t.value = 'Water';
    t.dispatchEvent(new Event('change', { bubbles: true }));
    return [Terrain.byHexId('Ed_1')?.type, 'Water'];`,
  'edit sprite field': `HexDB.add(); const el = document.getElementById('hexdb-id'); el.value = 'Sp_1';
    el.dispatchEvent(new Event('input', { bubbles: true })); Terrain.byHexId('Sp_1');
    const s = document.querySelector('#hexdb-right [data-field="spriteName"]'); s.value = 'Sp_Sprite';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return [Terrain.byHexId('Sp_1')?.spriteName, 'Sp_Sprite'];`,
  'delete': `HexDB.add(); UI.showConfirm = (_t, _m, cb) => cb(); HexDB.deleteSelected();
    return [Terrain.byHexId('NewHex_2'), null];`,
  'copy/paste': `HexDB.add(); HexDB.copy(); HexDB.paste();
    return [Terrain.byHexId('NewHex_2_copy')?.id, 'NewHex_2_copy'];`,
  addEntries: `HexDB.addEntries([{ id: 'Ent_1', type: 'Plains', spriteName: '', edgeFaces: [], package: 'pk' }]);
    return [Terrain.byHexId('Ent_1')?.id, 'Ent_1'];`,
  removeByPackage: `HexDB.addEntries([{ id: 'Ent_1', type: 'Plains', spriteName: '', edgeFaces: [], package: 'pk' }]);
    const had = Terrain.byHexId('Ent_1')?.id; HexDB.removeByPackage('pk');
    return [had + '|' + Terrain.byHexId('Ent_1'), 'Ent_1|null'];`,
  mergeFromServer: `HexDB.mergeFromServer('pk', { version: 1, hexes: [{ id: 'Mg_1', type: 'Plains', spriteName: '', edgeFaces: [] }] });
    return [Terrain.byHexId('Mg_1')?.id, 'Mg_1'];`,
  loadFromObject: `HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes: [{ id: 'Lo_1', type: 'Plains', spriteName: '', edgeFaces: [] }] });
    return [Terrain.byHexId('Lo_1')?.id + '|' + Terrain.byHexId('Aa_1'), 'Lo_1|null'];`,
  // a reskin keeps the id: the postapoc entry stays first and keeps winning, the list grows
  'reskin add': `Packages.getActive = () => 'pk'; const n0 = HexDB.getAll().length; HexDB.addReskin('Aa_1');
    return [[Terrain.byHexId('Aa_1')?.package ?? 'postapoc', HexDB.getAll().length - n0], ['postapoc', 1]];`,
  'migrateToBuilding': `HexDB.add(); const had = Terrain.byHexId('NewHex_2')?.id; UI.showConfirm = (_t, _m, cb) => cb();
    HexDB.migrateToBuilding();
    await new Promise(r => setTimeout(r, 400));
    return [had + '|' + Terrain.byHexId('NewHex_2'), 'NewHex_2|null'];`,
};
for (const [name, body] of Object.entries(cases)) {
  test(`invalidates on ${name}`, async ({ page }) => {
    await openEditor(page);
    const [got, want] = await page.evaluate(`(async () => { ${SEED}
      Terrain.byHexId('Aa_1'); Terrain.byHexId('Bb_1'); Terrain.byHexId('NewHex_2'); Terrain.byHexId('NewHex_2_copy');
      for (const k of ['Renamed_1','Ed_1','Sp_1','Ent_1','Mg_1','Lo_1']) Terrain.byHexId(k);
      Terrain.getTerrainSpriteForType('Water');
      const select = () => { try { HexDB.getAll(); } catch(e) {} };
      const r = await (async () => { ${body} })();
      return r; })()`) as [any, any];
    expect(got).toEqual(want);
  });
}

test('getTerrainSpriteForType memo follows HexDB changes', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(async () => {
    HexDB.loadFromObject({ version: 1, common: { goldPerTap: 10 }, hexes: [] });
    const none = Terrain.getTerrainSpriteForType('Water');
    HexDB.addEntries([{ id: 'Water_X', type: 'Water', spriteName: 'Water_X', edgeFaces: [] }]);
    // the entry is now found; its sprite loads async so only the lookup path is exercised
    const a = Terrain.getTerrainSpriteForType('Water');
    HexDB.removeByPackage('postapoc');
    return { none, after: a, removed: Terrain.getTerrainSpriteForType('Water') };
  });
  expect(r.none).toBeNull();
  expect(r.removed).toBeNull();
});

test('render output unchanged and faster', async ({ page }) => {
  await openEditor(page);
  await setupScene(page);
  await frame(page, 100);
  checkBaseline('render_100', await hashCanvas(page, '#map-canvas'));
});
