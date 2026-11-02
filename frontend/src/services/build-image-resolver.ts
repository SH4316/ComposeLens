/** Loads Compose Dockerfiles and combines their resolved bases with service provenance. */
import { resolveDockerfile } from '../domain/dockerfile-base-resolver';
import type { ImageSpec, ParsedCompose, RepositoryFile } from '../domain/analysis-types';
import { fetchRepositoryFile } from './github-file-client';

const MAX_FILE_REQUESTS = 3;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError');
}

function repositoryPath(base: string, relative: string): string {
  if (relative.startsWith('/') || relative.startsWith('~') || /[\\\u0000]/.test(relative) || /^[a-z]:\//i.test(relative)) {
    throw new Error('호스트의 절대 경로는 읽을 수 없습니다. 저장소 안의 상대 경로를 지정해주세요.');
  }
  if (!relative || /^(?:[a-z][a-z\d+.-]*:|[^/]+@[^/]+:|(?:github\.com|gitlab\.com|bitbucket\.org)\/)/i.test(relative)) {
    throw new Error('원격 빌드 컨텍스트는 지원하지 않습니다. 같은 GitHub 저장소의 상대 경로를 지정해주세요.');
  }
  const parts = base ? base.split('/') : [];
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('빌드 경로가 GitHub 저장소 밖을 가리킵니다. 저장소 안의 파일만 읽을 수 있습니다.');
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

/** Resolve build outputs to the selected Dockerfile stage's external base image. */
export async function resolveBuildImages(parsed: ParsedCompose, source: RepositoryFile, signal?: AbortSignal): Promise<ParsedCompose> {
  checkAbort(signal);
  const directory = source.path.split('/').slice(0, -1).join('/');
  const files = new Map<string, Promise<RepositoryFile>>();
  const waiting: (() => void)[] = [];
  let activeRequests = 0;

  async function readFile(path: string): Promise<RepositoryFile> {
    if (activeRequests >= MAX_FILE_REQUESTS) await new Promise<void>((resolve) => waiting.push(resolve));
    else activeRequests += 1;
    try {
      checkAbort(signal);
      return await fetchRepositoryFile(source, path, signal);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else activeRequests -= 1;
    }
  }

  function cachedFile(path: string): Promise<RepositoryFile> {
    let file = files.get(path);
    if (!file) {
      file = readFile(path);
      files.set(path, file);
    }
    return file;
  }

  async function resolveImage(image: ImageSpec): Promise<{ image: ImageSpec; warnings: string[] }> {
    if (!image.build) return { image, warnings: [] };
    const prefix = `${image.services.join(', ')}: `;
    if (image.issue) return { image, warnings: [prefix + image.issue] };
    const build = image.build;
    try {
      checkAbort(signal);
      const context = repositoryPath(directory, build.context);
      const path = build.dockerfileInline === undefined ? repositoryPath(context, build.dockerfile) : '(inline)';
      if (!path) throw new Error('Dockerfile 경로가 파일을 가리켜야 합니다.');
      const file = build.dockerfileInline === undefined ? await cachedFile(path) : undefined;
      const content = build.dockerfileInline ?? file!.content;
      checkAbort(signal);
      const resolved = resolveDockerfile(content, {
        args: build.args, unresolvedArgs: build.unresolvedArgs, target: build.target, platform: image.platform,
      });
      return {
        image: {
          ...image,
          declaredRef: resolved.reference,
          platform: resolved.platform,
          issue: undefined,
          origin: {
            dockerfile: path,
            stage: resolved.stage,
            outputRef: build.outputRef,
            baseRef: resolved.reference,
            ...(file?.resolvedLocation ? { source: file.resolvedLocation } : {}),
          },
        },
        warnings: resolved.warnings.map((warning) => `${prefix}${path}: ${warning}`),
      };
    } catch (error) {
      checkAbort(signal);
      if (error instanceof Error && error.name === 'AbortError') throw error;
      const issue = error instanceof Error ? error.message : 'Dockerfile의 베이스 이미지를 확인할 수 없습니다.';
      return { image: { ...image, origin: undefined, issue }, warnings: [prefix + issue] };
    }
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal) {
      onAbort = () => reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    const resolved = await Promise.race([Promise.all(parsed.images.map(resolveImage)), aborted]);
    checkAbort(signal);
    return {
      images: resolved.map((result) => result.image),
      warnings: [...parsed.warnings, ...resolved.flatMap((result) => result.warnings)],
    };
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
