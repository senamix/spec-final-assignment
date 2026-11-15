import { describe, expect, it } from 'vitest';
import { addLaptop, changeStatus, deleteLaptop, editLaptop } from '../../src/laptops.ts';
import { emptyState, type Laptop, type State, type Status } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

function seed(): { state: State; id: string } {
  const r = addLaptop(emptyState(), validLaptop, makeCtx());
  if (!r.ok) throw new Error('seed failed');
  return { state: r.value.state, id: r.value.laptop.id };
}

/** Builds a state whose single laptop is already in the given status. */
function seedWithStatus(status: Status, assignments: Laptop['assignments'] = []): { state: State; id: string } {
  const { state, id } = seed();
  const laptop = state.laptops[id]!;
  return { state: { ...state, laptops: { [id]: { ...laptop, status, assignments } } }, id };
}

const ctx2 = () => makeCtx('2026-01-16T09:00:00.000Z', { id: 'acc-2', name: 'Bob' });

describe('editLaptop', () => {
  it('updates fields and records who edited and when', () => {
    const { state, id } = seed();
    const r = editLaptop(state, id, { model: 'Latitude 9999', specs: { memory: '32GB' } }, ctx2());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.laptop).toMatchObject({ model: 'Latitude 9999', brand: 'Dell', specs: { processor: 'i7', memory: '32GB', storage: '512GB' } });
    expect(r.value.laptop.history.at(-1)).toMatchObject({ action: 'Edited', byName: 'Bob', at: '2026-01-16T09:00:00.000Z' });
    expect(r.value.state.laptops[id]).toEqual(r.value.laptop);
  });

  it('keeps the same id and status', () => {
    const { state, id } = seed();
    const r = editLaptop(state, id, { brand: 'HP' }, ctx2());
    expect(r.ok && r.value.laptop).toMatchObject({ id, status: 'Available' });
  });

  it('clears an optional spec when given an empty string', () => {
    const { state, id } = seed();
    const r = editLaptop(state, id, { specs: { storage: '' } }, ctx2());
    expect(r.ok && r.value.laptop.specs).toEqual({ processor: 'i7', memory: '16GB' });
  });

  it('keeps serial number uniqueness but allows keeping its own', () => {
    const ids = makeCtx();
    const a = addLaptop(emptyState(), validLaptop, ids);
    if (!a.ok) throw new Error('seed failed');
    const b = addLaptop(a.value.state, { ...validLaptop, serialNumber: 'SN-2' }, ids);
    if (!b.ok) throw new Error('seed failed');
    const dup = editLaptop(b.value.state, b.value.laptop.id, { serialNumber: ' sn-1001' }, ctx2());
    expect(!dup.ok && dup.error.code).toBe('DuplicateSerialNumber');
    const same = editLaptop(b.value.state, b.value.laptop.id, { serialNumber: 'SN-2' }, ctx2());
    expect(same.ok).toBe(true);
  });

  it('rejects invalid values with the field name', () => {
    const { state, id } = seed();
    const r = editLaptop(state, id, { brand: '' }, ctx2());
    expect(!r.ok && r.error).toMatchObject({ code: 'ValidationError', field: 'brand' });
  });

  it('records nothing when nothing changed', () => {
    const { state, id } = seed();
    const r = editLaptop(state, id, { brand: 'Dell' }, ctx2());
    expect(r.ok && r.value.laptop.history).toHaveLength(1);
  });

  it('returns NotFound for an unknown id', () => {
    const r = editLaptop(emptyState(), 'nope', { brand: 'HP' }, ctx2());
    expect(!r.ok && r.error.code).toBe('NotFound');
  });

  it('does not modify the input state', () => {
    const { state, id } = seed();
    const before = JSON.stringify(state);
    editLaptop(state, id, { brand: 'HP' }, ctx2());
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('changeStatus', () => {
  const allowed: Array<[Status, Status]> = [
    ['Available', 'InRepair'],
    ['Available', 'Retired'],
    ['InRepair', 'Available'],
    ['InRepair', 'Retired'],
  ];
  it.each(allowed)('allows %s -> %s and records a StatusChanged entry', (from, to) => {
    const { state, id } = seedWithStatus(from);
    const r = changeStatus(state, id, to, ctx2());
    expect(r.ok && r.value.laptop.status).toBe(to);
    expect(r.ok && r.value.laptop.history.at(-1)).toMatchObject({ action: 'StatusChanged', byName: 'Bob' });
  });

  const refused: Array<[Status, Status]> = [
    ['Assigned', 'Available'],
    ['Assigned', 'InRepair'],
    ['Assigned', 'Retired'],
    ['Retired', 'Available'],
    ['Retired', 'InRepair'],
    ['Retired', 'Retired'],
    ['Available', 'Assigned'],
    ['InRepair', 'Assigned'],
    ['Available', 'Available'],
  ];
  it.each(refused)('refuses %s -> %s', (from, to) => {
    const { state, id } = seedWithStatus(from);
    const r = changeStatus(state, id, to, ctx2());
    expect(!r.ok && r.error.code).toBe('InvalidStatusTransition');
  });

  it('tells the manager to return an assigned laptop first', () => {
    const { state, id } = seedWithStatus('Assigned', [{ personName: 'Ada', assignedAt: 'x', returnedAt: null }]);
    const r = changeStatus(state, id, 'Retired', ctx2());
    expect(!r.ok && r.error.message).toMatch(/return/i);
  });

  it('rejects an unknown status value and an unknown laptop', () => {
    const { state, id } = seed();
    const bad = changeStatus(state, id, 'Broken' as Status, ctx2());
    expect(!bad.ok && bad.error).toMatchObject({ code: 'ValidationError', field: 'status' });
    const missing = changeStatus(state, 'nope', 'InRepair', ctx2());
    expect(!missing.ok && missing.error.code).toBe('NotFound');
  });
});

describe('deleteLaptop', () => {
  it('erases a never-assigned laptop together with its history and frees the serial number', () => {
    const { state, id } = seed();
    const r = deleteLaptop(state, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.laptops[id]).toBeUndefined();
    expect(addLaptop(r.value.state, validLaptop, makeCtx()).ok).toBe(true);
  });

  it('refuses when assignment history exists and suggests retiring', () => {
    const { state, id } = seedWithStatus('Available', [{ personName: 'Ada', assignedAt: 'a', returnedAt: 'b' }]);
    const r = deleteLaptop(state, id);
    expect(!r.ok && r.error.code).toBe('HasAssignmentHistory');
    expect(!r.ok && r.error.message).toMatch(/retir/i);
  });

  it('returns NotFound for an unknown id', () => {
    const r = deleteLaptop(emptyState(), 'nope');
    expect(!r.ok && r.error.code).toBe('NotFound');
  });
});
