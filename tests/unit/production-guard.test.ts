// @vitest-environment node
import { expect, it } from 'vitest';
import { assertProductionFlags } from '../../scripts/verify-no-demo.mjs';
it('rejects every production demo flag rather than silently enabling a fixture identity', () => {
  for (const name of [
    'DEMO_AUTH',
    'DEMO_DATA',
    'NEXT_PUBLIC_DEMO_AUTH',
    'NEXT_PUBLIC_DEMO_DATA',
    'ENABLE_FIXTURES',
  ])
    expect(() => assertProductionFlags({ [name]: 'true' })).toThrow();
  expect(() => assertProductionFlags({ DEMO_AUTH: 'false', DEMO_DATA: '0' })).not.toThrow();
});
