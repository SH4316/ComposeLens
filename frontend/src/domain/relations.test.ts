import { describe, expect, it } from 'vitest';
import { buildGraph } from './relations';
import type { Finding } from '@composelens/shared';
import type { Filters, ImageState } from './types';

const defaultFilters: Filters = { search: '', severities: [], fix: 'all' };
const digest = `sha256:${'a'.repeat(64)}`;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-a', cve: 'CVE-2026-1000', packageName: 'openssl', packageVersion: '3.0',
    purl: 'pkg:deb/debian/openssl@3.0', severity: 'HIGH', score: 8.1, fixedVersion: null,
    description: 'A package vulnerability', source: 'debian', url: 'https://example.org/cve',
    ...overrides,
  };
}

function image(id: string, findings: Finding[], selectedRef = 'nginx:latest'): ImageState {
  return {
    spec: { id, services: [id], declaredRef: selectedRef, platform: 'linux/amd64' },
    selectedRef, status: 'done', error: null,
    report: { metadata: null, status: 'available', findings, retrievedAt: '2026-11-02T00:00:00Z' },
  };
}

describe('buildGraph', () => {
  it('merges a CVE across images and packages while preserving each affected package', () => {
    const graph = buildGraph([
      image('web', [finding(), finding({ id: 'other-package', packageName: 'curl', severity: 'LOW' })]),
      image('api', [finding({ severity: 'CRITICAL', fixedVersion: '3.1' })], `nginx@${digest}`),
    ], defaultFilters);
    expect(graph.vulnerabilities).toHaveLength(1);
    expect(graph.vulnerabilities[0].findings).toHaveLength(3);
    expect(graph.vulnerabilities[0].severity).toBe('CRITICAL');
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.find((edge) => edge.imageId === 'web')?.uncertain).toBe(true);
    expect(graph.edges.find((edge) => edge.imageId === 'api')?.uncertain).toBe(false);
  });

  it('filters actual package findings before recomputing CVE severity and links', () => {
    const graph = buildGraph([
      image('web', [finding({ severity: 'HIGH', fixedVersion: null })]),
      image('api', [finding({ severity: 'LOW', fixedVersion: '3.1' })]),
    ], { ...defaultFilters, fix: 'available' });
    expect(graph.images.map((entry) => entry.spec.id)).toEqual(['api']);
    expect(graph.vulnerabilities[0].severity).toBe('LOW');
    expect(graph.vulnerabilities[0].findings).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
  });

  it('keeps zero-CVE and unavailable images in the unfiltered inventory', () => {
    const empty = image('empty', []);
    const unavailable = image('unknown', []);
    unavailable.report!.status = 'not-indexed';
    const graph = buildGraph([empty, unavailable], defaultFilters);
    expect(graph.images).toHaveLength(2);
    expect(graph.vulnerabilities).toEqual([]);
  });

  it('narrows both sides for a package search and ignores unrelated findings on the same image', () => {
    const graph = buildGraph([
      image('one', [finding(), finding({ id: 'curl', cve: 'CVE-2026-2000', packageName: 'curl', purl: 'pkg:curl' })]),
      image('two', [finding({ id: 'sqlite', packageName: 'sqlite', purl: 'pkg:sqlite' })]),
    ], { ...defaultFilters, search: 'OPENSSL' });
    expect(graph.images.map((entry) => entry.spec.id)).toEqual(['one']);
    expect(graph.vulnerabilities.map((entry) => entry.cve)).toEqual(['CVE-2026-1000']);
  });

  it('supports image/service search without hiding an image whose analysis has no findings', () => {
    const graph = buildGraph([image('cache-service', [], 'redis:7')], { ...defaultFilters, search: 'cache-service' });
    expect(graph.images).toHaveLength(1);
    expect(buildGraph(graph.images, { ...defaultFilters, search: 'cache-service', severities: ['HIGH'] }).images).toHaveLength(0);
  });

  it('sorts CVEs by the highest remaining severity and then identifier', () => {
    const graph = buildGraph([image('one', [
      finding({ id: 'low', cve: 'CVE-2026-0001', severity: 'LOW' }),
      finding({ id: 'critical-b', cve: 'CVE-2026-0003', severity: 'CRITICAL' }),
      finding({ id: 'critical-a', cve: 'CVE-2026-0002', severity: 'CRITICAL' }),
    ])], defaultFilters);
    expect(graph.vulnerabilities.map((node) => node.cve)).toEqual(['CVE-2026-0002', 'CVE-2026-0003', 'CVE-2026-0001']);
  });

  it('does not mutate the original findings or create duplicate edges', () => {
    const entry = image('one', [finding(), finding()]);
    const original = JSON.stringify(entry);
    const graph = buildGraph([entry], defaultFilters);
    expect(graph.edges).toHaveLength(1);
    expect(graph.vulnerabilities[0].findings).toHaveLength(1);
    expect(JSON.stringify(entry)).toBe(original);
  });
});
