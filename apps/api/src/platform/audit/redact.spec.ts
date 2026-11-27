import { describe, expect, it } from 'vitest';
import { redact } from './audit.service.js';

describe('audit redaction', () => {
  it('removes secrets at any depth', () => {
    const out = redact({ email: 'a@b.c', password_hash: 'x', nested: { mfa_secret: 'y', password: 'z', ok: 1 } });
    expect(out).toEqual({ email: 'a@b.c', nested: { ok: 1 } });
  });
  it('turns undefined into null and dates into ISO strings', () => {
    expect(redact(undefined)).toBeNull();
    expect(redact({ at: new Date('2026-01-02T03:04:05Z') })).toEqual({ at: '2026-01-02T03:04:05.000Z' });
  });
});
