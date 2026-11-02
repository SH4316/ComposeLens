import { describe, expect, it } from 'vitest';
import { normalizeFindings, type ScoutPackage } from './scout';

function packageFixture(vulnerabilities: ScoutPackage['package']['vulnerabilities']): ScoutPackage {
  return { package: { name: 'openssl', purl: 'pkg:deb/debian/openssl@3.0.0', version: '3.0.0', vulnerabilities } };
}

describe('normalizeFindings', () => {
  it('keeps source-specific advisories while deduplicating exact repeats', () => {
    const debian = { sourceId: 'CVE-2026-1000', source: 'debian', fixedBy: null, cvss: { severity: 'HIGH' } };
    const result = normalizeFindings([packageFixture([debian, debian, { ...debian, source: 'nvd' }])]);

    expect(result).toHaveLength(2);
    expect(result.map((finding) => finding.source)).toEqual(['debian', 'nvd']);
    expect(result[0].fixedVersion).toBeNull();
  });

  it('keeps non-CVE advisory identifiers and does not invent missing scores or severity', () => {
    const result = normalizeFindings([packageFixture([{
      sourceId: 'GHSA-example-example', source: 'github', cvss: null, fixedBy: '',
    }])]);

    expect(result[0]).toMatchObject({ cve: 'GHSA-example-example', severity: 'UNKNOWN', score: null, fixedVersion: null });
  });

  it('replaces unsafe advisory URLs with the public Scout advisory URL', () => {
    const result = normalizeFindings([packageFixture([{
      sourceId: 'CVE-2026-1000', source: 'debian', url: 'javascript:alert(1)',
    }])]);

    expect(result[0].url).toBe('https://scout.docker.com/v/CVE-2026-1000');
  });

  it('rejects malformed inventories instead of reporting no vulnerabilities', () => {
    expect(() => normalizeFindings([{ package: { purl: 'pkg:example', version: '1' } } as ScoutPackage])).toThrow('응답 형식');
  });
});
