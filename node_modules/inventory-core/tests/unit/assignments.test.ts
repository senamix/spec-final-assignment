import { describe, expect, it } from 'vitest';
import { addLaptop, changeStatus } from '../../src/laptops.ts';
import { assignLaptop, returnLaptop } from '../../src/assignments.ts';
import { emptyState, type State } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

const bob = () => makeCtx('2026-02-01T08:00:00.000Z', { id: 'acc-2', name: 'Bob' });
const later = () => makeCtx('2026-02-10T17:00:00.000Z', { id: 'acc-3', name: 'Cy' });

function seed(): { state: State; id: string } {
  const r = addLaptop(emptyState(), validLaptop, makeCtx());
  if (!r.ok) throw new Error('seed failed');
  return { state: r.value.state, id: r.value.laptop.id };
}

describe('assignLaptop', () => {
  it('assigns an Available laptop, sets the holder and records who did it', () => {
    const { state, id } = seed();
    const r = assignLaptop(state, id, '  Ada Lovelace ', bob());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.laptop.status).toBe('Assigned');
    expect(r.value.laptop.assignments).toEqual([
      { personName: 'Ada Lovelace', assignedAt: '2026-02-01T08:00:00.000Z', returnedAt: null },
    ]);
    expect(r.value.laptop.history.at(-1)).toMatchObject({ action: 'Assigned', byName: 'Bob' });
    expect(r.value.state.laptops[id]).toEqual(r.value.laptop);
  });

  it('refuses a laptop that is already assigned (one open assignment at most)', () => {
    const { state, id } = seed();
    const first = assignLaptop(state, id, 'Ada', bob());
    if (!first.ok) throw new Error('setup failed');
    const second = assignLaptop(first.value.state, id, 'Grace', bob());
    expect(!second.ok && second.error.code).toBe('NotAvailable');
  });

  it.each(['InRepair', 'Retired'] as const)('refuses a %s laptop and states the reason', (status) => {
    const { state, id } = seed();
    const prepared = changeStatus(state, id, status === 'Retired' ? 'Retired' : 'InRepair', bob());
    if (!prepared.ok) throw new Error('setup failed');
    const r = assignLaptop(prepared.value.state, id, 'Ada', bob());
    expect(!r.ok && r.error.code).toBe('NotAvailable');
    expect(!r.ok && r.error.message).toContain(status === 'Retired' ? 'Retired' : 'InRepair');
  });

  it('validates the person name', () => {
    const { state, id } = seed();
    const empty = assignLaptop(state, id, '   ', bob());
    expect(!empty.ok && empty.error).toMatchObject({ code: 'ValidationError', field: 'personName' });
    const long = assignLaptop(state, id, 'a'.repeat(101), bob());
    expect(long.ok).toBe(false);
    expect(assignLaptop(state, id, 'a'.repeat(100), bob()).ok).toBe(true);
  });

  it('returns NotFound for an unknown laptop and does not modify the input state', () => {
    const { state, id } = seed();
    const before = JSON.stringify(state);
    expect(assignLaptop(state, 'nope', 'Ada', bob()).ok).toBe(false);
    assignLaptop(state, id, 'Ada', bob());
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('returnLaptop', () => {
  it('makes the laptop Available again and keeps the assignment in history', () => {
    const { state, id } = seed();
    const assigned = assignLaptop(state, id, 'Ada', bob());
    if (!assigned.ok) throw new Error('setup failed');
    const r = returnLaptop(assigned.value.state, id, later());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.laptop.status).toBe('Available');
    expect(r.value.laptop.assignments).toEqual([
      { personName: 'Ada', assignedAt: '2026-02-01T08:00:00.000Z', returnedAt: '2026-02-10T17:00:00.000Z' },
    ]);
    expect(r.value.laptop.history.at(-1)).toMatchObject({ action: 'Returned', byName: 'Cy' });
  });

  it('allows assigning again after a return and keeps both assignments', () => {
    const { state, id } = seed();
    const a = assignLaptop(state, id, 'Ada', bob());
    if (!a.ok) throw new Error('setup failed');
    const r1 = returnLaptop(a.value.state, id, later());
    if (!r1.ok) throw new Error('setup failed');
    const b = assignLaptop(r1.value.state, id, 'Grace', later());
    expect(b.ok && b.value.laptop.assignments.map((x) => x.personName)).toEqual(['Ada', 'Grace']);
    expect(b.ok && b.value.laptop.assignments.filter((x) => x.returnedAt === null)).toHaveLength(1);
  });

  it('refuses to return a laptop that is not assigned', () => {
    const { state, id } = seed();
    const r = returnLaptop(state, id, later());
    expect(!r.ok && r.error.code).toBe('InvalidStatusTransition');
  });

  it('returns NotFound for an unknown laptop', () => {
    const r = returnLaptop(emptyState(), 'nope', later());
    expect(!r.ok && r.error.code).toBe('NotFound');
  });
});
