import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryFile } from '../domain/analysis-types';
import { fetchComposeFile, fetchRepositoryFile } from './github-file-client';

const API = 'https://api.github.com';
const PIN = 'a'.repeat(40);
const NESTED_PIN = 'b'.repeat(40);
const source: RepositoryFile = {
  repository: 'owner/application', branch: 'feature/submodules', path: 'deployment/compose.yaml',
  content: '', sha: 'compose-blob', htmlUrl: 'https://github.com/owner/application',
};

interface JsonRoute {
  body: unknown;
  status?: number;
  headers?: HeadersInit;
}

type Route = JsonRoute | ((options: RequestInit) => Promise<Response>);

function contents(repository: string, path: string, ref: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

function file(content = 'FROM node:24-alpine\n', sha = 'dockerfile-blob'): JsonRoute {
  const bytes = new TextEncoder().encode(content);
  return { body: { type: 'file', size: bytes.length, encoding: 'base64', content: btoa(String.fromCharCode(...bytes)), sha } };
}

function gitlink(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'file', name: path.split('/').at(-1), path,
    submodule_git_url: 'https://github.com/team/backend.git', sha: PIN, ...overrides,
  };
}

function stubGitHub(entries: [string, Route][]) {
  const routes = new Map(entries);
  const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    const route = routes.get(url);
    if (typeof route === 'function') return route(options);
    return new Response(JSON.stringify(route?.body ?? {}), {
      status: route ? (route.status ?? 200) : 404, headers: route?.headers,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GitHub files inside submodules', () => {
  it('keeps ordinary repository file reads on the direct contents path', async () => {
    const path = 'frontend/Dockerfile';
    const fetchMock = stubGitHub([[contents(source.repository, path, source.branch), file()]]);
    const result = await fetchRepositoryFile({ ...source }, path);
    expect(result).toMatchObject({ repository: source.repository, branch: source.branch, path, sha: 'dockerfile-blob' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a gitlink SHA while preserving the parent repository and logical path', async () => {
    const path = 'services/backend/Dockerfile';
    const module = gitlink('services/backend');
    const pinnedFile = contents('team/backend', 'Dockerfile', PIN);
    const fetchMock = stubGitHub([
      [contents(source.repository, 'services', source.branch), { body: [module] }],
      [contents(source.repository, 'services/backend', source.branch), { body: module }],
      [pinnedFile, file()],
    ]);

    const result = await fetchRepositoryFile({ ...source }, path);
    expect(result).toMatchObject({
      repository: source.repository, branch: source.branch, path, sha: 'dockerfile-blob',
      resolvedLocation: { repository: 'team/backend', ref: PIN, path: 'Dockerfile' },
      htmlUrl: `https://github.com/team/backend/blob/${PIN}/Dockerfile`,
    });
    expect(fetchMock.mock.calls.some(([url]) => url === pinnedFile)).toBe(true);
    const moduleRequests = fetchMock.mock.calls.filter(([url]) => url.includes('/repos/team/backend/'));
    expect(moduleRequests.length).toBeGreaterThan(0);
    for (const [url] of moduleRequests) expect(new URL(url).searchParams.get('ref')).toBe(PIN);
  });

  it('follows nested submodules using each parent gitlink pin and encodes raw filenames once', async () => {
    const path = 'vendor/platform/services/api/docker/Custom %2e Dockerfile';
    const outer = gitlink('vendor/platform', { submodule_git_url: 'https://github.com/team/platform.git' });
    const inner = gitlink('services/api', { submodule_git_url: 'git@github.com:team/api.git', sha: NESTED_PIN });
    const nestedFile = contents('team/api', 'docker/Custom %2e Dockerfile', NESTED_PIN);
    const fetchMock = stubGitHub([
      [contents(source.repository, 'vendor', source.branch), { body: [outer] }],
      [contents(source.repository, 'vendor/platform', source.branch), { body: outer }],
      [contents('team/platform', 'services', PIN), { body: [inner] }],
      [contents('team/platform', 'services/api', PIN), { body: inner }],
      [nestedFile, file('FROM redis:7\n', 'nested-blob')],
    ]);

    const result = await fetchRepositoryFile({ ...source }, path);
    expect(result).toMatchObject({
      repository: source.repository, branch: source.branch, path, sha: 'nested-blob',
      resolvedLocation: { repository: 'team/api', ref: NESTED_PIN, path: 'docker/Custom %2e Dockerfile' },
      htmlUrl: `https://github.com/team/api/blob/${NESTED_PIN}/docker/Custom%20%252e%20Dockerfile`,
    });
    expect(fetchMock.mock.calls.some(([url]) => url === nestedFile)).toBe(true);
    for (const [url] of fetchMock.mock.calls.filter(([url]) => url.includes('/repos/team/platform/'))) {
      expect(new URL(url).searchParams.get('ref')).toBe(PIN);
    }
  });

  it('reads a Compose file inside a submodule and reuses its logical location for another file', async () => {
    const module = gitlink('modules/backend');
    const logicalCompose = 'modules/backend/deployment/compose.yaml';
    const prefix = contents(source.repository, 'modules/backend', source.branch);
    const fetchMock = stubGitHub([
      [`${API}/repos/${source.repository}`, { body: { default_branch: source.branch, private: false } }],
      [contents(source.repository, 'modules', source.branch), { body: [module] }],
      [prefix, { body: module }],
      [contents('team/backend', 'deployment/compose.yaml', PIN), file('services:\n  api:\n    build: ..\n', 'nested-compose-blob')],
      [contents('team/backend', 'Dockerfile', PIN), file()],
    ]);

    const compose = await fetchComposeFile(`https://github.com/${source.repository}`, logicalCompose);
    expect(compose).toMatchObject({
      repository: source.repository, branch: source.branch, path: logicalCompose, sha: 'nested-compose-blob',
      resolvedLocation: { repository: 'team/backend', ref: PIN, path: 'deployment/compose.yaml' },
    });
    const dockerfile = await fetchRepositoryFile(compose, 'modules/backend/Dockerfile');
    expect(dockerfile).toMatchObject({
      repository: source.repository, branch: source.branch, path: 'modules/backend/Dockerfile',
      resolvedLocation: { repository: 'team/backend', ref: PIN, path: 'Dockerfile' },
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === `${API}/repos/${source.repository}`)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === prefix)).toHaveLength(1);
  });

  it('shares in-flight prefix metadata across concurrent files from the same source and signal', async () => {
    const currentSource = { ...source };
    const controller = new AbortController();
    const module = gitlink('modules/backend');
    const directory = contents(source.repository, 'modules', source.branch);
    const prefix = contents(source.repository, 'modules/backend', source.branch);
    const fetchMock = stubGitHub([
      [directory, { body: [module] }], [prefix, { body: module }],
      [contents('team/backend', 'Dockerfile', PIN), file()],
      [contents('team/backend', 'docker/Releasefile', PIN), file('FROM nginx:alpine')],
    ]);

    const results = await Promise.all([
      fetchRepositoryFile(currentSource, 'modules/backend/Dockerfile', controller.signal),
      fetchRepositoryFile(currentSource, 'modules/backend/docker/Releasefile', controller.signal),
    ]);
    expect(results.every((result) => result.resolvedLocation?.ref === PIN)).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url === directory)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === prefix)).toHaveLength(1);
  });

  it('starts fresh prefix metadata requests when the caller signal changes', async () => {
    const currentSource = { ...source };
    const prefix = contents(source.repository, 'backend', source.branch);
    const fetchMock = stubGitHub([
      [prefix, { body: gitlink('backend') }],
      [contents('team/backend', 'Dockerfile', PIN), file()],
      [contents('team/backend', 'Releasefile', PIN), file()],
    ]);
    await fetchRepositoryFile(currentSource, 'backend/Dockerfile', new AbortController().signal);
    await fetchRepositoryFile(currentSource, 'backend/Releasefile', new AbortController().signal);
    expect(fetchMock.mock.calls.filter(([url]) => url === prefix)).toHaveLength(2);
  });

  it('caches missing prefixes and preserves each original missing file error', async () => {
    const currentSource = { ...source };
    const missingPrefix = contents(source.repository, 'missing', source.branch);
    const fetchMock = stubGitHub([]);
    const results = await Promise.allSettled([
      fetchRepositoryFile(currentSource, 'missing/first/Dockerfile'),
      fetchRepositoryFile(currentSource, 'missing/second/Releasefile'),
    ]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('missing/first/Dockerfile') } });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('missing/second/Releasefile') } });
    expect(fetchMock.mock.calls.filter(([url]) => url === missingPrefix)).toHaveLength(1);
  });

  it('rejects missing and malformed gitlink SHAs without falling back to a branch or HEAD', async () => {
    for (const sha of [undefined, '', 'main', 'abc123', 'x'.repeat(40)]) {
      const fetchMock = stubGitHub([
        [contents(source.repository, 'backend', source.branch), { body: gitlink('backend', { type: 'submodule', sha }) }],
      ]);
      await expect(fetchRepositoryFile({ ...source }, 'backend/Dockerfile')).rejects.toThrow(/submodule|SHA|커밋/i);
      expect(fetchMock.mock.calls.some(([url]) => url.includes('/repos/team/backend/'))).toBe(false);
    }
  });

  it('rejects explicit submodule metadata that has no repository URL', async () => {
    const fetchMock = stubGitHub([
      [contents(source.repository, 'backend', source.branch), { body: gitlink('backend', { type: 'submodule', submodule_git_url: undefined }) }],
    ]);
    await expect(fetchRepositoryFile({ ...source }, 'backend/Dockerfile')).rejects.toThrow(/submodule|URL/i);
    expect(fetchMock.mock.calls.every(([url]) => !url.includes('/repos/team/backend/'))).toBe(true);
  });

  it('blocks symlink prefixes instead of following them to another repository path', async () => {
    const fetchMock = stubGitHub([
      [contents(source.repository, 'linked', source.branch), { body: { type: 'symlink', target: 'backend', sha: PIN } }],
    ]);
    await expect(fetchRepositoryFile({ ...source }, 'linked/Dockerfile')).rejects.toThrow(/심볼릭|symlink/i);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/contents/backend'))).toBe(false);
  });

  it('rejects non-GitHub submodule URLs without fetching the external host', async () => {
    const fetchMock = stubGitHub([
      [contents(source.repository, 'backend', source.branch), { body: gitlink('backend', { submodule_git_url: 'https://gitlab.com/team/backend.git' }) }],
    ]);
    await expect(fetchRepositoryFile({ ...source }, 'backend/Dockerfile')).rejects.toThrow(/GitHub|submodule/i);
    expect(fetchMock.mock.calls.every(([url]) => new URL(url).hostname === 'api.github.com')).toBe(true);
  });

  it('propagates full-path access errors without attempting prefix discovery', async () => {
    const fullPath = contents(source.repository, 'backend/Dockerfile', source.branch);
    for (const response of [
      { body: {}, status: 403 },
      { body: {}, status: 403, headers: { 'x-ratelimit-remaining': '0' } },
    ]) {
      const fetchMock = stubGitHub([[fullPath, response]]);
      await expect(fetchRepositoryFile({ ...source }, 'backend/Dockerfile')).rejects.toThrow(/접근|요청 한도/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('preserves rate-limit and network errors raised while discovering a submodule', async () => {
    const prefix = contents(source.repository, 'backend', source.branch);
    const failures: [Route, RegExp][] = [
      [{ body: {}, status: 403, headers: { 'x-ratelimit-remaining': '0' } }, /요청 한도/],
      [async () => { throw new TypeError('Network unavailable'); }, /연결|네트워크/],
    ];
    for (const [failure, message] of failures) {
      stubGitHub([[prefix, failure]]);
      await expect(fetchRepositoryFile({ ...source }, 'backend/Dockerfile')).rejects.toThrow(message);
    }
  });

  it('propagates caller cancellation during prefix discovery', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const prefixStarted = new Promise<void>((resolve) => { started = resolve; });
    stubGitHub([
      [contents(source.repository, 'backend', source.branch), (options) => {
        started();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener('abort', abort, { once: true });
        });
      }],
    ]);
    const request = fetchRepositoryFile({ ...source }, 'backend/Dockerfile', controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await prefixStarted;
    controller.abort();
    await rejected;
  });

  it('supports eight pinned submodule hops and rejects a ninth', async () => {
    for (const hops of [8, 9]) {
      const entries: [string, Route][] = [];
      for (let index = 0; index < hops; index += 1) {
        const repository = index === 0 ? source.repository : `team/module${index - 1}`;
        const ref = index === 0 ? source.branch : index.toString(16).padStart(40, '0');
        const pin = (index + 1).toString(16).padStart(40, '0');
        entries.push([contents(repository, `module${index}`, ref), {
          body: gitlink(`module${index}`, { submodule_git_url: `https://github.com/team/module${index}.git`, sha: pin }),
        }]);
      }
      const deepestRef = hops.toString(16).padStart(40, '0');
      const deepestFile = contents(`team/module${hops - 1}`, 'Dockerfile', deepestRef);
      entries.push([deepestFile, file()]);
      const fetchMock = stubGitHub(entries);
      const logicalPath = [...Array.from({ length: hops }, (_, index) => `module${index}`), 'Dockerfile'].join('/');
      const request = fetchRepositoryFile({ ...source }, logicalPath);
      if (hops === 8) {
        await expect(request).resolves.toMatchObject({
          path: logicalPath, resolvedLocation: { repository: 'team/module7', ref: deepestRef, path: 'Dockerfile' },
        });
      } else {
        await expect(request).rejects.toThrow(/submodule|8|깊이/i);
        expect(fetchMock.mock.calls.some(([url]) => url === deepestFile)).toBe(false);
      }
    }
  });
});
