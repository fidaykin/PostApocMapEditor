import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

test.beforeEach(async ({ page }) => { await openEditor(page); });

const merge = (page: any, local: any[], server: any[], base: any[] | null) =>
  page.evaluate(([l, s, b]: any) => SyncMerge.merge3(l, s, b), [local, server, base]);

test('an entry untouched locally takes the server update', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 1 }], [{ id: 'A', v: 2 }], [{ id: 'A', v: 1 }]);
  expect(r.merged).toEqual([{ id: 'A', v: 2 }]);
  expect(r.conflicts).toEqual([]);
  expect(r.fromServer).toBe(1);
});

test('a locally edited entry is kept and reported', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 9 }], [{ id: 'A', v: 2 }], [{ id: 'A', v: 1 }]);
  expect(r.merged).toEqual([{ id: 'A', v: 9 }]);
  expect(r.conflicts).toEqual(['postapoc::A']);
  expect(r.kept).toBe(1);
});

test('without a base every differing local entry is kept', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 1 }, { id: 'B', v: 5 }], [{ id: 'A', v: 2 }, { id: 'B', v: 5 }], null);
  expect(r.merged).toEqual([{ id: 'A', v: 1 }, { id: 'B', v: 5 }]);
  expect(r.conflicts).toEqual(['postapoc::A']);
});

test('server-only entries are added after local-only ones are preserved; server order first', async ({ page }) => {
  const r = await merge(page, [{ id: 'L', v: 1 }], [{ id: 'S', v: 1 }], [{ id: 'X', v: 0 }]);
  expect(r.merged.map((e: any) => e.id)).toEqual(['S', 'L']);
});

test('deletions: local delete sticks, unedited server delete applies, edited server delete is kept', async ({ page }) => {
  const base = [{ id: 'A', v: 1 }, { id: 'B', v: 1 }, { id: 'C', v: 1 }];
  const local = [{ id: 'B', v: 1 }, { id: 'C', v: 7 }];            // A deleted locally, C edited locally
  const server = [{ id: 'A', v: 1 }];                               // B and C deleted on the server
  const r = await merge(page, local, server, base);
  expect(r.merged).toEqual([{ id: 'C', v: 7 }]);                    // A stays deleted, B dropped, C kept
  expect(r.dropped).toBe(2);
});

test('same id in different packages are different entries (reskins)', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', package: 'skin', v: 1 }], [{ id: 'A', v: 1 }], null);
  expect(r.merged.length).toBe(2);
  expect(r.conflicts).toEqual([]);
});

test('key order does not matter for equality', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', a: 1, b: { x: 1, y: 2 } }], [{ b: { y: 2, x: 1 }, a: 1, id: 'A' }], null);
  expect(r.conflicts).toEqual([]);
});

test('saveBase/loadBase keep packages side by side', async ({ page }) => {
  const out = await page.evaluate(() => {
    SyncMerge.saveBase('hex', 'p1', [{ id: 'A' }]);
    SyncMerge.saveBase('hex', 'p2', [{ id: 'B' }]);
    return SyncMerge.loadBase('hex');
  });
  expect(out).toEqual({ p1: [{ id: 'A' }], p2: [{ id: 'B' }] });
});

test('local entries without a usable id are passed through', async ({ page }) => {
  const r = await merge(page, [{ v: 1 }, { id: '', v: 2 }, { id: 'A', v: 3 }], [{ id: 'A', v: 3 }], null);
  expect(r.merged).toEqual([{ id: 'A', v: 3 }, { v: 1 }, { id: '', v: 2 }]);
});

test('duplicate package+id local entries are all preserved', async ({ page }) => {
  const r = await merge(page, [{ id: 'A', v: 1 }, { id: 'A', v: 2 }], [], null);
  expect(r.merged).toEqual([{ id: 'A', v: 1 }, { id: 'A', v: 2 }]);
});

test('undefined values equal missing keys', async ({ page }) => {
  const r = await page.evaluate(() => SyncMerge.same({ id: 'A', a: undefined }, { id: 'A' }));
  expect(r).toBe(true);
});
