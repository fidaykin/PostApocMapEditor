import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openEditor } from './helpers';

// T6.6: code that the repo-wide grep ("2-hit" method, scripts/unreferenced.sh) proved unreferenced was removed. These tests
// keep it removed and prove the editor still starts and builds its palette without it.
const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('dead public helpers are gone and the editor still builds its palette', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openEditor(page);
  const r = await page.evaluate(() => ({
    sel: typeof UI.selectCustomTerrain, id: typeof UI.getSelectedCustomId, spr: typeof Terrain.getCustomSprite,
    // positive controls: the live neighbours of the removed helpers still exist
    selectTerrain: typeof UI.selectTerrain, getSelectedTerrain: typeof UI.getSelectedTerrain, getSprite: typeof Terrain.getSprite,
    buttons: document.querySelectorAll('#palette-scroll .tile-btn').length,
  }));
  expect(r).toMatchObject({ sel: 'undefined', id: 'undefined', spr: 'undefined', selectTerrain: 'function', getSelectedTerrain: 'function', getSprite: 'function' });
  expect(r.buttons).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
