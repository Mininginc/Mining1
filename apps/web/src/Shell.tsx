import { modulesFor, type PublicUser } from '@wms/shared';
import { useOnline } from './useOnline';

export function Shell({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const online = useOnline();
  const modules = modulesFor(user.roles);
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
        <button onClick={onSignOut}>Sign out</button>
      </header>
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
    </div>
  );
}
