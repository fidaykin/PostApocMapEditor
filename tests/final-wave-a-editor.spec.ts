import { test, expect } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Final fix wave A, editor items: A9 (auto-place / zone fill keep Placement's bunkers and mega cities), A10 (startup autosave
// validation and load-refusal data safety), A11 (image pixel cap before decode).

const CFG = `{ bunkers: { count: 8, kind: 'settlement', id: 'bunker', minCity: 6 }, megaCities: { count: 2, kind: 'settlement', id: 'megacity', minCity: 40 },
  artifacts: { count: 0, kind: 'object', id: 'Artefact_Test_1', minCity: 25 }, ores: [] }`;
const types = (page: any): Promise<Record<string, number>> => page.evaluate(() => {
  const o: Record<string, number> = {};
  for (const s of settlements) o[s.type] = (o[s.type] || 0) + 1;
  return o;
});

test.describe('A9: Auto-place and zone fill only replace what slots/zones created', () => {
  test.beforeEach(async ({ page }) => { await freshEditor(page); });

  test('Place then Auto-place keeps bunkers and mega cities (and replaces stray slot settlements); undo restores everything', async ({ page }) => {
    await page.evaluate(`Placement.place(${CFG}, 7)`);
    const placed = await types(page);
    expect(placed.bunker, 'positive control: bunkers were placed').toBeGreaterThan(0);
    expect(placed.megacity, 'positive control: mega cities were placed').toBeGreaterThan(0);
    await page.evaluate(() => { settlements.push({ col: 5, row: 5, type: 'settlement' }, { col: 6, row: 9, type: 'outpost' }); });
    const before = await page.evaluate(() => JSON.stringify(settlements));
    await page.evaluate(() => {
      settlementSlots = [{ minDist: 5, maxDist: 12, count: 4, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 34, midPct: 33, farPct: 33 }];
      autoPlaceSettlements();
    });
    const after = await types(page);
    expect(after.bunker).toBe(placed.bunker);
    expect(after.megacity).toBe(placed.megacity);
    expect(after.city).toBe(1);
    expect(after.settlement, 'slot settlements were placed').toBeGreaterThan(0);
    expect(await page.evaluate(() => settlements.some(s => s.col === 5 && s.row === 5 && s.type === 'settlement'))).toBe(false);   // stray slot settlement replaced
    expect(await page.evaluate(() => settlements.some(s => s.col === 6 && s.row === 9 && s.type === 'outpost'))).toBe(false);      // outposts are slot-created too
    await page.evaluate(() => History.undo());
    expect(await page.evaluate(() => JSON.stringify(settlements))).toBe(before);
  });

  test('zone fill keeps bunkers/mega cities inside the zone, replaces only its own settlements; undo restores', async ({ page }) => {
    const r = await page.evaluate(() => {
      const id = ZonePainter.addZone('z', '#ff0000');
      const layer = ZonePainter.getZoneLayer();
      for (let row = 100; row < 200; row++) for (let col = 100; col < 200; col++) layer[row * MAP_WIDTH + col] = id;
      settlements.push({ col: 150, row: 150, type: 'bunker' }, { col: 120, row: 120, type: 'megacity' }, { col: 110, row: 110, type: 'settlement' });
      const before = JSON.stringify(settlements);
      ZonePainter.fillZoneSettlements(id, mapData, settlements);
      const kinds = settlements.map(s => s.type);
      const out = {
        bunker: settlements.some(s => s.type === 'bunker' && s.col === 150 && s.row === 150),
        mega: settlements.some(s => s.type === 'megacity' && s.col === 120 && s.row === 120),
        strayGone: !settlements.some(s => s.col === 110 && s.row === 110),
        newOnes: kinds.filter(k => k === 'settlement').length,
      };
      return { ...out, before };
    });
    expect(r.bunker).toBe(true);
    expect(r.mega).toBe(true);
    expect(r.strayGone).toBe(true);
    expect(r.newOnes, 'positive control: the zone fill placed settlements').toBeGreaterThan(0);
    // the History-backed entry point (Fill all zones) is one undoable step that restores the list
    const u = await page.evaluate(() => {
      const before = JSON.stringify(settlements);
      ZonePainter._fillAllZones();
      const mid = JSON.stringify(settlements);
      History.undo();
      return { changed: mid !== before, restored: JSON.stringify(settlements) === before, bunkers: settlements.filter(s => s.type === 'bunker').length };
    });
    expect(u.restored).toBe(true);
    expect(u.bunkers).toBe(1);
  });
});
