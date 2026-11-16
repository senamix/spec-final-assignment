import { describe, expect, it } from 'vitest';
import { addLaptop } from '../../src/laptops.ts';
import { createAccount } from '../../src/accounts.ts';
import { assignLaptop } from '../../src/assignments.ts';
import {
  availableCount,
  evaluateLowInventory,
  nextDueDeliveries,
  recordDeliveryResult,
} from '../../src/alerts.ts';
import { emptyState, type State } from '../../src/types.ts';
import { fakeHasher, makeCtx, validLaptop } from '../helpers.ts';

const withManagers = (state: State, ...names: Array<[string, string | undefined]>): State =>
  names.reduce((s, [username, email]) => {
    const r = createAccount(s, { username, displayName: username, password: 'password-123', email: email ?? 'x@y.co' }, fakeHasher, { newId: () => username });
    if (!r.ok) throw new Error('account');
    // Legacy account: drop the email to simulate one created before this feature.
    const account = email === undefined ? { ...r.value.account, email: undefined } : r.value.account;
    return { ...r.value.state, accounts: { ...r.value.state.accounts, [account.id]: account } };
  }, state);

const withLaptops = (state: State, n: number): State => {
  let s = state;
  for (let i = 0; i < n; i++) {
    const r = addLaptop(s, { ...validLaptop, serialNumber: `SN-${i}` }, { ...makeCtx(), newId: () => `l${i}` });
    if (!r.ok) throw new Error('laptop');
    s = r.value.state;
  }
  return s;
};

const setLevel = (state: State, lowLevel: number): State => ({ ...state, settings: { ...state.settings, lowLevel } });
const base = (laptops: number, level: number) =>
  setLevel(withLaptops(withManagers(emptyState(), ['amy', 'amy@example.com'], ['bob', 'bob@example.com']), laptops), level);
const ctx = (now = '2026-01-15T10:00:00.000Z') => makeCtx(now);

const assign = (s: State, id: string): State => {
  const r = assignLaptop(s, id, 'Pat', ctx());
  if (!r.ok) throw new Error('assign');
  return r.value.state;
};

describe('evaluateLowInventory performance', () => {
  it('evaluates 1,000 laptops in well under 100 ms', () => {
    let state = emptyState();
    const laptops: Record<string, any> = {};
    for (let i = 0; i < 1000; i++) laptops[`l${i}`] = { id: `l${i}`, status: i % 2 ? 'Available' : 'Assigned' };
    state = { ...state, laptops, settings: { ...state.settings, lowLevel: 10 } };
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) evaluateLowInventory(state, { now: '2026-01-15T10:00:00.000Z', newId: () => 'x' });
    expect((performance.now() - t0) / 20).toBeLessThan(100);
  });
});

describe('availableCount', () => {
  it('counts only Available laptops', () => {
    const s = assign(base(4, 3), 'l0');
    expect(availableCount(s)).toBe(3);
  });
});

