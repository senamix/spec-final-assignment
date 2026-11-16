import { describe, expect, it } from 'vitest';
import { createAccount } from '../../src/accounts.ts';
import { addLaptop } from '../../src/laptops.ts';
import {
  acknowledgeAlert,
  availableQuantity,
  evaluate,
  lowStockFrequency,
  queryHistory,
  recordDelivery,
  removeThreshold,
  setAlertConfig,
  setRecipientSettings,
  setThreshold,
  skuKey,
  snoozeAlert,
  stockLevels,
} from '../../src/lowstock.ts';
import { emptyState, type Laptop, type State } from '../../src/types.ts';
import { fakeHasher, makeCtx, validLaptop } from '../helpers.ts';

const T0 = '2026-01-15T10:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const ctxAt = (minutes: number) => ({ ...makeCtx(at(minutes)), newId: () => `c-${++counter}` });

let counter = 0;
const uniq = () => ({ ...makeCtx(), newId: () => `u-${++counter}` });
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

function withLaptops(count: number, patch: Partial<Laptop> = {}, base: State = emptyState(), serialPrefix = 'S'): State {
  let state = base;
  for (let i = 0; i < count; i++) {
    const added = unwrap(addLaptop(state, { ...validLaptop, serialNumber: `${serialPrefix}-${++counter}` }, uniq()));
    state = { ...added.state, laptops: { ...added.state.laptops, [added.laptop.id]: { ...added.laptop, ...patch } } };
  }
  return state;
}

function withManagers(state: State, names: string[]): { state: State; ids: string[] } {
  const ids: string[] = [];
  let next = state;
  for (const name of names) {
    const created = unwrap(createAccount(next, { username: name, displayName: name, password: 'password-123' }, fakeHasher, uniq()));
    next = created.state;
    ids.push(created.account.id);
  }
  return { state: next, ids };
}

const sku = skuKey(validLaptop as unknown as Laptop);

const setup = (available: number, minQty = 3) => {
  // One Assigned laptop keeps the SKU present even when nothing is available.
  const stocked = withLaptops(available, {}, withLaptops(1, { status: 'Assigned' }));
  const { state: s1, ids } = withManagers(stocked, ['alice', 'bob']);
  let state = unwrap(setThreshold(s1, { sku, minQty }, ctxAt(0))).state;
  state = unwrap(setRecipientSettings(state, ids[0]!, { designated: true, email: 'a@x.com', secondaryAccountId: ids[1]! })).state;
  state = unwrap(setRecipientSettings(state, ids[1]!, { designated: false, email: 'b@x.com' })).state;
  return { state, alice: ids[0]!, bob: ids[1]! };
};

const dropOne = (state: State): State => {
  const first = Object.values(state.laptops).find((l) => l.status === 'Available' && !l.reserved && !l.defective)!;
  return { ...state, laptops: { ...state.laptops, [first.id]: { ...first, status: 'Assigned' } } };
};

describe('available quantity (REQ-02)', () => {
  it('counts only Available, non-reserved, non-defective laptops', () => {
    let state = withLaptops(4);
    state = withLaptops(2, { status: 'Assigned' }, state);
    state = withLaptops(1, { status: 'InRepair' }, state);
    state = withLaptops(1, { status: 'Retired' }, state);
    state = withLaptops(1, { reserved: true }, state);
    state = withLaptops(1, { defective: true }, state);
    expect(availableQuantity(state, sku)).toBe(4);
  });

  it('scopes by warehouse, defaulting to Main', () => {
    let state = withLaptops(2);
    state = withLaptops(3, { warehouse: 'North' }, state);
    expect(availableQuantity(state, sku, 'Main')).toBe(2);
    expect(availableQuantity(state, sku, 'North')).toBe(3);
    expect(availableQuantity(state, sku)).toBe(5);
  });
});

