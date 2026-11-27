import { describe, expect, it } from 'vitest';
import { MODULES, modulesFor } from '@wms/shared';

describe('module visibility by role', () => {
  it('admin sees all 16 modules', () => {
    expect(modulesFor(['admin'])).toHaveLength(16);
    expect(MODULES).toHaveLength(16);
  });
  it('shipping sees fulfillment but not finance', () => {
    const names = modulesFor(['shipping']).map((m) => m.code);
    expect(names).toContain('M7');
    expect(names).not.toContain('M11');
  });
  it('a user with no roles sees nothing', () => {
    expect(modulesFor([])).toEqual([]);
  });
});
