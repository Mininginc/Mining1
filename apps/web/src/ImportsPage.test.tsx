import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@wms/shared';
import { Shell } from './Shell';

const manager: PublicUser = { id: 'u1', email: 'm@x.co', name: 'Mia', roles: ['manager'], active: true, mfaEnabled: false };
const sales: PublicUser = { ...manager, roles: ['sales'] };

afterEach(() => vi.unstubAllGlobals());

describe('import screen', () => {
  it('is offered to managers but not to sales', () => {
    const { unmount } = render(<Shell user={sales} onSignOut={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Import data' })).toBeNull();
    unmount();
    render(<Shell user={manager} onSignOut={() => {}} />);
    expect(screen.getByRole('button', { name: 'Import data' })).toBeInTheDocument();
  });

  it('uploads the car sheet and shows counts and issues to review', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            runId: 'r1',
            status: 'succeeded',
            counts: { created: 1288, skipped: 2 },
            issues: [{ rowNumber: 600, code: 'duplicate_car_id', message: 'Car ID 743 also appears on row 586' }],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Shell user={manager} onSignOut={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    const file = new File(['Car ID,VIN\n1,X'], 'Cars Inventory.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('Car spreadsheet file'), file);

    const result = await screen.findByRole('region', { name: 'Import result' });
    expect(result).toHaveTextContent('Cars Inventory.csv: imported');
    expect(result).toHaveTextContent('created1288');
    expect(result).toHaveTextContent('Car ID used twice: 1');
    expect(screen.getByRole('table', { name: 'Issues' })).toHaveTextContent('Car ID 743 also appears on row 586');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/intake/imports/car-sheet');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({ fileName: 'Cars Inventory.csv', content: 'Car ID,VIN\n1,X' });
  });
});
