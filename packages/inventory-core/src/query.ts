import { toView } from './laptops.ts';
import type { LaptopView, State, Status } from './types.ts';

export interface LaptopQuery {
  readonly text?: string;
  readonly status?: Status;
}

export type StatusCounts = Record<Status, number> & { total: number };

export const STATUSES: readonly Status[] = ['Available', 'Assigned', 'InRepair', 'Retired'];

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

const matchesText = (laptop: LaptopView, text: string): boolean =>
  [laptop.brand, laptop.model, laptop.serialNumber, laptop.currentHolder ?? ''].some((v) => v.toLowerCase().includes(text));

export function listLaptops(state: State, query: LaptopQuery = {}): LaptopView[] {
  const text = (query.text ?? '').trim().toLowerCase();
  return Object.values(state.laptops)
    .map(toView)
    .filter((l) => (text === '' || matchesText(l, text)) && (query.status === undefined || l.status === query.status))
    .sort((a, b) => byText(a.brand, b.brand) || byText(a.model, b.model) || byText(a.serialNumber, b.serialNumber));
}

export function statusCounts(state: State): StatusCounts {
  const counts: StatusCounts = { Available: 0, Assigned: 0, InRepair: 0, Retired: 0, total: 0 };
  for (const laptop of Object.values(state.laptops)) {
    counts[laptop.status] += 1;
    counts.total += 1;
  }
  return counts;
}
