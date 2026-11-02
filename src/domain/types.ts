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

export interface ImageSpec {
  id: string;
  services: string[];
  declaredRef: string;
  platform: string;
  issue?: string;
}

export interface ParsedCompose {
  images: ImageSpec[];
  warnings: string[];
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

export interface ImageState {
  spec: ImageSpec;
  selectedRef: string;
  report: ImageReport | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string | null;
}

export interface LinkedFinding extends Finding {
  imageId: string;
  imageReference: string;
  imageServices: string[];
}

export interface VulnerabilityNode {
  id: string;
  cve: string;
  severity: Severity;
  findings: LinkedFinding[];
}

export interface RelationEdge {
  id: string;
  imageId: string;
  vulnerabilityId: string;
  uncertain: boolean;
}

export interface RelationGraph {
  images: ImageState[];
  vulnerabilities: VulnerabilityNode[];
  edges: RelationEdge[];
}

export interface Filters {
  search: string;
  severities: Severity[];
  fix: 'all' | 'available' | 'unavailable';
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

export interface RepositoryFile {
  content: string;
  repository: string;
  branch: string;
  path: string;
  htmlUrl: string;
  sha: string;
}
