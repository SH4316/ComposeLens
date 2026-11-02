/** Reads bounded UTF-8 files, following public GitHub submodules at their gitlink commits. */
import type { RepositoryFile, RepositoryFileLocation } from '../domain/analysis-types';
import { submoduleRepository } from './github-submodule-repository';

const API = 'https://api.github.com';
const MAX_FILE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;
const MAX_SUBMODULE_DEPTH = 8;

type CancellationSource = 'caller' | 'timeout' | null;
type RequestTarget = 'repository' | 'file' | { label: string };
type RepositoryEntry = Record<string, unknown> | unknown[];

class GitHubRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface FileSession {
  signal?: AbortSignal;
  entries: Map<string, Promise<RepositoryEntry | null>>;
}

// A source belongs to one analysis. Share prefix lookups between its Dockerfiles
// without retaining stale branch contents across analyses or sharing cancellation.
const fileSessions = new WeakMap<RepositoryFile, FileSession>();

interface RepositoryAddress {
  owner: string;
  name: string;
  branch?: string;
}

function repositoryAddress(input: string): RepositoryAddress {
  let url: URL;
  try {
    url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error('GitHub 저장소 URL을 확인해주세요. 예: https://github.com/owner/repository');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) {
    throw new Error('https://github.com의 공개 저장소 URL을 입력해주세요.');
  }

  const [owner, rawName, kind, branch, ...remaining] = url.pathname.split('/').filter(Boolean);
  const name = rawName?.replace(/\.git$/, '');
  if (!owner || !name || !REPOSITORY_PART.test(owner) || !REPOSITORY_PART.test(name)) {
    throw new Error('GitHub 계정명과 저장소명이 포함된 URL을 입력해주세요.');
  }
  if (kind && !(['tree', 'blob'].includes(kind) && branch)) {
    throw new Error('GitHub 저장소 최상위 URL을 입력하고 Compose 경로는 별도로 지정해주세요.');
  }
  // Tree/blob links support a single path-segment branch; use the repository URL for the default branch.
  if (kind === 'tree' && remaining.length) {
    throw new Error('하위 폴더 링크 대신 GitHub 저장소 최상위 URL을 입력해주세요.');
  }

  return { owner, name, branch: branch ? decodeURIComponent(branch) : undefined };
}

function composePath(input: string): string {
  let path: string;
  try {
    path = decodeURIComponent(input.trim()).replace(/^\.\//, '').replace(/^\//, '');
  } catch {
    throw new Error('Compose 파일 경로의 인코딩을 확인해주세요.');
  }
  const parts = path.split('/');
  if (!path || path.includes('\\') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('저장소 기준의 Compose 파일 경로를 입력해주세요. 예: deploy/compose.yml');
  }
  return path;
}

function requestError(response: Response, target: RequestTarget): Error {
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    return new GitHubRequestError('GitHub의 익명 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.', response.status);
  }
  if (response.status === 404) {
    return new GitHubRequestError(target === 'repository'
      ? '공개 GitHub 저장소를 찾을 수 없습니다. URL과 저장소 공개 여부를 확인해주세요.'
      : `${target === 'file' ? 'Compose 파일' : target.label}을 찾을 수 없습니다. 브랜치·submodule 커밋과 파일 경로를 확인해주세요.`, response.status);
  }
  if (response.status === 403 || response.status === 401) {
    return new GitHubRequestError('GitHub 파일에 접근할 수 없습니다. 인증 없이 읽을 수 있는 공개 저장소인지 확인해주세요.', response.status);
  }
  return new GitHubRequestError(`GitHub 조회에 실패했습니다 (${response.status}). 잠시 후 다시 시도해주세요.`, response.status);
}

function readFailure(error: unknown, cancelledBy: CancellationSource): Error {
  if (cancelledBy === 'timeout') {
    return new Error('GitHub 응답이 15초 안에 도착하지 않았습니다. 네트워크 연결을 확인하고 다시 시도해주세요.', { cause: error });
  }
  if (error instanceof Error && error.name === 'AbortError') return error;
  if (cancelledBy === 'caller') return new DOMException('요청이 취소되었습니다.', 'AbortError');
  return new Error('GitHub에 연결할 수 없습니다. 네트워크 연결을 확인하고 다시 시도해주세요.', { cause: error });
}

