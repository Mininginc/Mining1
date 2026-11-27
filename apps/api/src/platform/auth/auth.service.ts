import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import type { PublicUser } from '@wms/shared';
import { CONFIG, type AppConfig } from '../../config.js';
import { DB } from '../../db/db.js';
import { companyIdBySlug, withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { getDummyHash, verifyPassword } from '../crypto/password.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../crypto/totp.js';
import { toPublicUser } from '../users/users.service.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const GENERIC = 'Invalid company, email or password';

type Meta = { ip: string | null; requestId: string | null };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(meta: Meta, input: { company?: string; email: string; password: string; totp?: string }) {
    const slug = input.company?.trim().toLowerCase() || this.config.DEFAULT_COMPANY_SLUG;
    const companyId = slug ? await companyIdBySlug(this.db, slug) : null;
    if (!companyId) {
      // Unknown company: nothing to audit against. Keep timing close to a real attempt.
      await verifyPassword(input.password, await getDummyHash());
      throw new UnauthorizedException(GENERIC);
    }

    const now = new Date();
    const user = await withCompany(this.db, companyId, (trx) =>
      trx
        .selectFrom('platform.users')
        .selectAll()
        .where((eb) => eb(eb.fn('lower', ['email']), '=', input.email.trim().toLowerCase()))
        .executeTakeFirst(),
    );

    if (!user) {
      await verifyPassword(input.password, await getDummyHash());
      await withCompany(this.db, companyId, (trx) =>
        this.audit.record(trx, { ...meta, actorId: null }, { action: 'auth.login_failed', entityType: 'user', entityId: null, after: { reason: 'unknown_email' } }),
      );
      throw new UnauthorizedException(GENERIC);
    }

    const passwordOk = await verifyPassword(input.password, user.password_hash);
    const as = { ...meta, actorId: user.id };

    if (user.locked_until && user.locked_until > now) {
      await withCompany(this.db, companyId, (trx) => this.audit.record(trx, as, { action: 'auth.login_blocked_locked', entityType: 'user', entityId: user.id }));
      throw new UnauthorizedException(GENERIC);
    }
    if (!user.active) {
      await withCompany(this.db, companyId, (trx) => this.audit.record(trx, as, { action: 'auth.login_blocked_inactive', entityType: 'user', entityId: user.id }));
      throw new UnauthorizedException(GENERIC);
    }
    if (!passwordOk) {
      await this.registerFailure(companyId, as, user.id, 'bad_password');
      throw new UnauthorizedException(GENERIC);
    }
    if (user.mfa_enabled) {
      if (!input.totp) throw new UnauthorizedException({ message: 'MFA code required', code: 'mfa_required' });
      if (!user.mfa_secret || !verifyTotp(user.mfa_secret, input.totp)) {
        await this.registerFailure(companyId, as, user.id, 'bad_mfa_code');
        throw new UnauthorizedException({ message: 'Invalid MFA code', code: 'mfa_invalid' });
      }
    }

    await withCompany(this.db, companyId, async (trx) => {
      await trx.updateTable('platform.users').set({ failed_logins: 0, locked_until: null }).where('id', '=', user.id).execute();
      await this.audit.record(trx, as, { action: 'auth.login_succeeded', entityType: 'user', entityId: user.id });
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id, cid: companyId });
    return { accessToken, user: toPublicUser(user) };
  }

  private async registerFailure(companyId: string, as: Omit<ActorContext, 'companyId'>, userId: string, reason: string): Promise<void> {
    await withCompany(this.db, companyId, async (trx) => {
      const row = await trx
        .updateTable('platform.users')
        .set((eb) => ({ failed_logins: eb('failed_logins', '+', 1) }))
        .where('id', '=', userId)
        .returning(['failed_logins'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, as, { action: 'auth.login_failed', entityType: 'user', entityId: userId, after: { reason, failedLogins: row.failed_logins } });
      if (row.failed_logins >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
        await trx.updateTable('platform.users').set({ failed_logins: 0, locked_until: lockedUntil }).where('id', '=', userId).execute();
        await this.audit.record(trx, as, { action: 'auth.locked_out', entityType: 'user', entityId: userId, after: { lockedUntil } });
      }
    });
  }

  async me(companyId: string, userId: string): Promise<PublicUser & { company: { id: string; name: string; slug: string } }> {
    return withCompany(this.db, companyId, async (trx) => {
      const u = await trx
        .selectFrom('platform.users')
        .select(['id', 'email', 'name', 'roles', 'active', 'mfa_enabled'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      const c = await trx.selectFrom('platform.companies').select(['id', 'name', 'slug']).executeTakeFirstOrThrow();
      return { ...toPublicUser(u), company: c };
    });
  }

  /** Stores a pending secret; MFA turns on only after `enableMfa` confirms a code. */
  async setupMfa(ctx: ActorContext, userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    return withCompany(this.db, ctx.companyId, async (trx) => {
      const u = await trx.selectFrom('platform.users').select(['email', 'mfa_enabled']).where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (u.mfa_enabled) throw new BadRequestException('MFA is already enabled');
      const secret = generateSecret();
      await trx.updateTable('platform.users').set({ mfa_secret: secret, updated_at: new Date() }).where('id', '=', userId).execute();
      await this.audit.record(trx, ctx, { action: 'auth.mfa_setup_started', entityType: 'user', entityId: userId });
      return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
    });
  }

  async enableMfa(ctx: ActorContext, userId: string, code: string): Promise<PublicUser> {
    return withCompany(this.db, ctx.companyId, async (trx) => {
      const u = await trx.selectFrom('platform.users').selectAll().where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (u.mfa_enabled) throw new BadRequestException('MFA is already enabled');
      if (!u.mfa_secret) throw new BadRequestException('Start MFA setup first');
      if (!verifyTotp(u.mfa_secret, code)) throw new BadRequestException('Invalid MFA code');
      const row = await trx
        .updateTable('platform.users')
        .set({ mfa_enabled: true, updated_at: new Date() })
        .where('id', '=', userId)
        .returning(['id', 'email', 'name', 'roles', 'active', 'mfa_enabled'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, { action: 'auth.mfa_enabled', entityType: 'user', entityId: userId, before: { mfaEnabled: false }, after: { mfaEnabled: true } });
      return toPublicUser(row);
    });
  }
}
