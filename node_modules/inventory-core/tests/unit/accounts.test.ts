import { describe, expect, it } from 'vitest';
import { createAccount, hasAccounts, verifyCredentials } from '../../src/accounts.ts';
import { emptyState } from '../../src/types.ts';
import { fakeHasher, makeCtx } from '../helpers.ts';

const input = { username: 'alice', displayName: 'Alice A', password: 'correct horse', email: 'alice@example.com' };

describe('accounts', () => {
  it('starts with no accounts', () => {
    expect(hasAccounts(emptyState())).toBe(false);
  });

  it('creates an account without storing the plain password', () => {
    const r = createAccount(emptyState(), input, fakeHasher, makeCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hasAccounts(r.value.state)).toBe(true);
    expect(r.value.account.passwordHash).toBe('hashed:correct horse');
    expect(JSON.stringify(r.value.state)).not.toContain('"correct horse"');
  });

  it('does not modify the input state', () => {
    const state = emptyState();
    createAccount(state, input, fakeHasher, makeCtx());
    expect(hasAccounts(state)).toBe(false);
  });

  it('rejects usernames shorter than 3 or longer than 50 characters', () => {
    const run = (username: string) => createAccount(emptyState(), { ...input, username }, fakeHasher, makeCtx());
    expect(run('ab').ok).toBe(false);
    expect(run('abc').ok).toBe(true);
    expect(run('a'.repeat(50)).ok).toBe(true);
    const r = run('a'.repeat(51));
    expect(!r.ok && r.error.field).toBe('username');
  });

  it('requires a display name of 1 to 100 characters', () => {
    const run = (displayName: string) => createAccount(emptyState(), { ...input, displayName }, fakeHasher, makeCtx());
    expect(run('  ').ok).toBe(false);
    expect(run('a'.repeat(100)).ok).toBe(true);
    expect(run('a'.repeat(101)).ok).toBe(false);
  });

  it('requires a password of at least 8 characters', () => {
    const r = createAccount(emptyState(), { ...input, password: 'short' }, fakeHasher, makeCtx());
    expect(!r.ok && r.error.field).toBe('password');
  });

  it('rejects a duplicate username ignoring case', () => {
    const first = createAccount(emptyState(), input, fakeHasher, makeCtx());
    if (!first.ok) throw new Error('setup failed');
    const second = createAccount(first.value.state, { ...input, username: 'ALICE' }, fakeHasher, makeCtx());
    expect(!second.ok && second.error.code).toBe('DuplicateUsername');
  });

  it('verifies correct credentials ignoring username case', () => {
    const created = createAccount(emptyState(), input, fakeHasher, makeCtx());
    if (!created.ok) throw new Error('setup failed');
    const r = verifyCredentials(created.value.state, 'Alice', 'correct horse', fakeHasher);
    expect(r.ok && r.value.id).toBe(created.value.account.id);
  });

  it('rejects a wrong password and an unknown user with the same error', () => {
    const created = createAccount(emptyState(), input, fakeHasher, makeCtx());
    if (!created.ok) throw new Error('setup failed');
    const wrong = verifyCredentials(created.value.state, 'alice', 'nope nope', fakeHasher);
    const unknown = verifyCredentials(created.value.state, 'bob', 'correct horse', fakeHasher);
    expect(!wrong.ok && wrong.error.code).toBe('InvalidCredentials');
    expect(!unknown.ok && unknown.error).toEqual(!wrong.ok && wrong.error);
  });
});
