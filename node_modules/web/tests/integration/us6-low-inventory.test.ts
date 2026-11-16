import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

const add = (sn: string) =>
  app.request('POST', '/api/laptops', { brand: 'Dell', model: 'M', serialNumber: sn, purchaseDate: '2025-06-01' });

describe('US6: low-inventory alert', () => {
  it('appears when Available reaches the threshold and clears when it rises', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    await app.setup();
    const ids: string[] = [];
    for (const sn of ['A', 'B', 'C', 'D']) ids.push((await add(sn)).body.id);
    const alert = async () => (await app.request('GET', '/api/low-inventory-alert')).body;

    expect(await alert()).toMatchObject({ low: false, available: 4, threshold: 3 });
    await app.request('POST', `/api/laptops/${ids[0]}/assign`, { personName: 'Ada' });
    expect(await alert()).toEqual({ low: true, available: 3, threshold: 3, total: 4 });
    await app.request('POST', `/api/laptops/${ids[0]}/return`);
    expect(await alert()).toMatchObject({ low: false, available: 4 });

    await app.request('POST', `/api/laptops/${ids[1]}/status`, { status: 'InRepair' });
    expect((await alert()).low).toBe(true);
    await app.request('POST', `/api/laptops/${ids[1]}/status`, { status: 'Available' });
    expect((await alert()).low).toBe(false);
    await app.request('DELETE', `/api/laptops/${ids[3]}`);
    expect((await alert()).low).toBe(true);
  });

  it('threshold changes by one manager apply to every manager and survive a restart', async () => {
    app = await startTestApp();
    await app.setup();
    for (const sn of ['A', 'B', 'C', 'D', 'E']) await add(sn);
    const bob = await app.addManager('bob');
    expect((await app.request('GET', '/api/low-inventory-alert', undefined, bob)).body.low).toBe(false);

    await app.request('PUT', '/api/settings', { lowInventoryThreshold: 5 }, bob);
    expect((await app.request('GET', '/api/low-inventory-alert')).body).toMatchObject({ low: true, threshold: 5 });

    await app.restart();
    const login = await app.request('POST', '/api/login', { username: 'admin', password: 'password-123' }, null);
    app.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect((await app.request('GET', '/api/settings')).body.lowInventoryThreshold).toBe(5);
    expect((await app.request('GET', '/api/low-inventory-alert')).body.low).toBe(true);
  });

  it('shows no alert for a brand-new system with no laptops', async () => {
    app = await startTestApp();
    await app.setup();
    expect((await app.request('GET', '/api/low-inventory-alert')).body.low).toBe(false);
  });

  it('loads a data file saved before settings existed and uses the default threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-old-'));
    const dataFile = join(dir, 'data.json');
    writeFileSync(dataFile, JSON.stringify({ laptops: {}, accounts: {} }));
    app = await startTestApp({ dataFile });
    await app.setup();
    expect((await app.request('GET', '/api/settings')).body).toEqual({ lowInventoryThreshold: 3 });
  });
});
