import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// deploy-dev.yml turns every literal head tag of MapEditorPro.html into "head + <base href>". A second occurrence (a comment or a string)
// puts the <base> line inside it and the page dies with "Unexpected token '<'": the dev page was broken that way from 2026-10-06 to 2026-11-08.
test('MapEditorPro.html has exactly one literal head tag, so the dev build gets exactly one <base>', () => {
  const html = readFileSync(join(__dirname, '..', 'MapEditorPro.html'), 'utf8');
  expect(html.split('<head>').length - 1).toBe(1);
  const built = html.split('<head>').join('<head>\n<base href="../">');
  expect(built.split('<base href').length - 1).toBe(1);
});
