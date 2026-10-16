import { test, expect, Page } from '@playwright/test';
import { FakeGitHub, openEditor, packageZip, hexRec, bldRec, quiesceAfterDialog } from './helpers';
import { seedRoadsWorld, BASE_HEXES } from './roads-fixtures';

// Roads/Bridges V1, E5 (validation gate before any publish write) and E6 (write mode, dual write). Everything runs against FakeGitHub.
const setMode = (page: Page, m: string) => page.evaluate((m) => localStorage.setItem('roadsWriteMode', m), m);
/** Gives every BASE record a list so the unset rule is satisfied (positive control for the gates). */
const backfillBase = (page: Page) => page.evaluate(() => {
  for (const h of HexDB.getAll()) if (!h.package || h.package === 'postapoc') HexDB.setAllowedRoads(h, h.type === 'Rivers' ? ['bridge'] : h.type === 'Plains' ? ['road'] : []);
});
const publishBase = (page: Page) => page.evaluate(() => GitHubSync.publishHexDbOnly({ skipManifest: true }));

test.describe('roads publish gate (E5)', () => {
  test('stage mode: a base record without the field aborts before any write; with the field everywhere both hex files are written', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await setMode(page, 'stage');
    expect(gh.puts.length).toBe(0);
    expect(await publishBase(page)).toBe(false);
    expect(gh.puts.length).toBe(0);                                   // nothing written
    await expect(page.locator('#toast-container')).toContainText('no road permissions');
    await backfillBase(page);
    expect(await publishBase(page)).toBe(true);
    expect(gh.putPaths()).toEqual(['packages/postapoc/hex_database.json', 'hex_database.json']);
  });

  test('off mode: the same unset records publish (positive control)', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    expect(await page.evaluate(() => localStorage.getItem('roadsWriteMode'))).toBeNull();
    expect(await publishBase(page)).toBe(true);
    expect(gh.putPaths()).toEqual(['packages/postapoc/hex_database.json', 'hex_database.json']);
  });

  test('active mode blocks like stage; an unknown road id blocks and the message names the id and the count', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await backfillBase(page);
    await page.evaluate(() => {
      HexDB.setAllowedRoads('postapoc::Plain_1', ['road_old']);
      HexDB.setAllowedRoads('postapoc::Plain_2', ['road', 'gone_too']);
    });
    for (const mode of ['stage', 'active']) {
      await setMode(page, mode);
      expect(await publishBase(page)).toBe(false);
    }
    expect(gh.puts.length).toBe(0);
    await expect(page.locator('#toast-container')).toContainText('road_old');
    await expect(page.locator('#toast-container')).toContainText('2 problems');
    // control: off mode publishes the same data
    await setMode(page, 'off');
    expect(await publishBase(page)).toBe(true);
  });

  test('a duplicate id offers "Fix and continue": confirming dedupes and publishes; Cancel writes nothing', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await backfillBase(page);
    await setMode(page, 'stage');
    await page.evaluate(() => { HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads = ['road', 'road']; });
    const p1 = publishBase(page);
    await page.locator('#dialog-modal.open button', { hasText: 'Cancel' }).click();
    expect(await p1).toBe(false);
    await quiesceAfterDialog(page);
    expect(gh.puts.length).toBe(0);
    const p2 = publishBase(page);
    await page.locator('#dialog-modal.open button', { hasText: 'Fix and continue' }).click();
    expect(await p2).toBe(true);
    expect(gh.putPaths()).toContain('hex_database.json');
    expect(await page.evaluate(() => HexDB.getAll().find((h: any) => h.id === 'Plain_1').allowedRoads)).toEqual(['road']);
  });

  test('a road defined in a package Building DB blocks Packages.publishPackage in stage/active, not in off; the other package data is fine', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
    gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'p.png', isDefault: false });
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => !!Packages.getEntry('pp'));
    await page.evaluate(() => {
      HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains', allowedRoads: [] }]);
      BldDB.addEntries([{ id: 'Pp_road', package: 'pp', isRoad: true, buildingCategory: 'Standard', spriteName: 'x' }]);
    });
    for (const mode of ['stage', 'active']) {
      await setMode(page, mode);
      const r = await page.evaluate(() => Packages.publishPackage('pp'));
      expect(r.ok).toBe(false);
      expect(r.error).toContain('Pp_road');
    }
    expect(gh.puts.length).toBe(0);
    await setMode(page, 'off');
    expect((await page.evaluate(() => Packages.publishPackage('pp'))).ok).toBe(true);
  });

  test('stage mode: a package hex without the field blocks the package publish; with the field it goes through', async ({ page }) => {
    const gh = new FakeGitHub();
    gh.setRegistry([{ id: 'pp', name: 'PP', version: '1.0.0' }]);
    gh.setJson('packages/pp/package.json', { id: 'pp', name: 'PP', version: '1.2.3', description: 'd', preview: 'p.png', isDefault: false });
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => !!Packages.getEntry('pp'));
    await page.evaluate(() => HexDB.addEntries([{ id: 'Pp_Hex_1', package: 'pp', type: 'Plains' }]));
    await setMode(page, 'stage');
    const r = await page.evaluate(() => Packages.publishPackage('pp'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Pp_Hex_1');
    expect(gh.puts.length).toBe(0);
    await page.evaluate(() => HexDB.setAllowedRoads('pp::Pp_Hex_1', []));
    expect((await page.evaluate(() => Packages.publishPackage('pp'))).ok).toBe(true);
  });
});

