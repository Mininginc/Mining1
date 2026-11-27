import { useState, type ChangeEvent } from 'react';
import { api, ApiError, type ImportResult } from './api';

type Kind = 'cars' | 'ebay';

const LABELS: Record<Kind, { title: string; help: string }> = {
  cars: { title: 'Car spreadsheet', help: 'The Cars Inventory sheet saved as CSV. Car ID and VIN columns are required.' },
  ebay: { title: 'eBay active listings', help: 'Seller Hub > Listings > Active > Download report (CSV).' },
};

const ISSUE_NAMES: Record<string, string> = {
  duplicate_car_id: 'Car ID used twice',
  duplicate_vin: 'Same VIN on several cars',
  vin_invalid: 'VIN looks mistyped',
  invalid_date: 'Date not readable',
  invalid_money: 'Amount not readable',
  profit_mismatch: 'Profit does not match',
  sku_unlinked: 'Listing not linked to a car',
  car_mismatch: 'Listing title does not match its car',
  bad_item_number: 'Bad item number',
  bad_quantity: 'Bad quantity',
};

export function ImportsPage({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [result, setResult] = useState<{ kind: Kind; fileName: string; data: ImportResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: Kind, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const data = kind === 'cars' ? await api.importCarSheet(file.name, text) : await api.importEbayCsv(file.name, text);
      setResult({ kind, fileName: file.name, data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  }

  const issuesByCode = new Map<string, number>();
  for (const i of result?.data.issues ?? []) issuesByCode.set(i.code, (issuesByCode.get(i.code) ?? 0) + 1);

  return (
    <main className="imports">
      <button onClick={onBack}>← Back</button>
      <h1>Import existing data</h1>
      <p>Importing again is safe: unchanged rows are left alone.</p>
      {(Object.keys(LABELS) as Kind[]).map((kind) => (
        <section key={kind} className="upload">
          <h2>{LABELS[kind].title}</h2>
          <p>{LABELS[kind].help}</p>
          <label className="file">
            {busy === kind ? 'Importing…' : `Choose ${LABELS[kind].title} file`}
            <input type="file" accept=".csv,text/csv" disabled={busy !== null} onChange={(e) => upload(kind, e)} aria-label={`${LABELS[kind].title} file`} />
          </label>
        </section>
      ))}
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <section aria-label="Import result" className="result">
          <h2>
            {result.fileName}: {result.data.status === 'succeeded' ? 'imported' : 'not imported'}
          </h2>
          {result.data.error && <p role="alert" className="error">{result.data.error}</p>}
          <table>
            <tbody>
              {Object.entries(result.data.counts).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k.replaceAll('_', ' ')}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.data.issues.length > 0 && (
            <>
              <h3>To review ({result.data.issues.length})</h3>
              <ul className="issue-summary">
                {[...issuesByCode].map(([code, n]) => (
                  <li key={code}>
                    {ISSUE_NAMES[code] ?? code}: {n}
                  </li>
                ))}
              </ul>
              <table aria-label="Issues">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.issues.map((i, n) => (
                    <tr key={n}>
                      <td>{i.rowNumber ?? ''}</td>
                      <td>{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </main>
  );
}
