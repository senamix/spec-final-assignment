import { err, ok } from './result.ts';
import {
  DEFAULT_WAREHOUSE,
  type AlertHistoryEntry,
  type AlertMessage,
  type Channel,
  type Delivery,
  type LowStockAlert,
  type LowStockState,
  type RecipientSettings,
  type Threshold,
} from './lowstock-types.ts';
import type { Ctx, Laptop, Result, State } from './types.ts';

type SkuFields = Pick<Laptop, 'brand' | 'model' | 'specs'>;

const norm = (value: string | undefined): string => (value ?? '').trim().toLowerCase();
const skuParts = (l: SkuFields): (string | undefined)[] => [l.brand, l.model, l.specs.processor, l.specs.memory, l.specs.storage];

export const skuKey = (l: SkuFields): string => skuParts(l).map(norm).join('|');
export const skuLabel = (l: SkuFields): string =>
  skuParts(l)
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');

const warehouseOf = (l: Laptop): string => l.warehouse?.trim() || DEFAULT_WAREHOUSE;
const isAvailable = (l: Laptop): boolean => l.status === 'Available' && !l.reserved && !l.defective;
const pairKey = (sku: string, warehouse: string): string => `${sku}\u0000${warehouse.toLowerCase()}`;

export interface StockLevel {
  readonly sku: string;
  readonly skuLabel: string;
  readonly warehouse: string;
  readonly available: number;
  readonly threshold: number | null;
  readonly reorderTarget: number | null;
  readonly low: boolean;
}

export function availableQuantity(state: State, sku: string, warehouse?: string): number {
  return Object.values(state.laptops).filter(
    (l) =>
      skuKey(l) === sku &&
      isAvailable(l) &&
      (warehouse === undefined || warehouseOf(l).toLowerCase() === warehouse.toLowerCase()),
  ).length;
}

const findThreshold = (thresholds: readonly Threshold[], sku: string, warehouse: string): Threshold | undefined =>
  thresholds.find((t) => t.sku === sku && t.warehouse?.toLowerCase() === warehouse.toLowerCase()) ??
  thresholds.find((t) => t.sku === sku && t.warehouse === null);

export function stockLevels(state: State): StockLevel[] {
  const groups = new Map<string, { sku: string; label: string; warehouse: string; available: number }>();
  const labels = new Map<string, string>();
  for (const laptop of Object.values(state.laptops)) {
    const sku = skuKey(laptop);
    const warehouse = warehouseOf(laptop);
    labels.set(sku, labels.get(sku) ?? skuLabel(laptop));
    const key = pairKey(sku, warehouse);
    const group = groups.get(key) ?? { sku, label: labels.get(sku)!, warehouse, available: 0 };
    groups.set(key, { ...group, available: group.available + (isAvailable(laptop) ? 1 : 0) });
  }
  for (const t of state.lowStock.thresholds) {
    const key = t.warehouse === null ? undefined : pairKey(t.sku, t.warehouse);
    if (key && !groups.has(key) && labels.has(t.sku)) {
      groups.set(key, { sku: t.sku, label: labels.get(t.sku)!, warehouse: t.warehouse!, available: 0 });
    }
  }
  return [...groups.values()]
    .map((g): StockLevel => {
      const t = findThreshold(state.lowStock.thresholds, g.sku, g.warehouse);
      return {
        sku: g.sku,
        skuLabel: g.label,
        warehouse: g.warehouse,
        available: g.available,
        threshold: t?.minQty ?? null,
        reorderTarget: t?.reorderTarget ?? null,
        low: t !== undefined && g.available <= t.minQty,
      };
    })
    .sort((a, b) => a.skuLabel.localeCompare(b.skuLabel) || a.warehouse.localeCompare(b.warehouse));
}

const withLowStock = (state: State, patch: Partial<LowStockState>): State => ({
  ...state,
  lowStock: { ...state.lowStock, ...patch },
});

const invalid = (message: string, field?: string) => err('ValidationError', message, field);

const wholeNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

// ---- Thresholds (REQ-01) ----

