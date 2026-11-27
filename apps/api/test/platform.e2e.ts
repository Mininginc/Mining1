import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types.js';
import { seedCompany } from '../src/db/seed.js';
import { migrateToLatest } from '../src/db/migrate.js';
import { totp } from '../src/platform/crypto/totp.js';
import { ADMIN, COMPANY, resetDatabase, startApp } from './helpers.js';

let app: INestApplication;
let db: Kysely<Database>;
let adminToken: string;
const http = () => request(app.getHttpServer());

async function login(email: string, password: string, code?: string) {
  return http().post('/auth/login').send({ email, password, ...(code && { totp: code }) });
}

async function createUser(email: string, roles: string[], password = 'user-password-123') {
  const res = await http().post('/users').set('authorization', `Bearer ${adminToken}`).send({ email, name: email, password, roles });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

beforeAll(async () => {
  db = await resetDatabase();
  app = await startApp();
  const res = await login(ADMIN.email, ADMIN.password);
  adminToken = res.body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('AC1-2 health and migrations', () => {
  it('reports the database as reachable without sign-in', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });
  it('running migrations again is a no-op', async () => {
    expect(await migrateToLatest(db)).toEqual([]);
  });
});

describe('AC3 seed', () => {
  it('does not create a second admin in the same company', async () => {
    expect(await seedCompany(db, { company: COMPANY, admin: { email: 'other@test.local', password: 'another-password-1', name: 'X' } })).toEqual({
      companyCreated: false,
      adminCreated: false,
    });
    const admins = await db.selectFrom('platform.users').select('email').execute();
    expect(admins.map((a) => a.email)).toEqual([ADMIN.email]);
  });
  it('rejects a short admin password', async () => {
    await expect(seedCompany(db, { company: COMPANY, admin: { email: 'x@test.local', password: 'short', name: 'X' } })).rejects.toThrow(/at least 12/);
  });
});

describe('AC4 login', () => {
  it('returns a token and the public user, email case-insensitive', async () => {
    const res = await login(ADMIN.email.toUpperCase(), ADMIN.password);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: ADMIN.email, roles: ['admin'], mfaEnabled: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|mfa_secret|secret/i);
  });
  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await login(ADMIN.email, 'nope-nope-nope-1');
    const unknown = await login('nobody@test.local', 'nope-nope-nope-1');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });
  it('refuses requests without a valid token', async () => {
    expect((await http().get('/auth/me')).status).toBe(401);
    expect((await http().get('/auth/me').set('authorization', 'Bearer garbage')).status).toBe(401);
  });
  it('returns the current user from /auth/me', async () => {
    const res = await http().get('/auth/me').set('authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN.email);
  });
});

