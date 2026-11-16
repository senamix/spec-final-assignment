import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { MailMessage, Mailer } from '../../src/mailer.ts';
import { startTestApp, type TestApp } from '../helpers/testApp.ts';

const recordingMailer = (): Mailer & { sent: MailMessage[]; failing: boolean } => {
  const mailer = {
    sent: [] as MailMessage[],
    failing: false,
    async send(m: MailMessage) {
      if (mailer.failing) throw new Error('smtp down');
      mailer.sent.push(m);
    },
  };
  return mailer;
};

let app: TestApp | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
});

const laptop = (n: number) => ({ brand: 'Dell', model: 'L', serialNumber: `SN-${n}`, purchaseDate: '2025-01-01' });

async function addLaptops(a: TestApp, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await a.request('POST', '/api/laptops', laptop(i));
    expect(r.status).toBe(201);
    ids.push(r.body.id);
  }
  return ids;
}

const alerts = async (a: TestApp, cookie?: string) => (await a.request('GET', '/api/alerts', undefined, cookie)).body;
const assign = (a: TestApp, id: string) => a.request('POST', `/api/laptops/${id}/assign`, { personName: 'Pat' });

// Default level is 5: with 6 available laptops the next assignment reaches the level.
async function sixLaptops(mailer = recordingMailer()) {
  app = await startTestApp({ mailer });
  await app.setup();
  await app.addManager('bob');
  const ids = await addLaptops(app, 6);
  await app.flush();
  return { a: app, ids, mailer };
}

describe('US3: configure the level', () => {
  it('alerts and emails immediately when the level is raised above the available count', async () => {
    const { a, mailer } = await sixLaptops();
    mailer.sent.length = 0;
    const count = (await alerts(a)).alerts.length;
    const r = await a.request('PUT', '/api/settings/low-inventory-level', { level: 10 });
    expect(r.body).toEqual({ level: 10, alertRaised: true });
    await a.flush();
    const after = await alerts(a);
    expect(after.alerts).toHaveLength(count + 1);
    expect(after.alerts[0]).toMatchObject({ availableCount: 6, level: 10 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'bob@example.com']);
  });
});

describe('US2: see and acknowledge alerts', () => {
  it('keeps read state per manager', async () => {
    const { a, ids } = await sixLaptops();
    await assign(a, ids[0]!);
    const bobCookie = await a.addManager('carol');
    const first = (await alerts(a)).alerts[0].id;

    expect((await a.request('POST', `/api/alerts/${first}/read`)).status).toBe(204);

    const mine = await alerts(a);
    const bobs = await alerts(a, bobCookie);
    expect(mine.alerts.find((x: any) => x.id === first).read).toBe(true);
    expect(bobs.alerts.find((x: any) => x.id === first).read).toBe(false);
    expect(bobs.unread).toBe(mine.unread + 1);
    expect(bobs.alerts.length).toBe(mine.alerts.length);
  });
});

describe('US1: low-inventory alert on change', () => {
  it('raises one alert at the level and emails every manager once', async () => {
    const { a, ids, mailer } = await sixLaptops();
    const before = (await alerts(a)).alerts.length;
    mailer.sent.length = 0;

    expect((await assign(a, ids[0]!)).status).toBe(200);
    await a.flush();

    const after = await alerts(a);
    expect(after.alerts).toHaveLength(before + 1);
    expect(after.alerts[0]).toMatchObject({ availableCount: 5, level: 5, read: false, emailStatus: 'sent' });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'bob@example.com']);
    expect(mailer.sent[0]!.subject).toBe('Low laptop inventory: 5 available');
  });

  it('does not alert again while still low', async () => {
    const { a, ids, mailer } = await sixLaptops();
    await assign(a, ids[0]!);
    await a.flush();
    const count = (await alerts(a)).alerts.length;
    const sent = mailer.sent.length;
    await assign(a, ids[1]!);
    await a.flush();
    expect((await alerts(a)).alerts).toHaveLength(count);
    expect(mailer.sent).toHaveLength(sent);
  });

  it('alerts again after recovering above the level and dropping again', async () => {
    const { a, ids } = await sixLaptops();
    await assign(a, ids[0]!);
    const count = (await alerts(a)).alerts.length;
    await a.request('POST', `/api/laptops/${ids[0]}/return`);
    await assign(a, ids[0]!);
    expect((await alerts(a)).alerts).toHaveLength(count + 1);
  });

  it('raises no alert when a return or addition keeps inventory above the level', async () => {
    const { a, ids } = await sixLaptops();
    const count = (await alerts(a)).alerts.length;
    await addLaptops(a, 0);
    await a.request('POST', '/api/laptops', laptop(99));
    expect((await alerts(a)).alerts).toHaveLength(count);
    expect(ids).toHaveLength(6);
  });

  it.each([
    ['status change to InRepair', (a: TestApp, id: string) => a.request('POST', `/api/laptops/${id}/status`, { status: 'InRepair' })],
    ['retiring', (a: TestApp, id: string) => a.request('POST', `/api/laptops/${id}/status`, { status: 'Retired' })],
    ['deleting', (a: TestApp, id: string) => a.request('DELETE', `/api/laptops/${id}`)],
  ])('re-evaluates after %s', async (_name, act) => {
    const { a, ids } = await sixLaptops();
    const count = (await alerts(a)).alerts.length;
    const r = await act(a, ids[0]!);
    expect(r.status).toBeLessThan(300);
    const after = await alerts(a);
    expect(after.alerts).toHaveLength(count + 1);
    expect(after.alerts[0]).toMatchObject({ availableCount: 5 });
  });

  it('still completes the change when email delivery fails, and records the pending retry', async () => {
    const mailer = recordingMailer();
    const { a, ids } = await sixLaptops(mailer);
    mailer.failing = true;
    const r = await assign(a, ids[0]!);
    expect(r.status).toBe(200);
    await a.flush();
    const list = await alerts(a);
    expect(list.alerts[0]).toMatchObject({ availableCount: 5, emailStatus: 'pending' });
    expect(mailer.sent).not.toContainEqual(expect.objectContaining({ subject: 'Low laptop inventory: 5 available' }));
  });

  it('gives a manager without an email address an in-app alert and a skipped email', async () => {
    app = await startTestApp({ mailer: recordingMailer() });
    await app.setup();
    await app.addManager('bob');
    const data = JSON.parse(readFileSync(app.dataFile, 'utf8'));
    for (const account of Object.values<any>(data.accounts)) if (account.username === 'bob') delete account.email;
    writeFileSync(app.dataFile, JSON.stringify(data));
    await app.restart();
    await app.request('POST', '/api/login', { username: 'admin', password: 'password-123' }, null).then((r) => {
      app!.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    });
    const bobLogin = await app.request('POST', '/api/login', { username: 'bob', password: 'password-456' }, null);
    const bobCookie = (bobLogin.headers.get('set-cookie') ?? '').split(';')[0]!;

    await addLaptops(app, 1);
    await app.flush();

    const mine = await alerts(app, bobCookie);
    expect(mine.alerts[0]).toMatchObject({ emailStatus: 'skipped' });
    expect((await app.request('GET', '/api/me', undefined, bobCookie)).body.email).toBeNull();
  });
});
