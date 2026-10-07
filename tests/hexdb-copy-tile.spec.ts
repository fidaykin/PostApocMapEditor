import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage, TINY_PNG } from './helpers';

// Owner report 2026-10-07: "Decameroon_Rift_1_copy а малює воду" (a HEX DB copy of the Decameroon rift paints water).
// Root cause (reproduced with the live packages/decameroon/hex_database.json): painting ANY land tile (the copy and the
// original alike) into or next to a lake handed the touched cells to the edge re-resolution, which turned the adjacent
// lake / shore pieces into flat water. The id is not parsed: the copy keeps type 'Volcanic/Rift' and its spriteName. That
// logic is gone from the hand tools (manual-no-water-logic.spec.ts). Independent defects found on the way, fixed here:
//   * HexDB Paste and Reskin+ did not load the new entry's sprite nor rebuild the palette: the copy had no palette button
//     and painted as an empty dark hex until a reload or a field edit;
//   * editing any field of the copy rewrote its biome to the first list entry ('Decameron' is not a defined biome);
//   * the selected-tile preview always looked for a package tile's sprite in the base package folder;
//   * Scatter grouped "variants" by the first '_' segment of the id, which for a package tile is the package prefix
//     (Decameroon_): every Volcanic/Rift tile of the package was a variant of the rift.
// Fixture: the live Decameroon entries (exact id, type, biome, spriteName, category), trimmed to the fields that matter.
const LIVE = (id: string, type: string, spriteName: string, extra: object = {}) => ({
  id, type, spriteName, biome: 'Decameron', filterCategory: 'FilterTerrain', terrainTypeId: -1, package: 'decameroon', edgeFaces: [],
  category: type === 'Volcanic/Rift' ? '🌋 VOLCANIC/RIFT' : type === 'Water' ? '💧 WATER / RIVER' : type === 'Rivers' ? '💧 WATER / RIVER' : '🌾 PLAINS', ...extra });
const DEC = [
  LIVE('Decameroon_Plain_1', 'Plains', 'Decameroon_Plain_1'),
  LIVE('Decameroon_Water_1', 'Water', 'Decameroon_Water'),
  LIVE('Decameroon_DirtyWater_1', 'Water', 'Decameroon_DirtyWater_1'),
  LIVE('Decameroon_Lake_3', 'Rivers', 'Decameroon_Lake_3', { edgeFaces: ['N'] }),
  LIVE('Decameroon_Lava_Plain_1', 'Volcanic/Rift', 'Decameroon_LavaPlain_1'),
  LIVE('Decameroon_Lava_Rift_1', 'Volcanic/Rift', 'Decameroon_LavaRift_1'),
  LIVE('Decameroon_Rift_1', 'Volcanic/Rift', 'Decameroon_Rift_1'),
];

async function decEditor(page: Page) {
  const gh = new FakeGitHub();
  const sprites: Record<string, Buffer> = {};
  for (const h of DEC) sprites['hex/' + h.spriteName + '.png'] = TINY_PNG;
  seedServerPackage(gh, 'decameroon', { name: 'Decameroon', hexes: DEC, sprites });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await page.waitForFunction(() => Terrain.spriteState('Decameroon_Rift_1') === 'loaded');
  await page.evaluate(() => { IO.setNewMapSize(40, 40); IO.applyNewMap(); for (let i = 0; i < mapData.length; i++) mapData[i] = 'Decameroon_Plain_1'; });
}

