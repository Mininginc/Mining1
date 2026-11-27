import type { Request } from 'express';
import type { Role } from '@wms/shared';

export interface AuthUser {
  id: string;
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
  actorId: string | null;
  ip: string | null;
  requestId: string | null;
}

export function actorFrom(req: AuthedRequest): ActorContext {
  return { actorId: req.user?.id ?? null, ip: req.ip ?? null, requestId: req.requestId ?? null };
}
