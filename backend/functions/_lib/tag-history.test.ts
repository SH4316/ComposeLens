import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listTagHistory } from './tag-history';

const INDEX = `sha256:${'1'.repeat(64)}`;
const AMD = `sha256:${'a'.repeat(64)}`;
const ARM = `sha256:${'b'.repeat(64)}`;
const OLDER = `sha256:${'c'.repeat(64)}`;
const fetchMock = vi.fn();
const commit = (character: string, date = '2026-10-28T00:00:00Z') => ({ sha: character.repeat(40), commit: { committer: { date } } });
function snapshot(amd = AMD) {
  return [
    '## `python:3.11`', `$ docker pull python@${INDEX}`,
    '### `python:3.11` - unknown; unknown', `$ docker pull python@${INDEX}`,
    '### `python:3.11` - linux; amd64', `$ docker pull python@${amd}`, 'ENV PYTHON_VERSION=3.11.18',
    '### `python:3.11` - linux; arm64 variant v8', `$ docker pull python@${ARM}`, 'ENV PYTHON_VERSION=3.11.17',
  ].join('\n');
}
beforeEach(() => vi.stubGlobal('fetch', fetchMock.mockReset()));
afterEach(() => vi.unstubAllGlobals());

describe('public tag observations', () => {
  it('extracts the requested platform digest and version from an immutable snapshot', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([commit('a')])).mockResolvedValueOnce(new Response(snapshot()));
    const result = await listTagHistory('python:3.11', 'linux/arm64', 1);
    expect(result).toEqual({ status: 'available', nextPage: null, entries: [{
      sourceReference: 'library/python:3.11', digest: ARM, indexDigest: INDEX, platform: 'linux/arm64/v8',
      version: '3.11.17', recordedAt: '2026-10-28T00:00:00Z',
      sourceUrl: `https://github.com/docker-library/repo-info/blob/${'a'.repeat(40)}/repos/python/remote/3.11.md`,
    }] });
    const commitsUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(commitsUrl.searchParams.get('path')).toBe('repos/python/remote/3.11.md');
    expect(String(fetchMock.mock.calls[1][0])).toBe(`https://raw.githubusercontent.com/docker-library/repo-info/${'a'.repeat(40)}/repos/python/remote/3.11.md`);
  });

  it('does not substitute a different architecture when no matching observation exists', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([commit('a')])).mockResolvedValueOnce(new Response(snapshot()));
    expect((await listTagHistory('python:3.11', 'linux/386', 1)).entries).toEqual([]);
  });

  it('collapses repeated platform digests while preserving newest-first observations and pagination', async () => {
    fetchMock.mockImplementation(async (url: URL | string) => String(url).includes('api.github.com')
      ? Response.json(Array.from({ length: 8 }, (_, index) => commit(index.toString(16), `2026-10-${String(28 - index).padStart(2, '0')}T00:00:00Z`)))
      : new Response(snapshot(String(url).includes(`/${'7'.repeat(40)}/`) ? OLDER : AMD)));
    const result = await listTagHistory('python:3.11', 'linux/amd64', 2);
    expect(result.entries.map((entry) => entry.digest)).toEqual([AMD, OLDER]);
    expect(result.entries[0].recordedAt).toBe('2026-10-28T00:00:00Z');
    expect(result.nextPage).toBe(3);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('page')).toBe('2');
  });

  it.each(['example/python:3.11', 'ghcr.io/example/python:3.11', `python@${AMD}`])('does not guess history for %s', async (reference) => {
    expect(await listTagHistory(reference, 'linux/amd64', 1)).toMatchObject({ status: 'unsupported', entries: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['https://example.com/python', 'linux/amd64', 1], ['python:3.11', '../../private', 1],
    ['python:3.11', 'linux/amd64', 0], ['python:3.11', 'linux/amd64', 1.5],
  ] as const)('rejects invalid history input before fetching', async (reference, platform, page) => {
    await expect(listTagHistory(reference, platform, page)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a GitHub quota failure rather than an empty history', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    await expect(listTagHistory('python:3.11', 'linux/amd64', 1)).rejects.toMatchObject({ status: 429 });
  });

  it('keeps usable observations and discloses partial upstream failures', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([commit('a'), commit('b')]))
      .mockResolvedValueOnce(new Response(snapshot())).mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await listTagHistory('python:3.11', 'linux/amd64', 1)).toMatchObject({
      entries: [{ digest: AMD }], message: expect.stringContaining('일부'),
    });
  });

  it('ignores file deletion commits without inventing an image', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([commit('a')])).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await listTagHistory('python:3.11', 'linux/amd64', 1)).toEqual({ status: 'available', entries: [], nextPage: null });
  });

  it('rejects malformed commits and a changed snapshot format', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([commit('../bad')]));
    await expect(listTagHistory('python:3.11', 'linux/amd64', 1)).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(Response.json([commit('a')])).mockResolvedValueOnce(new Response('<html>Unavailable</html>'));
    await expect(listTagHistory('python:3.11', 'linux/amd64', 1)).rejects.toMatchObject({ status: 502 });
  });
});
