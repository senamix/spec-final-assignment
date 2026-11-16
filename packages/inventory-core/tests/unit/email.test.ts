import { describe, expect, it } from 'vitest';
import { createAccount, setEmail } from '../../src/accounts.ts';
import { validateEmail } from '../../src/validation.ts';
import { emptyState } from '../../src/types.ts';
import { fakeHasher, makeCtx } from '../helpers.ts';

const input = { username: 'alice', displayName: 'Alice A', password: 'correct horse', email: 'alice@example.com' };

describe('validateEmail', () => {
  it('accepts and trims a normal address', () => {
    expect(validateEmail('  bob@example.com ')).toEqual({ ok: true, value: 'bob@example.com' });
  });

  it.each(['', '   ', 'bob', 'bob@', '@example.com', 'bob@example', 'a@@b.com', 'a@b@c.com', 'bo b@example.com', 42, undefined])(
    'rejects %j',
    (value) => {
      const r = validateEmail(value);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe('email');
    },
  );

  it('rejects addresses longer than 254 characters', () => {
    const long = `${'a'.repeat(250)}@x.co`;
    expect(validateEmail(long).ok).toBe(false);
    const okLen = `${'a'.repeat(240)}@x.co`;
    expect(validateEmail(okLen).ok).toBe(true);
  });
});

describe('createAccount email', () => {
  it('stores the trimmed email', () => {
    const r = createAccount(emptyState(), { ...input, email: ' alice@example.com ' }, fakeHasher, makeCtx());
    expect(r.ok && r.value.account.email).toBe('alice@example.com');
  });

  it('rejects a missing or invalid email on field email', () => {
    for (const email of [undefined, '', 'nope']) {
      const r = createAccount(emptyState(), { ...input, email: email as string }, fakeHasher, makeCtx());
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ValidationError');
        expect(r.error.field).toBe('email');
      }
    }
  });
});

describe('setEmail', () => {
  const created = () => {
    const r = createAccount(emptyState(), input, fakeHasher, makeCtx());
    if (!r.ok) throw new Error('setup');
    return r.value;
  };

  it('changes the address without mutating the input state', () => {
    const { state, account } = created();
    const r = setEmail(state, account.id, 'new@example.com');
    expect(r.ok && r.value.account.email).toBe('new@example.com');
    expect(r.ok && r.value.state.accounts[account.id]?.email).toBe('new@example.com');
    expect(state.accounts[account.id]?.email).toBe('alice@example.com');
  });

  it('rejects an invalid address and an unknown account', () => {
    const { state, account } = created();
    const bad = setEmail(state, account.id, 'nope');
    expect(!bad.ok && bad.error.field).toBe('email');
    const missing = setEmail(state, 'nobody', 'a@b.co');
    expect(!missing.ok && missing.error.code).toBe('NotFound');
  });
});
