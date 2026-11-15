import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
afterEach(async () => { await app.stop(); });

describe('US4: search, filter, and review inventory', () => {
  it('searches by brand, filters by status, and the counts add up to the total', async () => {
    app = await startTestApp({ now: () => new Date('2026-01-15T10:00:00.000Z') });
    await app.setup();
    const ids: string[] = [];
    for (const [brand, sn] of [['Dell', 'D-1'], ['Dell', 'D-2'], ['Acer', 'A-1'], ['Lenovo', 'L-1'], ['HP', 'H-1']] as const) {
      ids.push((await app.request('POST', '/api/laptops', { brand, model: 'M', serialNumber: sn, purchaseDate: '2025-06-01' })).body.id);
    }
    await app.request('POST', `/api/laptops/${ids[0]}/assign`, { personName: 'Ada' });
    await app.request('POST', `/api/laptops/${ids[2]}/assign`, { personName: 'Grace' });
    await app.request('POST', `/api/laptops/${ids[3]}/status`, { status: 'InRepair' });
    await app.request('POST', `/api/laptops/${ids[4]}/status`, { status: 'Retired' });

    const brand = await app.request('GET', '/api/laptops?q=dell');
    expect(brand.body.map((l: any) => l.serialNumber)).toEqual(['D-1', 'D-2']);

    const assigned = await app.request('GET', '/api/laptops?status=Assigned');
    expect(assigned.body.every((l: any) => l.status === 'Assigned')).toBe(true);
    expect(assigned.body).toHaveLength(2);

    expect((await app.request('GET', '/api/laptops?q=nothing')).body).toEqual([]);

    const summary = (await app.request('GET', '/api/summary')).body;
    expect(summary).toEqual({ Available: 1, Assigned: 2, InRepair: 1, Retired: 1, total: 5 });
    expect(summary.Available + summary.Assigned + summary.InRepair + summary.Retired).toBe(summary.total);
  });

  it('shows an empty summary for an empty inventory', async () => {
    app = await startTestApp();
    await app.setup();
    expect((await app.request('GET', '/api/summary')).body).toEqual({ Available: 0, Assigned: 0, InRepair: 0, Retired: 0, total: 0 });
  });
});
