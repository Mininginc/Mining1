import type { Request } from 'express';
import type { Role } from '@wms/shared';

export interface AuthUser {
  id: string;
  companyId: string;
  email: string;
  name: string;
  roles: Role[];
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  requestId?: string;
}

/** Who did it, from where: passed to every write so it can be audited. */
export interface ActorContext {
  companyId: string;
  actorId: string | null;
  ip: string | null;
  requestId: string | null;
}

/** For signed-in routes: the company comes from the verified token, never from the request body. */
export function actorFrom(req: AuthedRequest): ActorContext {
  if (!req.user) throw new Error('actorFrom needs a signed-in request');
  return { companyId: req.user.companyId, actorId: req.user.id, ip: req.ip ?? null, requestId: req.requestId ?? null };
}

/** For sign-in, before the company is known. */
export function requestMeta(req: AuthedRequest): { ip: string | null; requestId: string | null } {
  return { ip: req.ip ?? null, requestId: req.requestId ?? null };
}
