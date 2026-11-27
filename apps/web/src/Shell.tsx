import { modulesFor, type PublicUser } from '@wms/shared';
import { useState } from 'react';
import { useOnline } from './useOnline';
import { ImportsPage } from './ImportsPage';

export function Shell({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const online = useOnline();
  const modules = modulesFor(user.roles);
  const [page, setPage] = useState<'home' | 'imports'>('home');
  const canImport = user.roles.includes('admin') || user.roles.includes('manager');
  return (
    <div className="shell">
      {!online && (
        <div role="status" className="offline">
          You're offline. Changes will sync when the connection returns.
        </div>
      )}
      <header>
        <strong>Dismantler Platform</strong>
        <span>
          {user.name} · {user.roles.join(', ')}
        </span>
        {canImport && page === 'home' && <button onClick={() => setPage('imports')}>Import data</button>}
        <button onClick={onSignOut}>Sign out</button>
      </header>
      {page === 'imports' ? (
        <ImportsPage onBack={() => setPage('home')} />
      ) : (
      <nav aria-label="Modules">
        <ul>
          {modules.map((m) => (
            <li key={m.code}>
              <span className="code">{m.code}</span> {m.name}
              <span className="phase">Phase {m.phase}</span>
            </li>
          ))}
        </ul>
        {modules.length === 0 && <p>No modules are assigned to your role yet. Ask an admin.</p>}
      </nav>
      )}
    </div>
  );
}
