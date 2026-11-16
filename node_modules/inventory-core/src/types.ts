import { emptyLowStock, type LowStockState } from './lowstock-types.ts';

export type Status = 'Available' | 'Assigned' | 'InRepair' | 'Retired';

export interface Specs {
  readonly processor?: string;
  readonly memory?: string;
  readonly storage?: string;
}

export interface Assignment {
  readonly personName: string;
  readonly assignedAt: string;
  readonly returnedAt: string | null;
}

export type ChangeAction = 'Created' | 'Edited' | 'StatusChanged' | 'Assigned' | 'Returned';

export interface ChangeRecord {
  readonly at: string;
  readonly byAccountId: string;
  readonly byName: string;
  readonly action: ChangeAction;
  readonly detail: string;
}

export interface Laptop {
  readonly id: string;
  readonly brand: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly purchaseDate: string;
  readonly specs: Specs;
  readonly warehouse?: string;
  readonly reserved?: boolean;
  readonly defective?: boolean;
  readonly status: Status;
  readonly assignments: readonly Assignment[];
  readonly history: readonly ChangeRecord[];
}

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
}

export interface State {
  readonly laptops: Readonly<Record<string, Laptop>>;
  readonly accounts: Readonly<Record<string, Account>>;
  readonly lowStock: LowStockState;
}

export interface Actor {
  readonly id: string;
  readonly name: string;
}

/** Everything impure is supplied by the caller: who acts, the current time, and new ids. */
export interface Ctx {
  readonly actor: Actor;
  readonly now: string;
  readonly newId: () => string;
}

export interface Hasher {
  hash(password: string): string;
  verify(password: string, storedHash: string): boolean;
}

export type ErrorCode =
  | 'ValidationError'
  | 'DuplicateSerialNumber'
  | 'DuplicateUsername'
  | 'NotFound'
  | 'InvalidStatusTransition'
  | 'NotAvailable'
  | 'HasAssignmentHistory'
  | 'Unauthenticated'
  | 'InvalidCredentials'
  | 'SetupComplete';

export interface DomainError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DomainError };

export const emptyState = (): State => ({ laptops: {}, accounts: {}, lowStock: emptyLowStock() });

export type LaptopView = Laptop & { readonly currentHolder: string | null };
