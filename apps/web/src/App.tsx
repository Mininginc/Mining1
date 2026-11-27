import { useEffect, useState } from 'react';
import type { PublicUser } from '@wms/shared';
import { api, tokenStore } from './api';
import { LoginPage } from './LoginPage';
import { Shell } from './Shell';

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checking, setChecking] = useState(() => Boolean(tokenStore.get()));

  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <p className="loading">Loading…</p>;
  if (!user) return <LoginPage onSignedIn={setUser} />;
  return (
    <Shell
      user={user}
      onSignOut={() => {
        tokenStore.clear();
        setUser(null);
      }}
    />
  );
}
