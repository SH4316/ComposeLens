export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ParsedImageReference {
  registry: string;
  repository: string;
  tag: string | null;
  digest: string | null;
  normalized: string;
  pinned: boolean;
}

export interface ImageMetadata {
  repository: string;
  reference: string;
  tag: string | null;
  digest: string;
  platform: string;
  size: number | null;
  updatedAt: string | null;
  sourceUrl: string;
}

export interface Finding {
  id: string;
  cve: string;
  packageName: string;
  packageVersion: string;
  purl: string;
  severity: Severity;
  score: number | null;
  fixedVersion: string | null;
  description: string;
  source: string;
  url: string;
}

export interface ImageReport {
  metadata: ImageMetadata | null;
  findings: Finding[];
  status: 'available' | 'not-indexed' | 'unavailable' | 'unsupported';
  message?: string;
  retrievedAt: string;
}

export interface TagOption {
  name: string;
  digest: string;
  updatedAt: string | null;
}

export interface TagPage {
  tags: TagOption[];
  nextPage: number | null;
}
