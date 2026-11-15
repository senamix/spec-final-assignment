import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Hasher } from 'inventory-core';

const KEY_LENGTH = 64;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

export const scryptHasher: Hasher = { hash: hashPassword, verify: verifyPassword };

export interface SessionStore {
  create(accountId: string): string;
  get(token: string | undefined): string | undefined;
  destroy(token: string | undefined): void;
}

export function createSessionStore(options: { now?: () => number; ttlMs?: number } = {}): SessionStore {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? SESSION_TTL_MS;
  const sessions = new Map<string, { accountId: string; expiresAt: number }>();
  return {
    create(accountId) {
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { accountId, expiresAt: now() + ttl });
      return token;
    },
    get(token) {
      if (!token) return undefined;
      const session = sessions.get(token);
      if (!session) return undefined;
      if (now() >= session.expiresAt) {
        sessions.delete(token);
        return undefined;
      }
      return session.accountId;
    },
    destroy(token) {
      if (token) sessions.delete(token);
    },
  };
}

export interface RateLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  reset(key: string): void;
}

export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const k = key.trim().toLowerCase();
    const live = (failures.get(k) ?? []).filter((t) => now() - t < options.windowMs);
    if (live.length > 0) failures.set(k, live);
    else failures.delete(k);
    return live;
  };
  const norm = (key: string) => key.trim().toLowerCase();
  return {
    isBlocked: (key) => recent(key).length >= options.max,
    recordFailure(key) {
      failures.set(norm(key), [...recent(key), now()]);
    },
    reset(key) {
      failures.delete(norm(key));
    },
  };
}
