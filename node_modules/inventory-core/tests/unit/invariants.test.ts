import { describe, expect, it } from 'vitest';
import { assignLaptop, returnLaptop } from '../../src/assignments.ts';
import { addLaptop, changeStatus, deleteLaptop, editLaptop } from '../../src/laptops.ts';
import { statusCounts } from '../../src/query.ts';
import { emptyState, type State, type Status } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

// Small deterministic PRNG so failures are reproducible.
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function checkInvariants(state: State): void {
  const counts = statusCounts(state);
  expect(counts.Available + counts.Assigned + counts.InRepair + counts.Retired).toBe(counts.total);
  expect(counts.total).toBe(Object.keys(state.laptops).length);
  const serials = Object.values(state.laptops).map((l) => l.serialNumber.toLowerCase());
  expect(new Set(serials).size).toBe(serials.length);
  for (const laptop of Object.values(state.laptops)) {
    const open = laptop.assignments.filter((a) => a.returnedAt === null);
    expect(open.length).toBeLessThanOrEqual(1);
    expect(open.length === 1).toBe(laptop.status === 'Assigned');
    expect(laptop.history[0]?.action).toBe('Created');
  }
}

describe('inventory invariants under random operations (SC-005)', () => {
  it.each([1, 2, 3, 4, 5])('hold for seed %i', (seed) => {
    const rand = prng(seed);
    const ctx = makeCtx();
    let state = emptyState();
    let n = 0;
    const statuses: Status[] = ['Available', 'InRepair', 'Retired', 'Assigned'];

    for (let step = 0; step < 300; step++) {
      const ids = Object.keys(state.laptops);
      const pick = () => ids[Math.floor(rand() * ids.length)] ?? 'none';
      const op = Math.floor(rand() * 7);
      const result =
        op === 0 || ids.length === 0
          ? addLaptop(state, { ...validLaptop, serialNumber: `SN-${Math.floor(rand() * 40)}-${n++ % 3}` }, ctx)
          : op === 1
            ? assignLaptop(state, pick(), `Person ${step}`, ctx)
            : op === 2
              ? returnLaptop(state, pick(), ctx)
              : op === 3
                ? changeStatus(state, pick(), statuses[Math.floor(rand() * 4)]!, ctx)
                : op === 4
                  ? editLaptop(state, pick(), { serialNumber: `SN-${Math.floor(rand() * 40)}-${n++ % 3}` }, ctx)
                  : op === 5
                    ? deleteLaptop(state, pick())
                    : assignLaptop(state, pick(), 'Ada', ctx);
      if (result.ok) state = result.value.state;
      checkInvariants(state);
    }
  });
});
