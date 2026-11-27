import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import { isRole, type Role } from '@wms/shared';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';
import type { AuthedRequest } from '../../common/request-context.js';
import { IS_PUBLIC, ROLES_KEY } from './decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard: every route needs a valid token unless marked @Public().
 * The user is re-read inside their company on each request, so deactivation and role changes
 * apply at once, and a token can never reach another company's rows.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Kysely<Database>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let sub: string;
    let cid: string;
    try {
      ({ sub, cid } = await this.jwt.verifyAsync<{ sub: string; cid: string }>(token));
    } catch {
      throw new UnauthorizedException();
    }
    if (!UUID.test(sub ?? '') || !UUID.test(cid ?? '')) throw new UnauthorizedException();

    const user = await withCompany(this.db, cid, (trx) =>
      trx.selectFrom('platform.users').select(['id', 'company_id', 'email', 'name', 'roles', 'active']).where('id', '=', sub).executeTakeFirst(),
    );
    if (!user || !user.active) throw new UnauthorizedException();

    const roles = user.roles.filter(isRole);
    req.user = { id: user.id, companyId: user.company_id, email: user.email, name: user.name, roles };

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (required?.length && !roles.includes('admin') && !required.some((r) => roles.includes(r))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