describe('thresholds (REQ-01)', () => {
  it.each([-1, 1.5, '3', null, Number.NaN])('rejects invalid minQty %s', (minQty) => {
    const r = setThreshold(withLaptops(1), { sku, minQty }, makeCtx());
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown SKU', () => {
    const r = setThreshold(withLaptops(1), { sku: 'nope', minQty: 1 }, makeCtx());
    expect(!r.ok && r.error.code).toBe('NotFound');
  });

  it('replaces an existing threshold for the same SKU and warehouse', () => {
    let state = unwrap(setThreshold(withLaptops(1), { sku, minQty: 2 }, makeCtx())).state;
    state = unwrap(setThreshold(state, { sku, minQty: 5 }, makeCtx())).state;
    expect(state.lowStock.thresholds).toHaveLength(1);
    expect(state.lowStock.thresholds[0]!.minQty).toBe(5);
  });

  it('flags Low Stock at or below the threshold and prefers the warehouse threshold', () => {
    let state = withLaptops(5);
    state = withLaptops(3, { warehouse: 'A' }, state);
    state = unwrap(setThreshold(state, { sku, minQty: 5 }, makeCtx())).state;
    state = unwrap(setThreshold(state, { sku, warehouse: 'A', minQty: 2 }, makeCtx())).state;
    const levels = Object.fromEntries(stockLevels(state).map((l) => [l.warehouse, l]));
    expect(levels.Main).toMatchObject({ available: 5, threshold: 5, low: true });
    expect(levels.A).toMatchObject({ available: 3, threshold: 2, low: false });
  });

  it('never flags a SKU without a threshold', () => {
    expect(stockLevels(withLaptops(0)).every((l) => !l.low)).toBe(true);
    expect(stockLevels(withLaptops(1))[0]).toMatchObject({ threshold: null, low: false });
  });

  it('removes a threshold', () => {
    let state = unwrap(setThreshold(withLaptops(1), { sku, minQty: 2 }, makeCtx())).state;
    state = unwrap(removeThreshold(state, sku, null)).state;
    expect(state.lowStock.thresholds).toEqual([]);
  });
});

describe('recipient settings and config', () => {
  it('rejects unknown accounts, bad emails and self-escalation', () => {
    const { state, ids } = withManagers(emptyState(), ['alice']);
    expect(setRecipientSettings(state, 'nope', { designated: true }).ok).toBe(false);
    expect(setRecipientSettings(state, ids[0]!, { email: 'not-an-email' }).ok).toBe(false);
    expect(setRecipientSettings(state, ids[0]!, { secondaryAccountId: ids[0]! }).ok).toBe(false);
    expect(setRecipientSettings(state, ids[0]!, { secondaryAccountId: 'ghost' }).ok).toBe(false);
  });

  it('validates the Slack and Teams webhook addresses as https URLs', () => {
    const { state, ids } = withManagers(emptyState(), ['alice']);
    expect(setRecipientSettings(state, ids[0]!, { slack: 'http://hooks.slack.com/x' }).ok).toBe(false);
    expect(setRecipientSettings(state, ids[0]!, { teams: 'https://example.com/x' }).ok).toBe(false);
    expect(setRecipientSettings(state, ids[0]!, { slack: 'https://hooks.slack.com/services/T/B/x' }).ok).toBe(true);
  });

  it('validates the escalation period', () => {
    expect(setAlertConfig(emptyState(), { escalationMinutes: 0 }).ok).toBe(false);
    expect(setAlertConfig(emptyState(), { escalationMinutes: 30 }).ok).toBe(true);
  });
});

