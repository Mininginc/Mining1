import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@wms/shared';
import { api, ApiError, companyStore, tokenStore } from './api';

export function LoginPage({ onSignedIn }: { onSignedIn: (u: PublicUser) => void }) {
  const [company, setCompany] = useState(() => companyStore.get());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(company.trim().toLowerCase(), email, password, needCode ? code : undefined);
      tokenStore.set(res.accessToken);
      if (company.trim()) companyStore.set(company.trim().toLowerCase());
      onSignedIn(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mfa_required') {
        setNeedCode(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Cannot reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Dismantler Platform</h1>
      <form onSubmit={submit} aria-label="Sign in">
        <label>
          Company code
          <input autoComplete="organization" autoCapitalize="none" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Leave blank for the default" />
        </label>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {needCode && (
          <label>
            Authenticator code
            <input inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </label>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
