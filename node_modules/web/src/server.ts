import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acknowledgeAlert,
  addLaptop,
  assignLaptop,
  changeStatus,
  createAccount,
  deleteLaptop,
  editLaptop,
  err,
  evaluate,
  getLaptop,
  hasAccounts,
  listLaptops,
  lowStockFrequency,
  ok,
  queryHistory,
  recordDelivery,
  removeThreshold,
  returnLaptop,
  setAlertConfig,
  setRecipientSettings,
  setThreshold,
  snoozeAlert,
  statusCounts,
  stockLevels,
  STATUSES,
  toView,
  verifyCredentials,
  type Account,
  type Ctx,
  type Delivery,
  type DomainError,
  type ErrorCode,
  type Status,
} from 'inventory-core';
import { createRateLimiter, createSessionStore, scryptHasher, type RateLimiter } from './auth.ts';
import { createDefaultNotifier, type Notifier } from './notifier.ts';
import { createStore, type Store } from './store.ts';

export interface ServerOptions {
  dataFile: string;
  port?: number;
  now?: () => Date;
  notifier?: Notifier;
  /** How often stock is re-checked for escalation and snooze expiry. Defaults to 30 seconds. */
  sweepIntervalMs?: number;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface RouteContext {
  body: any;
  params: Record<string, string>;
  query: URLSearchParams;
  account: Account | undefined;
  store: Store;
  coreCtx(): Ctx;
  startSession(account: Account): Reply['headers'];
  endSession(): Reply['headers'];
  limiter: RateLimiter;
}

type Handler = (c: RouteContext) => Promise<Reply> | Reply;

interface Route {
  method: string;
  pattern: RegExp;
  isPublic?: boolean;
  handler: Handler;
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  ValidationError: 400,
  Unauthenticated: 401,
  InvalidCredentials: 401,
  NotFound: 404,
  DuplicateSerialNumber: 409,
  DuplicateUsername: 409,
  NotAvailable: 409,
  InvalidStatusTransition: 409,
  HasAssignmentHistory: 409,
  SetupComplete: 409,
};

const errorReply = (error: DomainError): Reply => ({
  status: STATUS_BY_CODE[error.code],
  body: { error },
});

const rawError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message } },
});

const publicAccount = (a: Account) => ({ id: a.id, username: a.username, displayName: a.displayName });