describe('alerting (REQ-03, REQ-05)', () => {
  it('sends nothing while stock is above the threshold', () => {
    const { state } = setup(4);
    const r = evaluate(state, ctxAt(1));
    expect(r.deliveries).toEqual([]);
    expect(Object.keys(r.state.lowStock.alerts)).toHaveLength(0);
  });

  it('alerts designated managers in-app and by email with full content', () => {
    const { state, alice } = setup(3);
    const r = evaluate(state, ctxAt(1));
    const alert = Object.values(r.state.lowStock.alerts)[0]!;
    expect(alert).toMatchObject({ warehouse: 'Main', available: 3, threshold: 3, status: 'sent', recipients: [alice] });
    expect(r.deliveries).toHaveLength(1);
    expect(r.deliveries[0]).toMatchObject({ channel: 'email', address: 'a@x.com', recipientId: alice });
    expect(r.deliveries[0]!.message).toMatchObject({
      sku: 'Dell Latitude 7440 i7 16GB 512GB',
      warehouse: 'Main',
      available: 3,
      threshold: 3,
      suggestedReorder: 3,
      escalation: false,
      outOfStock: false,
    });
    expect(r.deliveries[0]!.message.link).toContain(encodeURIComponent(sku));
    const channels = r.state.lowStock.history.map((h) => h.channel).sort();
    expect(channels).toEqual(['email', 'in-app']);
    expect(r.state.lowStock.history.find((h) => h.channel === 'in-app')!.delivery).toBe('ok');
  });

  it('also uses optional channels a manager enabled', () => {
    const { state, alice } = setup(3);
    const next = unwrap(
      setRecipientSettings(state, alice, { slack: 'https://hooks.slack.com/services/T/B/x', sms: '+8190123456' }),
    ).state;
    const channels = evaluate(next, ctxAt(1)).deliveries.map((d) => d.channel).sort();
    expect(channels).toEqual(['email', 'slack', 'sms']);
  });

  it('suggests restoring stock to the reorder target, at least 1', () => {
    const { state } = setup(0, 3);
    const a = Object.values(evaluate(state, ctxAt(1)).state.lowStock.alerts)[0]!;
    expect(a.suggestedReorder).toBe(6);
    const target = unwrap(setThreshold(state, { sku, minQty: 3, reorderTarget: 0 }, makeCtx())).state;
    expect(Object.values(evaluate(target, ctxAt(1)).state.lowStock.alerts)[0]!.suggestedReorder).toBe(1);
  });

  it('records delivery failures without affecting other channels', () => {
    const { state } = setup(3);
    const r = evaluate(state, ctxAt(1));
    const next = recordDelivery(r.state, r.deliveries[0]!.historyId, false, 'smtp down');
    const entry = next.lowStock.history.find((h) => h.id === r.deliveries[0]!.historyId)!;
    expect(entry).toMatchObject({ delivery: 'failed', note: 'smtp down' });
    expect(next.lowStock.history.find((h) => h.channel === 'in-app')!.delivery).toBe('ok');
  });

  it('alerts only designated managers with a deliverable address', () => {
    const { state, alice } = setup(3);
    const noEmail = unwrap(setRecipientSettings(state, alice, { email: null })).state;
    const r = evaluate(noEmail, ctxAt(1));
    expect(r.deliveries).toEqual([]);
    expect(Object.values(r.state.lowStock.alerts)[0]!.recipients).toEqual([alice]);
    expect(r.state.lowStock.history.some((h) => h.channel === 'email' && h.delivery === 'failed')).toBe(true);
  });
});

