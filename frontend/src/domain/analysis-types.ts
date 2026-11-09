/** Frontend models for Compose inputs, image analysis and CVE relationships. */
import type { Finding, HistoricalImage, ImageReport, Severity } from '@composelens/shared';

export interface BuildSpec {
  context: string;
  dockerfile: string;
  dockerfileInline?: string;
  target?: string;
  args: Record<string, string | null>;
  unresolvedArgs?: string[];
  outputRef?: string;
}

export interface BuildOrigin {
  dockerfile: string;
  stage: string;
  outputRef?: string;
  baseRef: string;
  source?: RepositoryFileLocation;
}

export interface ImageSpec {
  id: string;
  services: string[];
  declaredRef: string;
  platform: string;
  issue?: string;
  build?: BuildSpec;
  origin?: BuildOrigin;
}

export interface ParsedCompose {
  images: ImageSpec[];
  warnings: string[];
}

export interface ImageState {
  spec: ImageSpec;
  selectedRef: string;
  report: ImageReport | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string | null;
  history?: HistoricalImage;
}

export interface LinkedFinding extends Finding {
  imageId: string;
  imageReference: string;
  imageServices: string[];
  imageOrigin?: BuildOrigin;
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

export interface RepositoryFileLocation {
  repository: string;
  ref: string;
  path: string;
}

export interface RepositoryFile {
  content: string;
  /** The selected superproject and logical checkout path, including submodule mounts. */
  repository: string;
  branch: string;
  path: string;
  htmlUrl: string;
  sha: string;
  /** The actual file location when traversal crossed one or more submodules. */
  resolvedLocation?: RepositoryFileLocation;
}
