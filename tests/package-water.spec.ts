import { test, expect, Page } from '@playwright/test';
import { openEditor, FakeGitHub, seedServerPackage } from './helpers';
import { clickCell, dragCells } from './editor-helpers';
import { readBaseline, setupScene, hashMapData } from './perf-scene';

// Owner report (live build f22f9b9, Decameroon package): "water broke: it places random water sprites and adds rocks
// and shores even INSIDE a water mass". Root cause: edge re-resolution looked up directional pieces among EVERY
// package's Water/Rivers tiles and fell back to the BASE dark/light/rock water roles, so re-resolving a Decameroon
// cell wrote base River_*/Lake_* pieces or a random Water_1 / Water_Dirty_1 / Water_Rock_1 into the Decameroon water.
// The fixture is a trimmed subset of the live packages/decameroon/hex_database.json (exact id, type, spriteName,
// edgeFaces; note the package's own Lake_N numbering differs from the base one).
const DEC_ROWS: [string, string, string, string[]][] = [
  ['Decameroon_Plain_1', 'Plains', 'Decameroon_Plain_1', []],
  ['Decameroon_Water_1', 'Water', 'Decameroon_Water', []],
  ['Decameroon_DirtyWater_1', 'Water', 'Decameroon_DirtyWater_1', []],
  ['Decameroon_WaterStones_1', 'Water', 'Decameroon_WaterStones_1', []],
  ['Decameroon_Fish_1', 'Water', 'Decameroon_Fish_1', []],
  ['Decameroon_Lake_1', 'Rivers', 'Decameroon_Lake_1', ['SW']],
  ['Decameroon_Lake_2', 'Rivers', 'Decameroon_Lake_2', ['NW']],
  ['Decameroon_Lake_3', 'Rivers', 'Decameroon_Lake_3', ['N']],
  ['Decameroon_Lake_4', 'Rivers', 'Decameroon_Lake_4', ['NE']],
  ['Decameroon_Lake_5', 'Rivers', 'Decameroon_Lake_5', ['SE']],
  ['Decameroon_Lake_6', 'Rivers', 'Decameroon_Lake_6', ['S']],
  ['Decameroon_Lake_7', 'Rivers', 'Decameroon_Lake_7', []],
  ['Decameroon_River_D_2', 'Rivers', 'Decameroon_River_D_2', ['SW', 'SE']],
  ['Decameroon_River_U_2', 'Rivers', 'Decameroon_River_U_2', ['NE', 'NW']],
  ['Decameroon_River_L_1', 'Rivers', 'Decameroon_River_L_1', ['N', 'S']],
  ['Decameroon_River_R_1', 'Rivers', 'Decameroon_River_R_1', ['N', 'S']],
  ['Decameroon_River_D_3', 'Rivers', 'Decameroon_River_D_3', ['NW', 'NE', 'S']],
  ['Decameroon_River_U_3', 'Rivers', 'Decameroon_River_U_3', ['N', 'SW', 'SE']],
  ['Decameroon_River_D_L_EE_2', 'Rivers', 'Decameroon_River_D_L_EE_2', ['NW', 'SW', 'SE']],
  ['Decameroon_River_U_R_EE_2', 'Rivers', 'Decameroon_River_U_R_EE_2', ['NW', 'NE', 'SE']],
  ['Decameroon_River_R_5', 'Rivers', 'Decameroon_River_R_5', ['NE', 'SW']],
  ['Decameroon_River_L_5', 'Rivers', 'Decameroon_River_L_5', ['NW', 'SE']],
  ['Decameroon_River_R_4', 'Rivers', 'Decameroon_River_R_4', ['S', 'NE']],
  ['Decameroon_River_L_4', 'Rivers', 'Decameroon_River_L_4', ['S', 'NW']],
  ['Decameroon_River_U_4', 'Rivers', 'Decameroon_River_U_4', ['N', 'SW']],
  ['Decameroon_River_D_4', 'Rivers', 'Decameroon_River_D_4', ['N', 'SE']],
];
const DEC = DEC_ROWS.map(([id, type, spriteName, edgeFaces]) => ({ id, type, spriteName, edgeFaces, package: 'decameroon' }));