/** HEX DB > select the row of `id` > Copy > Paste, as the buttons do. Returns the new entry. */
async function copyPaste(page: Page, id: string) {
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('.hexdb-list-row', { hasText: new RegExp('^' + id + '$') }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  return page.evaluate((id) => HexDB.getAll().find((h: any) => h.id === id + '_copy'), id);
}

test.describe('a HEX DB copy of a land tile paints that tile, never water (owner report)', () => {
  test.beforeEach(async ({ page }) => { await decEditor(page); });

  test('Copy/Paste of Decameroon_Rift_1: the copy keeps type, biome, spriteName and package; its sprite loads at once; it gets a palette button', async ({ page }) => {
    const copy = await copyPaste(page, 'Decameroon_Rift_1');
    expect(copy).toMatchObject({ id: 'Decameroon_Rift_1_copy', type: 'Volcanic/Rift', biome: 'Decameron', spriteName: 'Decameroon_Rift_1', package: 'decameroon', edgeFaces: [] });
    await page.waitForFunction(() => Terrain.spriteState('Decameroon_Rift_1_copy') === 'loaded', null, { timeout: 5000 });
    const r = await page.evaluate(() => ({
      same: Terrain.getSprite('Decameroon_Rift_1_copy')!.src === Terrain.getSprite('Decameroon_Rift_1')!.src,
      src: Terrain.getSprite('Decameroon_Rift_1_copy')!.src,
      btn: !!document.querySelector('.tile-btn[data-hex-id="Decameroon_Rift_1_copy"]'),
    }));
    expect(r.same).toBe(true);
    expect(r.src).toContain('/packages/decameroon/sprites/hex/Decameroon_Rift_1.png');
    expect(r.btn).toBe(true);
  });

  test('editing a field of the copy keeps its biome (Decameron is not a defined biome) and its type', async ({ page }) => {
    await copyPaste(page, 'Decameroon_Rift_1');
    await page.locator('#hexdb-right [data-field="textId"]').fill('rift_copy_name');
    await page.locator('#hexdb-right [data-field="textId"]').dispatchEvent('change');
    const h = await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Decameroon_Rift_1_copy'));
    expect(h).toMatchObject({ textId: 'rift_copy_name', biome: 'Decameron', type: 'Volcanic/Rift' });
  });

  test('Reskin+ copy (prefix mode) loads its sprite and gets a palette button without a reload', async ({ page }) => {
    await page.evaluate(() => { Packages.setActive('decameroon'); HexDB.addReskin('Plain_2'); });
    const h = await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Decameroon_Plain_2'));
    expect(h).toMatchObject({ package: 'decameroon', spriteName: 'Plain_2', type: 'Plains' });
    // the base sprite name is not in the package folder: the load is attempted at once (failed, not 'unknown')
    await page.waitForFunction(() => ['loaded', 'failed'].includes(Terrain.spriteState('Decameroon_Plain_2')), null, { timeout: 5000 });
    expect(await page.evaluate(() => !!document.querySelector('.tile-btn[data-hex-id="Decameroon_Plain_2"]'))).toBe(true);
  });

  for (const suffix of ['_copy', '_2x', '_Copy_3']) {
    test(`a clone under an id with the suffix ${suffix} is an opaque id: stored, typed, drawn and scattered as the rift`, async ({ page }) => {
      const id = 'Decameroon_Rift_1' + suffix;
      const r = await page.evaluate(async (id) => {
        const base = HexDB.getAll().find((h: any) => h.id === 'Decameroon_Rift_1');
        HexDB.addEntries([{ ...structuredClone(base), id }]);
        await Terrain.applyHexDbOverrides(HexDB.getAll().filter((h: any) => h.id === id));
        UI.selectTerrain(id);
        Tools.applyTerrainCells([{ col: 20, row: 20 }], UI.getSelectedTerrain());
        const e = Terrain.byHexId(mapData[20 * MAP_WIDTH + 20]);
        return {
          stored: mapData[20 * MAP_WIDTH + 20], type: e.type,
          sameSprite: Terrain.getSprite(id)!.src === Terrain.getSprite('Decameroon_Rift_1')!.src,
          variants: Tools.scatterVariants(id).slice().sort(),
          preview: (document.getElementById('palette-sel-img') as HTMLImageElement).src,
        };
      }, id);
      expect(r.stored).toBe(id);
      expect(r.type).toBe('Volcanic/Rift');
      expect(r.sameSprite).toBe(true);
      expect(r.preview).toContain('/packages/decameroon/sprites/hex/Decameroon_Rift_1.png');
      // variants: the rift family of the package only (the package prefix is not the family), never water or lava
      expect(r.variants).toEqual(['Decameroon_Rift_1', id].sort());
    });
  }

  test('the selected-tile preview of a package tile whose sprite is not loaded yet points into its own package folder', async ({ page }) => {
    const src = await page.evaluate(() => {
      HexDB.addEntries([{ id: 'Decameroon_NotLoaded_1', type: 'Volcanic/Rift', spriteName: 'Decameroon_Rift_1', package: 'decameroon', edgeFaces: [] }]);
      UI.selectTerrain('Decameroon_NotLoaded_1');
      return (document.getElementById('palette-sel-img') as HTMLImageElement).src;
    });
    expect(src).toContain('/packages/decameroon/sprites/hex/Decameroon_Rift_1.png');   // was packages/postapoc/sprites/hex/...
  });

  test('scatter families of package tiles skip the package prefix: lava tiles group together, the rift alone', async ({ page }) => {
    const r = await page.evaluate(() => ({ lava: Tools.scatterVariants('Decameroon_Lava_Rift_1').slice().sort(), rift: Tools.scatterVariants('Decameroon_Rift_1'), base: Tools.scatterVariants('Water_1').slice().sort() }));
    expect(r.lava).toEqual(['Decameroon_Lava_Plain_1', 'Decameroon_Lava_Rift_1']);
    expect(r.rift).toEqual(['Decameroon_Rift_1']);
    expect(r.base).toContain('Water_Dirty_1');      // base families are unchanged (no package prefix to skip)
  });

  test('painting the copy into a lake writes only that cell: the lake / shore pieces around it do not turn into water', async ({ page }) => {
    await copyPaste(page, 'Decameroon_Rift_1');
    await page.evaluate(() => App.setMode('map'));
    const d = await page.evaluate(() => {
      const W = MAP_WIDTH;
      for (let r = 10; r <= 20; r++) for (let c = 10; c <= 20; c++) mapData[r * W + c] = 'Decameroon_Water_1';
      for (let c = 10; c <= 20; c++) mapData[10 * W + c] = 'Decameroon_Lake_3';
      const before = mapData.slice();
      UI.selectTerrain('Decameroon_Rift_1_copy');
      Tools.applyTerrainCells([{ col: 15, row: 11 }], UI.getSelectedTerrain());
      const out: string[] = [];
      for (let i = 0; i < mapData.length; i++) if (mapData[i] !== before[i]) out.push((i % W) + ',' + Math.floor(i / W) + '=' + mapData[i]);
      return out;
    });
    expect(d).toEqual(['15,11=Decameroon_Rift_1_copy']);   // before the fix: 14,10 15,10 16,10 Lake_3 -> Decameroon_Water_1 as well
  });
});