export function setThreshold(
  state: State,
  input: Record<string, unknown>,
  ctx: Ctx,
): Result<{ state: State; threshold: Threshold }> {
  const sku = typeof input.sku === 'string' ? input.sku : '';
  if (!Object.values(state.laptops).some((l) => skuKey(l) === sku)) return err('NotFound', 'SKU was not found');
  if (!wholeNumber(input.minQty, 0, 1_000_000)) return invalid('minQty must be a whole number of 0 or more', 'minQty');
  const target = input.reorderTarget ?? null;
  if (target !== null && !wholeNumber(target, 0, 1_000_000)) {
    return invalid('reorderTarget must be a whole number of 0 or more', 'reorderTarget');
  }
  const rawWarehouse = input.warehouse ?? null;
  if (rawWarehouse !== null && typeof rawWarehouse !== 'string') return invalid('warehouse must be text', 'warehouse');
  const warehouse = rawWarehouse === null || rawWarehouse.trim() === '' ? null : rawWarehouse.trim();
  if (warehouse !== null && warehouse.length > 100) return invalid('warehouse must be at most 100 characters', 'warehouse');

  const threshold: Threshold = {
    sku,
    warehouse,
    minQty: input.minQty,
    reorderTarget: target,
    updatedAt: ctx.now,
    updatedBy: ctx.actor.name,
  };
  const others = state.lowStock.thresholds.filter((t) => !sameScope(t, sku, warehouse));
  return ok({ state: withLowStock(state, { thresholds: [...others, threshold] }), threshold });
}

const sameScope = (t: Threshold, sku: string, warehouse: string | null): boolean =>
  t.sku === sku && (t.warehouse?.toLowerCase() ?? null) === (warehouse?.toLowerCase() ?? null);

export function removeThreshold(state: State, sku: string, warehouse: string | null): Result<{ state: State }> {
  const remaining = state.lowStock.thresholds.filter((t) => !sameScope(t, sku, warehouse));
  if (remaining.length === state.lowStock.thresholds.length) return err('NotFound', 'Threshold was not found');
  return ok({ state: withLowStock(state, { thresholds: remaining }) });
}

// ---- Recipient settings and config (REQ-03, REQ-04) ----

const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/;
const PHONE = /^\+?[0-9]{6,15}$/;

const hostOf = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};
const isSlackHook = (v: string) => hostOf(v) === 'hooks.slack.com';
const isTeamsHook = (v: string) => {
  const host = hostOf(v);
  return host !== undefined && (host.endsWith('.webhook.office.com') || host === 'outlook.office.com');
};

function optionalText(input: Record<string, unknown>, key: string, current: string | null): Result<string | null> {
  if (!(key in input)) return ok(current);
  const raw = input[key];
  if (raw === null || raw === undefined || raw === '') return ok(null);
  if (typeof raw !== 'string') return invalid(`${key} must be text`, key);
  return ok(raw.trim());
}

export function setRecipientSettings(
  state: State,
  accountId: string,
  input: Record<string, unknown>,
): Result<{ state: State; settings: RecipientSettings }> {
  if (!state.accounts[accountId]) return err('NotFound', 'Manager account was not found');
  const current: RecipientSettings = state.lowStock.recipients[accountId] ?? {
    accountId,
    designated: false,
    email: null,
    slack: null,
    teams: null,
    sms: null,
    secondaryAccountId: null,
  };
  if ('designated' in input && typeof input.designated !== 'boolean') return invalid('designated must be true or false', 'designated');

  const email = optionalText(input, 'email', current.email);
  const slack = optionalText(input, 'slack', current.slack);
  const teams = optionalText(input, 'teams', current.teams);
  const sms = optionalText(input, 'sms', current.sms);
  const secondary = optionalText(input, 'secondaryAccountId', current.secondaryAccountId);
  for (const r of [email, slack, teams, sms, secondary]) if (!r.ok) return r;
  const values = {
    email: (email as { value: string | null }).value,
    slack: (slack as { value: string | null }).value,
    teams: (teams as { value: string | null }).value,
    sms: (sms as { value: string | null }).value,
    secondaryAccountId: (secondary as { value: string | null }).value,
  };
  if (values.email !== null && !EMAIL.test(values.email)) return invalid('email is not a valid address', 'email');
  if (values.slack !== null && !isSlackHook(values.slack)) return invalid('slack must be an https hooks.slack.com webhook URL', 'slack');
  if (values.teams !== null && !isTeamsHook(values.teams)) return invalid('teams must be an https Microsoft Teams webhook URL', 'teams');
  if (values.sms !== null && !PHONE.test(values.sms)) return invalid('sms must be a phone number such as +8190123456', 'sms');
  if (values.secondaryAccountId !== null) {
    if (values.secondaryAccountId === accountId) return invalid('A manager cannot be their own secondary recipient', 'secondaryAccountId');
    if (!state.accounts[values.secondaryAccountId]) return invalid('Secondary recipient was not found', 'secondaryAccountId');
  }
  const settings: RecipientSettings = {
    ...current,
    ...values,
    designated: typeof input.designated === 'boolean' ? input.designated : current.designated,
  };
  return ok({ state: withLowStock(state, { recipients: { ...state.lowStock.recipients, [accountId]: settings } }), settings });
}

