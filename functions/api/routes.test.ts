import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as getImages, onRequest as rejectImageMethod } from './images';
import { onRequestGet as getTags } from './tags';

function context(url: string): Parameters<PagesFunction>[0] {
  return { request: new Request(url) } as Parameters<PagesFunction>[0];
}

afterEach(() => vi.unstubAllGlobals());

describe('Pages API routes', () => {
  it('requires an image reference', async () => {
    const response = await getImages(context('https://example.com/api/images'));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it('limits methods to GET', async () => {
    const response = await rejectImageMethod(context('https://example.com/api/images'));

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  it.each(['0', '-1', '1.5', 'NaN'])('rejects invalid tag pagination: %s', async (page) => {
    const response = await getTags(context(`https://example.com/api/tags?repository=library/nginx&page=${page}`));
    expect(response.status).toBe(400);
  });

  it('does not accept arbitrary upstream URLs as repositories', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await getTags(context('https://example.com/api/tags?repository=https://example.org/private'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes paginated tag metadata without forwarding provider URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      next: 'https://hub.docker.com/next',
      results: [{ name: '1.27', digest: `sha256:${'a'.repeat(64)}`, last_updated: '2026-10-01' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await getTags(context('https://example.com/api/tags?repository=library/nginx&page=2&search=1.'));
    const result = await response.json();

    expect(result).toEqual({
      nextPage: 3,
      tags: [{ name: '1.27', digest: `sha256:${'a'.repeat(64)}`, updatedAt: '2026-10-01' }],
    });
    const upstream = new URL(fetchMock.mock.calls[0][0]);
    expect(upstream.hostname).toBe('hub.docker.com');
    expect(upstream.searchParams.get('page_size')).toBe('50');
    expect(upstream.searchParams.get('name')).toBe('1.');
  });
});
