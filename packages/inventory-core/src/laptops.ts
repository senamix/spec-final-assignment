import { err, ok } from './result.ts';
import type { ChangeAction, ChangeRecord, Ctx, Laptop, LaptopView, Result, State, Status } from './types.ts';
import { normalizeSerial, validateLaptopInput } from './validation.ts';

export const toView = (laptop: Laptop): LaptopView => ({
  ...laptop,
  currentHolder: laptop.assignments.find((a) => a.returnedAt === null)?.personName ?? null,
});

export const changeRecord = (ctx: Ctx, action: ChangeAction, detail: string): ChangeRecord => ({
  at: ctx.now,
  byAccountId: ctx.actor.id,
  byName: ctx.actor.name,
  action,
  detail,
});

export const findBySerial = (state: State, serialNumber: string, exceptId?: string): Laptop | undefined =>
  Object.values(state.laptops).find(
    (l) => l.id !== exceptId && normalizeSerial(l.serialNumber) === normalizeSerial(serialNumber),
  );

export const duplicateSerial = (serialNumber: string) =>
  err('DuplicateSerialNumber', `Serial number ${serialNumber} is already in use`, 'serialNumber');

export const notFound = (id: string) => err('NotFound', `Laptop ${id} was not found`);

export const putLaptop = (state: State, laptop: Laptop): State => ({
  ...state,
  laptops: { ...state.laptops, [laptop.id]: laptop },
});

export function addLaptop(
  state: State,
  input: Record<string, unknown>,
  ctx: Ctx,
): Result<{ state: State; laptop: Laptop }> {
  const fields = validateLaptopInput(input, ctx.now);
  if (!fields.ok) return fields;
  if (findBySerial(state, fields.value.serialNumber)) return duplicateSerial(fields.value.serialNumber);
  const laptop: Laptop = {
    id: ctx.newId(),
    ...fields.value,
    status: 'Available',
    assignments: [],
    history: [changeRecord(ctx, 'Created', 'laptop added')],
  };
  return ok({ state: putLaptop(state, laptop), laptop });
}

export function getLaptop(state: State, id: string): Result<LaptopView> {
  const laptop = state.laptops[id];
  return laptop ? ok(toView(laptop)) : notFound(id);
}

const EDITABLE = ['brand', 'model', 'serialNumber', 'purchaseDate'] as const;

export function editLaptop(
  state: State,
  id: string,
  changes: Record<string, unknown>,
  ctx: Ctx,
): Result<{ state: State; laptop: Laptop }> {
  const current = state.laptops[id];
  if (!current) return notFound(id);
  const changesSpecs = changes.specs && typeof changes.specs === 'object' ? changes.specs : undefined;
  const merged = {
    brand: changes.brand ?? current.brand,
    model: changes.model ?? current.model,
    serialNumber: changes.serialNumber ?? current.serialNumber,
    purchaseDate: changes.purchaseDate ?? current.purchaseDate,
    specs: changesSpecs ? { ...current.specs, ...changesSpecs } : current.specs,
  };
  // An unchanged purchase date is not re-checked against today's date, so old laptops stay editable.
  const fields = validateLaptopInput(
    { ...merged, purchaseDate: merged.purchaseDate === current.purchaseDate ? ctx.now.slice(0, 10) : merged.purchaseDate },
    ctx.now,
  );
  if (!fields.ok) return fields;
  const next = { ...fields.value, purchaseDate: merged.purchaseDate === current.purchaseDate ? current.purchaseDate : fields.value.purchaseDate };
  if (findBySerial(state, next.serialNumber, id)) return duplicateSerial(next.serialNumber);

  const changed = [
    ...EDITABLE.filter((key) => next[key] !== current[key]),
    ...(JSON.stringify(next.specs) !== JSON.stringify(current.specs) ? ['specs'] : []),
  ];
  if (changed.length === 0) return ok({ state, laptop: current });
  const laptop: Laptop = {
    ...current,
    ...next,
    history: [...current.history, changeRecord(ctx, 'Edited', `changed ${changed.join(', ')}`)],
  };
  return ok({ state: putLaptop(state, laptop), laptop });
}

const STATUS_TARGETS: readonly Status[] = ['Available', 'InRepair', 'Retired'];

export function changeStatus(
  state: State,
  id: string,
  target: Status,
  ctx: Ctx,
): Result<{ state: State; laptop: Laptop }> {
  const current = state.laptops[id];
  if (!current) return notFound(id);
  if (target === 'Assigned') return err('InvalidStatusTransition', 'Use assign to give a laptop to someone');
  if (!STATUS_TARGETS.includes(target)) {
    return err('ValidationError', 'status must be Available, InRepair or Retired', 'status');
  }
  const refuse = (message: string) => err('InvalidStatusTransition', message);
  if (current.status === 'Retired') return refuse('A retired laptop cannot change status');
  if (current.status === 'Assigned') return refuse('Return the laptop before changing its status');
  if (current.status === target) return refuse(`The laptop is already ${target}`);
  const laptop: Laptop = {
    ...current,
    status: target,
    history: [...current.history, changeRecord(ctx, 'StatusChanged', `status: ${current.status} -> ${target}`)],
  };
  return ok({ state: putLaptop(state, laptop), laptop });
}

export function deleteLaptop(state: State, id: string): Result<{ state: State }> {
  const current = state.laptops[id];
  if (!current) return notFound(id);
  if (current.assignments.length > 0) {
    return err('HasAssignmentHistory', 'This laptop has assignment history and cannot be deleted. Retire it instead.');
  }
  const { [id]: _removed, ...rest } = state.laptops;
  return ok({ state: { ...state, laptops: rest } });
}
