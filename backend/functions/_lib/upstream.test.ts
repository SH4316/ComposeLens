import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorResponse } from './http';
import { requestJson } from './upstream';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('requestJson', () => {
  it('passes upstream retry timing through the API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '90' } })));

    const error = await requestJson('https://hub.docker.com/example', { label: 'Docker Hub' }).catch((value: unknown) => value);
    const response = errorResponse(error);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('aborts slow providers and reports a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));

    const outcome = requestJson('https://hub.docker.com/example', { label: 'Docker Hub' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(outcome).resolves.toMatchObject({ status: 504, message: expect.stringContaining('초과') });
  });

  it('rejects an HTML error page even when its status is 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>')));

    await expect(requestJson('https://hub.docker.com/example', { label: 'Docker Hub' })).rejects.toMatchObject({
      status: 502, message: expect.stringContaining('JSON'),
    });
  });
});
