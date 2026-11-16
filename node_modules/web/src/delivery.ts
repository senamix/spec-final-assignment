import { nextDueDeliveries, ok, recordDeliveryResult } from 'inventory-core';
import { alertMessage, type Mailer } from './mailer.ts';
import type { Store } from './store.ts';

export interface DeliveryRunner {
  /** Sends everything that is due now; never rejects. Concurrent calls share one pass. */
  run(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

export function createDeliveryRunner(deps: { store: Store; mailer: Mailer; now: () => Date }): DeliveryRunner {
  const { store, mailer, now } = deps;
  let current: Promise<void> | undefined;
  let rerun = false;
  let timer: NodeJS.Timeout | undefined;

  async function pass(): Promise<void> {
    const due = nextDueDeliveries(store.read(), now().toISOString());
    for (const item of due) {
      const alert = store.read().alerts[item.alertId];
      if (!alert) continue;
      let outcome: { ok: true } | { ok: false; error: string };
      try {
        await mailer.send(alertMessage(alert, item.email));
        outcome = { ok: true };
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : 'Email delivery failed' };
      }
      const at = now().toISOString();
      await store.update((state) => ok({ state: recordDeliveryResult(state, item.alertId, item.accountId, outcome, { now: at }) }));
    }
  }

  const loop = async (): Promise<void> => {
    do {
      rerun = false;
      await pass().catch(() => undefined);
    } while (rerun);
    current = undefined;
  };

  // A call made while a pass is running asks for another pass, so newly raised alerts are not missed.
  const run = (): Promise<void> => {
    if (current) {
      rerun = true;
      return current;
    }
    current = loop();
    return current;
  };

  return {
    run,
    start(intervalMs) {
      if (intervalMs <= 0 || timer) return;
      timer = setInterval(() => void run(), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
