import { test, expect, Page } from '@playwright/test';
import * as crypto from 'crypto';
import { openEditor, FakeGitHub, seedSprites, TINY_PNG, dataUrl, quiesceAfterDialog } from './helpers';

// Unified Publish, stage 1 (docs/superpowers/plans/2026-10-23-unified-publish-stage1.md).
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const CHANGED_PNG = Buffer.concat([TINY_PNG, Buffer.from([0])]);   // same name, different bytes
const hex = (id: string, extra: object = {}) => ({ id, package: 'hashpkg', spriteName: id, type: 'Plains', ...extra });

async function setupPkg(page: Page, gh: FakeGitHub, opts: { manifest?: 'ok' | 'none' | 'corrupt' } = {}) {
  gh.setRegistry([{ id: 'hashpkg', name: 'Hash Pkg', version: '1.0.0' }]);
  gh.setJson('packages/hashpkg/package.json', { id: 'hashpkg', name: 'Hash Pkg', version: '1.0.0', description: 'D', preview: 'p.png', isDefault: false });
  gh.setJson('packages/hashpkg/hex_database.json', { version: 1, package: 'hashpkg', hexes: [hex('Hashpkg_Same'), hex('Hashpkg_Changed')] });
  const mode = opts.manifest ?? 'ok';
  if (mode === 'ok') gh.setJson('packages/hashpkg/manifest.json', { schemaVersion: 1, id: 'hashpkg', version: '1.0.0', files: [
    { path: 'sprites/hex/Hashpkg_Same.png', sha256: sha(TINY_PNG), size: TINY_PNG.length },
    { path: 'sprites/hex/Hashpkg_Changed.png', sha256: sha(TINY_PNG), size: TINY_PNG.length },
  ] });
  if (mode === 'corrupt') gh.write('packages/hashpkg/manifest.json', '{ not json');
  await openEditor(page, { gh, pat: true });
  await page.waitForFunction(() => !!Packages.getEntry('hashpkg'));
  await page.evaluate(() => (window as any).__startupSyncDone);
  await page.evaluate(h => HexDB.addEntries(h), [hex('Hashpkg_Same'), hex('Hashpkg_Changed'), hex('Hashpkg_New')]);
  await seedSprites(page, [
    { name: 'Hashpkg_Same', category: 'hex', dataUrl: dataUrl(TINY_PNG) },
    { name: 'Hashpkg_Changed', category: 'hex', dataUrl: dataUrl(CHANGED_PNG) },
    { name: 'Hashpkg_New', category: 'hex', dataUrl: dataUrl(TINY_PNG) },
  ]);
}
const spritePuts = (gh: FakeGitHub) => gh.putPaths().filter(p => p.startsWith('packages/hashpkg/sprites/'));

test.describe('Task 1: unchanged sprites are skipped', () => {
  test('a sprite whose hash matches the server manifest is not uploaded', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh);
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toContain('packages/hashpkg/sprites/hex/Hashpkg_Changed.png');
    expect(spritePuts(gh)).toContain('packages/hashpkg/sprites/hex/Hashpkg_New.png');
    expect(spritePuts(gh)).not.toContain('packages/hashpkg/sprites/hex/Hashpkg_Same.png');
    expect(r.skipped).toBe(1);
  });

  test('no manifest on the server (first publish): every sprite uploads', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh, { manifest: 'none' });
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toHaveLength(3);
    expect(r.skipped).toBe(0);
  });

  test('a corrupt server manifest: every sprite uploads and nothing throws', async ({ page }) => {
    const gh = new FakeGitHub();
    await setupPkg(page, gh, { manifest: 'corrupt' });
    const r = await page.evaluate(() => Packages.publishPackageSprites('hashpkg'));
    expect(spritePuts(gh)).toHaveLength(3);
    expect(r.skipped).toBe(0);
  });
});