test.describe('roads in imported packages (E5)', () => {
  const PICK = (page: Page, buffer: Buffer) => page.setInputFiles('#pkg-import-input', { name: 'pkg.zip', mimeType: 'application/zip', buffer });

  test('a ZIP whose Building DB has a road or a bridge is rejected in every mode; a house is accepted (positive control)', async ({ page }) => {
    const gh = new FakeGitHub();
    await openEditor(page, { gh, pat: true });
    await page.waitForFunction(() => (window as any).__startupSyncDone);
    for (const mode of ['off', 'active']) {
      await setMode(page, mode);
      await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd')], buildings: [bldRec('Rd_road', 'rd', { isRoad: true }), bldRec('Rd_bridge', 'rd', { buildingCategory: 'Bridge' })] }));
      await expect(page.locator('#pkg-import-errors')).toContainText('Rd_road');
      await expect(page.locator('#pkg-import-errors')).toContainText('Rd_bridge');
      await expect(page.locator('#pkg-import-errors')).toContainText('global');
      await page.keyboard.press('Escape');
    }
    await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd')], buildings: [bldRec('Rd_house', 'rd', {})] }));
    await expect.poll(() => page.evaluate(() => !!Packages.getImportPlan())).toBe(true);
    await expect(page.locator('#pkg-import-errors')).toHaveCount(0);
    expect(await page.evaluate(() => Packages.getImportPlan().ok)).toBe(true);
  });

  test('an imported hex file with an unknown road id gives a warning in the plan, not an error', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    void gh;
    await PICK(page, await packageZip('rd', 'Rd', { hexes: [hexRec('Rd_Plain_1', 'rd', { allowedRoads: ['road', 'road_old'] }), hexRec('Rd_Plain_2', 'rd', { allowedRoads: ['road_old'] }), hexRec('Rd_Plain_3', 'rd', { allowedRoads: ['road'] })] }));
    await expect.poll(() => page.evaluate(() => !!Packages.getImportPlan())).toBe(true);
    const plan = await page.evaluate(() => { const p = Packages.getImportPlan(); return { ok: p.ok, errors: p.errors, warnings: p.warnings }; });
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join('\n')).toMatch(/2 tiles list road ids unknown here.*road_old/);
  });
});

// ── E6: write mode, exporter, dual write ────────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import { createHash } from 'crypto';
import { SPEC8 } from './roads-fixtures';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Fixture world with the spec 8 lists on Decameroon and lists on the base tiles. */
async function worldWithLists(page: Page) {
  const w = await seedRoadsWorld(page);
  await page.evaluate((spec) => {
    for (const h of HexDB.getAll()) {
      if (h.package === 'decameroon') HexDB.setAllowedRoads(h, Object.keys(spec).filter((t: string) => spec[t].includes(h.id)));
      else HexDB.setAllowedRoads(h, h.type === 'Rivers' ? ['bridge'] : h.type === 'Water' ? ['bridge_2'] : h.type === 'Plains' || h.type === 'Rubble' ? ['road'] : []);
    }
  }, SPEC8);
  return w;
}
const lastPut = (gh: FakeGitHub, p: string) => JSON.parse(gh.puts.filter(x => x.path === p).at(-1)!.text);
const recOf = (file: any, id: string) => file.hexes.find((h: any) => h.id === id);

