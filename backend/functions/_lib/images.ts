import { parseImageReference } from '@composelens/shared/image-reference';
import type { ImageMetadata, ImageReport } from '@composelens/shared';
import { ApiError } from './http';
import { readTagMetadata, validateRepository } from './hub';
import { validatePlatform } from './platform';
import { readDigestMetadata, readFindings } from './scout';

export async function getImageReport(input: string, platform = 'linux/amd64'): Promise<ImageReport> {
  const reference = parseReference(input);
  validatePlatform(platform);
  const retrievedAt = new Date().toISOString();

  if (reference.registry !== 'docker.io') {
    return {
      status: 'unsupported',
      metadata: null,
      findings: [],
      retrievedAt,
      message: '현재 Docker Hub의 공개 이미지 분석만 지원합니다.',
    };
  }
  validateRepository(reference.repository);

  const metadata = reference.digest
    ? await readDigestMetadata(reference, platform)
    : await readTagMetadata(reference, platform);

  if (!metadata) {
    return noAnalysis(retrievedAt, null, '이 digest와 플랫폼에 해당하는 공개 이미지 분석이 없습니다.');
  }

  try {
    const result = await readFindings(metadata.digest);
    return { ...result, metadata, retrievedAt };
  } catch (error) {
    // Image provenance stays useful when its separate analysis provider fails.
    return {
      status: 'unavailable',
      metadata,
      findings: [],
      retrievedAt,
      message: error instanceof ApiError ? error.message : '취약점 분석 정보를 조회하지 못했습니다.',
    };
  }
}

function parseReference(input: string) {
  try {
    return parseImageReference(input);
  } catch {
    throw new ApiError('이미지 참조 형식을 확인해 주세요. 예: nginx:latest 또는 nginx@sha256:…', 400);
  }
}

function noAnalysis(retrievedAt: string, metadata: ImageMetadata | null, message: string): ImageReport {
  return { status: 'not-indexed', metadata, findings: [], message, retrievedAt };
}
