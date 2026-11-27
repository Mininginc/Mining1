import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { base32Decode, base32Encode, generateSecret, totp, verifyTotp } from './totp.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong horse battery', hash)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same password here')).not.toEqual(await hashPassword('same password here'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", last 6 digits.
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59_000, '287082'],
    [1_111_111_109_000, '081804'],
    [1_234_567_890_000, '005924'],
    [2_000_000_000_000, '279037'],
  ])('matches the RFC vector at %i ms', (t, code) => {
    expect(totp(rfcSecret, t)).toBe(code);
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('hello world, dismantlers');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts one step of clock drift and rejects two', () => {
    const secret = generateSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });

  it('rejects non-numeric codes', () => {
    expect(verifyTotp(generateSecret(), 'abcdef')).toBe(false);
  });
});