test.describe('Roads write mode: exporter and dual write (E6)', () => {
  test('off: records carry no allowedRoads and the file no roadsSchema, but roadAllowed is the derived value', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    expect(await publishBase(page)).toBe(true);
    const f = lastPut(gh, 'packages/postapoc/hex_database.json');
    expect(f.hexes.some((h: any) => 'allowedRoads' in h)).toBe(false);
    expect('roadsSchema' in f).toBe(false);
    expect(recOf(f, 'Plain_1').roadAllowed).toBe(true);
    expect(recOf(f, 'River_L_1').roadAllowed).toBe(false);
    expect(recOf(f, 'Water_1').roadAllowed).toBe(false);
  });

  test('stage: every record has allowedRoads and the derived roadAllowed, still no roadsSchema', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    await setMode(page, 'stage');
    expect(await publishBase(page)).toBe(true);
    for (const p of ['packages/postapoc/hex_database.json', 'hex_database.json']) {
      const f = lastPut(gh, p);
      expect(f.hexes.every((h: any) => Array.isArray(h.allowedRoads))).toBe(true);
      expect('roadsSchema' in f).toBe(false);
      expect(recOf(f, 'Plain_1')).toMatchObject({ allowedRoads: ['road'], roadAllowed: true });
      expect(recOf(f, 'River_L_1')).toMatchObject({ allowedRoads: ['bridge'], roadAllowed: false });
      expect(recOf(f, 'Water_1')).toMatchObject({ allowedRoads: ['bridge_2'], roadAllowed: false });   // D2: a bridge-only tile keeps the old flag false
    }
  });

  test('active: roadsSchema 1 sits right after version in the base file and in a package file; the three derived flags', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    await setMode(page, 'active');
    expect(await publishBase(page)).toBe(true);
    await page.evaluate(() => Packages.publishPackage('decameroon'));
    const base = lastPut(gh, 'packages/postapoc/hex_database.json');
    const dec = lastPut(gh, 'packages/decameroon/hex_database.json');
    expect(base.roadsSchema).toBe(1); expect(dec.roadsSchema).toBe(1);
    expect(Object.keys(base).slice(0, 2)).toEqual(['version', 'roadsSchema']);
    expect(Object.keys(dec).slice(0, 3)).toEqual(['version', 'roadsSchema', 'package']);
    expect(recOf(base, 'Plain_1').roadAllowed).toBe(true);
    expect(recOf(base, 'River_L_1').roadAllowed).toBe(false);
    expect(recOf(dec, 'Decameroon_Water_1')).toMatchObject({ allowedRoads: ['bridge_2'], roadAllowed: false });
    expect(recOf(dec, 'Decameroon_Plain_1')).toMatchObject({ allowedRoads: ['road', 'road_2'], roadAllowed: true });
  });

  test('off after active strips roadsSchema again (also one that arrived through Load DB)', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    await page.evaluate(() => { const d = HexDB.getData(); HexDB.load(JSON.stringify({ ...d, roadsSchema: 1, common: { ...d.common, roadDefaults: { Plains: ['road'] } } })); });
    expect(await page.evaluate(() => HexDB.getData().roadsSchema)).toBe(1);   // the loaded file carried it
    expect(await publishBase(page)).toBe(true);
    const f = lastPut(gh, 'packages/postapoc/hex_database.json');
    expect('roadsSchema' in f).toBe(false);
    expect(f.common).toEqual({ goldPerTap: 10 });
    expect(f.hexes.some((h: any) => 'allowedRoads' in h)).toBe(false);
  });

  test('exporting never mutates the in-memory data; an unset record never gets a synthetic list in any mode', async ({ page }) => {
    await worldWithLists(page);
    const r = await page.evaluate(() => {
      const h = HexDB.getAll().find((x: any) => x.id === 'Hills_1'); delete h.allowedRoads;
      const before = JSON.stringify(HexDB.getData());
      const out: any = {};
      for (const mode of ['off', 'stage', 'active']) {
        const f = HexDB.exportFor({ pkg: 'postapoc', mode });
        out[mode] = { has: 'allowedRoads' in f.hexes.find((x: any) => x.id === 'Hills_1'), lists: f.hexes.filter((x: any) => Array.isArray(x.allowedRoads)).length };
      }
      return { out, same: before === JSON.stringify(HexDB.getData()) };
    });
    expect(r.same).toBe(true);
    expect(r.out.off).toEqual({ has: false, lists: 0 });
    expect(r.out.stage.has).toBe(false); expect(r.out.active.has).toBe(false);
    expect(r.out.stage.lists).toBe(11); expect(r.out.active.lists).toBe(11);   // 12 base tiles, one unset
  });

  test('Export ZIP and package publish write the same hex file in the same mode', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    for (const mode of ['off', 'active']) {
      await setMode(page, mode);
      await page.evaluate(() => Packages.publishPackage('decameroon'));
      const published = gh.puts.filter(p => p.path === 'packages/decameroon/hex_database.json').at(-1)!.text;
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => Packages.exportPackage('decameroon', { skipWarning: true }))]);
      const zipB64 = fs.readFileSync((await dl.path())!).toString('base64');
      const inZip = await page.evaluate(async (b64) => {
        const JSZip = await Packages._loadJSZip();
        const z = await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        return await z.file('hex_database.json').async('string');
      }, zipB64);
      expect(inZip).toBe(published);
      expect('roadsSchema' in JSON.parse(inZip)).toBe(mode === 'active');                    // the ZIP is not a stale copy of the other mode
      expect(JSON.parse(inZip).hexes.some((h: any) => 'allowedRoads' in h)).toBe(mode === 'active');
    }
  });

  test('the base manifest after a publish in active mode carries the sha256 of the written bytes', async ({ page }) => {
    const { gh } = await worldWithLists(page);
    gh.setJson('packages/registry.json', { version: 1, packages: [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }] });
    await setMode(page, 'active');
    expect(await page.evaluate(() => GitHubSync.publishHexDbOnly())).toBe(true);
    const written = gh.puts.filter(p => p.path === 'packages/postapoc/hex_database.json').at(-1)!.text;
    const m = gh.json('packages/postapoc/manifest.json');
    expect(m.files.find((f: any) => f.path === 'hex_database.json').sha256).toBe(sha(written));
  });

  test('Save DB (local snapshot) keeps allowedRoads in every mode and writes roadsSchema only in active', async ({ page }) => {
    await worldWithLists(page);
    for (const [mode, schema] of [['off', false], ['stage', false], ['active', true]] as const) {
      await setMode(page, mode);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => HexDB.save())]);
      const f = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8'));
      expect(f.hexes.every((h: any) => Array.isArray(h.allowedRoads))).toBe(true);
      expect('roadsSchema' in f).toBe(schema);
    }
  });
});

