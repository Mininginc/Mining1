import { SetMetadata } from '@nestjs/common';
import type { Role } from '@wms/shared';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Route needs no sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs one of these roles. `admin` always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
