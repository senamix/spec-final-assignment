import { err, ok } from './result.ts';
import { statusCounts } from './query.ts';
import type { Result, State } from './types.ts';

export const MAX_LOW_INVENTORY_THRESHOLD = 10_000;

export interface LowInventoryAlert {
  readonly low: boolean;
  readonly available: number;
  readonly threshold: number;
  readonly total: number;
}

export function setLowInventoryThreshold(
  state: State,
  value: unknown,
): Result<{ state: State; threshold: number }> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_LOW_INVENTORY_THRESHOLD) {
    return err(
      'ValidationError',
      `The low-inventory threshold must be a whole number from 0 to ${MAX_LOW_INVENTORY_THRESHOLD.toLocaleString('en-US')}`,
      'lowInventoryThreshold',
    );
  }
  return ok({ state: { ...state, settings: { ...state.settings, lowInventoryThreshold: value } }, threshold: value });
}

/** Pure calculation only: the application decides how to show the alert, and nothing is ever sent. */
export function lowInventoryAlert(state: State): LowInventoryAlert {
  const counts = statusCounts(state);
  const threshold = state.settings.lowInventoryThreshold;
  return {
    low: counts.total > 0 && counts.Available <= threshold,
    available: counts.Available,
    threshold,
    total: counts.total,
  };
}
