import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertMessage, createOutboxMailer } from '../../src/mailer.ts';

const alert = { raisedAt: '2026-01-15T10:00:00.000Z', availableCount: 3, level: 5 };

describe('alertMessage', () => {
  it('states the time, available count and level in the subject and body', () => {
    const m = alertMessage(alert, 'amy@example.com');
    expect(m.to).toBe('amy@example.com');
    expect(m.subject).toBe('Low laptop inventory: 3 available');
    expect(m.text).toContain('2026-01-15T10:00:00.000Z');
    expect(m.text).toContain('3');
    expect(m.text).toContain('5');
  });

  it('contains nothing sensitive', () => {
    const m = alertMessage(alert, 'amy@example.com');
    expect(m.text).not.toMatch(/password|session|sid=|hash/i);
  });
});

describe('outbox mailer', () => {
  it('appends one JSON line per message', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'inv-mail-')), 'outbox.jsonl');
    const mailer = createOutboxMailer(file);
    await mailer.send(alertMessage(alert, 'a@example.com'));
    await mailer.send(alertMessage(alert, 'b@example.com'));
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(lines[0].subject).toBe('Low laptop inventory: 3 available');
  });
});
