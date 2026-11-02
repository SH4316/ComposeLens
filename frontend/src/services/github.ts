import type { RepositoryFile } from '../domain/types';

const API = 'https://api.github.com';
const MAX_COMPOSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;

type CancellationSource = 'caller' | 'timeout' | null;

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

function requestError(response: Response, target: 'repository' | 'file'): Error {
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    return new Error('GitHub의 익명 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
  }
  if (response.status === 404) {
    return new Error(target === 'repository'
      ? '공개 GitHub 저장소를 찾을 수 없습니다. URL과 저장소 공개 여부를 확인해주세요.'
      : 'Compose 파일을 찾을 수 없습니다. 기본 브랜치와 파일 경로를 확인해주세요.');
  }
  if (response.status === 403 || response.status === 401) {
    return new Error('GitHub 파일에 접근할 수 없습니다. 인증 없이 읽을 수 있는 공개 저장소인지 확인해주세요.');
  }
  return new Error(`GitHub 조회에 실패했습니다 (${response.status}). 잠시 후 다시 시도해주세요.`);
}

function readFailure(error: unknown, cancelledBy: CancellationSource): Error {
  if (cancelledBy === 'timeout') {
    return new Error('GitHub 응답이 15초 안에 도착하지 않았습니다. 네트워크 연결을 확인하고 다시 시도해주세요.', { cause: error });
  }
  if (error instanceof Error && error.name === 'AbortError') return error;
  if (cancelledBy === 'caller') return new DOMException('요청이 취소되었습니다.', 'AbortError');
  return new Error('GitHub에 연결할 수 없습니다. 네트워크 연결을 확인하고 다시 시도해주세요.', { cause: error });
}

async function readJson(url: string, target: 'repository' | 'file', signal?: AbortSignal): Promise<Record<string, unknown>> {
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
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('GitHub 응답이 올바르지 않습니다. 파일 경로가 폴더를 가리키는지 확인해주세요.');
    }
    return result as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

function fileContent(file: Record<string, unknown>): string {
  if (file.type !== 'file') throw new Error('Compose 경로는 폴더나 심볼릭 링크가 아닌 파일이어야 합니다.');
  if (typeof file.size !== 'number' || file.size > MAX_COMPOSE_BYTES) {
    throw new Error('Compose 파일은 1MB 이하만 지원합니다. 분석할 설정을 단일 파일로 정리해주세요.');
  }
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error('GitHub에서 Compose 파일 내용을 읽을 수 없습니다. 파일 크기와 경로를 확인해주세요.');
  }

  try {
    const binary = atob(file.content.replace(/\s/g, ''));
    if (binary.length > MAX_COMPOSE_BYTES) throw new Error('File too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new Error('Compose 파일의 UTF-8 인코딩 또는 파일 크기를 확인해주세요.');
  }
}

export async function fetchComposeFile(repositoryUrl: string, pathInput: string, signal?: AbortSignal): Promise<RepositoryFile> {
  const address = repositoryAddress(repositoryUrl);
  const path = composePath(pathInput);
  const repository = `${address.owner}/${address.name}`;
  const repoUrl = `${API}/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}`;
  const info = await readJson(repoUrl, 'repository', signal);
  if (info.private === true) throw new Error('공개 GitHub 저장소만 분석할 수 있습니다.');

  const branch = address.branch ?? info.default_branch;
  if (typeof branch !== 'string' || !branch) throw new Error('GitHub 저장소의 기본 브랜치를 확인할 수 없습니다.');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const file = await readJson(`${repoUrl}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, 'file', signal);
  const content = fileContent(file);

  return {
    content,
    repository,
    branch,
    path,
    htmlUrl: `https://github.com/${repository}/blob/${encodeURIComponent(branch)}/${encodedPath}`,
    sha: typeof file.sha === 'string' ? file.sha : '',
  };
}
