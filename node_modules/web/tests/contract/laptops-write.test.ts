import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
let id: string;
beforeEach(async () => {
  app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
  await app.setup();
  const r = await app.request('POST', '/api/laptops', {
    brand: 'Dell', model: 'Latitude', serialNumber: 'SN-1', purchaseDate: '2025-06-01',
  });
  id = r.body.id;
});
afterEach(async () => { await app.stop(); });

describe('PATCH /api/laptops/{id}', () => {
  it('updates fields (200)', async () => {
    const r = await app.request('PATCH', `/api/laptops/${id}`, { model: 'XPS', specs: { memory: '32GB' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ model: 'XPS', specs: { memory: '32GB' } });
  });

  it('returns 400 for an invalid value, 409 for a duplicate serial, 404 for an unknown id', async () => {
    expect((await app.request('PATCH', `/api/laptops/${id}`, { brand: '' })).status).toBe(400);
    await app.request('POST', '/api/laptops', { brand: 'Acer', model: 'A', serialNumber: 'SN-2', purchaseDate: '2025-06-01' });
    const dup = await app.request('PATCH', `/api/laptops/${id}`, { serialNumber: 'sn-2' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DuplicateSerialNumber');
    expect((await app.request('PATCH', '/api/laptops/unknown', { brand: 'HP' })).status).toBe(404);
  });
});

describe('POST /api/laptops/{id}/status', () => {
  it('changes status (200) and refuses invalid transitions (409)', async () => {
    const ok = await app.request('POST', `/api/laptops/${id}/status`, { status: 'InRepair' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('InRepair');
    await app.request('POST', `/api/laptops/${id}/status`, { status: 'Retired' });
    const refused = await app.request('POST', `/api/laptops/${id}/status`, { status: 'Available' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('InvalidStatusTransition');
  });

  it('returns 400 for an unknown status and 404 for an unknown laptop', async () => {
    expect((await app.request('POST', `/api/laptops/${id}/status`, { status: 'Broken' })).status).toBe(400);
    expect((await app.request('POST', '/api/laptops/unknown/status', { status: 'InRepair' })).status).toBe(404);
  });
});

describe('DELETE /api/laptops/{id}', () => {
  it('deletes a never-assigned laptop (204) and then returns 404', async () => {
    expect((await app.request('DELETE', `/api/laptops/${id}`)).status).toBe(204);
    expect((await app.request('GET', `/api/laptops/${id}`)).status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    expect((await app.request('DELETE', '/api/laptops/unknown')).status).toBe(404);
  });
});
