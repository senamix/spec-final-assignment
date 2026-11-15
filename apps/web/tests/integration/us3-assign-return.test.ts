import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

const laptop = (serialNumber: string) => ({
  brand: 'Dell', model: 'Latitude', serialNumber, purchaseDate: '2025-06-01',
});

describe('US3: assign and return laptops', () => {
  it('assigns, refuses a second assignment, returns, and keeps the history', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    await app.setup();
    const { id } = (await app.request('POST', '/api/laptops', laptop('SN-1'))).body;

    const assigned = await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada Lovelace' });
    expect(assigned.body).toMatchObject({ status: 'Assigned', currentHolder: 'Ada Lovelace' });
    const list = await app.request('GET', '/api/laptops');
    expect(list.body[0]).toMatchObject({ status: 'Assigned', currentHolder: 'Ada Lovelace' });

    expect((await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Grace' })).status).toBe(409);
    // An assigned laptop cannot be retired or sent to repair without a recorded return.
    expect((await app.request('POST', `/api/laptops/${id}/status`, { status: 'Retired' })).status).toBe(409);

    const returned = await app.request('POST', `/api/laptops/${id}/return`);
    expect(returned.body).toMatchObject({ status: 'Available', currentHolder: null });

    const details = await app.request('GET', `/api/laptops/${id}`);
    expect(details.body.assignments).toEqual([
      expect.objectContaining({ personName: 'Ada Lovelace', returnedAt: '2026-01-15T10:00:00.000Z' }),
    ]);
    expect(details.body.history.map((h: any) => h.action)).toEqual(['Created', 'Assigned', 'Returned']);
  });

  it('refuses to assign a laptop in repair or retired', async () => {
    app = await startTestApp();
    await app.setup();
    const repair = (await app.request('POST', '/api/laptops', laptop('SN-R'))).body.id;
    const retired = (await app.request('POST', '/api/laptops', laptop('SN-X'))).body.id;
    await app.request('POST', `/api/laptops/${repair}/status`, { status: 'InRepair' });
    await app.request('POST', `/api/laptops/${retired}/status`, { status: 'Retired' });
    for (const target of [repair, retired]) {
      const r = await app.request('POST', `/api/laptops/${target}/assign`, { personName: 'Ada' });
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/InRepair|Retired/);
    }
  });

  it('lets exactly one of two simultaneous assignments succeed', async () => {
    app = await startTestApp();
    await app.setup();
    const { id } = (await app.request('POST', '/api/laptops', laptop('SN-1'))).body;
    const replies = await Promise.all(
      ['Ada', 'Grace', 'Linus', 'Ken', 'Dennis'].map((personName) =>
        app.request('POST', `/api/laptops/${id}/assign`, { personName }),
      ),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(4);
    const details = await app.request('GET', `/api/laptops/${id}`);
    expect(details.body.assignments).toHaveLength(1);
  });
});
