import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
  await app.setup();
});
afterEach(async () => { await app.stop(); });

const manager = { username: 'bob', displayName: 'Bob B', password: 'password-456', email: 'bob@example.com' };

describe('email on accounts', () => {
  it('requires a valid email on setup', async () => {
    const fresh = await startTestApp();
    const r = await fresh.request('POST', '/api/setup', { username: 'root', displayName: 'Root', password: 'password-123' }, null);
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('email');
    await fresh.stop();
  });

  it('requires a valid email when adding a manager', async () => {
    for (const email of [undefined, 'nope']) {
      const r = await app.request('POST', '/api/accounts', { ...manager, email });
      expect(r.status).toBe(400);
      expect(r.body.error.field).toBe('email');
    }
  });

  it('GET /api/me returns the caller email', async () => {
    const r = await app.request('GET', '/api/me');
    expect(r.body.email).toBe('admin@example.com');
  });

  it('PUT /api/me/email changes only the caller address', async () => {
    const bobCookie = await app.addManager('bob');
    const r = await app.request('PUT', '/api/me/email', { email: 'new-bob@example.com' }, bobCookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ email: 'new-bob@example.com' });
    expect((await app.request('GET', '/api/me', undefined, bobCookie)).body.email).toBe('new-bob@example.com');
    expect((await app.request('GET', '/api/me')).body.email).toBe('admin@example.com');
  });

  it('PUT /api/me/email rejects invalid input (400) and signed-out callers (401)', async () => {
    const bad = await app.request('PUT', '/api/me/email', { email: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.field).toBe('email');
    expect((await app.request('PUT', '/api/me/email', { email: 'a@b.co' }, null)).status).toBe(401);
  });
});
