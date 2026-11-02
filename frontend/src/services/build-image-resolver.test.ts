import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCompose } from '../domain/compose-parser';
import type { RepositoryFile } from '../domain/analysis-types';
import { resolveBuildImages } from './build-image-resolver';
import { fetchRepositoryFile } from './github-file-client';

vi.mock('./github-file-client', () => ({ fetchRepositoryFile: vi.fn() }));

const source: RepositoryFile = {
  content: '', repository: 'owner/repo', branch: 'feature/builds', path: 'deployment/compose.yaml',
  htmlUrl: 'https://github.com/owner/repo/blob/feature%2Fbuilds/deployment/compose.yaml', sha: 'compose-sha',
};

function repositoryFile(path: string, content: string): RepositoryFile {
  return { ...source, path, content, sha: 'dockerfile-sha' };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('resolveBuildImages', () => {
  it('resolves context from the Compose directory and a custom Dockerfile from that context', async () => {
    const parsed = parseCompose(`services:
  frontend:
    image: owner/frontend:local
    platform: linux/arm64
    build:
      context: ..
      dockerfile: frontend/Customfile
  backend:
    build:
      context: ../backend
      dockerfile: ../backend/Dockerfile
`);
    vi.mocked(fetchRepositoryFile).mockImplementation(async (_source, path) => repositoryFile(path,
      path.startsWith('frontend/') ? 'FROM nginx:1.27-alpine AS runtime' : 'FROM node:22-alpine AS server'));
    const result = await resolveBuildImages(parsed, source);

    expect(fetchRepositoryFile).toHaveBeenCalledWith(source, 'frontend/Customfile', undefined);
    expect(fetchRepositoryFile).toHaveBeenCalledWith(source, 'backend/Dockerfile', undefined);
    expect(result.images[0]).toMatchObject({
      id: 'build:frontend', services: ['frontend'], declaredRef: 'nginx:1.27-alpine', platform: 'linux/arm64',
      build: { outputRef: 'owner/frontend:local' },
      origin: { dockerfile: 'frontend/Customfile', stage: 'runtime', outputRef: 'owner/frontend:local', baseRef: 'nginx:1.27-alpine' },
    });
    expect(result.images[1]).toMatchObject({ id: 'build:backend', declaredRef: 'node:22-alpine', origin: { dockerfile: 'backend/Dockerfile', stage: 'server' } });
    expect(result.images.every((image) => image.issue === undefined)).toBe(true);
    expect(parsed.images[0].declaredRef).toBe('owner/frontend:local');
  });

  it('caches the same Dockerfile while resolving service-specific build args independently', async () => {
    const parsed = parseCompose(`services:
  first:
    image: app:local
    build:
      context: ..
      args:
        VERSION: "22"
  second:
    image: app:local
    build:
      context: ..
      args:
        - VERSION=24
`);
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'ARG VERSION=20\nFROM node:${VERSION}-alpine AS runtime'));
    const result = await resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(1);
    expect(result.images.map((image) => image.declaredRef)).toEqual(['node:22-alpine', 'node:24-alpine']);
    expect(result.images.map((image) => image.id)).toEqual(['build:first', 'build:second']);
    expect(result.images.map((image) => image.origin?.outputRef)).toEqual(['app:local', 'app:local']);
  });

  it('keeps the logical build path and the actual pinned submodule file as provenance', async () => {
    const parsed = parseCompose('services:\n  app:\n    build: ../vendor/app\n');
    const resolvedLocation = { repository: 'owner/app', ref: 'a'.repeat(40), path: 'Dockerfile' };
    vi.mocked(fetchRepositoryFile).mockResolvedValue({
      ...repositoryFile('vendor/app/Dockerfile', 'FROM nginx:1.31-alpine AS runtime'), resolvedLocation,
    });

    const result = await resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).toHaveBeenCalledWith(source, 'vendor/app/Dockerfile', undefined);
    expect(result.images[0]).toMatchObject({
      declaredRef: 'nginx:1.31-alpine',
      origin: { dockerfile: 'vendor/app/Dockerfile', stage: 'runtime', source: resolvedLocation },
    });
    expect(result.images[0].issue).toBeUndefined();
  });

  it('resolves build paths from a Compose file inside a submodule in the superproject checkout', async () => {
    const nestedSource: RepositoryFile = {
      ...source, path: 'vendor/app/deploy/compose.yml',
      resolvedLocation: { repository: 'owner/app', ref: 'a'.repeat(40), path: 'deploy/compose.yml' },
    };
    const parsed = parseCompose('services:\n  inside:\n    build: ..\n  outside:\n    build: ../../../shared\n');
    vi.mocked(fetchRepositoryFile).mockImplementation(async (_source, path) => repositoryFile(path, 'FROM redis:7'));

    const result = await resolveBuildImages(parsed, nestedSource);
    expect(fetchRepositoryFile).toHaveBeenCalledWith(nestedSource, 'vendor/app/Dockerfile', undefined);
    expect(fetchRepositoryFile).toHaveBeenCalledWith(nestedSource, 'shared/Dockerfile', undefined);
    expect(result.images.every((image) => image.declaredRef === 'redis:7' && !image.issue)).toBe(true);
  });

  it('selects the requested target stage and follows an inherited runtime stage', async () => {
    const parsed = parseCompose(`services:
  compiler:
    build: { context: .., target: builder }
  runtime:
    build: { context: .., target: release }
`);
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'FROM node:22-alpine AS builder\nRUN npm run build\nFROM nginx:1.27-alpine AS runtime\nCOPY --from=builder /app/dist /usr/share/nginx/html\nFROM runtime AS release'));
    const result = await resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(1);
    expect(result.images[0]).toMatchObject({ declaredRef: 'node:22-alpine', origin: { stage: 'builder' } });
    expect(result.images[1]).toMatchObject({ declaredRef: 'nginx:1.27-alpine', origin: { stage: 'release' } });
  });

  it('does not let an unknown build output tag hide a known base', async () => {
    const parsed = parseCompose('services:\n  app:\n    image: local/app:${RELEASE}\n    build: ..\n');
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'FROM redis:7'));
    const result = await resolveBuildImages(parsed, source);
    expect(result.images[0]).toMatchObject({ declaredRef: 'redis:7', origin: { outputRef: 'local/app:${RELEASE}' } });
    expect(result.images[0].issue).toBeUndefined();
  });

  it('uses the selected FROM platform returned by the Dockerfile resolver', async () => {
    const parsed = parseCompose('services:\n  app:\n    platform: linux/arm64\n    build: ..\n');
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'FROM --platform=linux/amd64 nginx:1.27 AS runtime'));
    const result = await resolveBuildImages(parsed, source);
    expect(result.images[0]).toMatchObject({ declaredRef: 'nginx:1.27', platform: 'linux/amd64', origin: { stage: 'runtime' } });
  });

  it('uses no host environment for omitted args and distinguishes unresolved explicit overrides', async () => {
    const parsed = parseCompose(`services:
  omitted:
    build:
      context: ..
      args: [VERSION]
  unknown:
    build:
      context: ..
      args:
        VERSION: \${VERSION}
  unused:
    build:
      context: ..
      args:
        OTHER: \${OTHER}
`);
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'ARG VERSION=22\nFROM node:${VERSION}-alpine'));
    const result = await resolveBuildImages(parsed, source);
    expect(result.images[0]).toMatchObject({ declaredRef: 'node:22-alpine' });
    expect(result.images[0].issue).toBeUndefined();
    expect(result.images[1].issue).toBeTruthy();
    expect(result.images[1].origin).toBeUndefined();
    expect(result.images[2]).toMatchObject({ declaredRef: 'node:22-alpine' });
    expect(result.images[2].issue).toBeUndefined();
  });

  it('reads inline Dockerfiles without a GitHub request and honors escaped Docker ARG variables', async () => {
    const parsed = parseCompose('services:\n  inline:\n    image: inline:local\n    build:\n      context: ..\n      args:\n        VERSION: "24"\n      dockerfile_inline: |\n        ARG VERSION=22\n        FROM node:$$VERSION-alpine AS runtime\n');
    const result = await resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).not.toHaveBeenCalled();
    expect(result.images[0]).toMatchObject({
      declaredRef: 'node:24-alpine',
      origin: { dockerfile: '(inline)', stage: 'runtime', outputRef: 'inline:local', baseRef: 'node:24-alpine' },
    });
  });

  it('keeps unresolved Compose arguments unknown through conditional Dockerfile defaults', async () => {
    const parsed = parseCompose('services:\n  unknown:\n    build:\n      context: ..\n      args:\n        SWITCH: ${UNSET}\n  escaped:\n    build:\n      context: ..\n      args:\n        SWITCH: $$UNSET\n');
    vi.mocked(fetchRepositoryFile).mockResolvedValue(repositoryFile('Dockerfile', 'ARG SWITCH\nARG BASE=${SWITCH:+redis:7}\nFROM ${BASE:-nginx:latest}'));
    const result = await resolveBuildImages(parsed, source);
    expect(result.images[0].issue).toBeTruthy();
    expect(result.images[0].origin).toBeUndefined();
    expect(result.images[0].declaredRef).toBe('(로컬 빌드)');
    expect(result.images[1].issue).toBeUndefined();
    expect(result.images[1].declaredRef).toBe('redis:7');
    expect(parsed.images[0].build?.unresolvedArgs).toEqual(['SWITCH']);
    expect(parsed.images[1].build?.unresolvedArgs).toBeUndefined();
  });

  it('preserves usable direct images and builds when another build is missing or unsupported', async () => {
    const parsed = parseCompose(`services:
  published:
    image: postgres:16
  usable:
    build: ../good
  missing:
    image: missing:local
    build: ../missing
  remote:
    build: https://example.com/repo.git
  escape:
    build: ../../outside
  dockerfile_escape:
    build: { context: .., dockerfile: ../outside/Dockerfile }
  invalid_file:
    build: ../invalid
`);
    vi.mocked(fetchRepositoryFile).mockImplementation(async (_source, path) => {
      if (path === 'missing/Dockerfile') throw new Error('Dockerfile (missing/Dockerfile)을 찾을 수 없습니다.');
      return repositoryFile(path, path === 'invalid/Dockerfile' ? 'FROM scratch' : 'FROM nginx:1.27-alpine');
    });
    const result = await resolveBuildImages(parsed, source);
    expect(result.images[0]).toEqual(parsed.images[0]);
    expect(result.images[1]).toMatchObject({ declaredRef: 'nginx:1.27-alpine', origin: { dockerfile: 'good/Dockerfile' } });
    expect(result.images.slice(2).every((image) => Boolean(image.issue) && !image.origin)).toBe(true);
    expect(result.images[2].issue).toContain('missing/Dockerfile');
    expect(result.images[3].issue).toContain('원격');
    expect(result.images[4].issue).toContain('저장소 밖');
    expect(result.images[5].issue).toContain('저장소 밖');
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(3);
    expect(result.warnings).toHaveLength(5);
    expect(parsed.warnings).toEqual([]);
  });

  it('caches failed file requests while keeping a distinct issue for each service', async () => {
    const parsed = parseCompose('services:\n  first:\n    build: ..\n  second:\n    build: ..\n');
    vi.mocked(fetchRepositoryFile).mockRejectedValue(new Error('Dockerfile (Dockerfile)을 찾을 수 없습니다.'));
    const result = await resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(1);
    expect(result.images.every((image) => image.issue?.includes('찾을 수 없습니다'))).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  it('limits unique Dockerfile requests to three active fetches', async () => {
    const parsed = parseCompose('services:\n  a:\n    build: ../a\n  b:\n    build: ../b\n  c:\n    build: ../c\n  d:\n    build: ../d\n');
    const pending: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    vi.mocked(fetchRepositoryFile).mockImplementation((_source, path) => new Promise((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      pending.push(() => {
        active -= 1;
        resolve(repositoryFile(path, 'FROM nginx:1.27'));
      });
    }));
    const request = resolveBuildImages(parsed, source);
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(3);
    pending.shift()!();
    await vi.waitFor(() => expect(fetchRepositoryFile).toHaveBeenCalledTimes(4));
    pending.splice(0).forEach((complete) => complete());
    const result = await request;
    expect(peak).toBe(3);
    expect(result.images.every((image) => !image.issue)).toBe(true);
  });

  it('propagates caller abort instead of turning cancellation into an image issue', async () => {
    const parsed = parseCompose('services:\n  a:\n    build: ../a\n  b:\n    build: ../b\n  c:\n    build: ../c\n  d:\n    build: ../d\n');
    const controller = new AbortController();
    vi.mocked(fetchRepositoryFile).mockImplementation((_source, _path, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const request = resolveBuildImages(parsed, source, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(3);
    controller.abort();
    await rejection;
    expect(fetchRepositoryFile).toHaveBeenCalledTimes(3);
  });

  it('rejects an already cancelled analysis before any file is fetched', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveBuildImages(parseCompose('services:\n  app:\n    build: ..\n'), source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchRepositoryFile).not.toHaveBeenCalled();
  });
});
