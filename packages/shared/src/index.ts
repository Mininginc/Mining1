export const ROLES = [
  'admin',
  'manager',
  'yard_tech',
  'dismantler',
  'warehouse',
  'sales',
  'shipping',
  'accounting',
] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface ModuleInfo {
  code: string;
  name: string;
  phase: number;
  roles: Role[];
}

/** The 16 modules and which roles see them in the app. `admin` sees everything. */
export const MODULES: ModuleInfo[] = [
  { code: 'M1', name: 'Platform', phase: 0, roles: ['admin'] },
  { code: 'M2', name: 'Vehicle Intake', phase: 1, roles: ['manager', 'yard_tech'] },
  { code: 'M3', name: 'Dismantling', phase: 1, roles: ['manager', 'dismantler', 'yard_tech'] },
  { code: 'M4', name: 'Parts & Inventory', phase: 1, roles: ['manager', 'warehouse', 'dismantler', 'sales'] },
  { code: 'M5', name: 'Pricing & Listings', phase: 2, roles: ['manager', 'sales'] },
  { code: 'M6', name: 'Sales & Orders', phase: 1, roles: ['manager', 'sales'] },
  { code: 'M7', name: 'Fulfillment', phase: 1, roles: ['manager', 'warehouse', 'shipping'] },
  { code: 'M8', name: 'Returns & Warranty', phase: 2, roles: ['manager', 'sales', 'warehouse'] },
  { code: 'M9', name: 'Disposition & Recycling', phase: 1, roles: ['manager', 'yard_tech'] },
  { code: 'M10', name: 'Marketing & CRM', phase: 2, roles: ['manager', 'sales'] },
  { code: 'M11', name: 'Finance', phase: 2, roles: ['manager', 'accounting'] },
  { code: 'M12', name: 'People & HR', phase: 2, roles: ['manager'] },
  { code: 'M13', name: 'Compliance & Risk', phase: 2, roles: ['manager'] },
  { code: 'M14', name: 'Purchasing & Vendors', phase: 3, roles: ['manager', 'accounting'] },
  { code: 'M15', name: 'Facilities & Equipment', phase: 4, roles: ['manager'] },
  { code: 'M16', name: 'Analytics', phase: 1, roles: ['manager', 'accounting'] },
];

export function modulesFor(roles: readonly Role[]): ModuleInfo[] {
  if (roles.includes('admin')) return MODULES;
  return MODULES.filter((m) => m.roles.some((r) => roles.includes(r)));
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  active: boolean;
  mfaEnabled: boolean;
}

export const MIN_PASSWORD_LENGTH = 12;
