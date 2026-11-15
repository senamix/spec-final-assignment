import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
let id: string;
beforeEach(async () => {
  app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
  await app.setup();
  id = (await app.request('POST', '/api/laptops', {
    brand: 'Dell', model: 'Latitude', serialNumber: 'SN-1', purchaseDate: '2025-06-01',
  })).body.id;
});
afterEach(async () => { await app.stop(); });

describe('POST /api/laptops/{id}/assign', () => {
  it('assigns (200) and shows the holder', async () => {
    const r = await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada Lovelace' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'Assigned', currentHolder: 'Ada Lovelace' });
  });

  it('returns 409 when already assigned, 400 for a missing name, 404 for an unknown laptop', async () => {
    await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada' });
    const again = await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Grace' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NotAvailable');
    expect((await app.request('POST', `/api/laptops/${id}/assign`, { personName: '' })).status).toBe(400);
    expect((await app.request('POST', '/api/laptops/unknown/assign', { personName: 'Ada' })).status).toBe(404);
  });

  it('returns 409 for a laptop in repair', async () => {
    await app.request('POST', `/api/laptops/${id}/status`, { status: 'InRepair' });
    const r = await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('InRepair');
  });
});

describe('POST /api/laptops/{id}/return', () => {
  it('returns an assigned laptop (200) and clears the holder', async () => {
    await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada' });
    const r = await app.request('POST', `/api/laptops/${id}/return`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'Available', currentHolder: null });
    expect(r.body.assignments).toHaveLength(1);
  });

  it('returns 409 when the laptop is not assigned and 404 when unknown', async () => {
    expect((await app.request('POST', `/api/laptops/${id}/return`)).status).toBe(409);
    expect((await app.request('POST', '/api/laptops/unknown/return')).status).toBe(404);
  });
});

describe('deleting after assignment', () => {
  it('refuses to delete a laptop with assignment history (409)', async () => {
    await app.request('POST', `/api/laptops/${id}/assign`, { personName: 'Ada' });
    await app.request('POST', `/api/laptops/${id}/return`);
    const r = await app.request('DELETE', `/api/laptops/${id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('HasAssignmentHistory');
  });
});
