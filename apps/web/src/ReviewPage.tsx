import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ReviewItem } from './api';
import { ISSUE_NAMES } from './ImportsPage';

export function ReviewPage({ onBack, canResolve }: { onBack: () => void; canResolve: boolean }) {
  const [counts, setCounts] = useState<{ code: string; count: number }[]>([]);
  const [code, setCode] = useState<string>('');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([api.reviewCounts(), api.reviewItems(code || undefined)]);
      setCounts(c.map((x) => ({ code: x.code, count: Number(x.count) })));
      setItems(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the review list');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(item: ReviewItem) {
    try {
      await api.resolveItem(item.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark it fixed');
    }
  }

  const total = counts.reduce((a, c) => a + c.count, 0);
  return (
    <main className="imports">
      <button onClick={onBack}>← Back</button>
      <h1>Import problems to review ({total})</h1>
      <label>
        Show{' '}
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Problem type">
          <option value="">All problems ({total})</option>
          {counts.map((c) => (
            <option key={c.code} value={c.code}>
              {ISSUE_NAMES[c.code] ?? c.code} ({c.count})
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      {items.length === 0 ? (
        <p>Nothing to review.</p>
      ) : (
        <table aria-label="Problems" className="result">
          <thead>
            <tr>
              <th>Problem</th>
              <th>File, row</th>
              <th>Details</th>
              {canResolve && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{ISSUE_NAMES[i.code] ?? i.code}</td>
                <td>
                  {i.file_name ?? (i.kind === 'car_sheet' ? 'Car sheet' : 'eBay listings')}
                  {i.row_number ? `, row ${i.row_number}` : ''}
                </td>
                <td>{i.message}</td>
                {canResolve && (
                  <td>
                    <button onClick={() => resolve(i)} aria-label={`Mark fixed: ${i.message}`}>
                      Mark fixed
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