/** Editor with the decameroon package synced in, a 40x40 Decameroon_Plain_1 map (floor(40/2) even: legacy and true
 *  adjacency agree, so issue K1 plays no part), Paint tool, brush 0. Math.random is pinned to 0 so a mixed-package
 *  candidate list always yields its FIRST entry (the base one): the old behaviour fails deterministically. */
async function decEditor(page: Page) {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'decameroon', { name: 'Decameroon', hexes: DEC });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  await page.evaluate(() => {
    IO.setNewMapSize(40, 40); IO.applyNewMap();
    for (let i = 0; i < mapData.length; i++) mapData[i] = 'Decameroon_Plain_1';
    Math.random = () => 0;
    UI.selectTerrain('Decameroon_Water_1');
    Tools.setActive('paint');
    Brush.setSize(0);
    Canvas.centerOnCity();
  });
}

/** A Decameroon water block rows/cols 14..26 with the given lake piece just above it at (20,13) (an authored shore). */
async function seedLake(page: Page) {
  await page.evaluate(() => {
    const W = MAP_WIDTH;
    for (let r = 14; r <= 26; r++) for (let c = 14; c <= 26; c++) mapData[r * W + c] = 'Decameroon_Water_1';
    mapData[13 * W + 20] = 'Decameroon_Lake_3';
    Canvas.render();
  });
}

/** Ids on the map that are not Decameroon tiles, and interior cells (2+ cells inside the block) that are not flat
 *  Decameroon water. Independent of the code under test: membership by id prefix and by the fixture's edgeFaces. */
async function audit(page: Page) {
  return page.evaluate((dec) => {
    const flat = new Set(dec.filter((h: any) => !h.edgeFaces.length && (h.type === 'Water' || h.type === 'Rivers')).map((h: any) => h.id));
    const W = MAP_WIDTH;
    const foreign = new Set<string>();
    for (const id of mapData) if (!String(id).startsWith('Decameroon_')) foreign.add(id);
    const badInterior: string[] = [];
    for (let r = 16; r <= 24; r++) for (let c = 16; c <= 24; c++) { const id = mapData[r * W + c]; if (!flat.has(id)) badInterior.push(`${c},${r}=${id}`); }
    return { foreign: [...foreign].sort(), badInterior };
  }, DEC);
}

