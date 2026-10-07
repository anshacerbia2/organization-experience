import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for the Identity Control API: records what the proxy forwarded and answers what the
// test sets.

export interface Received {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface Answer {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export class Upstream {
  baseUrl = '';
  answer: Answer = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' };
  readonly received: Received[] = [];
  #server: Server | null = null;

  async start(): Promise<void> {
    this.#server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        this.received.push({
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(this.answer.status, this.answer.headers ?? {});
        response.end(this.answer.body ?? '');
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.#server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  last(): Received {
    const last = this.received.at(-1);
    if (last === undefined) {
      throw new Error('nothing reached the upstream');
    }
    return last;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.#server === null) {
        resolve();
        return;
      }
      this.#server.close(() => {
        resolve();
      });
    });
  }
}
