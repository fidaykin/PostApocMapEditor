import { test, expect, Page } from '@playwright/test';
import * as zlib from 'zlib';
import { freshEditor } from './editor-helpers';

// ClickUp 869fe6rug (building part): a map cell may hold a BUILDING id. Boat / FishTrap / SmallShipyard PNGs are transparent,
// so they were drawn on the black canvas. The cell now gets an underlay terrain (Terrain.buildingUnderlayId) under the sprite.

const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 16x16 PNG of one RGBA colour (alpha 0 = fully transparent). */
function solid(r: number, g: number, b: number, a: number): Buffer {
  const N = 16, raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = y * (N * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const BLUE = [20, 80, 200], RED = [200, 30, 30];
const HEXES = [
  { id: 'UL_Water_1', type: 'Water', spriteName: 'UL_Water_1', package: 'ul' },
  { id: 'UL_Water_2', type: 'Water', spriteName: 'UL_Water_2', package: 'ul' },
  { id: 'UL_Plain_1', type: 'Plains', spriteName: 'UL_Plain_1', package: 'ul' },
];
const BLDS = [
  { id: 'UL_Boat', spriteName: 'UL_Boat', package: 'ul', availableTiles: ['UL_Water_1'] },
  { id: 'UL_Bare', spriteName: 'UL_Bare', package: 'ul', availableTiles: [] },
  { id: 'UL_Ground', spriteName: 'UL_Ground', package: 'ul', availableTiles: ['UL_Plain_1'] },
  { id: 'UL_Under', spriteName: 'UL_Under', package: 'ul', underTerrainId: 'UL_Water_2', availableTiles: ['UL_Water_1'] },
];

// Sprites are registered as data: URLs (same-origin, so the canvas stays readable; package sprites fetched cross-origin taint it).
const SPRITES: Record<string, Buffer> = {
  UL_Water_1: solid(20, 80, 200, 255), UL_Water_2: solid(20, 200, 80, 255), UL_Plain_1: solid(120, 155, 85, 255),
  UL_Boat: solid(0, 0, 0, 0), UL_Bare: solid(0, 0, 0, 0), UL_Ground: solid(200, 30, 30, 255), UL_Under: solid(0, 0, 0, 0),
};

async function setup(page: Page) {
  await freshEditor(page);
  const urls: Record<string, string> = {};
  for (const [k, v] of Object.entries(SPRITES)) urls['ul/' + k] = 'data:image/png;base64,' + v.toString('base64');
  await page.evaluate(async ([hexes, blds, urls]: any) => {
    HexDB.addEntries(hexes); BldDB.addEntries(blds);
    Terrain.registerUploadedUrls(urls);
    await Terrain.applyHexDbOverrides(hexes.concat(blds), 'packages/postapoc/sprites/hex/');
  }, [HEXES, BLDS, urls]);
  await page.waitForFunction(() => Terrain.pendingSprites() === 0 && !!Terrain.getSprite('UL_Boat') && !!Terrain.getSprite('UL_Water_1'));
}

/** Puts `id` into a cell next to the city, renders and reads the canvas pixel at the cell centre. */
const cellPixel = (page: Page, id: string, extra?: string) => page.evaluate(async ([id, extra]) => {
  const col = 226, row = 224;
  mapData[row * MAP_WIDTH + col] = id;
  if (extra) tileExtras[col + ',' + row] = { underTerrainId: extra }; else delete tileExtras[col + ',' + row];
  Canvas.setZoom(100); Canvas.centerOnCity(); Canvas.render();
  const p = Canvas.hexScreenPos(col, row), cv = document.getElementById('map-canvas') as HTMLCanvasElement;
  return Array.from(cv.getContext('2d')!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data);
}, [id, extra || ''] as [string, string]);

test.describe('building cell underlay', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('helper: tile extra > building underTerrainId > first Water hex of availableTiles', async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = (b: any, x?: any) => Terrain.buildingUnderlayId(b, x);
      return {
        extraWins: f({ underTerrainId: 'UL_Water_2', availableTiles: ['UL_Water_1'] }, 'UL_Plain_1'),
        ownWins: f({ underTerrainId: 'UL_Water_2', availableTiles: ['UL_Water_1'] }),
        unknownExtraFallsThrough: f({ underTerrainId: 'UL_Water_2' }, 'Nope_1'),
        unknownOwnFallsThrough: f({ underTerrainId: 'Nope_1', availableTiles: ['UL_Water_1'] }),
        firstWaterOnly: f({ availableTiles: ['Nope_1', 'UL_Plain_1', 'UL_Water_2', 'UL_Water_1'] }),
        noWater: f({ availableTiles: ['UL_Plain_1', 'Nope_1'] }),
        empty: f({}), nullBld: f(null), nullBoth: f(undefined, undefined),
      };
    });
    expect(r.extraWins).toBe('UL_Plain_1');
    expect(r.ownWins).toBe('UL_Water_2');
    expect(r.unknownExtraFallsThrough).toBe('UL_Water_2');
    expect(r.unknownOwnFallsThrough).toBe('UL_Water_1');
    expect(r.firstWaterOnly).toBe('UL_Water_2');
    expect(r.noWater).toBeNull();
    expect(r.empty).toBeNull(); expect(r.nullBld).toBeNull(); expect(r.nullBoth).toBeNull();
  });

  test('a transparent building cell shows its water underlay, not black', async ({ page }) => {
    const px = await cellPixel(page, 'UL_Boat');
    expect(px.slice(0, 3)).toEqual(BLUE);
    expect(px[3]).toBe(255);
  });

  test('the building own underTerrainId and a tile extra override the availableTiles rule', async ({ page }) => {
    expect((await cellPixel(page, 'UL_Under')).slice(0, 3)).toEqual([20, 200, 80]);
    expect((await cellPixel(page, 'UL_Under', 'UL_Plain_1')).slice(0, 3)).toEqual([120, 155, 85]);
  });

  test('without any hint the cell is drawn as before (no underlay)', async ({ page }) => {
    const px = await cellPixel(page, 'UL_Bare');
    expect(px.slice(0, 3)).not.toEqual(BLUE);
    expect(Math.max(...px.slice(0, 3))).toBeLessThan(30);   // the dark canvas background shows through, as before
  });

  test('an opaque ground building sprite is unaffected (drawn on top, no water leaks)', async ({ page }) => {
    expect((await cellPixel(page, 'UL_Ground')).slice(0, 3)).toEqual(RED);
  });

  test('zoomed-out simple sprite level uses the same underlay', async ({ page }) => {
    await page.evaluate(() => Canvas._test.setLod(1));
    const px = await cellPixel(page, 'UL_Boat');
    expect(px.slice(0, 3)).toEqual(BLUE);
  });
});