describe('AC5 lockout', () => {
  it('locks after 5 failures, even with the right password', async () => {
    await createUser('lock@test.local', ['sales']);
    for (let i = 0; i < 5; i++) expect((await login('lock@test.local', 'wrong-password-xx')).status).toBe(401);
    expect((await login('lock@test.local', 'user-password-123')).status).toBe(401);
    const row = await db.selectFrom('platform.users').select('locked_until').where('email', '=', 'lock@test.local').executeTakeFirstOrThrow();
    expect(row.locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const actions = await db.selectFrom('platform.audit_log').select('action').where('action', '=', 'auth.locked_out').execute();
    expect(actions).toHaveLength(1);
  });
  it('an admin password reset clears the lock', async () => {
    const u = await db.selectFrom('platform.users').select('id').where('email', '=', 'lock@test.local').executeTakeFirstOrThrow();
    const res = await http().patch(`/users/${u.id}`).set('authorization', `Bearer ${adminToken}`).send({ password: 'brand-new-password-1' });
    expect(res.status).toBe(200);
    expect((await login('lock@test.local', 'brand-new-password-1')).status).toBe(200);
  });
});

describe('AC6 MFA', () => {
  it('requires a valid code once enabled', async () => {
    await createUser('mfa@test.local', ['manager']);
    const token = (await login('mfa@test.local', 'user-password-123')).body.accessToken;
    const setup = await http().post('/auth/mfa/setup').set('authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret: string = setup.body.secret;

    expect((await http().post('/auth/mfa/enable').set('authorization', `Bearer ${token}`).send({ code: '000000' })).status).toBe(400);
    const enabled = await http().post('/auth/mfa/enable').set('authorization', `Bearer ${token}`).send({ code: totp(secret) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.mfaEnabled).toBe(true);

    const noCode = await login('mfa@test.local', 'user-password-123');
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('mfa_required');
    const badCode = await login('mfa@test.local', 'user-password-123', totp(secret, Date.now() - 10 * 60_000));
    expect(badCode.status).toBe(401);
    expect((await login('mfa@test.local', 'user-password-123', totp(secret))).status).toBe(200);
  });
});

describe('AC7 inactive users', () => {
  it('blocks login and existing tokens once deactivated', async () => {
    const u = await createUser('gone@test.local', ['warehouse']);
    const token = (await login('gone@test.local', 'user-password-123')).body.accessToken;
    expect((await http().get('/auth/me').set('authorization', `Bearer ${token}`)).status).toBe(200);
    await http().patch(`/users/${u.id}`).set('authorization', `Bearer ${adminToken}`).send({ active: false }).expect(200);
    expect((await http().get('/auth/me').set('authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await login('gone@test.local', 'user-password-123')).status).toBe(401);
  });
});

describe('AC8 roles', () => {
  it('only admin manages users; admin and manager read audit', async () => {
    await createUser('sales@test.local', ['sales']);
    await createUser('boss@test.local', ['manager']);
    const sales = (await login('sales@test.local', 'user-password-123')).body.accessToken;
    const boss = (await login('boss@test.local', 'user-password-123')).body.accessToken;
    expect((await http().get('/users').set('authorization', `Bearer ${sales}`)).status).toBe(403);
    expect((await http().get('/users').set('authorization', `Bearer ${boss}`)).status).toBe(403);
    expect((await http().get('/audit').set('authorization', `Bearer ${sales}`)).status).toBe(403);
    expect((await http().get('/audit').set('authorization', `Bearer ${boss}`)).status).toBe(200);
    expect((await http().get('/users').set('authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });
  it('role changes apply to existing tokens immediately', async () => {
    const u = await createUser('promo@test.local', ['sales']);
    const token = (await login('promo@test.local', 'user-password-123')).body.accessToken;
    expect((await http().get('/audit').set('authorization', `Bearer ${token}`)).status).toBe(403);
    await http().patch(`/users/${u.id}`).set('authorization', `Bearer ${adminToken}`).send({ roles: ['manager'] }).expect(200);
    expect((await http().get('/audit').set('authorization', `Bearer ${token}`)).status).toBe(200);
  });
  it('rejects unknown roles and duplicate emails', async () => {
    const bad = await http().post('/users').set('authorization', `Bearer ${adminToken}`).send({ email: 'r@test.local', name: 'R', password: 'user-password-123', roles: ['owner'] });
    expect(bad.status).toBe(400);
    const dup = await http().post('/users').set('authorization', `Bearer ${adminToken}`).send({ email: 'SALES@test.local', name: 'S', password: 'user-password-123', roles: ['sales'] });
    expect(dup.status).toBe(409);
  });
});

describe('AC9 audit', () => {
  it('records who changed what, with before and after, and never secrets', async () => {
    const u = await createUser('audited@test.local', ['sales']);
    await http().patch(`/users/${u.id}`).set('authorization', `Bearer ${adminToken}`).set('x-request-id', 'req-ac9').send({ roles: ['sales', 'shipping'] }).expect(200);
    const res = await http().get('/audit').query({ entityType: 'user', entityId: u.id }).set('authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const update = res.body.find((r: { action: string }) => r.action === 'user.updated');
    expect(update.before.roles).toEqual(['sales']);
    expect(update.after.roles).toEqual(['sales', 'shipping']);
    expect(update.actor_id).toEqual(expect.any(String));
    expect(update.request_id).toBe('req-ac9');
    expect(res.body.some((r: { action: string }) => r.action === 'user.created')).toBe(true);

    const all = await db.selectFrom('platform.audit_log').selectAll().execute();
    expect(JSON.stringify(all)).not.toMatch(/scrypt\$|password_hash|mfa_secret/);
    expect(all.some((r) => r.action === 'auth.login_succeeded')).toBe(true);
    expect(all.some((r) => r.action === 'auth.login_failed')).toBe(true);
    expect(all.some((r) => r.action === 'auth.mfa_enabled')).toBe(true);
  });
  it('is append-only at the database level', async () => {
    await expect(db.deleteFrom('platform.audit_log').execute()).rejects.toThrow(/append-only/);
    await expect(db.updateTable('platform.audit_log').set({ action: 'x' }).execute()).rejects.toThrow(/append-only/);
  });
  it('writes an outbox event when a user is created', async () => {
    const events = await db.selectFrom('platform.outbox').selectAll().where('topic', '=', 'platform.user.created').execute();
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('AC10 password policy', () => {
  it('rejects passwords under 12 characters', async () => {
    const res = await http().post('/users').set('authorization', `Bearer ${adminToken}`).send({ email: 'short@test.local', name: 'S', password: 'short-pw', roles: ['sales'] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/at least 12/);
  });
});

describe('last-admin protection (found in design verification)', () => {
  it('refuses to deactivate or demote the only active admin', async () => {
    const admin = await db.selectFrom('platform.users').select('id').where('email', '=', ADMIN.email).executeTakeFirstOrThrow();
    const off = await http().patch(`/users/${admin.id}`).set('authorization', `Bearer ${adminToken}`).send({ active: false });
    expect(off.status).toBe(409);
    const demote = await http().patch(`/users/${admin.id}`).set('authorization', `Bearer ${adminToken}`).send({ roles: ['manager'] });
    expect(demote.status).toBe(409);
    expect((await http().get('/auth/me').set('authorization', `Bearer ${adminToken}`)).body.roles).toEqual(['admin']);
  });
  it('allows it once another active admin exists', async () => {
    await createUser('admin2@test.local', ['admin']);
    const admin = await db.selectFrom('platform.users').select('id').where('email', '=', ADMIN.email).executeTakeFirstOrThrow();
    const res = await http().patch(`/users/${admin.id}`).set('authorization', `Bearer ${adminToken}`).send({ roles: ['admin', 'manager'] });
    expect(res.status).toBe(200);
  });
});

describe('security headers', () => {
  it('sets standard hardening headers and a request id', async () => {
    const res = await http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });
});
