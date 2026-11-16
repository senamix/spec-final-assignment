import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
  await app.setup();
});
afterEach(async () => { await app.stop(); });

const laptop = (n: number) => ({ brand: 'Dell', model: 'L', serialNumber: `SN-${n}`, purchaseDate: '2025-01-01' });
const raiseAlert = async () => { await app.request('POST', '/api/laptops', laptop(1)); };

describe('GET /api/alerts', () => {
  it('returns an empty list and zero unread when nothing was raised', async () => {
    const r = await app.request('GET', '/api/alerts');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unread: 0, alerts: [] });
  });

  it('returns alerts newest first with read and the caller email status', async () => {
    await raiseAlert();
    await app.flush();
    const r = await app.request('GET', '/api/alerts');
    expect(r.body.unread).toBe(1);
    expect(r.body.alerts[0]).toEqual({
      id: expect.any(String),
      raisedAt: expect.any(String),
      availableCount: 1,
      level: 5,
      read: false,
      emailStatus: 'sent',
    });
  });

  it('never exposes email addresses or password hashes', async () => {
    await app.addManager('bob');
    await raiseAlert();
    const text = JSON.stringify((await app.request('GET', '/api/alerts')).body);
    expect(text).not.toMatch(/@example\.com|hash|scrypt/i);
  });

  it('returns 401 without a session', async () => {
    expect((await app.request('GET', '/api/alerts', undefined, null)).status).toBe(401);
  });
});

describe('GET and PUT /api/settings/low-inventory-level', () => {
  const path = '/api/settings/low-inventory-level';

  it('returns the default level with no updater', async () => {
    const r = await app.request('GET', path);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ level: 5, updatedBy: null, updatedAt: null });
  });

  it('saves a valid level and reports whether an alert was raised', async () => {
    await app.request('POST', '/api/laptops', laptop(1));
    const r = await app.request('PUT', path, { level: 0 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ level: 0, alertRaised: false });
    const got = await app.request('GET', path);
    expect(got.body.level).toBe(0);
    expect(got.body.updatedBy).toBeTruthy();
    expect(got.body.updatedAt).toBeTruthy();
  });

  it('raises an alert immediately when the new level is already reached', async () => {
    const r = await app.request('PUT', path, { level: 10 });
    expect(r.body).toEqual({ level: 10, alertRaised: true });
    expect((await app.request('GET', '/api/alerts')).body.alerts).toHaveLength(1);
  });

  it.each([-1, 1.5, 100001, 'abc', null])('rejects %j with 400 and the range message', async (level) => {
    const r = await app.request('PUT', path, { level });
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('level');
    expect(r.body.error.message).toContain('0 to 100000');
  });

  it('returns 401 without a session', async () => {
    expect((await app.request('GET', path, undefined, null)).status).toBe(401);
    expect((await app.request('PUT', path, { level: 3 }, null)).status).toBe(401);
  });
});

describe('POST /api/alerts/{id}/read', () => {
  it('returns 204, allows repeating, and keeps the alert in history', async () => {
    await raiseAlert();
    const id = (await app.request('GET', '/api/alerts')).body.alerts[0].id;
    expect((await app.request('POST', `/api/alerts/${id}/read`)).status).toBe(204);
    expect((await app.request('POST', `/api/alerts/${id}/read`)).status).toBe(204);
    const after = (await app.request('GET', '/api/alerts')).body;
    expect(after.unread).toBe(0);
    expect(after.alerts[0].read).toBe(true);
  });

  it('returns 404 for an unknown alert and 401 without a session', async () => {
    const missing = await app.request('POST', '/api/alerts/nope/read');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NotFound');
    expect((await app.request('POST', '/api/alerts/nope/read', undefined, null)).status).toBe(401);
  });
});
