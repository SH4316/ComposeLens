import type { Finding, ImageReport, Severity } from '@composelens/shared';

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

export interface RepositoryFile {
  content: string;
  repository: string;
  branch: string;
  path: string;
  htmlUrl: string;
  sha: string;
}