describe('evaluateLowInventory', () => {
  it('raises one alert when the count reaches the level', () => {
    const s = assign(base(4, 3), 'l0');
    const r = evaluateLowInventory(s, ctx());
    expect(r.alert).toMatchObject({ availableCount: 3, level: 3, raisedAt: '2026-01-15T10:00:00.000Z', readBy: [] });
    expect(r.state.lowPeriodActive).toBe(true);
    expect(Object.keys(r.state.alerts)).toHaveLength(1);
  });

  it('raises no alert while the count is above the level', () => {
    const r = evaluateLowInventory(base(4, 3), ctx());
    expect(r.alert).toBeNull();
    expect(r.state.lowPeriodActive).toBe(false);
  });

  it('does not raise a second alert in the same low period', () => {
    const first = evaluateLowInventory(assign(base(4, 3), 'l0'), ctx());
    const second = evaluateLowInventory(assign(first.state, 'l1'), ctx());
    expect(second.alert).toBeNull();
    expect(Object.keys(second.state.alerts)).toHaveLength(1);
  });

  it('is idempotent when evaluated twice with no change', () => {
    const first = evaluateLowInventory(assign(base(4, 3), 'l0'), ctx());
    const again = evaluateLowInventory(first.state, ctx());
    expect(again.alert).toBeNull();
    expect(again.state).toBe(first.state);
  });

  it('raises a new alert after recovering above the level and dropping again', () => {
    const first = evaluateLowInventory(assign(base(4, 3), 'l0'), ctx());
    const recovered = evaluateLowInventory(withLaptops(first.state, 0), ctx());
    expect(recovered.alert).toBeNull();
    const more = { ...first.state, laptops: { ...first.state.laptops, ...withLaptops(emptyState(), 3).laptops } };
    const up = evaluateLowInventory(more, ctx());
    expect(up.state.lowPeriodActive).toBe(false);
    const down = evaluateLowInventory({ ...up.state, laptops: first.state.laptops }, { now: '2026-01-15T11:00:00.000Z', newId: () => 'second' });
    expect(down.alert).not.toBeNull();
    expect(Object.keys(down.state.alerts)).toHaveLength(2);
  });

  it('still alerts once when the count is 0', () => {
    const s = setLevel(emptyState(), 3);
    const r = evaluateLowInventory(withManagers(s, ['amy', 'amy@example.com']), ctx());
    expect(r.alert?.availableCount).toBe(0);
  });

  it('raises one alert when a single change drops the count by more than one', () => {
    const r = evaluateLowInventory(base(2, 5), ctx());
    expect(r.alert).not.toBeNull();
    expect(Object.keys(r.state.alerts)).toHaveLength(1);
  });

  it('creates one delivery per account: pending with an email, skipped without', () => {
    const state = setLevel(withLaptops(withManagers(emptyState(), ['amy', 'amy@example.com'], ['old', undefined]), 1), 5);
    const { alert } = evaluateLowInventory(state, ctx());
    expect(alert?.deliveries).toHaveLength(2);
    const amy = alert!.deliveries.find((d) => d.accountId === 'amy')!;
    expect(amy).toMatchObject({ email: 'amy@example.com', status: 'pending', attempts: 0, nextAttemptAt: '2026-01-15T10:00:00.000Z' });
    const old = alert!.deliveries.find((d) => d.accountId === 'old')!;
    expect(old).toMatchObject({ email: null, status: 'skipped', attempts: 0, nextAttemptAt: null });
    expect(old.lastError).toBeTruthy();
  });

  it('does not mutate its input', () => {
    const s = assign(base(4, 3), 'l0');
    const copy = JSON.stringify(s);
    evaluateLowInventory(s, ctx());
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('delivery scheduling', () => {
  const raised = () => evaluateLowInventory(base(1, 5), ctx()).state;
  const alertId = (s: State) => Object.keys(s.alerts)[0]!;
  const delivery = (s: State, account = 'amy') => s.alerts[alertId(s)]!.deliveries.find((d) => d.accountId === account)!;
  const fail = (s: State, now: string) => recordDeliveryResult(s, alertId(s), 'amy', { ok: false, error: 'smtp down' }, { now });

  it('lists pending deliveries that are due and have an address', () => {
    const s = raised();
    const due = nextDueDeliveries(s, '2026-01-15T10:00:00.000Z');
    expect(due.map((d) => d.accountId).sort()).toEqual(['amy', 'bob']);
    expect(due[0]).toMatchObject({ alertId: alertId(s), email: expect.any(String) });
    expect(nextDueDeliveries(s, '2026-01-15T09:59:59.000Z')).toEqual([]);
  });

  it('marks a delivery sent on success and stops listing it', () => {
    const s0 = raised();
    const st = recordDeliveryResult(s0, alertId(s0), 'amy', { ok: true }, { now: '2026-01-15T10:00:01.000Z' });
    expect(delivery(st)).toMatchObject({ status: 'sent', attempts: 1, nextAttemptAt: null, lastError: null });
    expect(nextDueDeliveries(st, '2030-01-01T00:00:00.000Z').map((d) => d.accountId)).toEqual(['bob']);
  });

  it('retries after +1, +5, +15 minutes and then fails on the 4th failure', () => {
    let s = fail(raised(), '2026-01-15T10:00:00.000Z');
    expect(delivery(s)).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: '2026-01-15T10:01:00.000Z', lastError: 'smtp down' });
    s = fail(s, '2026-01-15T10:01:00.000Z');
    expect(delivery(s)).toMatchObject({ status: 'pending', attempts: 2, nextAttemptAt: '2026-01-15T10:06:00.000Z' });
    s = fail(s, '2026-01-15T10:06:00.000Z');
    expect(delivery(s)).toMatchObject({ status: 'pending', attempts: 3, nextAttemptAt: '2026-01-15T10:21:00.000Z' });
    s = fail(s, '2026-01-15T10:21:00.000Z');
    expect(delivery(s)).toMatchObject({ status: 'failed', attempts: 4, nextAttemptAt: null, lastError: 'smtp down' });
    expect(nextDueDeliveries(s, '2030-01-01T00:00:00.000Z').map((d) => d.accountId)).toEqual(['bob']);
  });

  it('never lets attempts exceed 4 and ignores unknown alerts', () => {
    let s = raised();
    for (let i = 0; i < 6; i++) s = fail(s, '2026-01-15T10:00:00.000Z');
    expect(delivery(s).attempts).toBe(4);
    expect(recordDeliveryResult(s, 'nope', 'amy', { ok: true }, { now: '2026-01-15T10:00:00.000Z' })).toBe(s);
  });
});
