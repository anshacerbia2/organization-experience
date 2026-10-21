// The server the browser tests run against: the built application, served as the BFF serves it, with
// the BFF's own security headers (bff/src/http/security-headers.ts), and a stand-in for everything the
// application reads through the BFF. The stand-in answers /auth/session and /auth/scope for the persona
// (and /auth/identity-experience, the same for every persona)
// the test names in a cookie, and every /api read from fixtures.ts. Every command is refused, as the
// API refuses one it cannot take, so no test passes on a command the stand-in pretended to apply.
//
// It is not the BFF: the session, the scope guard and the proxy are proved by bff/test and by the
// stack-proof workflow. It exists so every route renders, with data, in each scope, under the real
// content security policy, for the screenshots and axe (TDD-organization-experience-001 §Visual
// Language).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { answer, identityExperienceOrigin, personaOf, scopeOf, sessionOf } from './fixtures.ts';
import { securityHeaders } from '../../bff/src/http/security-headers.ts';

const port = Number(process.env['E2E_BROWSER_PORT'] ?? '18491');
const webRoot = fileURLToPath(new URL('../../apps/admin/dist/', import.meta.url));

const types: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.json': 'application/json',
};

const send = (response: ServerResponse, status: number, body: unknown, type: string): void => {
  response.writeHead(status, { ...securityHeaders, 'content-type': type, 'cache-control': 'no-store' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const problem = (response: ServerResponse, status: number, detail: string): void => {
  send(response, status, { type: 'about:blank', status, detail }, 'application/problem+json');
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
  const persona = personaOf(request.headers.cookie ?? '');

  if (url.pathname === '/healthz') {
    send(response, 200, 'ok', 'text/plain');
    return;
  }
  if (url.pathname === '/auth/session' && request.method === 'GET') {
    send(response, 200, sessionOf(persona), 'application/json');
    return;
  }
  if (url.pathname === '/auth/identity-experience' && request.method === 'GET') {
    send(response, 200, { origin: identityExperienceOrigin }, 'application/json');
    return;
  }
  if (url.pathname === '/auth/scope' && request.method === 'GET') {
    const scope = scopeOf(persona);
    if (scope === null) {
      problem(response, 401, 'not signed in');
      return;
    }
    send(response, 200, scope, 'application/json');
    return;
  }
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) {
    const body = request.method === 'GET' ? answer(url.pathname.replace(/^\/api/, '')) : undefined;
    if (body === undefined) {
      problem(response, request.method === 'GET' ? 404 : 403, 'the stand-in takes no command');
      return;
    }
    send(response, 200, body, 'application/json');
    return;
  }

  // A file of the build, or the application's index.html for any route it renders.
  const file = path.join(webRoot, path.normalize(url.pathname));
  const servable = file.startsWith(webRoot) && existsSync(file) && statSync(file).isFile();
  const target = servable ? file : path.join(webRoot, 'index.html');
  response.writeHead(200, {
    ...securityHeaders,
    'content-type': types[path.extname(target)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`browser test server on http://127.0.0.1:${String(port)}\n`);
});

const stop = (): void => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
