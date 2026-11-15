import { changeRecord, notFound, putLaptop } from './laptops.ts';
import { err, ok } from './result.ts';
import type { Ctx, Laptop, Result, State } from './types.ts';
import { validatePersonName } from './validation.ts';

export function assignLaptop(
  state: State,
  id: string,
  personName: string,
  ctx: Ctx,
): Result<{ state: State; laptop: Laptop }> {
  const current = state.laptops[id];
  if (!current) return notFound(id);
  const name = validatePersonName(personName);
  if (!name.ok) return name;
  if (current.status !== 'Available') {
    return err('NotAvailable', `The laptop is ${current.status} and cannot be assigned`);
  }
  const laptop: Laptop = {
    ...current,
    status: 'Assigned',
    assignments: [...current.assignments, { personName: name.value, assignedAt: ctx.now, returnedAt: null }],
    history: [...current.history, changeRecord(ctx, 'Assigned', `assigned to ${name.value}`)],
  };
  return ok({ state: putLaptop(state, laptop), laptop });
}

export function returnLaptop(state: State, id: string, ctx: Ctx): Result<{ state: State; laptop: Laptop }> {
  const current = state.laptops[id];
  if (!current) return notFound(id);
  const open = current.assignments.find((a) => a.returnedAt === null);
  if (current.status !== 'Assigned' || !open) {
    return err('InvalidStatusTransition', 'The laptop is not assigned, so there is nothing to return');
  }
  const laptop: Laptop = {
    ...current,
    status: 'Available',
    assignments: current.assignments.map((a) => (a === open ? { ...a, returnedAt: ctx.now } : a)),
    history: [...current.history, changeRecord(ctx, 'Returned', `returned by ${open.personName}`)],
  };
  return ok({ state: putLaptop(state, laptop), laptop });
}
