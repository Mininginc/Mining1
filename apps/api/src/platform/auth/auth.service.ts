import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import type { PublicUser } from '@wms/shared';
import { DB } from '../../db/db.js';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { getDummyHash, verifyPassword } from '../crypto/password.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../crypto/totp.js';
import { toPublicUser } from '../users/users.service.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const GENERIC = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(ctx: ActorContext, input: { email: string; password: string; totp?: string }): Promise<{ accessToken: string; user: PublicUser }> {
    const now = new Date();
    const user = await this.db
      .selectFrom('platform.users')
      .selectAll()
      .where((eb) => eb(eb.fn('lower', ['email']), '=', input.email.trim().toLowerCase()))
      .executeTakeFirst();

    if (!user) {
      await verifyPassword(input.password, await getDummyHash()); // keep timing equal
      await this.audit.record(this.db, ctx, { action: 'auth.login_failed', entityType: 'user', entityId: null, after: { reason: 'unknown_email' } });
      throw new UnauthorizedException(GENERIC);
    }

    const passwordOk = await verifyPassword(input.password, user.password_hash);

    if (user.locked_until && user.locked_until > now) {
      await this.audit.record(this.db, { ...ctx, actorId: user.id }, { action: 'auth.login_blocked_locked', entityType: 'user', entityId: user.id });
      throw new UnauthorizedException(GENERIC);
    }
    if (!user.active) {
      await this.audit.record(this.db, { ...ctx, actorId: user.id }, { action: 'auth.login_blocked_inactive', entityType: 'user', entityId: user.id });
      throw new UnauthorizedException(GENERIC);
    }
    if (!passwordOk) {
      await this.registerFailure(ctx, user.id, 'bad_password');
      throw new UnauthorizedException(GENERIC);
    }
    if (user.mfa_enabled) {
      if (!input.totp) throw new UnauthorizedException({ message: 'MFA code required', code: 'mfa_required' });
      if (!user.mfa_secret || !verifyTotp(user.mfa_secret, input.totp)) {
        await this.registerFailure(ctx, user.id, 'bad_mfa_code');
        throw new UnauthorizedException({ message: 'Invalid MFA code', code: 'mfa_invalid' });
      }
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('platform.users').set({ failed_logins: 0, locked_until: null }).where('id', '=', user.id).execute();
      await this.audit.record(trx, { ...ctx, actorId: user.id }, { action: 'auth.login_succeeded', entityType: 'user', entityId: user.id });
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: toPublicUser(user) };
  }

  private async registerFailure(ctx: ActorContext, userId: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('platform.users')
        .set((eb) => ({ failed_logins: eb('failed_logins', '+', 1) }))
        .where('id', '=', userId)
        .returning(['failed_logins'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { ...ctx, actorId: userId }, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: userId,
        after: { reason, failedLogins: row.failed_logins },
      });
      if (row.failed_logins >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
        await trx.updateTable('platform.users').set({ failed_logins: 0, locked_until: lockedUntil }).where('id', '=', userId).execute();
        await this.audit.record(trx, { ...ctx, actorId: userId }, {
          action: 'auth.locked_out',
          entityType: 'user',
          entityId: userId,
          after: { lockedUntil },
        });
      }
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const u = await this.db
      .selectFrom('platform.users')
      .select(['id', 'email', 'name', 'roles', 'active', 'mfa_enabled'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return toPublicUser(u);
  }

  /** Stores a pending secret; MFA turns on only after `enableMfa` confirms a code. */
  async setupMfa(ctx: ActorContext, userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    return this.db.transaction().execute(async (trx) => {
      const u = await trx.selectFrom('platform.users').select(['email', 'mfa_enabled']).where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (u.mfa_enabled) throw new BadRequestException('MFA is already enabled');
      const secret = generateSecret();
      await trx.updateTable('platform.users').set({ mfa_secret: secret, updated_at: new Date() }).where('id', '=', userId).execute();
      await this.audit.record(trx, ctx, { action: 'auth.mfa_setup_started', entityType: 'user', entityId: userId });
      return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
    });
  }

  async enableMfa(ctx: ActorContext, userId: string, code: string): Promise<PublicUser> {
    return this.db.transaction().execute(async (trx) => {
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
      await this.audit.record(trx, ctx, {
        action: 'auth.mfa_enabled',
        entityType: 'user',
        entityId: userId,
        before: { mfaEnabled: false },
        after: { mfaEnabled: true },
      });
      return toPublicUser(row);
    });
  }
}
