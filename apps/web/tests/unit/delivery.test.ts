import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccount, emptyState, evaluateLowInventory, ok, type Hasher, type State } from 'inventory-core';
import { createDeliveryRunner } from '../../src/delivery.ts';
import type { MailMessage, Mailer } from '../../src/mailer.ts';
import { createStore } from '../../src/store.ts';

const hasher: Hasher = { hash: (p) => `h:${p}`, verify: (p, h) => h === `h:${p}` };

async function seededStore(file = join(mkdtempSync(join(tmpdir(), 'inv-del-')), 'data.json')) {
  const store = await createStore(file);
  await store.update((s: State) => {
    let state = s;
    for (const name of ['amy', 'bob']) {
      const r = createAccount(state, { username: name, displayName: name, password: 'password-123', email: `${name}@example.com` }, hasher, { newId: () => name });
      if (r.ok) state = r.value.state;
    }
    return ok({ state: evaluateLowInventory(state, { now: '2026-01-15T10:00:00.000Z', newId: () => 'a1' }).state });
  });
  return { store, file };
}

const recordingMailer = (failFor: string[] = []): Mailer & { sent: MailMessage[] } => {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      if (failFor.includes(m.to)) throw new Error('smtp down');
      sent.push(m);
    },
  };
};

describe('delivery runner', () => {
  it('sends due pending deliveries once and records them as sent', async () => {
    const { store } = await seededStore();
    const mailer = recordingMailer();
    const runner = createDeliveryRunner({ store, mailer, now: () => new Date('2026-01-15T10:00:00.000Z') });
    await runner.run();
    await runner.run();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['amy@example.com', 'bob@example.com']);
    expect(store.read().alerts.a1!.deliveries.every((d) => d.status === 'sent')).toBe(true);
  });

  it('records failures, retries on schedule, and never throws', async () => {
    const { store } = await seededStore();
    const mailer = recordingMailer(['bob@example.com']);
    let clock = Date.parse('2026-01-15T10:00:00.000Z');
    const runner = createDeliveryRunner({ store, mailer, now: () => new Date(clock) });
    await expect(runner.run()).resolves.toBeUndefined();
    const bob = () => store.read().alerts.a1!.deliveries.find((d) => d.accountId === 'bob')!;
    expect(bob()).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: '2026-01-15T10:01:00.000Z', lastError: 'smtp down' });

    await runner.run(); // not due yet
    expect(bob().attempts).toBe(1);

    for (const minutes of [1, 6, 21]) {
      clock = Date.parse('2026-01-15T10:00:00.000Z') + minutes * 60_000;
      await runner.run();
    }
    expect(bob()).toMatchObject({ status: 'failed', attempts: 4 });
    expect(store.read().alerts.a1!.deliveries.find((d) => d.accountId === 'amy')!.status).toBe('sent');
  });

  it('resumes pending deliveries after a simulated restart', async () => {
    const { store, file } = await seededStore();
    const reloaded = await createStore(file);
    const mailer = recordingMailer();
    await createDeliveryRunner({ store: reloaded, mailer, now: () => new Date('2026-01-15T10:00:00.000Z') }).run();
    expect(mailer.sent).toHaveLength(2);
    expect(store.read()).not.toBe(reloaded.read());
  });

  it('does not touch inventory state when there is nothing due', async () => {
    const store = await createStore(join(mkdtempSync(join(tmpdir(), 'inv-del-')), 'data.json'));
    const before = store.read();
    await createDeliveryRunner({ store, mailer: recordingMailer(), now: () => new Date() }).run();
    expect(store.read()).toBe(before);
    expect(before).toEqual(emptyState());
  });
});
