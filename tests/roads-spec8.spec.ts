import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { seedRoadsWorld, SPEC8, SPEC8_EXCLUDED_RIVERS, ROAD_IDS } from './roads-fixtures';

// Roads/Bridges V1, editor phase F7: spec section 8 end to end (Decameroon lists, dual write, old reader view).
// FakeGitHub only: nothing here can reach a real server.
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
/** What an old Unity build sees: it reads only roadAllowed. */
const readLegacy = (file: any): string[] => file.hexes.filter((h: any) => h.roadAllowed === true).map((h: any) => h.id).sort();

test('section 8 end to end: backfill, the four set-exact lists, active publish of base and Decameroon, old-reader view, back to off', async ({ page }) => {
  const { gh } = await seedRoadsWorld(page);
  const road1 = SPEC8[ROAD_IDS.road];
  // spec step 0: the 7 Road_1 tiles carry the legacy flag
  await page.evaluate((ids: string[]) => { HexDB.getAll().forEach((h: any) => { if (ids.includes(h.id)) h.roadAllowed = true; }); }, road1);

  // Backfill (explicit): base and Decameroon
  expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('off');
  expect(await page.evaluate(() => HexDB.getAll().filter((h: any) => 'allowedRoads' in h).length)).toBe(0);
  const bf = await page.evaluate(() => ({ base: HexDB.backfillRoads({ pkg: 'postapoc' }), dec: HexDB.backfillRoads({ pkg: 'decameroon' }) }));
  expect(bf.dec).toMatchObject({ changed: 60, road: 7, bridge: 29 });
  expect(bf.base.changed).toBeGreaterThan(0);

  // The matrix, package Decameroon: the four "Set exactly" runs
  await page.evaluate(() => App.setMode('hexdb'));
  await page.locator('#hexdb-roads-matrix-btn').click();
  await expect.poll(() => page.locator('#roads-matrix-modal tbody tr[data-key]').count()).toBeGreaterThan(0);
  await page.locator('#roads-matrix-modal #rm-pkg').selectOption('decameroon');
  await expect.poll(() => page.locator('#roads-matrix-modal tbody tr[data-key]').count()).toBe(60);
  for (const t of Object.values(ROAD_IDS)) {
    await page.locator(`#roads-matrix-modal th[data-type-id="${t}"] button[data-act="exact"]`).click();
    await page.locator('#roads-exact-modal textarea').fill(SPEC8[t].join('\n'));
    await page.locator('#roads-exact-modal').getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('#roads-exact-modal')).toHaveCount(0);
  }
  await page.locator('#roads-matrix-modal').getByRole('button', { name: 'Close' }).click();

  // The exact section 8 table
  const lists: Record<string, string[]> = await page.evaluate(() => Object.fromEntries(HexDB.getAll().filter((h: any) => h.package === 'decameroon').map((h: any) => [h.id, h.allowedRoads])));
  for (const t of Object.values(ROAD_IDS)) expect(Object.keys(lists).filter(id => lists[id].includes(t)).sort()).toEqual([...SPEC8[t]].sort());
  for (const id of SPEC8_EXCLUDED_RIVERS) expect(lists[id]).toEqual([]);
  expect(lists['Decameroon_Water_1']).toEqual(['bridge_2']);

  // Mode active (explicit owner action, with the confirm) and the two publishes
  const switched = page.evaluate(() => HexDB.setRoadsMode('active'));
  await page.locator('#dialog-modal.open button', { hasText: 'Continue' }).click();
  await switched;
  expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('active');
  const pkgRes = await page.evaluate(() => Packages.publishPackage('decameroon'));
  expect(pkgRes.ok).toBe(true);
  expect(await page.evaluate(() => GitHubSync.publishHexDbOnly())).toBe(true);

  const dec = JSON.parse(gh.read('packages/decameroon/hex_database.json')!.toString('utf8'));
  const base = JSON.parse(gh.read('packages/postapoc/hex_database.json')!.toString('utf8'));
  const baseRoot = JSON.parse(gh.read('hex_database.json')!.toString('utf8'));
  expect(dec.roadsSchema).toBe(1);
  expect(base.roadsSchema).toBe(1);
  expect(baseRoot.roadsSchema).toBe(1);
  expect(dec.hexes.length).toBe(60);
  expect(dec.hexes.every((h: any) => Array.isArray(h.allowedRoads))).toBe(true);
  expect(base.hexes.every((h: any) => Array.isArray(h.allowedRoads))).toBe(true);
  // derived legacy flag: true exactly on the 7 Road_1 tiles, false on every bridge-only tile
  expect(readLegacy(dec)).toEqual([...road1].sort());
  for (const h of dec.hexes) if (h.allowedRoads.length && !h.allowedRoads.some((x: string) => x.startsWith('road'))) expect(h.roadAllowed).toBe(false);
  expect(dec.hexes.find((h: any) => h.id === 'Decameroon_Water_1')).toMatchObject({ allowedRoads: ['bridge_2'], roadAllowed: false });
  for (const id of SPEC8_EXCLUDED_RIVERS) expect(dec.hexes.find((h: any) => h.id === id).allowedRoads).toEqual([]);
  // manifest hashes match the written bytes
  const sha256Of = (path: string) => sha(gh.read(path)!.toString('utf8'));
  const decManifest = gh.json('packages/decameroon/manifest.json');
  expect(decManifest.files.find((f: any) => f.path === 'hex_database.json').sha256).toBe(sha256Of('packages/decameroon/hex_database.json'));
  const baseManifest = gh.json('packages/postapoc/manifest.json');
  expect(baseManifest.files.find((f: any) => f.path === 'hex_database.json').sha256).toBe(sha256Of('packages/postapoc/hex_database.json'));

  // Back to off: neither field nor schema is written any more (and no confirm is needed)
  await page.evaluate(() => HexDB.setRoadsMode('off'));
  expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('off');
  expect((await page.evaluate(() => Packages.publishPackage('decameroon'))).ok).toBe(true);
  expect(await page.evaluate(() => GitHubSync.publishHexDbOnly())).toBe(true);
  const dec2 = JSON.parse(gh.read('packages/decameroon/hex_database.json')!.toString('utf8'));
  const base2 = JSON.parse(gh.read('packages/postapoc/hex_database.json')!.toString('utf8'));
  for (const f of [dec2, base2]) {
    expect('roadsSchema' in f).toBe(false);
    expect(f.hexes.some((h: any) => 'allowedRoads' in h)).toBe(false);
  }
  expect(readLegacy(dec2)).toEqual([...road1].sort());          // the old-reader view is unchanged by the mode
});
