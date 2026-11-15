import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

const now = () => new Date('2026-01-15T10:00:00.000Z');
const laptop = (serialNumber: string, brand = 'Dell') => ({
  brand, model: 'Latitude 7440', serialNumber, purchaseDate: '2025-06-01',
  specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
});

describe('US1: register and view laptops', () => {
  it('adds several laptops, lists them and opens one with exactly what was entered', async () => {
    app = await startTestApp({ now });
    await app.setup();
    await app.request('POST', '/api/laptops', laptop('SN-1'));
    await app.request('POST', '/api/laptops', laptop('SN-2', 'Acer'));
    const created = await app.request('POST', '/api/laptops', laptop('SN-3', 'Lenovo'));

    const list = await app.request('GET', '/api/laptops');
    expect(list.body).toHaveLength(3);
    expect(list.body.every((l: any) => l.status === 'Available')).toBe(true);

    const details = await app.request('GET', `/api/laptops/${created.body.id}`);
    expect(details.body).toMatchObject({
      brand: 'Lenovo', model: 'Latitude 7440', serialNumber: 'SN-3', purchaseDate: '2025-06-01',
      specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
    });
  });

  it('rejects a duplicate serial number and a missing required detail', async () => {
    app = await startTestApp({ now });
    await app.setup();
    await app.request('POST', '/api/laptops', laptop('SN-1001'));
    const dup = await app.request('POST', '/api/laptops', laptop('sn-1001'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already in use/);
    const missing = await app.request('POST', '/api/laptops', { ...laptop('SN-9'), purchaseDate: '' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.field).toBe('purchaseDate');
    expect((await app.request('GET', '/api/laptops')).body).toHaveLength(1);
  });

  it('keeps laptops after the server restarts', async () => {
    app = await startTestApp({ now });
    await app.setup();
    await app.request('POST', '/api/laptops', laptop('SN-1'));
    await app.restart();
    await app.request('POST', '/api/login', { username: 'admin', password: 'password-123' }, null).then((r) => {
      app.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    });
    const list = await app.request('GET', '/api/laptops');
    expect(list.body.map((l: any) => l.serialNumber)).toEqual(['SN-1']);
  });
});