test.describe('Roads write mode selector (E6)', () => {
  const sel = (page: Page) => page.locator('#roads-write-mode');
  test('defaults to off, persists, and asks before leaving off; Cancel keeps the old mode', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await expect(sel(page)).toHaveValue('off');
    await sel(page).selectOption('stage');
    await expect(page.locator('#dialog-modal.open')).toContainText('Old game builds read roadAllowed');
    await page.locator('#dialog-modal.open button', { hasText: 'Cancel' }).click();
    await expect(sel(page)).toHaveValue('off');
    expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('off');
    await sel(page).selectOption('stage');
    await page.locator('#dialog-modal.open button', { hasText: 'Continue' }).click();
    await expect.poll(() => page.evaluate(() => RoadPerms.writeMode())).toBe('stage');
    expect(await page.evaluate(() => localStorage.getItem('roadsWriteMode'))).toBe('stage');
    // back to off needs no confirmation
    await sel(page).selectOption('off');
    await expect.poll(() => page.evaluate(() => RoadPerms.writeMode())).toBe('off');
    await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
  });

  test('active is refused while records have no list ("Run Backfill roads first"); allowed once every record has one', async ({ page }) => {
    await seedRoadsWorld(page);
    await page.evaluate(() => App.setMode('hexdb'));
    await sel(page).selectOption('active');
    await expect(page.locator('#toast-container')).toContainText('Run Backfill roads first');
    await expect(page.locator('#dialog-modal.open')).toHaveCount(0);
    await expect(sel(page)).toHaveValue('off');
    expect(await page.evaluate(() => RoadPerms.writeMode())).toBe('off');
    await page.evaluate(() => { for (const h of HexDB.getAll()) HexDB.setAllowedRoads(h, []); });
    await sel(page).selectOption('active');
    await page.locator('#dialog-modal.open button', { hasText: 'Continue' }).click();
    await expect.poll(() => page.evaluate(() => RoadPerms.writeMode())).toBe('active');
  });

  test('an unavailable localStorage does not break the mode logic (default off)', async ({ page }) => {
    await seedRoadsWorld(page);
    const r = await page.evaluate(() => {
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function () { throw new Error('blocked'); };
      try { return RoadPerms.writeMode(); } finally { Storage.prototype.getItem = orig; }
    });
    expect(r).toBe('off');
  });
});
