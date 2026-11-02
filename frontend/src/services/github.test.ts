import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchComposeFile } from './github';

const source = 'services:\n  웹:\n    image: nginx:latest\n';

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'file', size: new TextEncoder().encode(source).length,
    encoding: 'base64', content: btoa(String.fromCharCode(...new TextEncoder().encode(source))), sha: 'blob-sha',
    ...overrides,
  };
}

function pendingUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchComposeFile', () => {
  it('reads a public repository default branch and decodes UTF-8 YAML', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'develop', private: false }))
      .mockResolvedValueOnce(json(file()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchComposeFile('https://github.com/SH4316/ComposeLens.git', 'deploy/compose.yml');
    expect(result).toMatchObject({ content: source, repository: 'SH4316/ComposeLens', branch: 'develop', path: 'deploy/compose.yml', sha: 'blob-sha' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/SH4316/ComposeLens/contents/deploy/compose.yml?ref=develop');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('supports a simple tree ref without replacing it with the default branch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json(file()));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchComposeFile('https://github.com/owner/repo/tree/staging', 'compose.yaml')).branch).toBe('staging');
    expect(fetchMock.mock.calls[1][0]).toContain('ref=staging');
  });

  it.each([
    ['https://not-github.example/owner/repo', 'compose.yml'],
    ['https://github.com/owner/repo', '../compose.yml'],
    ['https://github.com/owner/repo', '%2e%2e/compose.yml'],
    ['https://github.com/owner/repo', 'deploy\\compose.yml'],
  ])('rejects an unsupported address or traversal before fetching', async (url, path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchComposeFile(url, path)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes anonymous rate limits from missing repositories', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0' })));
    await expect(fetchComposeFile('https://github.com/owner/repo', 'compose.yml')).rejects.toThrow('요청 한도');
  });

  it('reports a missing Compose file separately', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json({}, 404)));
    await expect(fetchComposeFile('https://github.com/owner/repo', 'compose.yml')).rejects.toThrow('Compose 파일을 찾을 수 없습니다');
  });

  it('refuses oversized files and directory paths', async () => {
    for (const invalid of [file({ size: 1024 * 1024 + 1 }), file({ type: 'dir' })]) {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(json({ default_branch: 'main' }))
        .mockResolvedValueOnce(json(invalid)));
      await expect(fetchComposeFile('https://github.com/owner/repo', 'compose.yml')).rejects.toThrow();
    }
  });

  it('preserves cancellation so abandoned analyses can be ignored', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    controller.abort();
    await expect(fetchComposeFile('https://github.com/owner/repo', 'compose.yml', controller.signal)).rejects.toBe(abort);
  });

  it('aborts a stalled request after 15 seconds with a Korean timeout error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => pendingUntilAbort(options.signal!));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchComposeFile('https://github.com/owner/repo', 'compose.yml');
    const rejection = expect(request).rejects.toThrow('GitHub 응답이 15초 안에 도착하지 않았습니다');

    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock.mock.calls[0][1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetchMock.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the repository lookup and file lookup separate timeout budgets', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        setTimeout(() => resolve(json({ default_branch: 'main' })), 14_000);
      }))
      .mockImplementationOnce((_url: string, options: RequestInit) => pendingUntilAbort(options.signal!));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchComposeFile('https://github.com/owner/repo', 'compose.yml');
    const rejection = expect(request).rejects.toThrow('15초');

    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while the response body is stalled', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const response = json({});
      vi.spyOn(response, 'json').mockImplementation(() => pendingUntilAbort(options.signal!));
      return Promise.resolve(response);
    }));
    const request = fetchComposeFile('https://github.com/owner/repo', 'compose.yml');
    const rejection = expect(request).rejects.toThrow('15초');

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation and removes its listener and timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => pendingUntilAbort(options.signal!)));
    const request = fetchComposeFile('https://github.com/owner/repo', 'compose.yml', controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await rejection;
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up timeout timers after success and HTTP failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json(file())));
    await fetchComposeFile('https://github.com/owner/repo', 'compose.yml');
    expect(vi.getTimerCount()).toBe(0);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 404)));
    await expect(fetchComposeFile('https://github.com/owner/repo', 'compose.yml')).rejects.toThrow('공개 GitHub 저장소');
    expect(vi.getTimerCount()).toBe(0);
  });
});
