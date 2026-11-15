import { err, ok } from './result.ts';
import type { Account, Ctx, Hasher, Result, State } from './types.ts';

export interface AccountInput {
  readonly username: string;
  readonly displayName: string;
  readonly password: string;
}

const lower = (s: string) => s.trim().toLowerCase();
const findByUsername = (state: State, username: string): Account | undefined =>
  Object.values(state.accounts).find((a) => lower(a.username) === lower(username));

export const hasAccounts = (state: State): boolean => Object.keys(state.accounts).length > 0;

export function createAccount(
  state: State,
  input: AccountInput,
  hasher: Hasher,
  ctx: Pick<Ctx, 'newId'>,
): Result<{ state: State; account: Account }> {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (username.length < 3 || username.length > 50) {
    return err('ValidationError', 'username must be 3 to 50 characters', 'username');
  }
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName.length < 1 || displayName.length > 100) {
    return err('ValidationError', 'display name must be 1 to 100 characters', 'displayName');
  }
  if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200) {
    return err('ValidationError', 'password must be 8 to 200 characters', 'password');
  }
  if (findByUsername(state, username)) {
    return err('DuplicateUsername', `username ${username} is already in use`, 'username');
  }
  const account: Account = { id: ctx.newId(), username, displayName, passwordHash: hasher.hash(input.password) };
  return ok({ state: { ...state, accounts: { ...state.accounts, [account.id]: account } }, account });
}

export function verifyCredentials(
  state: State,
  username: string,
  password: string,
  hasher: Hasher,
): Result<Account> {
  const account = findByUsername(state, String(username));
  if (!account) {
    // Do comparable hashing work so response time does not reveal whether a username exists.
    hasher.hash(String(password));
    return err('InvalidCredentials', 'Invalid username or password');
  }
  if (!hasher.verify(String(password), account.passwordHash)) {
    return err('InvalidCredentials', 'Invalid username or password');
  }
  return ok(account);
}
