import { appendFile } from 'node:fs/promises';
import type { Delivery } from 'inventory-core';

export interface Notifier {
  /** Sends one external delivery; rejects when it could not be delivered. */
  send(delivery: Delivery, origin: string): Promise<void>;
}

export const alertText = (d: Delivery, origin: string): string => {
  const m = d.message;
  const heading = m.outOfStock ? 'OUT OF STOCK' : 'Low stock';
  return [
    `${m.escalation ? '[ESCALATED] ' : ''}${heading}: ${m.sku} (${m.warehouse})`,
    `Available: ${m.available}, threshold: ${m.threshold}, suggested reorder: ${m.suggestedReorder}`,
    `${origin}${m.link}`,
  ].join('\n');
};

const allowedHost = (channel: 'slack' | 'teams', url: URL): boolean =>
  url.protocol === 'https:' &&
  (channel === 'slack'
    ? url.hostname === 'hooks.slack.com'
    : url.hostname.endsWith('.webhook.office.com') || url.hostname === 'outlook.office.com');

async function postWebhook(channel: 'slack' | 'teams', address: string, text: string): Promise<void> {
  const url = new URL(address);
  if (!allowedHost(channel, url)) throw new Error(`${channel} webhook host is not allowed`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${channel} webhook responded ${res.status}`);
}

/**
 * Slack and Teams use their incoming webhooks. Email and SMS need a provider account, so they are written
 * to a JSON-lines outbox file until a real transport is plugged in through the Notifier interface.
 */
export function createDefaultNotifier(outboxFile: string): Notifier {
  return {
    async send(delivery, origin) {
      const text = alertText(delivery, origin);
      if (delivery.channel === 'slack' || delivery.channel === 'teams') {
        return postWebhook(delivery.channel, delivery.address, text);
      }
      const line = JSON.stringify({ channel: delivery.channel, to: delivery.address, body: text });
      await appendFile(outboxFile, `${line}\n`, 'utf8');
    },
  };
}