const MAX_BODY_BYTES = 100_000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/setup$/,
    isPublic: true,
    handler: (c) => ({ status: 200, body: { needsSetup: !hasAccounts(c.store.read()) } }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/setup$/,
    isPublic: true,
    async handler(c) {
      const result = await c.store.update((state) =>
        hasAccounts(state)
          ? err('SetupComplete', 'Setup has already been completed')
          : createAccount(state, c.body ?? {}, scryptHasher, c.coreCtx()),
      );
      if (!result.ok) return errorReply(result.error);
      return { status: 201, body: publicAccount(result.value.account), headers: c.startSession(result.value.account) };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/login$/,
    isPublic: true,
    handler(c) {
      const username = String(c.body?.username ?? '');
      if (c.limiter.isBlocked(username)) {
        return rawError(429, 'TooManyAttempts', 'Too many failed sign-in attempts. Try again later.');
      }
      const result = verifyCredentials(c.store.read(), username, String(c.body?.password ?? ''), scryptHasher);
      if (!result.ok) {
        c.limiter.recordFailure(username);
        return errorReply(result.error);
      }
      c.limiter.reset(username);
      return { status: 200, body: { displayName: result.value.displayName }, headers: c.startSession(result.value) };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/logout$/,
    handler: (c) => ({ status: 204, headers: c.endSession() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/me$/,
    handler: (c) => ({ status: 200, body: publicAccount(c.account!) }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/accounts$/,
    async handler(c) {
      const result = await c.store.update((state) => createAccount(state, c.body ?? {}, scryptHasher, c.coreCtx()));
      return result.ok ? { status: 201, body: publicAccount(result.value.account) } : errorReply(result.error);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/laptops$/,
    handler(c) {
      const status = c.query.get('status') || undefined;
      if (status !== undefined && !STATUSES.includes(status as Status)) {
        return errorReply({ code: 'ValidationError', message: `status must be one of ${STATUSES.join(', ')}`, field: 'status' });
      }
      const text = c.query.get('q') ?? undefined;
      return { status: 200, body: listLaptops(c.store.read(), { text, status: status as Status | undefined }) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/summary$/,
    handler: (c) => ({ status: 200, body: statusCounts(c.store.read()) }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/laptops$/,
    async handler(c) {
      const result = await c.store.update((state) => addLaptop(state, c.body ?? {}, c.coreCtx()));
      return result.ok ? { status: 201, body: result.value.laptop } : errorReply(result.error);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)$/,
    handler(c) {
      const result = getLaptop(c.store.read(), c.params.id!);
      return result.ok ? { status: 200, body: result.value } : errorReply(result.error);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)$/,
    async handler(c) {
      const result = await c.store.update((state) => editLaptop(state, c.params.id!, c.body ?? {}, c.coreCtx()));
      return result.ok ? { status: 200, body: toView(result.value.laptop) } : errorReply(result.error);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)\/status$/,
    async handler(c) {
      const result = await c.store.update((state) => changeStatus(state, c.params.id!, c.body?.status, c.coreCtx()));
      return result.ok ? { status: 200, body: toView(result.value.laptop) } : errorReply(result.error);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)\/assign$/,
    async handler(c) {
      const result = await c.store.update((state) => assignLaptop(state, c.params.id!, c.body?.personName, c.coreCtx()));
      return result.ok ? { status: 200, body: toView(result.value.laptop) } : errorReply(result.error);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)\/return$/,
    async handler(c) {
      const result = await c.store.update((state) => returnLaptop(state, c.params.id!, c.coreCtx()));
      return result.ok ? { status: 200, body: toView(result.value.laptop) } : errorReply(result.error);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/laptops\/(?<id>[^/]+)$/,
    async handler(c) {
      const result = await c.store.update((state) => deleteLaptop(state, c.params.id!));
      return result.ok ? { status: 204 } : errorReply(result.error);
    },
  },
  ...lowStockRoutes(),
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateParam(query: URLSearchParams, name: string): { value?: string } | DomainError {
  const raw = query.get(name);
  if (!raw) return {};
  return DATE.test(raw) ? { value: raw } : { code: 'ValidationError', message: `${name} must be a date (YYYY-MM-DD)`, field: name };
}

function dateRange(query: URLSearchParams): { from?: string; to?: string } | DomainError {
  const from = dateParam(query, 'from');
  if ('code' in from) return from;
  const to = dateParam(query, 'to');
  if ('code' in to) return to;
  return { from: from.value, to: to.value };
}

function lowStockRoutes(): Route[] {
  const base = '/api/low-stock';
  return [
    { method: 'GET', pattern: new RegExp(`^${base}/levels$`), handler: (c) => ({ status: 200, body: stockLevels(c.store.read()) }) },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/thresholds$`),
      handler: (c) => ({ status: 200, body: c.store.read().lowStock.thresholds }),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^${base}/thresholds$`),
      async handler(c) {
        const result = await c.store.update((state) => setThreshold(state, c.body ?? {}, c.coreCtx()));
        return result.ok ? { status: 200, body: result.value.threshold } : errorReply(result.error);
      },
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^${base}/thresholds$`),
      async handler(c) {
        const result = await c.store.update((state) =>
          removeThreshold(state, c.query.get('sku') ?? '', c.query.get('warehouse') || null),
        );
        return result.ok ? { status: 204 } : errorReply(result.error);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/settings$`),
      handler(c) {
        const { accounts, lowStock } = c.store.read();
        const managers = Object.values(accounts).map((a) => ({
          ...publicAccount(a),
          settings: lowStock.recipients[a.id] ?? null,
        }));
        return { status: 200, body: { config: lowStock.config, managers } };
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^${base}/settings/(?<id>[^/]+)$`),
      async handler(c) {
        const result = await c.store.update((state) => setRecipientSettings(state, c.params.id!, c.body ?? {}));
        return result.ok ? { status: 200, body: result.value.settings } : errorReply(result.error);
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^${base}/config$`),
      async handler(c) {
        const result = await c.store.update((state) => setAlertConfig(state, c.body ?? {}));
        return result.ok ? { status: 200, body: result.value.state.lowStock.config } : errorReply(result.error);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/alerts$`),
      handler(c) {
        const open = c.query.get('status') === 'open';
        const alerts = Object.values(c.store.read().lowStock.alerts)
          .filter((a) => !open || a.status !== 'resolved')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { status: 200, body: alerts };
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/notifications$`),
      handler(c) {
        const mine = Object.values(c.store.read().lowStock.alerts)
          .filter((a) => a.recipients.includes(c.account!.id))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { status: 200, body: mine };
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^${base}/alerts/(?<id>[^/]+)/acknowledge$`),
      async handler(c) {
        const result = await c.store.update((state) => acknowledgeAlert(state, c.params.id!, c.coreCtx()));
        return result.ok ? { status: 200, body: result.value.alert } : errorReply(result.error);
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^${base}/alerts/(?<id>[^/]+)/snooze$`),
      async handler(c) {
        const result = await c.store.update((state) => snoozeAlert(state, c.params.id!, c.body?.minutes, c.coreCtx()));
        return result.ok ? { status: 200, body: result.value.alert } : errorReply(result.error);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/history$`),
      handler(c) {
        const range = dateRange(c.query);
        if ('code' in range) return errorReply(range);
        const filter = { sku: c.query.get('sku') || undefined, warehouse: c.query.get('warehouse') || undefined, ...range };
        return { status: 200, body: queryHistory(c.store.read(), filter) };
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^${base}/report$`),
      handler(c) {
        const range = dateRange(c.query);
        if ('code' in range) return errorReply(range);
        return { status: 200, body: lowStockFrequency(c.store.read(), range) };
      },
    },
  ];
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const now = options.now ?? (() => new Date());
  const store = await createStore(options.dataFile);
  const sessions = createSessionStore();
  const limiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
  const notifier = options.notifier ?? createDefaultNotifier(`${options.dataFile}.outbox.jsonl`);
  let origin = '';
  const pending = new Set<Promise<void>>();

  const dispatch = async (deliveries: readonly Delivery[]): Promise<void> => {
    const results = await Promise.all(
      deliveries.map(async (d) => {
        try {
          await notifier.send(d, origin);
          return { id: d.historyId, delivered: true, note: '' };
        } catch (e) {
          return { id: d.historyId, delivered: false, note: (e as Error).message.slice(0, 200) };
        }
      }),
    );
    await store.update((state) =>
      ok({ state: results.reduce((s, r) => recordDelivery(s, r.id, r.delivered, r.note), state) }),
    );
  };

  /** Re-checks stock and raises, escalates or resolves alerts. Evaluation is awaited; external sends run in the background. */
  const sweep = async (): Promise<void> => {
    const ctx: Ctx = { actor: { id: 'system', name: 'system' }, now: now().toISOString(), newId: randomUUID };
    const result = await store.update((state) => {
      const evaluated = evaluate(state, ctx);
      const unchanged =
        evaluated.state.lowStock.history.length === state.lowStock.history.length &&
        JSON.stringify(evaluated.state.lowStock.alerts) === JSON.stringify(state.lowStock.alerts);
      return unchanged ? err('NotFound', 'no change') : ok({ state: evaluated.state, deliveries: evaluated.deliveries });
    });
    if (!result.ok || result.value.deliveries.length === 0) return;
    const job = dispatch(result.value.deliveries).finally(() => pending.delete(job));
    pending.add(job);
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('too-large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const sessionToken = (req: IncomingMessage): string | undefined =>
    /(?:^|;\s*)sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1];

  const send = (res: ServerResponse, reply: Reply): void => {
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...reply.headers,
    };
    if (reply.body === undefined) {
      delete headers['content-type'];
      res.writeHead(reply.status, headers).end();
      return;
    }
    res.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
  };

  const serveStatic = async (res: ServerResponse, path: string): Promise<boolean> => {
    const entry = STATIC_FILES[path];
    if (!entry) return false;
    const content = await readFile(join(PUBLIC_DIR, entry.file));
    res.writeHead(200, {
      'content-type': entry.type,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    }).end(content);
    return true;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (!url.pathname.startsWith('/api/')) {
      if (method === 'GET' && (await serveStatic(res, url.pathname))) return;
      return send(res, rawError(404, 'NotFound', 'Not found'));
    }

    const rawBody = method === 'GET' || method === 'DELETE' ? '' : await readBody(req);
    if (rawBody.length > 0 && !(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return send(res, rawError(415, 'UnsupportedMediaType', 'Content-Type must be application/json'));
    }
    let body: unknown;
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return send(res, rawError(400, 'ValidationError', 'Request body is not valid JSON'));
      }
    }

    const matched = routes
      .map((route) => ({ route, m: route.pattern.exec(url.pathname) }))
      .filter((x) => x.m !== null && x.route.method === method)[0];
    const token = sessionToken(req);
    const accountId = sessions.get(token);
    const account = accountId ? store.read().accounts[accountId] : undefined;

    const isPublic = matched?.route.isPublic ?? false;
    if (!isPublic && !account) {
      return send(res, errorReply({ code: 'Unauthenticated', message: 'Sign in to continue' }));
    }
    if (!matched) return send(res, rawError(404, 'NotFound', 'Not found'));

    const reply = await matched.route.handler({
      body,
      params: matched.m!.groups ?? {},
      query: url.searchParams,
      account,
      store,
      coreCtx: () => ({
        actor: { id: account?.id ?? 'system', name: account?.displayName ?? 'system' },
        now: now().toISOString(),
        newId: randomUUID,
      }),
      startSession: (a) => ({
        'set-cookie': `sid=${sessions.create(a.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
      }),
      endSession: () => {
        sessions.destroy(token);
        return { 'set-cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' };
      },
      limiter,
    });
    if (method !== 'GET' && reply.status < 400 && !/^\/api\/(login|logout)$/.test(url.pathname)) {
      await sweep().catch(() => undefined);
    }
    send(res, reply);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      if (res.headersSent) return res.end();
      if (e.message === 'too-large') return send(res, rawError(413, 'PayloadTooLarge', 'Request body too large'));
      send(res, rawError(500, 'InternalError', 'Something went wrong'));
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 3000, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  const timer = setInterval(() => void sweep().catch(() => undefined), options.sweepIntervalMs ?? 30_000);
  timer.unref();
  await sweep();
  return {
    url: origin,
    close: async () => {
      clearInterval(timer);
      await Promise.allSettled([...pending]);
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
