import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
  await app.setup();
});
afterEach(async () => { await app.stop(); });

const laptop = {
  brand: 'Dell', model: 'Latitude 7440', serialNumber: 'SN-1001', purchaseDate: '2025-06-01',
  specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
};

describe('POST /api/laptops', () => {
  it('creates a laptop (201) that is Available', async () => {
    const r = await app.request('POST', '/api/laptops', laptop);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ brand: 'Dell', status: 'Available', serialNumber: 'SN-1001' });
    expect(typeof r.body.id).toBe('string');
  });

  it('returns 400 naming the missing field', async () => {
    const r = await app.request('POST', '/api/laptops', { ...laptop, brand: '' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'ValidationError', field: 'brand' });
  });

  it('returns 409 for a duplicate serial number ignoring case and spaces', async () => {
    await app.request('POST', '/api/laptops', laptop);
    const r = await app.request('POST', '/api/laptops', { ...laptop, serialNumber: ' sn-1001 ' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DuplicateSerialNumber');
  });

  it('returns 400 for a future purchase date', async () => {
    const r = await app.request('POST', '/api/laptops', { ...laptop, purchaseDate: '2026-02-01' });
    expect(r.status).toBe(400);
  });
});

describe('GET /api/laptops', () => {
  it('returns an empty array when there are no laptops', async () => {
    const r = await app.request('GET', '/api/laptops');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('lists created laptops', async () => {
    await app.request('POST', '/api/laptops', laptop);
    await app.request('POST', '/api/laptops', { ...laptop, serialNumber: 'SN-2', brand: 'Acer' });
    const r = await app.request('GET', '/api/laptops');
    expect(r.body.map((l: any) => l.brand)).toEqual(['Acer', 'Dell']);
  });
});

describe('GET /api/laptops/{id}', () => {
  it('returns the laptop with holder, assignments and history', async () => {
    const created = await app.request('POST', '/api/laptops', laptop);
    const r = await app.request('GET', `/api/laptops/${created.body.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: created.body.id, currentHolder: null, assignments: [] });
    expect(r.body.history).toHaveLength(1);
  });

  it('returns 404 for an unknown id', async () => {
    const r = await app.request('GET', '/api/laptops/unknown');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NotFound');
  });
});
