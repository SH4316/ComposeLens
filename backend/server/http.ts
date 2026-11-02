import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { jsonResponse, methodNotAllowed } from '../functions/_lib/http';
import { handleRequest } from './app';

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): { host: string; port: number } {
  const host = env.HOST ?? '0.0.0.0';
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  const isHostname = host.length <= 253 && host.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));

  if (!isIP(host) && !isHostname) throw new Error('HOST must be an IP address or hostname.');
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { host, port };
}

export function createApiServer(): Server {
  return createServer((request, response) => {
    void serve(request, response);
  });
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // No route consumes request bodies. Drain them without buffering for keep-alive clients.
  request.resume();

  try {
    // Reject before constructing a Fetch Request: it disallows methods such as TRACE.
    const result = request.method === 'GET'
      ? await handleRequest(toRequest(request))
      : methodNotAllowed();
    await send(response, result, request.method === 'HEAD');
  } catch {
    if (response.headersSent || response.destroyed) {
      response.destroy();
      return;
    }
    await send(response, jsonResponse({ error: '요청을 처리하지 못했습니다.' }, 500), request.method === 'HEAD');
  }
}

function toRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
  }
  // Routing does not depend on the client-controlled Host header.
  return new Request(new URL(request.url ?? '/', 'http://localhost'), { headers });
}

async function send(response: ServerResponse, result: Response, head: boolean): Promise<void> {
  const body = head ? undefined : new Uint8Array(await result.arrayBuffer());
  if (response.destroyed) return;

  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(body);
}

export function drainServer(server: Server, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}
