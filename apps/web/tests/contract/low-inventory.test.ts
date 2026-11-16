import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
  await app.setup();
});
afterEach(async () => { await app.stop(); });

const add = (serialNumber: string) =>
  app.request('POST', '/api/laptops', { brand: 'Dell', model: 'M', serialNumber, purchaseDate: '2025-06-01' });

describe('GET /api/low-inventory-alert', () => {
  it('reports not low for an empty inventory', async () => {
    const r = await app.request('GET', '/api/low-inventory-alert');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ low: false, available: 0, threshold: 3, total: 0 });
  });

  it('reports low at the threshold', async () => {
    for (const sn of ['A', 'B', 'C']) await add(sn);
    const r = await app.request('GET', '/api/low-inventory-alert');
    expect(r.body).toEqual({ low: true, available: 3, threshold: 3, total: 3 });
  });

  it('requires a session', async () => {
    expect((await app.request('GET', '/api/low-inventory-alert', undefined, null)).status).toBe(401);
  });
});

describe('GET and PUT /api/settings', () => {
  it('returns the default threshold', async () => {
    const r = await app.request('GET', '/api/settings');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ lowInventoryThreshold: 3 });
  });

  it('updates the threshold (200) and the alert uses it', async () => {
    for (const sn of ['A', 'B', 'C', 'D']) await add(sn);
    expect((await app.request('GET', '/api/low-inventory-alert')).body.low).toBe(false);
    const put = await app.request('PUT', '/api/settings', { lowInventoryThreshold: 5 });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ lowInventoryThreshold: 5 });
    expect((await app.request('GET', '/api/low-inventory-alert')).body).toMatchObject({ low: true, threshold: 5 });
  });

  it.each([-1, 10001, 2.5, '5', null])('rejects %s with 400 and keeps the old value', async (value) => {
    const r = await app.request('PUT', '/api/settings', { lowInventoryThreshold: value });
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('lowInventoryThreshold');
    expect((await app.request('GET', '/api/settings')).body.lowInventoryThreshold).toBe(3);
  });

  it('requires a session for both', async () => {
    expect((await app.request('GET', '/api/settings', undefined, null)).status).toBe(401);
    expect((await app.request('PUT', '/api/settings', { lowInventoryThreshold: 1 }, null)).status).toBe(401);
  });
});
