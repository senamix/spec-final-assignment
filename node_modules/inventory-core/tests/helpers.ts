import type { Ctx, Hasher } from '../src/types.ts';

export function makeCtx(now = '2026-01-15T10:00:00.000Z', actor = { id: 'acc-1', name: 'Alice' }): Ctx {
  let n = 0;
  return { actor, now, newId: () => `id-${++n}` };
}

export const fakeHasher: Hasher = {
  hash: (password) => `hashed:${password}`,
  verify: (password, hash) => hash === `hashed:${password}`,
};

export const validLaptop = {
  brand: 'Dell',
  model: 'Latitude 7440',
  serialNumber: 'SN-1001',
  purchaseDate: '2025-06-01',
  specs: { processor: 'i7', memory: '16GB', storage: '512GB' },
};
