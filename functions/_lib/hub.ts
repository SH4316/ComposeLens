import type { ImageMetadata, ParsedImageReference, TagPage } from '../../src/domain/types';
import { ApiError } from './http';
import { findPlatform, isDigest, platformName, type ImagePlatform } from './platform';
import { requestJson } from './upstream';

interface HubImage extends ImagePlatform {
  digest: string;
  size?: number;
}

interface HubTag {
  name: string;
  digest?: string;
  images?: HubImage[];
  tag_last_pushed?: string;
  last_updated?: string;
}

interface HubTagList {
  next: string | null;
  results: HubTag[];
}

export function repositoryUrl(repository: string): string {
  const [namespace, name] = repository.split('/');
  return namespace === 'library'
    ? `https://hub.docker.com/_/${encodeURIComponent(name)}`
    : `https://hub.docker.com/r/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

export function validateRepository(repository: string): string {
  if (repository.length > 255 || !/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(repository)) {
    throw new ApiError('Docker Hub 저장소는 namespace/image 형식이어야 합니다.', 400);
  }
  return repository;
}

function hubRepositoryEndpoint(repository: string): URL {
  const [namespace, name] = validateRepository(repository).split('/');
  return new URL(`https://hub.docker.com/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(name)}/tags`);
}

export async function readTagMetadata(reference: ParsedImageReference, requestedPlatform: string): Promise<ImageMetadata> {
  const url = hubRepositoryEndpoint(reference.repository);
  url.pathname += `/${encodeURIComponent(reference.tag ?? 'latest')}`;
  const tag = await requestJson<HubTag>(url, { label: 'Docker Hub' });

  if (!Array.isArray(tag.images)) throw new ApiError('Docker Hub 이미지 응답 형식이 변경되었습니다.');
  const images = tag.images.filter((image) =>
    image && image.os !== 'unknown' && image.architecture !== 'unknown' && isDigest(image.digest));
  const image = findPlatform(images, requestedPlatform);

  if (!image) {
    throw new ApiError(`이 태그에 ${requestedPlatform} 이미지가 없습니다. 다른 플랫폼이나 버전을 선택해 주세요.`, 422);
  }

  return {
    repository: reference.repository,
    reference: reference.normalized,
    tag: reference.tag ?? 'latest',
    digest: image.digest,
    platform: platformName(image),
    size: typeof image.size === 'number' && Number.isFinite(image.size) ? image.size : null,
    updatedAt: tag.tag_last_pushed ?? tag.last_updated ?? null,
    sourceUrl: repositoryUrl(reference.repository),
  };
}

export async function listTags(repository: string, page: number, search: string): Promise<TagPage> {
  const url = hubRepositoryEndpoint(repository);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', '50');
  if (search) url.searchParams.set('name', search);

  const data = await requestJson<HubTagList>(url, { label: 'Docker Hub 태그 목록' });
  if (!Array.isArray(data.results)) throw new ApiError('Docker Hub 태그 목록 응답 형식이 변경되었습니다.');

  return {
    tags: data.results.filter((tag) => typeof tag.name === 'string').map((tag) => ({
      name: tag.name,
      digest: isDigest(tag.digest) ? tag.digest : '',
      updatedAt: tag.tag_last_pushed ?? tag.last_updated ?? null,
    })),
    nextPage: data.next && data.results.length ? page + 1 : null,
  };
}
