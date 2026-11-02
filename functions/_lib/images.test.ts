import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { getImageReport } from './images';

const AMD_DIGEST = `sha256:${'a'.repeat(64)}`;
const ARM_DIGEST = `sha256:${'b'.repeat(64)}`;
const INDEX_DIGEST = `sha256:${'c'.repeat(64)}`;
const fetchMock = vi.fn();

const hubTag = {
  name: 'latest',
  digest: INDEX_DIGEST,
  tag_last_pushed: '2026-10-01T00:00:00Z',
  images: [
    { os: 'linux', architecture: 'arm64', variant: 'v8', digest: ARM_DIGEST, size: 200 },
    { os: 'linux', architecture: 'amd64', digest: AMD_DIGEST, size: 100 },
    { os: 'unknown', architecture: 'unknown', digest: INDEX_DIGEST, size: 30 },
  ],
};

function inventoryResponse(packages: unknown[] = [], sbomState = 'INDEXED'): Response {
  return Response.json({
    data: { imagePackagesByDigest: { sbomState, imagePackages: { packages } } },
  });
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock.mockReset()));
afterEach(() => vi.unstubAllGlobals());

describe('getImageReport', () => {
  it('resolves the requested platform manifest, not the multi-platform index', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(inventoryResponse([{
        package: {
          name: 'openssl', version: '3.0.0', purl: 'pkg:deb/debian/openssl@3.0.0',
          vulnerabilities: [{
            sourceId: 'CVE-2026-1000', source: 'debian', description: 'Example advisory',
            fixedBy: '3.0.1', url: 'https://example.com/advisory', cvss: { severity: 'HIGH', score: 8.1 },
          }],
        },
      }]));

    const report = await getImageReport('nginx');

    expect(report.status).toBe('available');
    expect(report.metadata).toMatchObject({
      repository: 'library/nginx', tag: 'latest', digest: AMD_DIGEST,
      platform: 'linux/amd64', size: 100,
    });
    expect(report.findings[0]).toMatchObject({
      cve: 'CVE-2026-1000', packageName: 'openssl', packageVersion: '3.0.0',
      fixedVersion: '3.0.1', severity: 'HIGH', score: 8.1,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://hub.docker.com/v2/namespaces/library/repositories/nginx/tags/latest');
    const scoutRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(scoutRequest.variables.digest).toBe(AMD_DIGEST);
    expect(scoutRequest.query).toContain('includePublic: true');
  });

  it('does not equate an unindexed image to zero vulnerabilities', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(inventoryResponse([], 'NOT_INDEXED'));

    const report = await getImageReport('nginx:latest');

    expect(report.status).toBe('not-indexed');
    expect(report.message).toContain('아직 제공되지');
    expect(report.metadata?.digest).toBe(AMD_DIGEST);
  });

  it('accepts an indexed, valid, empty inventory as zero findings', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(inventoryResponse());

    const report = await getImageReport('nginx');

    expect(report.status).toBe('available');
    expect(report.findings).toEqual([]);
  });

  it('retains metadata when a HTTP-200 GraphQL response contains errors', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(Response.json({ data: null, errors: [{ message: 'Not authorized' }] }));

    const report = await getImageReport('nginx');

    expect(report.status).toBe('unavailable');
    expect(report.metadata?.digest).toBe(AMD_DIGEST);
    expect(report.message).toContain('Docker Scout');
  });

  it('retains metadata and identifies upstream throttling', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));

    const report = await getImageReport('nginx');

    expect(report.status).toBe('unavailable');
    expect(report.metadata?.digest).toBe(AMD_DIGEST);
    expect(report.message).toContain('요청 한도');
  });

  it('does not turn a provider schema change into a zero-finding success', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(hubTag))
      .mockResolvedValueOnce(Response.json({ data: { imagePackagesByDigest: { sbomState: 'INDEXED' } } }));

    const report = await getImageReport('nginx');

    expect(report.status).toBe('unavailable');
    expect(report.message).toContain('응답 형식');
  });

  it('uses Scout metadata for a supplied digest and respects the requested platform', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({
        data: {
          imageDetailsListByDigest: [
            { digest: ARM_DIGEST, compressedSize: 200, platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } },
            { digest: AMD_DIGEST, compressedSize: 100, platform: { os: 'linux', architecture: 'amd64' } },
          ],
        },
      }))
      .mockResolvedValueOnce(inventoryResponse());

    const report = await getImageReport(`nginx@${INDEX_DIGEST}`, 'linux/arm64');

    expect(report.metadata).toMatchObject({ digest: ARM_DIGEST, platform: 'linux/arm64/v8', tag: null });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.scout.docker.com/v1/graphql');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables.digest).toBe(ARM_DIGEST);
  });

  it('returns no analysis when the supplied digest has no matching platform data', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { imageDetailsListByDigest: [] } }));

    const report = await getImageReport(`nginx@${AMD_DIGEST}`);

    expect(report.status).toBe('not-indexed');
    expect(report.metadata).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not silently fall back to a different architecture', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(hubTag));

    await expect(getImageReport('nginx', 'windows/amd64')).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks other registries unsupported without fetching them', async () => {
    const report = await getImageReport('ghcr.io/owner/image:latest');

    expect(report.status).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/image', 'nginx?url=example.com', '../nginx'])('rejects invalid references: %s', async (reference) => {
    await expect(getImageReport(reference)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed platforms before fetching', async () => {
    await expect(getImageReport('nginx', '../../metadata')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