async function readJson(url: string, target: RequestTarget, signal?: AbortSignal): Promise<RepositoryEntry> {
  const controller = new AbortController();
  let cancelledBy: CancellationSource = null;
  const abort = (source: Exclude<CancellationSource, null>) => {
    if (controller.signal.aborted) return;
    cancelledBy = source;
    controller.abort();
  };
  const onCallerAbort = () => abort('caller');
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => abort('timeout'), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    }).catch((error: unknown) => { throw readFailure(error, cancelledBy); });
    if (!response.ok) throw requestError(response, target);

    // Keep the deadline active until the response body has also finished reading.
    const result: unknown = await response.json().catch((error: unknown) => { throw readFailure(error, cancelledBy); });
    if (!result || typeof result !== 'object') {
      throw new Error('GitHub 응답이 올바르지 않습니다. 파일 경로가 폴더를 가리키는지 확인해주세요.');
    }
    return result as RepositoryEntry;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

function fileContent(file: RepositoryEntry, label = 'Compose'): string {
  if (Array.isArray(file) || file.type !== 'file' || file.target !== undefined || file.submodule_git_url !== undefined) {
    throw new Error(`${label} 경로는 폴더나 심볼릭 링크가 아닌 파일이어야 합니다.`);
  }
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
    throw new Error(`${label} 파일은 1MB 이하만 지원합니다. 분석할 설정을 단일 파일로 정리해주세요.`);
  }
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error(`GitHub에서 ${label} 파일 내용을 읽을 수 없습니다. 파일 크기와 경로를 확인해주세요.`);
  }

  try {
    const binary = atob(file.content.replace(/\s/g, ''));
    if (binary.length > MAX_FILE_BYTES) throw new Error('File too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new Error(`${label} 파일의 UTF-8 인코딩 또는 파일 크기를 확인해주세요.`);
  }
}

