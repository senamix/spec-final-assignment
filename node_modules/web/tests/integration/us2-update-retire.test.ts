import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

const laptop = (serialNumber: string) => ({
  brand: 'Dell', model: 'Latitude', serialNumber, purchaseDate: '2025-06-01',
  specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
});

describe('US2: update and retire laptops', () => {
  it('edits details, changes status, retires permanently, and deletes a mistaken record', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    await app.setup();
    const a = (await app.request('POST', '/api/laptops', laptop('SN-A'))).body;
    const b = (await app.request('POST', '/api/laptops', laptop('SN-B'))).body;
    const mistake = (await app.request('POST', '/api/laptops', laptop('SN-M'))).body;

    // Edit shows everywhere the laptop appears.
    await app.request('PATCH', `/api/laptops/${a.id}`, { specs: { memory: '32GB' } });
    const list = await app.request('GET', '/api/laptops');
    expect(list.body.find((l: any) => l.id === a.id).specs.memory).toBe('32GB');
    expect((await app.request('GET', `/api/laptops/${a.id}`)).body.specs.memory).toBe('32GB');

    // In Repair and back.
    expect((await app.request('POST', `/api/laptops/${a.id}/status`, { status: 'InRepair' })).body.status).toBe('InRepair');
    expect((await app.request('POST', `/api/laptops/${a.id}/status`, { status: 'Available' })).body.status).toBe('Available');

    // Retire: stays in records, no further changes allowed.
    expect((await app.request('POST', `/api/laptops/${b.id}/status`, { status: 'Retired' })).status).toBe(200);
    expect((await app.request('GET', `/api/laptops/${b.id}`)).body.status).toBe('Retired');
    for (const status of ['Available', 'InRepair', 'Retired']) {
      expect((await app.request('POST', `/api/laptops/${b.id}/status`, { status })).status).toBe(409);
    }

    // Delete the mistaken record; its serial number can be used again.
    expect((await app.request('DELETE', `/api/laptops/${mistake.id}`)).status).toBe(204);
    expect((await app.request('GET', '/api/laptops')).body).toHaveLength(2);
    expect((await app.request('POST', '/api/laptops', laptop('SN-M'))).status).toBe(201);
  });

  it('shows who changed what in the change history', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    await app.setup();
    const a = (await app.request('POST', '/api/laptops', laptop('SN-A'))).body;
    const bob = await app.addManager('bob');
    await app.request('PATCH', `/api/laptops/${a.id}`, { brand: 'HP' }, bob);
    await app.request('POST', `/api/laptops/${a.id}/status`, { status: 'InRepair' }, bob);
    const history = (await app.request('GET', `/api/laptops/${a.id}`)).body.history;
    expect(history.map((h: any) => [h.action, h.byName])).toEqual([
      ['Created', 'Admin User'],
      ['Edited', 'bob Name'],
      ['StatusChanged', 'bob Name'],
    ]);
  });
});
