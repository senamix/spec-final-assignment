import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
  await app.setup();
  const add = async (brand: string, serialNumber: string) =>
    (await app.request('POST', '/api/laptops', { brand, model: 'M', serialNumber, purchaseDate: '2025-06-01' })).body.id;
  const dell = await add('Dell', 'SN-1');
  const acer = await add('Acer', 'SN-2');
  await add('Lenovo', 'SN-3');
  await app.request('POST', `/api/laptops/${dell}/assign`, { personName: 'Ada Lovelace' });
  await app.request('POST', `/api/laptops/${acer}/status`, { status: 'InRepair' });
});
afterEach(async () => { await app.stop(); });

describe('GET /api/laptops with q and status', () => {
  it('filters by text', async () => {
    const r = await app.request('GET', '/api/laptops?q=lovelace');
    expect(r.status).toBe(200);
    expect(r.body.map((l: any) => l.serialNumber)).toEqual(['SN-1']);
  });

  it('filters by status', async () => {
    const r = await app.request('GET', '/api/laptops?status=InRepair');
    expect(r.body.map((l: any) => l.serialNumber)).toEqual(['SN-2']);
  });

  it('combines both and returns an empty array when nothing matches', async () => {
    expect((await app.request('GET', '/api/laptops?q=dell&status=Assigned')).body).toHaveLength(1);
    const none = await app.request('GET', '/api/laptops?q=zzz');
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);
  });

  it('returns 400 for an unknown status value', async () => {
    const r = await app.request('GET', '/api/laptops?status=Broken');
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('status');
  });
});

describe('GET /api/summary', () => {
  it('returns counts per status and the total', async () => {
    const r = await app.request('GET', '/api/summary');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ Available: 1, Assigned: 1, InRepair: 1, Retired: 0, total: 3 });
  });

  it('requires a session', async () => {
    expect((await app.request('GET', '/api/summary', undefined, null)).status).toBe(401);
  });
});