describe('deduplication (REQ-04)', () => {
  it('sends one alert per low-stock event', () => {
    const { state } = setup(3);
    const first = evaluate(state, ctxAt(1));
    const again = evaluate(dropOne(first.state), ctxAt(2));
    expect(again.deliveries).toEqual([]);
    expect(Object.keys(again.state.lowStock.alerts)).toHaveLength(1);
    expect(Object.values(again.state.lowStock.alerts)[0]!.available).toBe(2);
  });

  it('resolves on recovery and alerts again on the next drop', () => {
    const { state } = setup(3);
    const first = evaluate(state, ctxAt(1)).state;
    const recovered = evaluate(withLaptops(5, {}, first), ctxAt(2));
    const resolved = Object.values(recovered.state.lowStock.alerts)[0]!;
    expect(resolved).toMatchObject({ status: 'resolved', resolvedAt: at(2) });
    expect(recovered.state.lowStock.history.some((h) => h.status === 'resolved')).toBe(true);
    let dropped = recovered.state;
    for (let i = 0; i < 5; i++) dropped = dropOne(dropped);
    const second = evaluate(dropped, ctxAt(3));
    expect(second.deliveries).toHaveLength(1);
    expect(Object.keys(second.state.lowStock.alerts)).toHaveLength(2);
  });

  it('re-evaluates when the threshold changes', () => {
    const { state } = setup(3);
    const first = evaluate(state, ctxAt(1)).state;
    const lowered = unwrap(setThreshold(first, { sku, minQty: 1 }, makeCtx())).state;
    expect(Object.values(evaluate(lowered, ctxAt(2)).state.lowStock.alerts)[0]!.status).toBe('resolved');
  });
});