export function setAlertConfig(state: State, input: Record<string, unknown>): Result<{ state: State }> {
  if (!wholeNumber(input.escalationMinutes, 1, 10_080)) {
    return invalid('escalationMinutes must be a whole number between 1 and 10080', 'escalationMinutes');
  }
  return ok({ state: withLowStock(state, { config: { ...state.lowStock.config, escalationMinutes: input.escalationMinutes } }) });
}

// ---- Evaluation: raise, dedupe, escalate, resolve (REQ-03, REQ-04) ----

const minutes = (n: number) => n * 60_000;
const later = (iso: string, mins: number) => new Date(Date.parse(iso) + minutes(mins)).toISOString();

const suggestedReorder = (threshold: number, target: number | null, available: number): number =>
  Math.max(1, (target ?? threshold * 2) - available);

const linkFor = (sku: string, warehouse: string) => `/#sku=${encodeURIComponent(sku)}&warehouse=${encodeURIComponent(warehouse)}`;

interface Draft {
  alerts: Record<string, LowStockAlert>;
  history: AlertHistoryEntry[];
  deliveries: Delivery[];
}

function notify(
  draft: Draft,
  state: State,
  ctx: Ctx,
  alert: LowStockAlert,
  recipientIds: readonly string[],
  escalation: boolean,
): void {
  const message: AlertMessage = {
    sku: alert.skuLabel,
    warehouse: alert.warehouse,
    available: alert.available,
    threshold: alert.threshold,
    suggestedReorder: alert.suggestedReorder,
    link: linkFor(alert.sku, alert.warehouse),
    escalation,
    outOfStock: alert.available === 0,
  };
  const entry = (recipientId: string, channel: Channel, delivery: AlertHistoryEntry['delivery'], note: string) => {
    const historyId = ctx.newId();
    draft.history.push({
      id: historyId,
      at: ctx.now,
      alertId: alert.id,
      sku: alert.sku,
      skuLabel: alert.skuLabel,
      warehouse: alert.warehouse,
      recipientId,
      channel,
      status: 'sent',
      delivery,
      note,
    });
    return historyId;
  };
  for (const recipientId of recipientIds) {
    const settings = state.lowStock.recipients[recipientId];
    entry(recipientId, 'in-app', 'ok', escalation ? 'escalated' : '');
    const channels: [Exclude<Channel, 'in-app'>, string | null | undefined][] = [
      ['email', settings?.email],
      ['slack', settings?.slack],
      ['teams', settings?.teams],
      ['sms', settings?.sms],
    ];
    for (const [channel, address] of channels) {
      if (address) {
        draft.deliveries.push({ historyId: entry(recipientId, channel, 'pending', ''), alertId: alert.id, recipientId, channel, address, message });
      } else if (channel === 'email') {
        entry(recipientId, 'email', 'failed', 'no email address configured');
      }
    }
  }
}

