import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor, ROOT } from './helpers';
import { AuditTile, DIFF_THRESHOLD, runAudit, TileResult } from './tile-audit-helpers';

// Owner request (2026-10-07): every tile's palette icon must be what the map draws when the tile is painted. This spec
// audits ALL tiles of the repo's base HexDB (packages/postapoc/hex_database.json) in ONE page: each tile is selected
// through its palette chip, painted with the Paint tool (radius 0) into a neighbourhood of its own kind, and the drawn
// hex at 200 % is compared with its icon image (tests/tile-audit-helpers.ts documents the method and the threshold).
// The live Decameroon run is tests/tile-icon-audit.live.spec.ts (AUDIT_LIVE=1); its report is
// docs/superpowers/ledger/reports/tile-icon-audit-report.md.

/**
 * Base tiles whose audit verdict is MISMATCH or SPRITE MISSING because of their DATA (only the content owner can change the
 * HexDB / sprites): kept visible here, each with its reason, so the suite stays green while the debt is listed.
 * DATA ISSUE verdicts (placement, shared spriteName, ...) are reported, not failed: see the report.
 */
const KNOWN_MISMATCHES: Record<string, string> = {
  // Its sprite Forest_red.png is at most 80 % opaque (max alpha 204) and the tile is not layered: the map draws it over the
  // black canvas, the palette over the button background (score 0.0193). Data fix: an opaque sprite, or isLayered.
  Forest_5_Test: 'semi-transparent sprite (max alpha 204) drawn over the black canvas',
};

const BASE_DB = path.join(ROOT, 'packages/postapoc/hex_database.json');
const SPRITE_DIR = path.join(ROOT, 'packages/postapoc/sprites/hex');

function baseTiles(): AuditTile[] {
  const db = JSON.parse(fs.readFileSync(BASE_DB, 'utf8'));
  return db.hexes.map((h: any) => ({ ...h, package: h.package || 'postapoc' }));
}

async function auditEditor(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const ctx = await openEditor(page);
  // every startup sprite request settled (loaded or failed) before the palette and the map are read
  await page.waitForFunction(() => Terrain.pendingSprites() === 0);
  return ctx;
}

const describe = (r: TileResult) => `${r.id}: ${r.verdict}: ${r.reasons.join('; ')}`;

