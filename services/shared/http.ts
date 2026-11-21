import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  rawBody: string;
  body: unknown;
}

export interface Response {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = (req: Request) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** A deliberately small JSON router: enough for simulated services, no framework dependency. */
export class Router {
  private readonly routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })}$`,
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  async handle(req: Omit<Request, 'params'>): Promise<Response> {
    const pathMatches = this.routes.filter((r) => r.pattern.test(req.path));
    if (pathMatches.length === 0) throw new HttpError(404, 'not_found', `No route for ${req.path}`);
    const route = pathMatches.find((r) => r.method === req.method);
    if (!route) throw new HttpError(405, 'method_not_allowed', `${req.method} not allowed on ${req.path}`);
    const values = route.pattern.exec(req.path)?.slice(1) ?? [];
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(values[i] ?? '')]));
    return route.handler({ ...req, params });
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, { status, body, headers }: Response): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
}

export function startServer(name: string, port: number, router: Router): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      try {
        const rawBody = await readBody(req);
        let body: unknown = undefined;
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
          }
        }
        const response = await router.handle({
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          rawBody,
          body,
        });
        send(res, response);
      } catch (error) {
        if (error instanceof HttpError) {
          send(res, {
            status: error.status,
            body: { error: { code: error.code, message: error.message, details: error.details } },
          });
        } else {
          console.error(`[${name}] unhandled error`, error);
          send(res, { status: 500, body: { error: { code: 'internal_error', message: 'Internal error' } } });
        }
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

export function requireBearer(
  req: Request,
  allowed: Record<string, 'read' | 'write'>,
  need: 'read' | 'write',
): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const scope = token ? allowed[token] : undefined;
  if (!scope) throw new HttpError(401, 'unauthorized', 'Missing or invalid bearer token');
  if (need === 'write' && scope !== 'write') {
    throw new HttpError(403, 'forbidden', 'Token does not have write permission');
  }
}