describe('acknowledge and snooze (REQ-04)', () => {
  it('acknowledges an alert and records history', () => {
    const { state, alice } = setup(3);
    const sent = evaluate(state, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    const acked = unwrap(acknowledgeAlert(sent, id, { ...ctxAt(2), actor: { id: alice, name: 'alice' } })).state;
    expect(acked.lowStock.alerts[id]).toMatchObject({ status: 'acknowledged', acknowledgedBy: alice });
    expect(acked.lowStock.history.some((h) => h.status === 'acknowledged' && h.recipientId === alice)).toBe(true);
    expect(acknowledgeAlert(acked, 'nope', ctxAt(3)).ok).toBe(false);
  });

  it('rejects acknowledging or snoozing a resolved alert and bad snooze lengths', () => {
    const { state } = setup(3);
    const sent = evaluate(state, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    expect(snoozeAlert(sent, id, 0, ctxAt(2)).ok).toBe(false);
    expect(snoozeAlert(sent, id, 1.5, ctxAt(2)).ok).toBe(false);
    const resolved = evaluate(withLaptops(5, {}, sent), ctxAt(3)).state;
    expect(acknowledgeAlert(resolved, id, ctxAt(4)).ok).toBe(false);
    expect(snoozeAlert(resolved, id, 10, ctxAt(4)).ok).toBe(false);
  });

  it('re-alerts after the snooze ends while stock is still low', () => {
    const { state } = setup(3);
    const sent = evaluate(state, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    const snoozed = unwrap(snoozeAlert(sent, id, 60, ctxAt(2))).state;
    expect(evaluate(snoozed, ctxAt(30)).deliveries).toEqual([]);
    const after = evaluate(snoozed, ctxAt(70));
    expect(after.deliveries).toHaveLength(1);
    expect(after.state.lowStock.alerts[id]).toMatchObject({ snoozedUntil: null, status: 'sent' });
    expect(Object.keys(after.state.lowStock.alerts)).toHaveLength(1);
  });

  it('does not re-alert after a snooze if stock recovered', () => {
    const { state } = setup(3);
    const sent = evaluate(state, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    const snoozed = unwrap(snoozeAlert(sent, id, 60, ctxAt(2))).state;
    const r = evaluate(withLaptops(5, {}, snoozed), ctxAt(70));
    expect(r.deliveries).toEqual([]);
    expect(r.state.lowStock.alerts[id]!.status).toBe('resolved');
  });
});

describe('escalation (REQ-04)', () => {
  it('escalates to the secondary recipient when not acknowledged in time', () => {
    const { state, bob } = setup(3);
    const cfg = unwrap(setAlertConfig(state, { escalationMinutes: 30 })).state;
    const sent = evaluate(cfg, ctxAt(1)).state;
    expect(evaluate(sent, ctxAt(20)).deliveries).toEqual([]);
    const esc = evaluate(sent, ctxAt(40));
    expect(esc.deliveries).toHaveLength(1);
    expect(esc.deliveries[0]).toMatchObject({ recipientId: bob, address: 'b@x.com' });
    expect(esc.deliveries[0]!.message.escalation).toBe(true);
    expect(Object.values(esc.state.lowStock.alerts)[0]!.recipients).toContain(bob);
    expect(evaluate(esc.state, ctxAt(500)).deliveries).toEqual([]);
  });

  it('does not escalate acknowledged alerts on timeout', () => {
    const { state, alice } = setup(3);
    const cfg = unwrap(setAlertConfig(state, { escalationMinutes: 30 })).state;
    const sent = evaluate(cfg, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    const acked = unwrap(acknowledgeAlert(sent, id, { ...ctxAt(5), actor: { id: alice, name: 'alice' } })).state;
    expect(evaluate(acked, ctxAt(100)).deliveries).toEqual([]);
  });

  it('escalates immediately when stock reaches zero, even if acknowledged', () => {
    const { state, alice, bob } = setup(3);
    const sent = evaluate(state, ctxAt(1)).state;
    const id = Object.keys(sent.lowStock.alerts)[0]!;
    const acked = unwrap(acknowledgeAlert(sent, id, { ...ctxAt(2), actor: { id: alice, name: 'alice' } })).state;
    const empty = {
      ...acked,
      laptops: Object.fromEntries(Object.entries(acked.laptops).map(([k, l]) => [k, { ...l, status: 'Assigned' as const }])),
    };
    const r = evaluate(empty, ctxAt(3));
    expect(r.deliveries[0]).toMatchObject({ recipientId: bob });
    expect(r.deliveries[0]!.message).toMatchObject({ outOfStock: true, escalation: true, available: 0 });
  });

  it('re-alerts the primary managers when no secondary recipient exists', () => {
    const { state, alice } = setup(0);
    const none = unwrap(setRecipientSettings(state, alice, { secondaryAccountId: null })).state;
    const r = evaluate(none, ctxAt(1));
    expect(r.deliveries).toHaveLength(1);
    expect(r.deliveries[0]!.recipientId).toBe(alice);
    const again = evaluate(r.state, ctxAt(2));
    expect(again.deliveries).toEqual([]);
    expect(Object.values(again.state.lowStock.alerts)[0]!.escalatedAt).not.toBeNull();
  });
});

describe('history and report (REQ-05)', () => {
  const scenario = () => {
    let { state } = setup(3);
    state = evaluate(state, ctxAt(1)).state;
    state = evaluate(withLaptops(5, {}, state), ctxAt(60)).state;
    state = evaluate(dropOne(dropOne(dropOne(dropOne(dropOne(dropOne(state)))))), ctxAt(24 * 60 + 5)).state;
    return state;
  };

  it('filters by SKU, warehouse and date range', () => {
    const state = scenario();
    expect(queryHistory(state, {}).length).toBeGreaterThan(3);
    expect(queryHistory(state, { sku: 'other' })).toEqual([]);
    expect(queryHistory(state, { warehouse: 'North' })).toEqual([]);
    const day1 = queryHistory(state, { sku, warehouse: 'Main', from: '2026-01-15', to: '2026-01-15' });
    expect(day1.every((h) => h.at.startsWith('2026-01-15'))).toBe(true);
    expect(day1.some((h) => h.status === 'resolved')).toBe(true);
    expect(queryHistory(state, { from: '2026-01-16' }).every((h) => h.at >= '2026-01-16')).toBe(true);
  });

  it('reports low-stock frequency per SKU, most frequent first', () => {
    const state = scenario();
    const all = lowStockFrequency(state, {});
    expect(all).toEqual([{ sku, skuLabel: 'Dell Latitude 7440 i7 16GB 512GB', count: 2 }]);
    expect(lowStockFrequency(state, { from: '2026-01-16', to: '2026-01-16' })[0]!.count).toBe(1);
    expect(lowStockFrequency(state, { from: '2027-01-01' })).toEqual([]);
  });
});
