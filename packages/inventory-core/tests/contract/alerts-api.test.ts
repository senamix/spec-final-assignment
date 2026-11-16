import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.ts';
import { emptyState } from '../../src/types.ts';
import { makeCtx } from '../helpers.ts';

describe('alerts public API (contracts/core-library.md)', () => {
  it('exports the documented functions', () => {
    for (const name of [
      'availableCount',
      'evaluateLowInventory',
      'nextDueDeliveries',
      'recordDeliveryResult',
      'setEmail',
    ] as const) {
      expect(typeof core[name]).toBe('function');
    }
  });

  it('evaluateLowInventory is pure: same input, same output, input untouched', () => {
    const state = Object.freeze({ ...emptyState(), settings: Object.freeze({ lowLevel: 3, updatedBy: null, updatedAt: null }) });
    const a = core.evaluateLowInventory(state, makeCtx());
    const b = core.evaluateLowInventory(state, makeCtx());
    expect(a).toEqual(b);
    expect(state.lowPeriodActive).toBe(false);
    expect(state.alerts).toEqual({});
  });
});
