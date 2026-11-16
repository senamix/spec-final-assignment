import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delivery } from 'inventory-core';
import type { Notifier } from '../../src/notifier.ts';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

const laptop = (n: number) => ({
  brand: 'Dell',
  model: 'Latitude 7440',
  serialNumber: `SN-${n}`,
  purchaseDate: '2025-06-01',
  specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
});

let app: TestApp;
let sent: Delivery[];
let failEmail = false;
let clock: number;
const notifier: Notifier = {
  async send(d) {
    if (failEmail && d.channel === 'email') throw new Error('smtp down');
    sent.push(d);
  },
};

beforeEach(async () => {
  sent = [];
  failEmail = false;
  clock = Date.parse('2026-02-01T10:00:00.000Z');
  app = await startTestApp({ notifier, now: () => new Date(clock), sweepIntervalMs: 25 });
  await app.setup();
});
afterEach(async () => { await app.stop(); });

async function addLaptops(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await app.request('POST', '/api/laptops', laptop(i))).body.id);
  return ids;
}

const skuOf = async () => (await app.request('GET', '/api/low-stock/levels')).body[0].sku as string;

async function configure(opts: { minQty?: number; secondary?: boolean } = {}) {
  const me = (await app.request('GET', '/api/me')).body.id as string;
  await app.addManager('second');
  const second = (await app.request('GET', '/api/low-stock/settings')).body.managers.find((m: any) => m.username === 'second').id as string;
  await app.request('PUT', `/api/low-stock/settings/${me}`, {
    designated: true,
    email: 'boss@example.com',
    secondaryAccountId: opts.secondary === false ? null : second,
  });
  await app.request('PUT', `/api/low-stock/settings/${second}`, { email: 'second@example.com' });
  const put = await app.request('PUT', '/api/low-stock/thresholds', { sku: await skuOf(), minQty: opts.minQty ?? 3 });
  expect(put.status).toBe(200);
  return { me, second };
}

const repair = (id: string) => app.request('POST', `/api/laptops/${id}/status`, { status: 'InRepair' });

