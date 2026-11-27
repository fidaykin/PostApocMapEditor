import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { seedRoadsWorld } from './roads-fixtures';

// Roads V1, E6 step 1: in write mode `off` (the default) the published hex files are byte-identical to what the editor
// would write if Roads V1 weren't there at all. The guard is specifically against roads code changing these bytes in
// `off` mode — it was never meant to freeze the hex record schema itself against unrelated features. The golden files
// were first generated at the plan commit (91be7d0, before any roads change); regenerating them (ROADS_GOLDEN_WRITE=1)
// is legitimate again whenever an unrelated, already-reviewed schema change (not a roads one) needs reflecting here —
// e.g. Actions MVP's `actionBonusDrops` (journal D-47 п.2, 2026-11-27) — but never to paper over an actual roads diff.
const DIR = path.join(__dirname, 'fixtures', 'roads');
const GOLD = {
  basePkg: path.join(DIR, 'off-mode-postapoc-hex_database.json'),
  baseRoot: path.join(DIR, 'off-mode-root-hex_database.json'),
  decameroon: path.join(DIR, 'off-mode-decameroon-hex_database.json'),
};
const WRITE = process.env.ROADS_GOLDEN_WRITE === '1';

function check(file: string, actual: string) {
  if (WRITE) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, actual); return; }
  expect(actual).toBe(fs.readFileSync(file, 'utf8'));
}

test.describe('off mode writes exactly the pre-roads bytes (golden)', () => {
  test('Publish HexDB: packages/postapoc and the root compat file', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    expect(await page.evaluate(() => GitHubSync.publishHexDbOnly({ skipManifest: true }))).toBe(true);
    expect(gh.putPaths()).toEqual(['packages/postapoc/hex_database.json', 'hex_database.json']);
    const pkg = gh.puts[0].text, root = gh.puts[1].text;
    expect(JSON.parse(pkg).hexes.length).toBe(12);           // the base fixture set, not the stale checkout file
    check(GOLD.basePkg, pkg);
    check(GOLD.baseRoot, root);
  });

  test('Publish package decameroon: packages/decameroon/hex_database.json', async ({ page }) => {
    const { gh } = await seedRoadsWorld(page);
    await page.evaluate(() => Packages.publishPackage('decameroon'));
    const put = gh.puts.find(p => p.path === 'packages/decameroon/hex_database.json');
    expect(put).toBeTruthy();
    expect(JSON.parse(put!.text).hexes.length).toBe(60);
    check(GOLD.decameroon, put!.text);
  });
});
