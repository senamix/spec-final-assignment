import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccount, emptyState, err, type Hasher } from 'inventory-core';
import { createStore } from '../../src/store.ts';

const hasher: Hasher = { hash: (p) => `h:${p}`, verify: (p, h) => h === `h:${p}` };
const addAccount = (name: string) => (s: ReturnType<typeof emptyState>) =>
  createAccount(s, { username: name, displayName: name, password: 'password-123' }, hasher, { newId: () => name });
const tmp = () => mkdtempSync(join(tmpdir(), 'inv-store-'));

describe('file store', () => {
  it('starts empty when no file exists', async () => {
    const store = await createStore(join(tmp(), 'data.json'));
    expect(store.read()).toEqual(emptyState());
  });

  it('persists an update and reloads it after restart', async () => {
    const file = join(tmp(), 'data.json');
    const store = await createStore(file);
    const r = await store.update(addAccount('alice'));
    expect(r.ok).toBe(true);
    const reloaded = await createStore(file);
    expect(Object.keys(reloaded.read().accounts)).toEqual(['alice']);
  });

  it('applies simultaneous updates without losing any', async () => {
    const store = await createStore(join(tmp(), 'data.json'));
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(addAccount(`user-${i}`))));
    expect(Object.keys(store.read().accounts)).toHaveLength(20);
  });

  it('does not write or change state when the update fails', async () => {
    const dir = tmp();
    const file = join(dir, 'data.json');
    const store = await createStore(file);
    const r = await store.update(() => err('NotFound', 'nope'));
    expect(r.ok).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(store.read()).toEqual(emptyState());
  });

  it('writes atomically and leaves no temp file behind', async () => {
    const dir = tmp();
    const file = join(dir, 'data.json');
    const store = await createStore(file);
    await store.update(addAccount('alice'));
    expect(readdirSync(dir)).toEqual(['data.json']);
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });
});
