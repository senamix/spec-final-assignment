import { describe, expect, it } from 'vitest';
import { addLaptop } from '../../src/laptops.ts';
import { listLaptops, statusCounts } from '../../src/query.ts';
import { emptyState } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

describe('search performance (SC-003)', () => {
  it('searches a 1,000-laptop inventory in well under a second', () => {
    const ctx = makeCtx();
    let state = emptyState();
    for (let i = 0; i < 1000; i++) {
      const r = addLaptop(state, { ...validLaptop, brand: i % 2 ? 'Dell' : 'Lenovo', serialNumber: `SN-${i}` }, ctx);
      if (!r.ok) throw new Error('seed failed');
      state = r.value.state;
    }
    const start = performance.now();
    const found = listLaptops(state, { text: 'sn-999' });
    const filtered = listLaptops(state, { text: 'dell', status: 'Available' });
    const counts = statusCounts(state);
    const elapsed = performance.now() - start;

    expect(found.map((l) => l.serialNumber)).toEqual(['SN-999']);
    expect(filtered).toHaveLength(500);
    expect(counts.total).toBe(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});