const designatedIds = (state: State): string[] =>
  Object.values(state.lowStock.recipients)
    .filter((r) => r.designated && state.accounts[r.accountId])
    .map((r) => r.accountId);

const secondariesOf = (state: State, primaries: readonly string[]): string[] => [
  ...new Set(
    primaries
      .map((id) => state.lowStock.recipients[id]?.secondaryAccountId)
      .filter((id): id is string => !!id && !!state.accounts[id] && !primaries.includes(id)),
  ),
];

function resolveAlert(draft: Draft, ctx: Ctx, alert: LowStockAlert): void {
  draft.alerts[alert.id] = { ...alert, status: 'resolved', resolvedAt: ctx.now, snoozedUntil: null };
  for (const recipientId of alert.recipients) {
    draft.history.push({
      id: ctx.newId(),
      at: ctx.now,
      alertId: alert.id,
      sku: alert.sku,
      skuLabel: alert.skuLabel,
      warehouse: alert.warehouse,
      recipientId,
      channel: 'in-app',
      status: 'resolved',
      delivery: 'ok',
      note: 'stock recovered or threshold changed',
    });
  }
}

export function evaluate(state: State, ctx: Ctx): { state: State; deliveries: Delivery[] } {
  const draft: Draft = { alerts: { ...state.lowStock.alerts }, history: [], deliveries: [] };
  const primaries = designatedIds(state);
  const levels = stockLevels(state);
  const open = Object.values(state.lowStock.alerts).filter((a) => a.status !== 'resolved');
  const seen = new Set<string>();

  for (const level of levels) {
    const key = pairKey(level.sku, level.warehouse);
    const existing = open.find((a) => pairKey(a.sku, a.warehouse) === key);
    if (existing) seen.add(existing.id);

    if (!level.low) {
      if (existing) resolveAlert(draft, ctx, existing);
      continue;
    }
    const threshold = level.threshold!;
    const reorder = suggestedReorder(threshold, level.reorderTarget, level.available);

    if (!existing) {
      const base: LowStockAlert = {
        id: ctx.newId(),
        sku: level.sku,
        skuLabel: level.skuLabel,
        warehouse: level.warehouse,
        available: level.available,
        threshold,
        suggestedReorder: reorder,
        status: 'sent',
        createdAt: ctx.now,
        notifiedAt: ctx.now,
        acknowledgedAt: null,
        acknowledgedBy: null,
        snoozedUntil: null,
        escalatedAt: null,
        resolvedAt: null,
        recipients: primaries,
      };
      notify(draft, state, ctx, base, primaries, false);
      if (level.available === 0) {
        const extra = secondariesOf(state, primaries);
        const alert = { ...base, escalatedAt: ctx.now, recipients: [...primaries, ...extra] };
        notify(draft, state, ctx, alert, extra, true);
        draft.alerts[alert.id] = alert;
      } else {
        draft.alerts[base.id] = base;
      }
      continue;
    }

    let alert: LowStockAlert = { ...existing, available: level.available, threshold, suggestedReorder: reorder };
    if (alert.snoozedUntil !== null && ctx.now >= alert.snoozedUntil) {
      alert = { ...alert, status: 'sent', snoozedUntil: null, notifiedAt: ctx.now, escalatedAt: null };
      alert = { ...alert, recipients: [...new Set([...alert.recipients, ...primaries])] };
      notify(draft, state, ctx, alert, primaries, false);
    }
    const timedOut =
      alert.status === 'sent' &&
      alert.snoozedUntil === null &&
      ctx.now >= later(alert.notifiedAt, state.lowStock.config.escalationMinutes);
    if (alert.escalatedAt === null && (level.available === 0 || timedOut)) {
      const extra = secondariesOf(state, primaries);
      const targets = extra.length > 0 ? extra : primaries;
      alert = { ...alert, escalatedAt: ctx.now, recipients: [...new Set([...alert.recipients, ...targets])] };
      notify(draft, state, ctx, alert, targets, true);
    }
    draft.alerts[alert.id] = alert;
  }

  for (const alert of open) if (!seen.has(alert.id)) resolveAlert(draft, ctx, alert);

  return {
    state: withLowStock(state, { alerts: draft.alerts, history: [...state.lowStock.history, ...draft.history] }),
    deliveries: draft.deliveries,
  };
}

