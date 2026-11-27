import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@wms/shared';
import { Shell } from './Shell';

const manager: PublicUser = { id: 'u1', email: 'm@x.co', name: 'Mia', roles: ['manager'], active: true, mfaEnabled: false };
const sales: PublicUser = { ...manager, roles: ['sales'] };
const yard: PublicUser = { ...manager, roles: ['yard_tech'] };

const item = { id: '7', run_id: 'r', row_number: 600, code: 'duplicate_car_id', message: 'Car ID 743 also appears on row 586', ref: '743', kind: 'car_sheet', file_name: 'Cars Inventory.csv', started_at: '2026-11-27' };

function backend() {
  let open = [item];
  return vi.fn((url: string, init?: RequestInit) => {
    const body = url.endsWith('/counts')
      ? open.length
        ? [{ code: 'duplicate_car_id', count: String(open.length) }]
        : []
      : url.includes('/resolve') && init?.method === 'POST'
        ? ((open = []), { id: '7' })
        : open;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('review screen', () => {
  it('lets a manager see problems and mark one fixed', async () => {
    const fetchMock = backend();
    vi.stubGlobal('fetch', fetchMock);
    render(<Shell user={manager} onSignOut={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review problems' }));
    const table = await screen.findByRole('table', { name: 'Problems' });
    expect(table).toHaveTextContent('Car ID used twice');
    expect(table).toHaveTextContent('Cars Inventory.csv, row 600');
    await userEvent.click(screen.getByRole('button', { name: /Mark fixed/ }));
    await waitFor(() => expect(screen.getByText('Nothing to review.')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/imports/issues/7/resolve' && i?.method === 'POST')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Import problems to review (0)' })).toBeInTheDocument();
  });

  it('shows sales the list without the Mark fixed button, and hides it from yard staff', async () => {
    vi.stubGlobal('fetch', backend());
    const { unmount } = render(<Shell user={sales} onSignOut={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review problems' }));
    await screen.findByRole('table', { name: 'Problems' });
    expect(screen.queryByRole('button', { name: /Mark fixed/ })).toBeNull();
    unmount();
    render(<Shell user={yard} onSignOut={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Review problems' })).toBeNull();
  });
});