describe('low-stock API', () => {
  it('requires sign-in for every endpoint', async () => {
    for (const [method, path] of [
      ['GET', '/api/low-stock/levels'],
      ['PUT', '/api/low-stock/thresholds'],
      ['GET', '/api/low-stock/settings'],
      ['GET', '/api/low-stock/alerts'],
      ['GET', '/api/low-stock/history'],
      ['GET', '/api/low-stock/report'],
    ] as const) {
      expect((await app.request(method, path, method === 'PUT' ? {} : undefined, null)).status).toBe(401);
    }
  });

  it('validates thresholds and settings', async () => {
    await addLaptops(1);
    const sku = await skuOf();
    expect((await app.request('PUT', '/api/low-stock/thresholds', { sku, minQty: -1 })).status).toBe(400);
    expect((await app.request('PUT', '/api/low-stock/thresholds', { sku: 'nope', minQty: 1 })).status).toBe(404);
    const me = (await app.request('GET', '/api/me')).body.id;
    expect((await app.request('PUT', `/api/low-stock/settings/${me}`, { email: 'bad' })).status).toBe(400);
    expect((await app.request('PUT', '/api/low-stock/config', { escalationMinutes: 0 })).status).toBe(400);
    expect((await app.request('GET', '/api/low-stock/history?from=yesterday')).status).toBe(400);
  });

  it('flags Low Stock using available laptops only', async () => {
    const ids = await addLaptops(4);
    await configure({ minQty: 3 });
    expect((await app.request('GET', '/api/low-stock/levels')).body[0]).toMatchObject({ available: 4, low: false });
    await app.request('PATCH', `/api/laptops/${ids[0]}`, { reserved: true });
    expect((await app.request('GET', '/api/low-stock/levels')).body[0]).toMatchObject({ available: 3, low: true });
  });

  it('alerts the designated manager by email and in-app when stock reaches the threshold', async () => {
    const ids = await addLaptops(4);
    const { me } = await configure();
    expect((await app.request('GET', '/api/low-stock/alerts')).body).toEqual([]);
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ channel: 'email', address: 'boss@example.com' });
    expect(sent[0]!.message).toMatchObject({ available: 3, threshold: 3, warehouse: 'Main', suggestedReorder: 3 });
    const mine = (await app.request('GET', '/api/low-stock/notifications')).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].recipients).toContain(me);

    await repair(ids[1]!);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toHaveLength(1);
    expect((await app.request('GET', '/api/low-stock/alerts')).body).toHaveLength(1);
  });

  it('records a failed delivery without blocking other channels', async () => {
    failEmail = true;
    const ids = await addLaptops(4);
    await configure();
    await repair(ids[0]!);
    await vi.waitFor(async () => {
      const history = (await app.request('GET', '/api/low-stock/history')).body;
      expect(history.some((h: any) => h.channel === 'email' && h.delivery === 'failed' && h.note === 'smtp down')).toBe(true);
    });
    const history = (await app.request('GET', '/api/low-stock/history')).body;
    expect(history.some((h: any) => h.channel === 'in-app' && h.delivery === 'ok')).toBe(true);
  });

  it('acknowledges, snoozes and re-alerts after the snooze', async () => {
    const ids = await addLaptops(4);
    await configure();
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const alertId = (await app.request('GET', '/api/low-stock/alerts?status=open')).body[0].id;

    expect((await app.request('POST', `/api/low-stock/alerts/${alertId}/snooze`, { minutes: 0 })).status).toBe(400);
    expect((await app.request('POST', `/api/low-stock/alerts/${alertId}/snooze`, { minutes: 60 })).status).toBe(200);
    clock += 61 * 60_000;
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    const ack = await app.request('POST', `/api/low-stock/alerts/${alertId}/acknowledge`);
    expect(ack.body.status).toBe('acknowledged');
    expect((await app.request('POST', '/api/low-stock/alerts/nope/acknowledge')).status).toBe(404);
  });

  it('escalates to the secondary recipient when not acknowledged in time', async () => {
    const ids = await addLaptops(4);
    await app.request('PUT', '/api/low-stock/config', { escalationMinutes: 30 });
    await configure();
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    clock += 31 * 60_000;
    await vi.waitFor(() => expect(sent.map((d) => d.address)).toContain('second@example.com'));
    expect(sent.at(-1)!.message.escalation).toBe(true);
  });

  it('escalates immediately when stock reaches zero', async () => {
    const ids = await addLaptops(2);
    await configure({ minQty: 1 });
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await repair(ids[1]!);
    await vi.waitFor(() => expect(sent.map((d) => d.address)).toContain('second@example.com'));
    expect(sent.at(-1)!.message).toMatchObject({ outOfStock: true, escalation: true });
  });

  it('keeps history and reports low-stock frequency, filterable', async () => {
    const ids = await addLaptops(4);
    await configure();
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await app.request('POST', `/api/laptops/${ids[0]}/status`, { status: 'Available' });

    const all = (await app.request('GET', '/api/low-stock/history')).body;
    expect(all.map((h: any) => h.status)).toEqual(expect.arrayContaining(['sent', 'resolved']));
    expect((await app.request('GET', '/api/low-stock/history?warehouse=Other')).body).toEqual([]);
    expect((await app.request('GET', '/api/low-stock/history?from=2026-02-01&to=2026-02-01')).body.length).toBe(all.length);
    expect((await app.request('GET', '/api/low-stock/history?from=2026-03-01')).body).toEqual([]);
    const report = (await app.request('GET', '/api/low-stock/report?from=2026-02-01&to=2026-02-28')).body;
    expect(report).toEqual([{ sku: await skuOf(), skuLabel: 'Dell Latitude 7440 i7 16GB 512GB', count: 1 }]);
  });

  it('persists thresholds and alerts across restarts', async () => {
    const ids = await addLaptops(4);
    await configure();
    await repair(ids[0]!);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await app.restart();
    await app.request('POST', '/api/login', { username: 'admin', password: 'password-123' }, null).then((r) => {
      app.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    });
    expect((await app.request('GET', '/api/low-stock/thresholds')).body).toHaveLength(1);
    expect((await app.request('GET', '/api/low-stock/alerts')).body).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toHaveLength(1);
  });
});
