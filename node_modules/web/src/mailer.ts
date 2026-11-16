import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import nodemailer from 'nodemailer';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Port for sending email; the only place SMTP is touched. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function alertMessage(
  alert: { readonly raisedAt: string; readonly availableCount: number; readonly level: number },
  to: string,
): MailMessage {
  return {
    to,
    subject: `Low laptop inventory: ${alert.availableCount} available`,
    text: [
      'Laptop inventory is low.',
      `Time: ${alert.raisedAt}`,
      `Available laptops: ${alert.availableCount}`,
      `Low-inventory level: ${alert.level}`,
    ].join('\n'),
  };
}

/** Local fallback used when no SMTP server is configured: one JSON line per message. */
export function createOutboxMailer(file: string): Mailer {
  return {
    async send(message) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(message)}\n`, 'utf8');
    },
  };
}

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv, outboxFile: string): Mailer {
  const url = env.SMTP_URL;
  return url ? createSmtpMailer(url, env.MAIL_FROM ?? 'inventory@localhost') : createOutboxMailer(outboxFile);
}
