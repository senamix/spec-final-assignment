import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/server.ts';
import type { Mailer } from '../../src/mailer.ts';

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
}

export interface TestApp {
  url: string;
  dataFile: string;
  cookie: string;
  request(method: string, path: string, body?: unknown, cookie?: string | null): Promise<Reply>;
  /** Creates the first account (if none) and returns its session cookie. */
  setup(username?: string): Promise<string>;
  /** Creates another manager via the API and returns that manager's session cookie. */
  addManager(username: string): Promise<string>;
  restart(): Promise<void>;
  /** Runs any due email deliveries now and waits for them to finish. */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

const cookieFrom = (headers: Headers): string => (headers.get('set-cookie') ?? '').split(';')[0] ?? '';

export async function startTestApp(
  options: { dataFile?: string; now?: () => Date; mailer?: Mailer } = {},
): Promise<TestApp> {
  const dir = options.dataFile ? undefined : mkdtempSync(join(tmpdir(), 'inv-web-'));
  const dataFile = options.dataFile ?? join(dir!, 'data.json');
  const serverOptions = () => ({
    dataFile,
    port: 0,
    now: options.now,
    mailer: options.mailer ?? { send: async () => undefined },
    deliveryIntervalMs: 0,
  });
  let server = await startServer(serverOptions());

  const app: TestApp = {
    url: server.url,
    dataFile,
    cookie: '',
    async request(method, path, body, cookie) {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      const c = cookie === undefined ? app.cookie : cookie;
      if (c) headers.cookie = c;
      const res = await fetch(app.url + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
    },
    async setup(username = 'admin') {
      const r = await app.request('POST', '/api/setup', { username, displayName: 'Admin User', password: 'password-123', email: 'admin@example.com' }, null);
      if (r.status !== 201) throw new Error(`setup failed: ${r.status}`);
      app.cookie = cookieFrom(r.headers);
      return app.cookie;
    },
    async addManager(username) {
      const created = await app.request('POST', '/api/accounts', {
        username, displayName: `${username} Name`, password: 'password-456', email: `${username}@example.com`,
      });
      if (created.status !== 201) throw new Error(`addManager failed: ${created.status}`);
      const login = await app.request('POST', '/api/login', { username, password: 'password-456' }, null);
      return cookieFrom(login.headers);
    },
    async restart() {
      await server.close();
      server = await startServer(serverOptions());
      app.url = server.url;
      app.cookie = '';
    },
    flush: () => server.flushDeliveries(),
    async stop() {
      await server.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return app;
}