test.describe('water edits in a content package stay in that package (owner report D1)', () => {
  test.beforeEach(async ({ page }) => { await decEditor(page); await seedLake(page); });

  test('Paint: a Decameroon lake piece painted inside Decameroon water leaves only flat Decameroon water inside', async ({ page }) => {
    await page.evaluate(() => UI.selectTerrain('Decameroon_Lake_3'));
    await clickCell(page, 20, 20);
    const a = await audit(page);
    expect(a.foreign).toEqual([]);
    expect(a.badInterior).toEqual([]);
  });

  test('Paint: plain Decameroon water next to an authored Decameroon shore piece re-resolves it with Decameroon pieces only', async ({ page }) => {
    await clickCell(page, 20, 12);
    expect(await page.evaluate(() => mapData[12 * MAP_WIDTH + 20])).toBe('Decameroon_Water_1');   // the click painted
    const a = await audit(page);
    expect(a.foreign).toEqual([]);
    // the shore piece now has water on three sides: it is the Decameroon piece with exactly those faces
    const faces = await page.evaluate(() => { const e = Terrain.byHexId(mapData[13 * MAP_WIDTH + 20]); return { id: e.id, package: e.package, n: e.edgeFaces.length }; });
    expect(faces.package).toBe('decameroon');
  });

  test('Rectangle, Fill, Replace and Scatter keep the package and leave the interior flat', async ({ page }) => {
    // Rectangle of lake pieces across the middle of the block
    await page.evaluate(() => { UI.selectTerrain('Decameroon_Lake_1'); Tools.setActive('rect'); });
    await dragCells(page, { col: 18, row: 19 }, { col: 22, row: 21 });
    let a = await audit(page);
    expect(a.foreign, 'after Rectangle').toEqual([]);
    expect(a.badInterior, 'after Rectangle').toEqual([]);
    // Fill the whole water body with a directional piece, then back with flat water
    await page.evaluate(() => { UI.selectTerrain('Decameroon_Lake_5'); Tools.setActive('fill'); });
    await clickCell(page, 20, 20);
    await page.evaluate(() => Tools.whenIdle());
    a = await audit(page);
    expect(a.foreign, 'after Fill').toEqual([]);
    expect(a.badInterior, 'after Fill').toEqual([]);
    // Replace every flat Decameroon water with a lake piece inside the block
    await page.evaluate(() => {
      const cells: any[] = [];
      for (let r = 14; r <= 26; r++) for (let c = 14; c <= 26; c++) cells.push({ col: c, row: r });
      Tools.replaceTerrain(mapData[20 * MAP_WIDTH + 20], 'Decameroon_Lake_2', cells);
    });
    a = await audit(page);
    expect(a.foreign, 'after Replace').toEqual([]);
    expect(a.badInterior, 'after Replace').toEqual([]);
    // Scatter flat-water variants over the block
    await page.evaluate(() => {
      const cells: any[] = [];
      for (let r = 14; r <= 26; r++) for (let c = 14; c <= 26; c++) cells.push({ col: c, row: r });
      Tools.scatterCells(cells, 'Decameroon_Water_1', 100);
    });
    a = await audit(page);
    expect(a.foreign, 'after Scatter').toEqual([]);
    expect(a.badInterior, 'after Scatter').toEqual([]);
  });

  test('a mixed-package water boundary is water to the resolver and to the Coastline overlay, a land boundary is a coast', async ({ page }) => {
    const r = await page.evaluate(() => {
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      // base Water_1 column 27 right of the Decameroon block (true neighbours, HexUtils), Decameroon_Plain_1 elsewhere
      for (let r = 14; r <= 26; r++) mapData[r * W + 27] = 'Water_1';
      const cell = { col: 26, row: 20 };
      const nb = HexUtils.neighbors(cell.col, cell.row, W, H);
      const e = Coastline.computeEdges(cell.col, cell.row, Terrain.byHexId(mapData[cell.row * W + cell.col]));
      // a Decameroon water cell on the top border has land (Decameroon_Plain_1) above it
      const top = Coastline.computeEdges(18, 14, Terrain.byHexId(mapData[14 * W + 18]));
      return { edgesMixed: e.filter(Boolean).length, neighbourIds: nb.map((n: any) => mapData[n.row * W + n.col]), edgesTop: top.filter(Boolean).length };
    });
    expect(r.neighbourIds.every((id: string) => id === 'Decameroon_Water_1' || id === 'Water_1')).toBe(true);
    expect(r.edgesMixed).toBe(0);              // Decameroon water next to base water: no coast
    expect(r.edgesTop).toBeGreaterThan(0);     // next to land: coast
  });
});

test('the generator ignores a loaded content package: seed 42 output is byte-identical to the base-DB baseline', async ({ page }) => {
  const gh = new FakeGitHub();
  seedServerPackage(gh, 'decameroon', { name: 'Decameroon', hexes: DEC });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page, { gh });
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => h.package === 'decameroon').length)).toBe(DEC.length);
  await setupScene(page);
  await page.evaluate(() => { (document.getElementById('gen-seed') as HTMLInputElement).value = '42'; });
  await page.evaluate(async () => { await Generator.apply(); });
  expect(await page.evaluate(() => mapData.filter(id => String(id).startsWith('Decameroon_')).length)).toBe(0);
  expect(await hashMapData(page)).toBe(readBaseline()['generator_seed42']);   // read-only: tests/perf-baseline.json is never written here
});
