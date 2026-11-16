import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
  await app.setup();
});
afterEach(async () => { await app.stop(); });

const newManager = { username: 'bob', displayName: 'Bob B', password: 'password-456', email: 'bob@example.com' };

describe('POST /api/accounts', () => {
  it('creates a manager (201) without exposing any hash', async () => {
    const r = await app.request('POST', '/api/accounts', newManager);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ username: 'bob', displayName: 'Bob B' });
    expect(typeof r.body.id).toBe('string');
    expect(JSON.stringify(r.body)).not.toMatch(/hash|scrypt|password/i);
  });

  it('returns 400 naming the invalid field', async () => {
    const r = await app.request('POST', '/api/accounts', { ...newManager, username: 'bo' });
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('username');
  });

  it('returns 409 for a duplicate username ignoring case', async () => {
    await app.request('POST', '/api/accounts', newManager);
    const r = await app.request('POST', '/api/accounts', { ...newManager, username: 'BOB' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DuplicateUsername');
  });

  it('returns 401 when signed out', async () => {
    const r = await app.request('POST', '/api/accounts', newManager, null);
    expect(r.status).toBe(401);
  });
});
