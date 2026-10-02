import { test, expect } from '@playwright/test';
import { assertBaselineWriteAllowed, saveBaselineKey, PRE_OPT_COMMIT_STAMPS } from './perf-scene';

// Pure tests (no browser): baselines may only be recorded from a pre-optimisation editor build.
test('baseline writes are allowed only for the pre-optimisation COMMIT stamps', () => {
  for (const s of PRE_OPT_COMMIT_STAMPS) expect(() => assertBaselineWriteAllowed(s)).not.toThrow();
  expect(PRE_OPT_COMMIT_STAMPS).toEqual(['4ac8bec', 'c3060d1']);
  expect(() => assertBaselineWriteAllowed('a5bb9a8')).toThrow(/Refusing to write perf baselines/);
  expect(() => assertBaselineWriteAllowed(undefined)).toThrow(/unknown/);
  expect(() => assertBaselineWriteAllowed('')).toThrow(/Refusing/);
});

test('saveBaselineKey refuses before any page has been inspected', () => {
  expect(() => saveBaselineKey('__guard_probe', 1)).toThrow(/Refusing to write perf baselines/);
});
