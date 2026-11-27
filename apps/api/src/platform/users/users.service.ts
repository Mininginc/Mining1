import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { isRole, type PublicUser, type Role } from '@wms/shared';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database, UserRow } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { hashPassword } from '../crypto/password.js';

export function toPublicUser(u: Pick<UserRow, 'id' | 'email' | 'name' | 'roles' | 'active' | 'mfa_enabled'>): PublicUser {
  return { id: u.id, email: u.email, name: u.name, roles: u.roles.filter(isRole), active: u.active, mfaEnabled: u.mfa_enabled };
}

const PUBLIC_COLUMNS = ['id', 'email', 'name', 'roles', 'active', 'mfa_enabled'] as const;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(companyId: string): Promise<PublicUser[]> {
    const rows = await withCompany(this.db, companyId, (trx) => trx.selectFrom('platform.users').select(PUBLIC_COLUMNS).orderBy('name').execute());
    return rows.map(toPublicUser);
  }

  async create(ctx: ActorContext, input: { email: string; name: string; password: string; roles: Role[] }): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await withCompany(this.db, ctx.companyId, async (trx) => {
        const row = await trx
          .insertInto('platform.users')
          .values({ email: input.email.trim(), name: input.name, password_hash: passwordHash, roles: input.roles, mfa_secret: null, locked_until: null })
          .returning(PUBLIC_COLUMNS)
          .executeTakeFirstOrThrow();
        const user = toPublicUser(row);
        await this.audit.record(trx, ctx, { action: 'user.created', entityType: 'user', entityId: user.id, after: user });
        await this.outbox.publish(trx, 'platform.user.created', { userId: user.id, roles: user.roles });
        return user;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A user with this email already exists');
      throw e;
    }
  }

  async update(
    ctx: ActorContext,
    id: string,
    patch: { name?: string; roles?: Role[]; active?: boolean; password?: string },
  ): Promise<PublicUser> {
    const passwordHash = patch.password ? await hashPassword(patch.password) : undefined;
    return withCompany(this.db, ctx.companyId, async (trx) => {
      const beforeRow = await trx.selectFrom('platform.users').select(PUBLIC_COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!beforeRow) throw new NotFoundException();
      const row = await trx
        .updateTable('platform.users')
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.roles !== undefined && { roles: patch.roles }),
          ...(patch.active !== undefined && { active: patch.active }),
          ...(passwordHash && { password_hash: passwordHash, failed_logins: 0, locked_until: null }),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returning(PUBLIC_COLUMNS)
        .executeTakeFirstOrThrow();
      const before = toPublicUser(beforeRow);
      const after = toPublicUser(row);
      const wasActiveAdmin = before.active && before.roles.includes('admin');
      const isActiveAdmin = after.active && after.roles.includes('admin');
      if (wasActiveAdmin && !isActiveAdmin) {
        const others = await trx
          .selectFrom('platform.users')
          .select('id')
          .where('id', '!=', id)
          .where('active', '=', true)
          .where(sql<boolean>`'admin' = any(roles)`)
          .executeTakeFirst();
        // Throwing rolls the transaction back, so the change is not saved.
        if (!others) throw new ConflictException('Cannot remove or deactivate the last active admin');
      }
      await this.audit.record(trx, ctx, {
        action: passwordHash ? 'user.updated_with_password_reset' : 'user.updated',
        entityType: 'user',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }
}
