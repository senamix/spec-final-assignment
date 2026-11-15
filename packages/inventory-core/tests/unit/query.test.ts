import { describe, expect, it } from 'vitest';
import { assignLaptop } from '../../src/assignments.ts';
import { addLaptop, changeStatus } from '../../src/laptops.ts';
import { listLaptops, statusCounts } from '../../src/query.ts';
import { emptyState, type State } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

function inventory(): State {
  const ctx = makeCtx();
  let state = emptyState();
  const add = (brand: string, model: string, serialNumber: string) => {
    const r = addLaptop(state, { ...validLaptop, brand, model, serialNumber }, ctx);
    if (!r.ok) throw new Error('seed failed');
    state = r.value.state;
    return r.value.laptop.id;
  };
  const dell = add('Dell', 'Latitude 7440', 'DL-001');
  const lenovo = add('Lenovo', 'ThinkPad T14', 'LN-002');
  const hp = add('HP', 'EliteBook', 'HP-003');
  add('Apple', 'MacBook Air', 'AP-004');

  const a = assignLaptop(state, dell, 'Ada Lovelace', ctx);
  if (!a.ok) throw new Error('seed failed');
  state = a.value.state;
  const r = changeStatus(state, lenovo, 'InRepair', ctx);
  if (!r.ok) throw new Error('seed failed');
  state = r.value.state;
  const x = changeStatus(state, hp, 'Retired', ctx);
  if (!x.ok) throw new Error('seed failed');
  return x.value.state;
}

const serials = (state: State, query: Parameters<typeof listLaptops>[1]) => listLaptops(state, query).map((l) => l.serialNumber);

describe('listLaptops filtering', () => {
  const state = inventory();

  it('matches text on brand, ignoring case', () => {
    expect(serials(state, { text: 'LENOVO' })).toEqual(['LN-002']);
  });

  it('matches text on model, serial number and current holder', () => {
    expect(serials(state, { text: 'macbook' })).toEqual(['AP-004']);
    expect(serials(state, { text: 'hp-003' })).toEqual(['HP-003']);
    expect(serials(state, { text: 'lovelace' })).toEqual(['DL-001']);
  });

  it('matches partial text and ignores surrounding spaces', () => {
    expect(serials(state, { text: '  thinkpad ' })).toEqual(['LN-002']);
  });

  it('does not search a former holder or other fields', () => {
    expect(serials(state, { text: 'i7' })).toEqual([]);
  });

  it('filters by status', () => {
    expect(serials(state, { status: 'Assigned' })).toEqual(['DL-001']);
    expect(serials(state, { status: 'InRepair' })).toEqual(['LN-002']);
    expect(serials(state, { status: 'Retired' })).toEqual(['HP-003']);
    expect(serials(state, { status: 'Available' })).toEqual(['AP-004']);
  });

  it('combines text and status with AND', () => {
    expect(serials(state, { text: 'dell', status: 'Assigned' })).toEqual(['DL-001']);
    expect(serials(state, { text: 'dell', status: 'Available' })).toEqual([]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(listLaptops(state, { text: 'no-such-thing' })).toEqual([]);
  });

  it('treats empty filters as no filter', () => {
    expect(listLaptops(state, { text: '', status: undefined })).toHaveLength(4);
    expect(listLaptops(state, {})).toHaveLength(4);
  });
});

describe('statusCounts', () => {
  it('counts every status and the total', () => {
    expect(statusCounts(inventory())).toEqual({ Available: 1, Assigned: 1, InRepair: 1, Retired: 1, total: 4 });
  });

  it('is all zeros for an empty inventory', () => {
    expect(statusCounts(emptyState())).toEqual({ Available: 0, Assigned: 0, InRepair: 0, Retired: 0, total: 0 });
  });

  it('always sums to the total', () => {
    const c = statusCounts(inventory());
    expect(c.Available + c.Assigned + c.InRepair + c.Retired).toBe(c.total);
  });
});
