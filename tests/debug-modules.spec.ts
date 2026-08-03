import { test, expect } from '@playwright/test';

test('Check if HexDB is available after page load', async ({ page }) => {
  let logs: string[] = [];
  page.on('console', msg => {
    logs.push(msg.text());
  });
  page.on('pageerror', err => console.error('PAGE CRASH:', err.message));
  
  await page.goto('/MapEditorPro.html');
  
  // Wait for ready message
  await page.waitForTimeout(3000);
  
  const modules = await page.evaluate(() => ({
    HexDB: typeof (window as any).HexDB,
    HexDBKeys: (window as any).HexDB ? Object.keys((window as any).HexDB).join(', ') : 'N/A',
    BldDB: typeof (window as any).BldDB,
    SttDB: typeof (window as any).SttDB,
    UpgDB: typeof (window as any).UpgDB,
  }));
  
  console.log('Modules state:', modules);
  console.log('Relevant logs:', logs.filter(l => l.includes('[') || l.includes('undefined')).slice(0, 10));
  
  expect(modules.HexDB).toBe('object');
});
