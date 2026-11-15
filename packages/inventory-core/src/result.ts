import type { ErrorCode, Result } from './types.ts';

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (code: ErrorCode, message: string, field?: string): Result<never> => ({
  ok: false,
  error: field === undefined ? { code, message } : { code, message, field },
});

export const map = <T, U>(r: Result<T>, f: (value: T) => U): Result<U> => (r.ok ? ok(f(r.value)) : r);

export const chain = <T, U>(r: Result<T>, f: (value: T) => Result<U>): Result<U> => (r.ok ? f(r.value) : r);
