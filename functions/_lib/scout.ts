import { SEVERITIES, type Finding, type ImageMetadata, type ParsedImageReference, type Severity } from '../../shared/types';
import { ApiError } from './http';
import { repositoryUrl } from './hub';
import { findPlatform, isDigest, platformName, type ImagePlatform } from './platform';
import { requestJson } from './upstream';

const SCOUT_ENDPOINT = 'https://api.scout.docker.com/v1/graphql';

const IMAGE_DETAILS_QUERY = `
  query imageDetails($digest: String!, $repository: String!) {
    imageDetailsListByDigest(context: {}, digest: $digest, repository: $repository) {
      digest
      compressedSize
      platform { os architecture variant }
    }
  }
`;

const FINDINGS_QUERY = `
  query imageFindings($digest: String!) {
    imagePackagesByDigest(context: {}, digest: $digest, query: { includePublic: true }) {
      sbomState
      imagePackages {
        packages {
          package {
            purl
            name
            version
            vulnerabilities {
              sourceId
              source
              description
              fixedBy
              url
              cvss { severity score }
            }
          }
        }
      }
    }
  }
`;

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }>;
}

interface ScoutImageDetails {
  digest: string;
  compressedSize: number | null;
  platform: ImagePlatform | null;
}

interface ScoutVulnerability {
  sourceId: string;
  source: string;
  description?: string | null;
  fixedBy?: string | null;
  url?: string | null;
  cvss?: { severity?: string | null; score?: number | null } | null;
}

export interface ScoutPackage {
  package: {
    purl: string;
    name: string | null;
    version: string;
    vulnerabilities: ScoutVulnerability[];
  };
}

interface ScoutInventory {
  sbomState: string;
  imagePackages: { packages: ScoutPackage[] };
}

export interface ScoutFindings {
  status: 'available' | 'not-indexed';
  findings: Finding[];
  message?: string;
}

async function scoutQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await requestJson<GraphQLResponse<T>>(SCOUT_ENDPOINT, {
    label: 'Docker Scout',
    method: 'POST',
    body: { query, variables },
  });
  if (response.errors?.length || !response.data) {
    throw new ApiError('Docker Scout에서 공개 분석 정보를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return response.data;
}

export async function readDigestMetadata(reference: ParsedImageReference, requestedPlatform: string): Promise<ImageMetadata | null> {
  const data = await scoutQuery<{ imageDetailsListByDigest: ScoutImageDetails[] }>(IMAGE_DETAILS_QUERY, {
    digest: reference.digest,
    repository: reference.repository,
  });
  if (!Array.isArray(data.imageDetailsListByDigest)) throw new ApiError('Docker Scout 이미지 응답 형식이 변경되었습니다.');
  const platforms = data.imageDetailsListByDigest
    .filter((image) => image && image.platform && isDigest(image.digest))
    .map((image) => ({ ...image.platform!, image }));
  const match = findPlatform(platforms, requestedPlatform);
  if (!match) return null;

  return {
    repository: reference.repository,
    reference: reference.normalized,
    tag: reference.tag,
    digest: match.image.digest,
    platform: platformName(match),
    size: typeof match.image.compressedSize === 'number' ? match.image.compressedSize : null,
    updatedAt: null,
    sourceUrl: repositoryUrl(reference.repository),
  };
}

export async function readFindings(digest: string): Promise<ScoutFindings> {
  const data = await scoutQuery<{ imagePackagesByDigest: ScoutInventory | null }>(FINDINGS_QUERY, { digest });
  const inventory = data.imagePackagesByDigest;
  if (!inventory || inventory.sbomState !== 'INDEXED') {
    return {
      status: 'not-indexed',
      findings: [],
      message: '이 이미지의 공개 취약점 분석이 아직 제공되지 않습니다.',
    };
  }

  if (!Array.isArray(inventory.imagePackages?.packages)) {
    throw new ApiError('Docker Scout 패키지 응답 형식이 변경되었습니다.');
  }
  return { status: 'available', findings: normalizeFindings(inventory.imagePackages.packages) };
}

export function normalizeFindings(packages: ScoutPackage[]): Finding[] {
  const findings = new Map<string, Finding>();

  for (const entry of packages) {
    const pkg = entry?.package;
    if (!pkg || typeof pkg.purl !== 'string' || typeof pkg.version !== 'string' || !Array.isArray(pkg.vulnerabilities)) {
      throw new ApiError('Docker Scout 패키지 응답 형식이 변경되었습니다.');
    }

    for (const vulnerability of pkg.vulnerabilities) {
      if (!vulnerability || typeof vulnerability.sourceId !== 'string' || !vulnerability.sourceId.trim()) {
        throw new ApiError('Docker Scout 취약점 응답 형식이 변경되었습니다.');
      }
      const source = vulnerability.source || 'unknown';
      const id = `${pkg.purl}::${vulnerability.sourceId}::${source}`;
      findings.set(id, {
        id,
        cve: vulnerability.sourceId,
        packageName: pkg.name || pkg.purl,
        packageVersion: pkg.version,
        purl: pkg.purl,
        severity: normalizeSeverity(vulnerability.cvss?.severity),
        score: normalizeScore(vulnerability.cvss?.score),
        fixedVersion: vulnerability.fixedBy?.trim() || null,
        description: vulnerability.description?.trim() || '제공된 설명이 없습니다.',
        source,
        url: advisoryUrl(vulnerability.url, vulnerability.sourceId),
      });
    }
  }

  return [...findings.values()].sort((a, b) =>
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    || a.cve.localeCompare(b.cve)
    || a.packageName.localeCompare(b.packageName));
}

function normalizeSeverity(value: string | null | undefined): Severity {
  const normalized = value?.toUpperCase();
  return SEVERITIES.includes(normalized as Severity) ? normalized as Severity : 'UNKNOWN';
}

function normalizeScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function advisoryUrl(value: string | null | undefined, id: string): string {
  try {
    const url = new URL(value ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* An absent provider URL uses the public advisory page. */ }
  return `https://scout.docker.com/v/${encodeURIComponent(id)}`;
}
