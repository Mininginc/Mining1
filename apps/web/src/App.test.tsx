import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@wms/shared';
import { App } from './App';
import { Shell } from './Shell';

const shipper: PublicUser = { id: 'u1', email: 's@x.co', name: 'Sam', roles: ['shipping'], active: true, mfaEnabled: false };

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('sign-in', () => {
  it('signs in and shows only the modules for the role', async () => {
    const fetchMock = vi.fn(() => json(200, { accessToken: 'tok', user: shipper }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await userEvent.type(screen.getByLabelText('Email'), 's@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw-pw-pw-pw-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const nav = await screen.findByRole('navigation', { name: 'Modules' });
    expect(nav).toHaveTextContent('Fulfillment');
    expect(nav).not.toHaveTextContent('Finance');
    expect(sessionStorage.getItem('wms.token')).toBe('tok');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('sends the company code and remembers it on this device', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => json(200, { accessToken: 'tok', user: shipper }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await userEvent.type(screen.getByLabelText('Company code'), 'Acme');
    await userEvent.type(screen.getByLabelText('Email'), 's@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw-pw-pw-pw-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Modules' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ company: 'acme' });
    expect(localStorage.getItem('wms.company')).toBe('acme');
  });

  it('asks for an authenticator code when MFA is on', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => json(401, { message: 'MFA code required', code: 'mfa_required' }))
      .mockImplementationOnce(() => json(200, { accessToken: 'tok', user: shipper }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await userEvent.type(screen.getByLabelText('Email'), 's@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw-pw-pw-pw-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Modules' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ totp: '123456' });
  });

  it('shows the server error on a bad password', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401, { message: 'Invalid email or password' })));
    render(<App />);
    await userEvent.type(screen.getByLabelText('Email'), 's@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-wrong-wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('offline banner', () => {
  it('appears when the network drops and goes away when it returns', () => {
    render(<Shell user={shipper} onSignOut={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent("You're offline");
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
