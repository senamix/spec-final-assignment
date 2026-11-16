import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

const laptop = {
  brand: 'Dell', model: 'Latitude', serialNumber: 'SN-1', purchaseDate: '2025-06-01',
};

describe('US5: sign in and manage manager accounts', () => {
  it('setup, create a second manager, and attribute a change to them', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    expect((await app.request('GET', '/api/setup', undefined, null)).body.needsSetup).toBe(true);
    await app.setup();

    const adminLaptop = await app.request('POST', '/api/laptops', laptop);
    const bobCookie = await app.addManager('bob');
    const bobLaptop = await app.request('POST', '/api/laptops', { ...laptop, serialNumber: 'SN-2' }, bobCookie);
    expect(bobLaptop.status).toBe(201);

    const bobDetails = await app.request('GET', `/api/laptops/${bobLaptop.body.id}`);
    expect(bobDetails.body.history[0]).toMatchObject({ action: 'Created', byName: 'bob Name' });
    const adminDetails = await app.request('GET', `/api/laptops/${adminLaptop.body.id}`);
    expect(adminDetails.body.history[0]).toMatchObject({ action: 'Created', byName: 'Admin User' });
  });

  it('refuses inventory access while signed out', async () => {
    app = await startTestApp();
    await app.setup();
    await app.request('POST', '/api/logout');
    expect((await app.request('GET', '/api/laptops')).status).toBe(401);
    expect((await app.request('GET', '/api/summary')).status).toBe(401);
  });

  it('gives the new manager the same permissions as the first', async () => {
    app = await startTestApp();
    await app.setup();
    const bobCookie = await app.addManager('bob');
    const r = await app.request('POST', '/api/accounts', { username: 'carol', displayName: 'Carol', password: 'password-789', email: 'carol@example.com' }, bobCookie);
    expect(r.status).toBe(201);
  });

  it('offers no self-registration route', async () => {
    app = await startTestApp();
    await app.setup();
    for (const path of ['/api/register', '/api/signup', '/api/users']) {
      expect((await app.request('POST', path, { username: 'eve', displayName: 'Eve', password: 'password-000' }, null)).status).toBe(401);
      expect((await app.request('POST', path, { username: 'eve', displayName: 'Eve', password: 'password-000' })).status).toBe(404);
    }
    const unauthenticatedAccounts = await app.request('POST', '/api/accounts', { username: 'eve', displayName: 'Eve', password: 'password-000', email: 'eve@example.com' }, null);
    expect(unauthenticatedAccounts.status).toBe(401);
  });
});