// ---- Acknowledge, snooze, delivery results ----

function openAlert(state: State, id: string): Result<LowStockAlert> {
  const alert = state.lowStock.alerts[id];
  if (!alert) return err('NotFound', 'Alert was not found');
  if (alert.status === 'resolved') return err('InvalidStatusTransition', 'This alert is already resolved');
  return ok(alert);
}

export function acknowledgeAlert(state: State, id: string, ctx: Ctx): Result<{ state: State; alert: LowStockAlert }> {
  const found = openAlert(state, id);
  if (!found.ok) return found;
  const current = found.value;
  if (current.status === 'acknowledged') return ok({ state, alert: current });
  const alert: LowStockAlert = {
    ...current,
    status: 'acknowledged',
    acknowledgedAt: ctx.now,
    acknowledgedBy: ctx.actor.id,
    snoozedUntil: null,
  };
  const entry: AlertHistoryEntry = {
    id: ctx.newId(),
    at: ctx.now,
    alertId: id,
    sku: alert.sku,
    skuLabel: alert.skuLabel,
    warehouse: alert.warehouse,
    recipientId: ctx.actor.id,
    channel: 'in-app',
    status: 'acknowledged',
    delivery: 'ok',
    note: `acknowledged by ${ctx.actor.name}`,
  };
  return ok({
    state: withLowStock(state, { alerts: { ...state.lowStock.alerts, [id]: alert }, history: [...state.lowStock.history, entry] }),
    alert,
  });
}

export function snoozeAlert(state: State, id: string, snoozeMinutes: unknown, ctx: Ctx): Result<{ state: State; alert: LowStockAlert }> {
  if (!wholeNumber(snoozeMinutes, 1, 43_200)) return invalid('minutes must be a whole number between 1 and 43200', 'minutes');
  const found = openAlert(state, id);
  if (!found.ok) return found;
  const alert: LowStockAlert = { ...found.value, snoozedUntil: later(ctx.now, snoozeMinutes) };
  return ok({ state: withLowStock(state, { alerts: { ...state.lowStock.alerts, [id]: alert } }), alert });
}

export function recordDelivery(state: State, historyId: string, delivered: boolean, note = ''): State {
  return withLowStock(state, {
    history: state.lowStock.history.map((h) =>
      h.id === historyId ? { ...h, delivery: delivered ? 'ok' : 'failed', note: delivered ? h.note : note } : h,
    ),
  });
}

// ---- History and reports (REQ-05) ----

export interface HistoryFilter {
  readonly sku?: string;
  readonly warehouse?: string;
  readonly from?: string;
  readonly to?: string;
}

const inRange = (iso: string, from?: string, to?: string): boolean => {
  const day = iso.slice(0, 10);
  return (from === undefined || day >= from) && (to === undefined || day <= to);
};

export function queryHistory(state: State, filter: HistoryFilter): AlertHistoryEntry[] {
  const sku = filter.sku?.trim().toLowerCase();
  const warehouse = filter.warehouse?.trim().toLowerCase();
  return state.lowStock.history
    .filter(
      (h) =>
        (!sku || h.sku === sku || h.skuLabel.toLowerCase().includes(sku)) &&
        (!warehouse || h.warehouse.toLowerCase() === warehouse) &&
        inRange(h.at, filter.from, filter.to),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface FrequencyRow {
  readonly sku: string;
  readonly skuLabel: string;
  readonly count: number;
}

export function lowStockFrequency(state: State, range: { from?: string; to?: string }): FrequencyRow[] {
  const rows = new Map<string, FrequencyRow>();
  for (const alert of Object.values(state.lowStock.alerts)) {
    if (!inRange(alert.createdAt, range.from, range.to)) continue;
    const row = rows.get(alert.sku);
    rows.set(alert.sku, { sku: alert.sku, skuLabel: alert.skuLabel, count: (row?.count ?? 0) + 1 });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.skuLabel.localeCompare(b.skuLabel));
}
