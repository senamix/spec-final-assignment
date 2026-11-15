import { describe, expect, it } from 'vitest';
import { createRateLimiter, createSessionStore, hashPassword, scryptHasher, verifyPassword } from '../../src/auth.ts';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('wrong horse', stored)).toBe(false);
  });

  it('uses a random salt and never contains the plain password', () => {
    const a = hashPassword('correct horse');
    const b = hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });

  it('exposes the hasher interface used by the core library', () => {
    expect(scryptHasher.verify('pw-12345', scryptHasher.hash('pw-12345'))).toBe(true);
  });
});

describe('session store', () => {
  it('creates a random token that resolves to the account', () => {
    const store = createSessionStore({ now: () => 0 });
    const token = store.create('acc-1');
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(store.get(token)).toBe('acc-1');
    expect(store.create('acc-1')).not.toBe(token);
  });

  it('expires sessions after 8 hours', () => {
    let t = 0;
    const store = createSessionStore({ now: () => t });
    const token = store.create('acc-1');
    t = 8 * 60 * 60 * 1000 - 1;
    expect(store.get(token)).toBe('acc-1');
    t = 8 * 60 * 60 * 1000;
    expect(store.get(token)).toBeUndefined();
  });

  it('destroys a session', () => {
    const store = createSessionStore({ now: () => 0 });
    const token = store.create('acc-1');
    store.destroy(token);
    expect(store.get(token)).toBeUndefined();
    expect(store.get('unknown')).toBeUndefined();
  });
});

describe('login rate limiter', () => {
  it('blocks a username after 5 failures and unblocks after the window', () => {
    let t = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000, now: () => t });
    for (let i = 0; i < 5; i++) {
      expect(limiter.isBlocked('alice')).toBe(false);
      limiter.recordFailure('alice');
    }
    expect(limiter.isBlocked('alice')).toBe(true);
    expect(limiter.isBlocked('bob')).toBe(false);
    t = 15 * 60 * 1000;
    expect(limiter.isBlocked('alice')).toBe(false);
  });

  it('resets the count on success', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => 0 });
    limiter.recordFailure('a');
    limiter.reset('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('treats usernames case-insensitively', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    limiter.recordFailure('Alice');
    expect(limiter.isBlocked('alice')).toBe(true);
  });
});
