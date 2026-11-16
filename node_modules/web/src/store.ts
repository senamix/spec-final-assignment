import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyState, type Result, type State } from 'inventory-core';

export interface Store {
  read(): State;
  /** Applies a pure update; persists and commits it only if it succeeds. Updates run one at a time. */
  update<T extends { state: State }>(fn: (state: State) => Result<T>): Promise<Result<T>>;
}

async function load(file: string): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<State>;
    const defaults = emptyState();
    return {
      laptops: parsed.laptops ?? {},
      accounts: parsed.accounts ?? {},
      alerts: parsed.alerts ?? defaults.alerts,
      settings: parsed.settings ?? defaults.settings,
      lowPeriodActive: parsed.lowPeriodActive ?? defaults.lowPeriodActive,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw e;
  }
}

async function persist(file: string, state: State): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, file);
}

export async function createStore(file: string): Promise<Store> {
  let state = await load(file);
  let queue: Promise<unknown> = Promise.resolve();

  return {
    read: () => state,
    update<T extends { state: State }>(fn: (s: State) => Result<T>): Promise<Result<T>> {
      const run = async (): Promise<Result<T>> => {
        const result = fn(state);
        if (!result.ok) return result;
        await persist(file, result.value.state);
        state = result.value.state;
        return result;
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