test.describe('tile icon audit: palette icon vs drawn hex (base HexDB)', () => {
  test('every base tile: the drawn hex equals its icon, the sprite resolves, mapData and Terrain.byHexId hold the chosen tile', async ({ page }) => {
    test.setTimeout(180_000);
    const { pageErrors } = await auditEditor(page);
    const tiles = baseTiles();
    // The editor runs on the same DB the spec reads (ids, in order of the file).
    const loaded = await page.evaluate(() => HexDB.getAll().filter((h: any) => (h.package || 'postapoc') === 'postapoc').map((h: any) => h.id));
    expect(loaded.slice().sort()).toEqual(tiles.map(t => t.id).sort());

    // AUDIT_DUMP=1 keeps the two compared images of every tile next to audit-results.json (debugging aid)
    const { results } = await runAudit(page, tiles, { postapoc: fs.readdirSync(SPRITE_DIR) }, { wantImages: () => !!process.env.AUDIT_DUMP });
    for (const r of results) {
      if (r.images) for (const k of ['map', 'ref'] as const) fs.writeFileSync(test.info().outputPath(`${r.id}__${k}.png`), Buffer.from(r.images[k].split(',')[1], 'base64'));
      delete r.images;
    }
    fs.writeFileSync(test.info().outputPath('audit-results.json'), JSON.stringify(results, null, 1));

    // Work counters: every tile was painted by the click and measured on pixels.
    expect(results.length).toBe(tiles.length);
    expect(results.filter(r => r.before !== r.id && r.mapId === r.id).length).toBe(tiles.length);
    expect(results.filter(r => r.score !== null && r.blockScore !== null).length).toBe(tiles.length);
    expect(results.filter(r => r.footprint).length).toBe(tiles.filter(t => t.occupiedOffsets?.length).length);

    const failing = results.filter(r => (r.verdict === 'MISMATCH' || r.verdict === 'SPRITE MISSING') && !(r.id in KNOWN_MISMATCHES));
    expect(failing.map(describe)).toEqual([]);
    // The allow-list is not stale: each entry still fails the audit.
    for (const id of Object.keys(KNOWN_MISMATCHES))
      expect(['MISMATCH', 'SPRITE MISSING'], `${id} is in KNOWN_MISMATCHES but now passes`).toContain(results.find(r => r.id === id)?.verdict);
    // Self-score evidence for the calibrated threshold (identical image, identical box), allow-listed tiles aside.
    expect(Math.max(...results.filter(r => !(r.id in KNOWN_MISMATCHES)).map(r => r.blockScore!))).toBeLessThanOrEqual(DIFF_THRESHOLD);
    expect(pageErrors).toEqual([]);
  });

  test('positive controls: a swapped icon, a spriteName that points at another tile, a missing sprite and an id collision are each caught; a good tile in the same batch passes', async ({ page }) => {
    const { gh } = await auditEditor(page);
    gh.write('packages/auditpkg/sprites/hex/Forest_frozen.png', fs.readFileSync(path.join(SPRITE_DIR, 'Forest_frozen.png')));
    const ctl: AuditTile[] = [
      // icon control: its own unused sprite file; after the palette is built its chip <img> is swapped to another sprite
      { id: 'Audit_Ctl_Icon_1', package: 'postapoc', type: 'Swamp', category: '🟫 SWAMP', spriteName: 'RockySwamp' },
      // spriteName pointing at another tile's file
      { id: 'Audit_Ctl_Points_1', package: 'postapoc', type: 'Rubble', category: '🏚️ RUBBLE/WASTELAND', spriteName: 'Rubble_2' },
      // missing sprite
      { id: 'Audit_Ctl_Missing_1', package: 'postapoc', type: 'Plains', category: '🌾 PLAINS', spriteName: 'Audit_No_Such_Sprite' },
      // id that collides case-insensitively with a base tile, in another package (map cells store the bare id)
      { id: 'forest_2', package: 'auditpkg', type: 'Forests', category: '🌲 FOREST', spriteName: 'Forest_frozen' },
    ];
    const good = baseTiles().find(t => t.id === 'Forest_1')!;
    await page.evaluate(async c => {
      HexDB.addEntries(c);
      await new Promise<void>(r => { const tick = () => (Terrain.pendingSprites() === 0 && document.querySelector('.tile-btn[data-hex-id="Audit_Ctl_Icon_1"]')) ? r() : requestAnimationFrame(tick); tick(); });
    }, ctl);
    await page.evaluate(() => {
      const img = document.querySelector('.pkg-group[data-pkg="postapoc"] .tile-btn[data-hex-id="Audit_Ctl_Icon_1"] img') as HTMLImageElement;
      img.src = 'packages/postapoc/sprites/hex/Forest_1.png';
      return img.decode();
    });
    const files = fs.readdirSync(SPRITE_DIR);
    const { results } = await runAudit(page, [good, ...ctl], { postapoc: files, auditpkg: ['Forest_frozen.png'] }, { allTiles: [...baseTiles(), ...ctl] });
    fs.writeFileSync(test.info().outputPath('audit-results.json'), JSON.stringify(results, null, 1));
    const by = (id: string, pkg = 'postapoc') => results.find(r => r.id === id && r.pkg === pkg)!;

    expect(by('Forest_1').verdict).toBe('MATCH');                 // the same batch passes a good tile
    expect(by('Forest_1').score).toBe(0);

    const icon = by('Audit_Ctl_Icon_1');
    expect(icon.verdict).toBe('MISMATCH');
    expect(icon.score!).toBeGreaterThan(DIFF_THRESHOLD);
    expect(icon.reasons.join('\n')).toContain('drawn hex differs from the icon');
    expect(icon.reasons.join('\n')).toContain("is not the entry's sprite file");
    expect(icon.mapId).toBe('Audit_Ctl_Icon_1');                  // the map part itself was right

    const points = by('Audit_Ctl_Points_1');
    expect(points.verdict).toBe('DATA ISSUE');
    expect(points.reasons.join('\n')).toContain('spriteName "Rubble_2" is shared with Rubble_2');

    const missing = by('Audit_Ctl_Missing_1');
    expect(missing.verdict).toBe('SPRITE MISSING');
    expect(missing.http).toBe(404);
    expect(missing.spriteState).toBe('failed');
    expect(missing.reasons.join('\n')).toContain('no file sprites/hex/Audit_No_Such_Sprite.png');

    const twin = by('forest_2', 'auditpkg');
    expect(twin.verdict).toBe('MISMATCH');
    expect(twin.byHexId).toMatchObject({ id: 'Forest_2', package: 'postapoc' });
    expect(twin.reasons.join('\n')).toContain('Terrain.byHexId resolves to Forest_2 [postapoc]');
    expect(twin.reasons.join('\n')).toContain('id collides (case-insensitive) with Forest_2 [postapoc]');
  });
});
