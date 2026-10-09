import { test, expect, Page } from '@playwright/test';
import { freshEditor } from './editor-helpers';

// Owner decision (2026-10-07, extended to zone fills): like every other hand tool, Fill Zones, Fill This Zone and
// Randomize & Fill place exactly the zone preset's tiles and do NOT re-pick river / lake pieces or shores in the
// neighbouring cells (no edge re-resolution). The map generator and generate-into-selection keep their own logic.
//
// Scene (blank 450x450 map): a 41x41 field (cols/rows 205..245) of ONE directional river piece D; the zone is the 20x20
// rectangle cols/rows 215..234 with the Coastal Waters preset (flat water only). Every zone-border cell touches D pieces,
// which the old edge pass rewrote (Math.random is pinned so it would pick the same ids every run). The intended cell set is
// the grid rectangle, and the allowed values are the preset's own tile ids; each check is a whole-map diff against the
// snapshot taken before the gesture, plus one History.undo().

const ZONE = { c0: 215, c1: 234, r0: 215, r1: 234 };
const WATER = ['Water_1', 'Water_Dirty_1', 'Water_Rock_1'];   // the coastal_waters preset's terrainWeights

async function scene(page: Page) {
  return page.evaluate(({ c0, c1, r0, r1 }) => {
    const D = HexDB.getAll().find((h: any) => (h.package || 'postapoc') === 'postapoc' && h.type === 'Rivers' && Array.isArray(h.edgeFaces) && h.edgeFaces.length === 2)!.id;
    const W = MAP_WIDTH;
    for (let r = 205; r <= 245; r++) for (let c = 205; c <= 245; c++) mapData[r * W + c] = D;
    const id = ZonePainter.addZone('Z');
    ZonePainter.getZones().find((z: any) => z.id === id).presetId = 'coastal_waters';
    ZonePainter.setSelectedZoneId(id);
    const zl = ZonePainter.getZoneLayer();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) zl[r * W + c] = id;
    Math.random = () => 0.999;
    (window as any).__before = mapData.slice();
    (window as any).__undo0 = History.undoSize();
    (window as any).__settle0 = JSON.stringify(settlements);
    return D;
  }, ZONE);
}
const inZone = (c: number, r: number) => c >= ZONE.c0 && c <= ZONE.c1 && r >= ZONE.r0 && r <= ZONE.r1;
/** Whole-map diff against the snapshot: { outside: changed cells outside the zone rectangle, inside: values written in it }. */
const diff = (page: Page) => page.evaluate(() => {
  const b = (window as any).__before as string[], W = MAP_WIDTH, out: { c: number; r: number; v: string }[] = [];
  for (let i = 0; i < mapData.length; i++) if (mapData[i] !== b[i]) out.push({ c: i % W, r: Math.floor(i / W), v: mapData[i] });
  return out;
});

test.describe('zone fills place exactly the preset tiles: no river/lake/shore re-resolution (owner decision)', () => {
  let D = '';
  test.beforeEach(async ({ page }) => { await freshEditor(page); D = await scene(page); });

  for (const writer of ['_fillAllZones', '_uiFillThisZone']) {
    test(`${writer}: only zone cells change and hold preset tiles; neighbouring river pieces are untouched; one undo restores`, async ({ page }) => {
      await page.evaluate(w => (ZonePainter as any)[w](), writer);
      const d = await diff(page);
      const outside = d.filter(x => !inZone(x.c, x.r));
      expect(outside, 'cells outside the zone were rewritten (edge re-resolution)').toEqual([]);
      const inside = d.filter(x => inZone(x.c, x.r));
      expect(inside.length, 'positive control: the fill wrote the zone').toBeGreaterThan(300);
      expect(inside.filter(x => !WATER.includes(x.v)).map(x => `${x.c},${x.r}=${x.v}`), 'zone cells hold only the preset tiles').toEqual([]);
      expect(await page.evaluate(() => History.undoSize() - (window as any).__undo0)).toBe(1);
      expect(await page.evaluate(() => JSON.stringify(settlements) === (window as any).__settle0)).toBe(true);   // coastal waters places no settlements
      await page.evaluate(() => History.undo());
      expect(await diff(page)).toEqual([]);
    });
  }

  for (const writer of ['_fillAllZones', '_uiFillThisZone', '_randomizeFillUI']) {
    test(`${writer}: never calls the edge re-resolution (work counter on Tools.autoResolveEdgesAround)`, async ({ page }) => {
      const calls = await page.evaluate(w => {
        const orig = Tools.autoResolveEdgesAround; let n = 0;
        Tools.autoResolveEdgesAround = (t: any[]) => { n++; return orig(t); };
        try { (ZonePainter as any)[w](); } finally { Tools.autoResolveEdgesAround = orig; }
        return { n, steps: History.undoSize() - (window as any).__undo0 };
      }, writer);
      expect(calls).toEqual({ n: 0, steps: 1 });   // and the fill really ran (one History step)
    });
  }

  test('Randomize & Fill: every cell holds a tile of some preset (no river / lake / shore piece appears), one undo restores', async ({ page }) => {
    await page.evaluate(() => {   // the whole map is a river-piece field, so any re-resolved cell would be a river or shore piece
      for (let i = 0; i < mapData.length; i++) mapData[i] = (window as any).__before[205 * MAP_WIDTH + 205];
      (window as any).__before = mapData.slice(); (window as any).__undo0 = History.undoSize();
      ZonePainter._randomizeFillUI();
    });
    const r = await page.evaluate(() => {
      const allowed = new Set<string>();
      for (const p of ZonePainter.getPresets()) for (const k of Object.keys(p.terrainWeights)) allowed.add(k);
      const bad: string[] = [];
      for (let i = 0; i < mapData.length; i++) if (!allowed.has(mapData[i])) { if (bad.length < 8) bad.push(`${i % MAP_WIDTH},${Math.floor(i / MAP_WIDTH)}=${mapData[i]}`); }
      return { bad, steps: History.undoSize() - (window as any).__undo0, n: allowed.size };
    });
    expect(r.n).toBeGreaterThan(5);
    expect(r.bad).toEqual([]);
    expect(r.steps).toBe(1);
    await page.evaluate(() => History.undo());
    expect(await diff(page)).toEqual([]);
  });

  test('locks are respected: terrain locked writes no terrain and no step; objects locked keeps bridges; terrain free writes the zone', async ({ page }) => {
    await page.evaluate(() => { Layers.setLocked('terrain', true); Layers.setLocked('settlements', true); });
    await page.evaluate(() => ZonePainter._fillAllZones());
    expect(await diff(page)).toEqual([]);
    expect(await page.evaluate(() => History.undoSize() - (window as any).__undo0)).toBe(0);
    await page.evaluate(() => { Layers.setLocked('terrain', false); Layers.setLocked('settlements', false); Layers.setLocked('objects', true); bridgesData.push({ col: 220, row: 220, axis: 1 }); });
    await page.evaluate(() => ZonePainter._fillAllZones());
    expect(await page.evaluate(() => bridgesData.length)).toBe(1);
    const d = await diff(page);
    expect(d.filter(x => !inZone(x.c, x.r))).toEqual([]);
    expect(d.length).toBeGreaterThan(300);
  });
});
