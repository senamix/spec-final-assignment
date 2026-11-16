import { describe, expect, it } from 'vitest';
import { evaluateLowInventory, listAlerts, markAlertRead, unreadCount } from '../../src/alerts.ts';
import { createAccount } from '../../src/accounts.ts';
import { emptyState, type State } from '../../src/types.ts';
import { fakeHasher, makeCtx } from '../helpers.ts';

const twoAlerts = (): State => {
  let s = emptyState();
  for (const name of ['amy', 'bob']) {
    const r = createAccount(s, { username: name, displayName: name, password: 'password-123', email: `${name}@example.com` }, fakeHasher, { newId: () => name });
    if (r.ok) s = r.value.state;
  }
  const first = evaluateLowInventory(s, { now: '2026-01-15T10:00:00.000Z', newId: () => 'a1' }).state;
  // Simulate recovery then a second low period.
  const recovered = { ...first, lowPeriodActive: false };
  return evaluateLowInventory(recovered, { now: '2026-01-16T10:00:00.000Z', newId: () => 'a2' }).state;
};

describe('listAlerts and unreadCount', () => {
  it('lists newest first with read state and the caller own email status', () => {
    const s = twoAlerts();
    const list = listAlerts(s, 'amy');
    expect(list.map((a) => a.id)).toEqual(['a2', 'a1']);
    expect(list[0]).toMatchObject({ read: false, emailStatus: 'pending', availableCount: 0, level: 5 });
    expect(unreadCount(s, 'amy')).toBe(2);
  });

  it('returns null email status for an account with no delivery', () => {
    expect(listAlerts(twoAlerts(), 'stranger')[0]!.emailStatus).toBeNull();
  });
});

describe('markAlertRead', () => {
  it('marks read for that manager only, keeps history, and is idempotent', () => {
    const s = twoAlerts();
    const r1 = markAlertRead(s, 'a1', 'amy');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = markAlertRead(r1.value.state, 'a1', 'amy');
    expect(r2.ok && r2.value.state.alerts.a1!.readBy).toEqual(['amy']);
    expect(unreadCount(r1.value.state, 'amy')).toBe(1);
    expect(unreadCount(r1.value.state, 'bob')).toBe(2);
    expect(listAlerts(r1.value.state, 'amy')).toHaveLength(2);
    expect(listAlerts(r1.value.state, 'amy').find((a) => a.id === 'a1')!.read).toBe(true);
    expect(s.alerts.a1!.readBy).toEqual([]);
  });

  it('returns NotFound for an unknown alert', () => {
    const r = markAlertRead(twoAlerts(), 'nope', 'amy');
    expect(!r.ok && r.error.code).toBe('NotFound');
  });
});
