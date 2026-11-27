import type { PublicUser } from '@wms/shared';

const TOKEN_KEY = 'wms.token';
const COMPANY_KEY = 'wms.company';

/** The company code is remembered on this device so staff type it once. */
export const companyStore = {
  get: () => localStorage.getItem(COMPANY_KEY) ?? '',
  set: (c: string) => localStorage.setItem(COMPANY_KEY, c),
};

export interface ImportIssue {
  rowNumber: number | null;
  code: string;
  message: string;
}

export interface ImportResult {
  runId: string;
  status: 'succeeded' | 'failed';
  counts: Record<string, number>;
  issues: ImportIssue[];
  error?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? res.statusText, body?.code);
  return body as T;
}

export const api = {
  login: (company: string, email: string, password: string, totp?: string) =>
    call<{ accessToken: string; user: PublicUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ ...(company ? { company } : {}), email, password, ...(totp ? { totp } : {}) }),
    }),
  me: () => call<PublicUser>('/auth/me'),
  importCarSheet: (fileName: string, content: string) =>
    call<ImportResult>('/intake/imports/car-sheet', { method: 'POST', body: JSON.stringify({ fileName, content }) }),
  importEbayCsv: (fileName: string, content: string) =>
    call<ImportResult>('/inventory/imports/ebay-csv', { method: 'POST', body: JSON.stringify({ fileName, content }) }),
};
