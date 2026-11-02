import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiServer, drainServer, readServerConfig } from './http';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const fetchMock = vi.fn();
let server: Server;
let port: number;

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function request(path: string, method = 'GET', body?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, agent: false }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => resolve({
        status: incoming.statusCode!,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock.mockReset());
  server = createApiServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  if (server.listening) await drainServer(server, 100);
  vi.unstubAllGlobals();
});

describe('Node HTTP API', () => {
  it('serves a local health check without contacting providers', async () => {
    const response = await request('/healthz');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves encoded tag queries and normalized pagination metadata', async () => {
    fetchMock.mockResolvedValue(Response.json({
      next: 'https://hub.docker.com/private-provider-pagination',
      results: [{ name: '1.27', digest: DIGEST, last_updated: '2026-10-01' }],
    }));
    const query = new URLSearchParams({ repository: 'library/nginx', page: '2', search: '  1.+ &  ' });

    const response = await request(`/api/tags?${query}`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      nextPage: 3,
      tags: [{ name: '1.27', digest: DIGEST, updatedAt: '2026-10-01' }],
    });
    const upstream = new URL(fetchMock.mock.calls[0][0]);
    expect(upstream.origin).toBe('https://hub.docker.com');
    expect(upstream.searchParams.get('page')).toBe('2');
    expect(upstream.searchParams.get('page_size')).toBe('50');
    expect(upstream.searchParams.get('name')).toBe('1.+ &');
  });

  it('returns an image report for the requested platform using both providers', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({
        images: [{ os: 'linux', architecture: 'arm64', variant: 'v8', digest: DIGEST, size: 123 }],
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          imagePackagesByDigest: { sbomState: 'INDEXED', imagePackages: { packages: [] } },
        },
      }));
    const query = new URLSearchParams({ reference: 'nginx:1.27', platform: 'linux/arm64/v8' });

    const response = await request(`/api/images?${query}`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'available',
      metadata: { reference: 'docker.io/library/nginx:1.27', digest: DIGEST, platform: 'linux/arm64/v8', size: 123 },
      findings: [],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/tags/1.27');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables.digest).toBe(DIGEST);
  });

  it.each(['/api/tags?repository=library%2Fnginx', '/api/images?reference=nginx'])('preserves provider throttling status and Retry-After: %s', async (path) => {
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));

    const response = await request(path);

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('120');
    expect(JSON.parse(response.body).error).toContain('요청 한도');
  });

  it('retains image metadata when analysis is unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({
        images: [{ os: 'linux', architecture: 'amd64', digest: DIGEST, size: 456 }],
      }))
      .mockRejectedValueOnce(new Error('private provider exception details'));

    const response = await request('/api/images?reference=nginx');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'unavailable',
      metadata: { digest: DIGEST, platform: 'linux/amd64', size: 456 },
      findings: [],
    });
    expect(response.body).not.toContain('private provider exception details');
  });

  it('returns safe JSON when a provider cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('secret network configuration'));

    const response = await request('/api/tags?repository=library%2Fnginx');

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body).error).toContain('Docker Hub');
    expect(response.body).not.toContain('secret network configuration');
  });

  it.each([
    '/api/images',
    '/api/images?reference=nginx&platform=..%2F..',
    '/api/tags?repository=https%3A%2F%2Fexample.com%2Fprivate',
    '/api/tags?repository=library%2Fnginx&page=1.5',
    `/api/tags?repository=library%2Fnginx&search=${'a'.repeat(129)}`,
  ])('keeps existing input validation before upstream calls: %s', async (path) => {
    const response = await request(path);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['POST', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'])('rejects %s before validation or upstream access', async (method) => {
    const response = await request('/api/images', method, method === 'POST' ? 'ignored request body' : undefined);

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(response.headers['content-type']).toContain('application/json');
    if (method === 'HEAD') expect(response.body).toBe('');
    else expect(JSON.parse(response.body)).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only accepts GET for the health endpoint', async () => {
    const response = await request('/healthz', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['/api/unknown', '/api/images/extra', '/', '/assets/app.js'])('returns JSON 404 without a frontend fallback: %s', async (path) => {
    const response = await request(path);

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(JSON.parse(response.body)).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('finishes an active request during graceful shutdown', async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = request('/api/tags?repository=library%2Fnginx');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const drained = drainServer(server);
    complete(Response.json({ next: null, results: [] }));

    expect((await pending).status).toBe(200);
    await drained;
    expect(server.listening).toBe(false);
  });

  it('bounds the time allowed to drain active connections', async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = request('/api/tags?repository=library%2Fnginx').catch((error: Error) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await drainServer(server, 20);
    expect(await pending).toBeInstanceOf(Error);
    complete(Response.json({ next: null, results: [] }));
    expect(server.listening).toBe(false);
  });
});

describe('server environment', () => {
  it('defaults to the container interface and port', () => {
    expect(readServerConfig({})).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(readServerConfig({ HOST: '::1', PORT: '8080' })).toEqual({ host: '::1', port: 8080 });
    expect(readServerConfig({ HOST: 'localhost', PORT: '3001' })).toEqual({ host: 'localhost', port: 3001 });
  });

  it.each(['', '0', '-1', '1.5', '65536', 'NaN', '3000junk', ' 3000'])('rejects invalid PORT=%s', (value) => {
    expect(() => readServerConfig({ PORT: value })).toThrow('PORT');
  });

  it.each(['', 'http://localhost', '0.0.0.0:3000', ' bad-host ', '../socket'])('rejects invalid HOST=%s', (value) => {
    expect(() => readServerConfig({ HOST: value })).toThrow('HOST');
  });
});
