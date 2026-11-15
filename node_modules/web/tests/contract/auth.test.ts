import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

let app: TestApp;
beforeEach(async () => { app = await startTestApp(); });
afterEach(async () => { await app.stop(); });

const account = { username: 'admin', displayName: 'Admin User', password: 'password-123' };

describe('setup', () => {
  it('reports that setup is needed, then not needed', async () => {
    expect((await app.request('GET', '/api/setup', undefined, null)).body).toEqual({ needsSetup: true });
    await app.setup();
    expect((await app.request('GET', '/api/setup', undefined, null)).body).toEqual({ needsSetup: false });
  });

  it('creates the first account with a session cookie that is HttpOnly and SameSite=Strict', async () => {
    const r = await app.request('POST', '/api/setup', account, null);
    expect(r.status).toBe(201);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('returns 409 once any account exists', async () => {
    await app.setup();
    const r = await app.request('POST', '/api/setup', { ...account, username: 'second' }, null);
    expect(r.status).toBe(409);
  });

  it('rejects invalid setup input with 400 naming the field', async () => {
    const r = await app.request('POST', '/api/setup', { ...account, password: 'short' }, null);
    expect(r.status).toBe(400);
    expect(r.body.error.field).toBe('password');
  });
});

describe('login, me and logout', () => {
  it('logs in with correct credentials and returns the display name', async () => {
    await app.setup();
    const r = await app.request('POST', '/api/login', { username: 'ADMIN', password: 'password-123' }, null);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ displayName: 'Admin User' });
    expect(r.headers.get('set-cookie')).toMatch(/^sid=/);
  });

  it('refuses wrong credentials with 401', async () => {
    await app.setup();
    const r = await app.request('POST', '/api/login', { username: 'admin', password: 'nope-nope' }, null);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('InvalidCredentials');
  });

  it('returns 429 after 5 failed attempts, even with the right password', async () => {
    await app.setup();
    for (let i = 0; i < 5; i++) {
      await app.request('POST', '/api/login', { username: 'admin', password: 'wrong-pass' }, null);
    }
    const r = await app.request('POST', '/api/login', { username: 'admin', password: 'password-123' }, null);
    expect(r.status).toBe(429);
  });

  it('returns the signed-in manager from /api/me', async () => {
    await app.setup();
    const r = await app.request('GET', '/api/me');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ username: 'admin', displayName: 'Admin User' });
  });

  it('logout ends the session', async () => {
    await app.setup();
    expect((await app.request('POST', '/api/logout')).status).toBe(204);
    expect((await app.request('GET', '/api/me')).status).toBe(401);
  });
});

describe('access control and request rules', () => {
  it.each([
    ['GET', '/api/laptops'],
    ['GET', '/api/summary'],
    ['GET', '/api/me'],
    ['POST', '/api/accounts'],
  ])('refuses %s %s without a session', async (method, path) => {
    await app.setup();
    const body = method === 'POST' ? {} : undefined;
    const r = await app.request(method, path, body, null);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('Unauthenticated');
  });

  it('refuses a made-up session cookie', async () => {
    await app.setup();
    expect((await app.request('GET', '/api/laptops', undefined, 'sid=forged')).status).toBe(401);
  });

  it('rejects write requests that are not application/json', async () => {
    const res = await fetch(app.url + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'username=admin',
    });
    expect(res.status).toBe(415);
  });

  it('never returns a password hash', async () => {
    const setup = await app.request('POST', '/api/setup', account, null);
    app.cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const me = await app.request('GET', '/api/me');
    for (const r of [setup, me]) {
      expect(JSON.stringify(r.body)).not.toMatch(/hash|scrypt|password/i);
    }
  });

  it('answers unknown routes with 404', async () => {
    await app.setup();
    expect((await app.request('GET', '/api/does-not-exist')).status).toBe(404);
  });
});