function contentsUrl(location: RepositoryFileLocation): string {
  const encodedRepository = location.repository.split('/').map(encodeURIComponent).join('/');
  const encodedPath = location.path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${encodedRepository}/contents/${encodedPath}?ref=${encodeURIComponent(location.ref)}`;
}

async function repositoryEntry(location: RepositoryFileLocation, target: RequestTarget, session: FileSession): Promise<RepositoryEntry | null> {
  if (session.signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError');
  const url = contentsUrl(location);
  let entry = session.entries.get(url);
  if (!entry) {
    entry = readJson(url, target, session.signal).catch((error: unknown) => {
      if (error instanceof GitHubRequestError && error.status === 404) return null;
      throw error;
    });
    session.entries.set(url, entry);
  }
  return entry;
}

async function readRepositoryPath(repository: string, ref: string, path: string, target: RequestTarget, session: FileSession): Promise<RepositoryFile> {
  const label = target === 'file' ? 'Compose' : typeof target === 'object' ? target.label : '파일';
  const missing = () => new Error(`${label}${target === 'file' ? ' 파일' : ''}을 찾을 수 없습니다. 브랜치·submodule 커밋과 파일 경로를 확인해주세요.`);

  async function locate(location: RepositoryFileLocation, depth: number): Promise<{ entry: RepositoryEntry; location: RepositoryFileLocation; depth: number }> {
    const entry = await repositoryEntry(location, target, session);
    if (entry !== null) return { entry, location, depth };

    // Contents cannot address a path below a gitlink in the superproject. Probe
    // only its ancestors after a 404; ordinary file reads still take one request.
    const parts = location.path.split('/');
    for (let index = 1; index < parts.length; index++) {
      const prefix = parts.slice(0, index).join('/');
      const ancestor = await repositoryEntry({ ...location, path: prefix }, target, session);
      if (ancestor === null) break;
      if (Array.isArray(ancestor)) continue;
      if (ancestor.target !== undefined || ancestor.type === 'symlink') {
        throw new Error(`${label}: 심볼릭 링크 경로는 지원하지 않습니다 (${prefix}).`);
      }
      if (ancestor.type === 'submodule' || ancestor.submodule_git_url !== undefined) {
        if (depth >= MAX_SUBMODULE_DEPTH) throw new Error(`${label}: submodule은 최대 ${MAX_SUBMODULE_DEPTH}단계까지 읽을 수 있습니다.`);
        if (typeof ancestor.sha !== 'string' || !/^[a-f\d]{40}$/i.test(ancestor.sha)) {
          throw new Error(`${label}: submodule (${prefix})의 고정 커밋 SHA를 확인할 수 없습니다.`);
        }
        let childRepository: string;
        try {
          childRepository = submoduleRepository(location.repository, ancestor.submodule_git_url);
        } catch (error) {
          throw new Error(`${label}: submodule (${prefix}) — ${error instanceof Error ? error.message : '저장소 URL을 확인할 수 없습니다.'}`, { cause: error });
        }
        return locate({ repository: childRepository, ref: ancestor.sha, path: parts.slice(index).join('/') }, depth + 1);
      }
      if (ancestor.type !== 'dir') break;
    }
    throw missing();
  }

  const resolved = await locate({ repository, ref, path }, 0);
  const content = fileContent(resolved.entry, label);
  // fileContent also rejects arrays, directories, links and gitlinks at the leaf.
  const file = resolved.entry as Record<string, unknown>;
  const location = resolved.location;
  const encodedPath = location.path.split('/').map(encodeURIComponent).join('/');
  return {
    content, repository, branch: ref, path,
    htmlUrl: `https://github.com/${location.repository}/blob/${encodeURIComponent(location.ref)}/${encodedPath}`,
    sha: typeof file.sha === 'string' ? file.sha : '',
    ...(resolved.depth > 0 ? { resolvedLocation: location } : {}),
  };
}

export async function fetchComposeFile(repositoryUrl: string, pathInput: string, signal?: AbortSignal): Promise<RepositoryFile> {
  const address = repositoryAddress(repositoryUrl);
  const path = composePath(pathInput);
  const repository = `${address.owner}/${address.name}`;
  const repoUrl = `${API}/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}`;
  const info = await readJson(repoUrl, 'repository', signal);
  if (Array.isArray(info)) throw new Error('GitHub 저장소 정보가 올바르지 않습니다.');
  if (info.private === true) throw new Error('공개 GitHub 저장소만 분석할 수 있습니다.');

  const branch = address.branch ?? info.default_branch;
  if (typeof branch !== 'string' || !branch) throw new Error('GitHub 저장소의 기본 브랜치를 확인할 수 없습니다.');
  const session: FileSession = { signal, entries: new Map() };
  const source = await readRepositoryPath(repository, branch, path, 'file', session);
  fileSessions.set(source, session);
  return source;
}

/** Read another raw repository-relative path from the already selected branch. */
export async function fetchRepositoryFile(source: RepositoryFile, path: string, signal?: AbortSignal): Promise<RepositoryFile> {
  const [owner, name, ...rest] = source.repository.split('/');
  if (!owner || !name || rest.length || !REPOSITORY_PART.test(owner) || !REPOSITORY_PART.test(name) || !source.branch) {
    throw new Error('Dockerfile을 읽을 GitHub 저장소와 브랜치를 확인해주세요.');
  }
  // Unlike the user-entered Compose path, this path has already been resolved.
  // Decode nothing here: a literal "%2e" belongs to the repository filename.
  if (!path || /^[a-z]:\//i.test(path) || /[\\\u0000]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Dockerfile은 저장소 안의 상대 파일 경로여야 합니다.');
  }
  let session = fileSessions.get(source);
  if (!session || session.signal !== signal) {
    session = { signal, entries: new Map() };
    fileSessions.set(source, session);
  }
  return readRepositoryPath(source.repository, source.branch, path, { label: `Dockerfile (${path})` }, session);
}
