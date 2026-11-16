import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
  await app.setup();
});
afterEach(async () => { await app.stop(); });

describe('only the low-inventory alert exists (FR-016, FR-025, SC-007)', () => {
  it('exposes the low-inventory alert to signed-in managers only', async () => {
    expect((await app.request('GET', '/api/low-inventory-alert')).status).toBe(200);
    expect((await app.request('GET', '/api/low-inventory-alert', undefined, null)).status).toBe(401);
  });

  it.each(['alerts', 'notifications', 'notify', 'subscriptions', 'webhooks', 'email', 'reminders', 'warranty-alerts'])(
    'has no /api/%s route',
    async (name) => {
      for (const method of ['GET', 'POST']) {
        const r = await app.request(method, `/api/${name}`, method === 'POST' ? {} : undefined);
        expect(r.status).toBe(404);
      }
    },
  );

  it('declares no email, messaging or push dependencies', () => {
    for (const file of ['package.json', 'packages/inventory-core/package.json', 'apps/web/package.json']) {
      const pkg = JSON.parse(readFileSync(join(root, file), 'utf8'));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      expect(deps.filter((d) => /mail|smtp|sendgrid|twilio|slack|push|notif|sms|webhook/i.test(d))).toEqual([]);
    }
  });

  it('has no notification code in the source', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|js|html)$/.test(entry)) files.push(full);
      }
    };
    walk(join(root, 'packages', 'inventory-core', 'src'));
    walk(join(root, 'apps', 'web', 'src'));
    expect(files.length).toBeGreaterThan(5);
    const pattern = /nodemailer|smtp|sendgrid|twilio|web-?push|\bNotification\b|serviceWorker|\balert\s*\(|node:net\b.*connect/i;
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
