import { describe, expect, it } from 'vitest';
import { chain, err, map, ok } from '../../src/result.ts';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('err wraps a domain error', () => {
    expect(err('NotFound', 'missing')).toEqual({ ok: false, error: { code: 'NotFound', message: 'missing' } });
  });

  it('err keeps the field name', () => {
    expect(err('ValidationError', 'bad', 'brand')).toEqual({
      ok: false,
      error: { code: 'ValidationError', message: 'bad', field: 'brand' },
    });
  });

  it('map transforms a success and passes through an error', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    const failure = err('NotFound', 'x');
    expect(map(failure, (n: number) => n * 2)).toBe(failure);
  });

  it('chain sequences results and stops at the first error', () => {
    expect(chain(ok(2), (n) => ok(n + 1))).toEqual(ok(3));
    const failure = err('NotFound', 'x');
    expect(chain(failure, () => ok(1))).toBe(failure);
    expect(chain(ok(2), () => failure)).toBe(failure);
  });
});
