import { test, expect } from '@playwright/test';
import { openEditor } from './helpers';

// Served through FakeGitHub (no real gh-pages); openEditor waits for the editor to be ready.
test('Check if HexDB is available after page load', async ({ page }) => {
  const { pageErrors } = await openEditor(page, { blankMap: false });
  const modules = await page.evaluate(() => ({
    HexDB: typeof (window as any).HexDB,
    BldDB: typeof (window as any).BldDB,
    SttDB: typeof (window as any).SttDB,
    UpgDB: typeof (window as any).UpgDB,
  }));
  expect(modules.HexDB, `modules: ${JSON.stringify(modules)}; page errors: ${pageErrors.join(' | ')}`).toBe('object');
});
