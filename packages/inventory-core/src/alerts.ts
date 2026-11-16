import { err, ok } from './result.ts';
import type { Alert, Ctx, Delivery, DeliveryStatus, Result, Settings, State } from './types.ts';

const RETRY_DELAYS_MINUTES = [1, 5, 15] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

export const availableCount = (state: State): number =>
  Object.values(state.laptops).filter((l) => l.status === 'Available').length;

const initialDelivery = (account: State['accounts'][string], now: string): Delivery =>
  account.email
    ? { accountId: account.id, email: account.email, status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null }
    : {
        accountId: account.id,
        email: null,
        status: 'skipped',
        attempts: 0,
        nextAttemptAt: null,
        lastError: 'No email address on file',
      };

/** Raises at most one alert per low period; clears the period once inventory recovers. */
export function evaluateLowInventory(
  state: State,
  ctx: Pick<Ctx, 'now' | 'newId'>,
): { state: State; alert: Alert | null } {
  const count = availableCount(state);
  const level = state.settings.lowLevel;
  const isLow = count <= level;

  if (!isLow) {
    return { state: state.lowPeriodActive ? { ...state, lowPeriodActive: false } : state, alert: null };
  }
  if (state.lowPeriodActive) return { state, alert: null };

  const alert: Alert = {
    id: ctx.newId(),
    raisedAt: ctx.now,
    availableCount: count,
    level,
    readBy: [],
    deliveries: Object.values(state.accounts).map((a) => initialDelivery(a, ctx.now)),
  };
  return { state: { ...state, alerts: { ...state.alerts, [alert.id]: alert }, lowPeriodActive: true }, alert };
}

export const MAX_LOW_LEVEL = 100000;

export const getLowLevel = (state: State): Settings => state.settings;

/** Saves the level and re-evaluates, so a level that is already reached alerts immediately. */
export function setLowLevel(
  state: State,
  level: unknown,
  ctx: Pick<Ctx, 'actor' | 'now' | 'newId'>,
): Result<{ state: State; alert: Alert | null }> {
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > MAX_LOW_LEVEL) {
    return err('ValidationError', `level must be a whole number from 0 to ${MAX_LOW_LEVEL}`, 'level');
  }
  const updated: State = { ...state, settings: { lowLevel: level, updatedBy: ctx.actor.id, updatedAt: ctx.now } };
  return ok(evaluateLowInventory(updated, ctx));
}

export interface DueDelivery {
  readonly alertId: string;
  readonly accountId: string;
  readonly email: string;
}

export function nextDueDeliveries(state: State, now: string): DueDelivery[] {
  return Object.values(state.alerts).flatMap((alert) =>
    alert.deliveries
      .filter((d) => d.status === 'pending' && d.email !== null && d.nextAttemptAt !== null && d.nextAttemptAt <= now)
      .map((d) => ({ alertId: alert.id, accountId: d.accountId, email: d.email! })),
  );
}

export type DeliveryOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface AlertListItem {
  readonly id: string;
  readonly raisedAt: string;
  readonly availableCount: number;
  readonly level: number;
  readonly read: boolean;
  readonly emailStatus: DeliveryStatus | null;
}

export function listAlerts(state: State, accountId: string): AlertListItem[] {
  return Object.values(state.alerts)
    .map((a) => ({
      id: a.id,
      raisedAt: a.raisedAt,
      availableCount: a.availableCount,
      level: a.level,
      read: a.readBy.includes(accountId),
      emailStatus: a.deliveries.find((d) => d.accountId === accountId)?.status ?? null,
    }))
    .sort((x, y) => (x.raisedAt < y.raisedAt ? 1 : x.raisedAt > y.raisedAt ? -1 : 0));
}

export const unreadCount = (state: State, accountId: string): number =>
  Object.values(state.alerts).filter((a) => !a.readBy.includes(accountId)).length;

export function markAlertRead(state: State, alertId: string, accountId: string): Result<{ state: State }> {
  const alert = state.alerts[alertId];
  if (!alert) return err('NotFound', `Alert ${alertId} was not found`);
  if (alert.readBy.includes(accountId)) return ok({ state });
  const updated: Alert = { ...alert, readBy: [...alert.readBy, accountId] };
  return ok({ state: { ...state, alerts: { ...state.alerts, [alertId]: updated } } });
}

const addMinutes = (iso: string, minutes: number): string => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

export function recordDeliveryResult(
  state: State,
  alertId: string,
  accountId: string,
  outcome: DeliveryOutcome,
  ctx: Pick<Ctx, 'now'>,
): State {
  const alert = state.alerts[alertId];
  const current = alert?.deliveries.find((d) => d.accountId === accountId);
  if (!alert || !current || current.status !== 'pending') return state;

  const attempts = Math.min(current.attempts + 1, MAX_DELIVERY_ATTEMPTS);
  let next: Delivery;
  if (outcome.ok) {
    next = { ...current, status: 'sent', attempts, nextAttemptAt: null, lastError: null };
  } else if (attempts >= MAX_DELIVERY_ATTEMPTS) {
    next = { ...current, status: 'failed', attempts, nextAttemptAt: null, lastError: outcome.error };
  } else {
    next = {
      ...current,
      attempts,
      nextAttemptAt: addMinutes(ctx.now, RETRY_DELAYS_MINUTES[attempts - 1]!),
      lastError: outcome.error,
    };
  }
  const updated: Alert = { ...alert, deliveries: alert.deliveries.map((d) => (d === current ? next : d)) };
  return { ...state, alerts: { ...state.alerts, [alertId]: updated } };
}
