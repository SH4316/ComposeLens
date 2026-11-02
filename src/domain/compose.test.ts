import { describe, expect, it } from 'vitest';
import { parseCompose } from './compose';

describe('parseCompose', () => {
  it('deduplicates canonical references and preserves service relationships', () => {
    const result = parseCompose(`services:
  web:
    image: nginx
  proxy:
    image: docker.io/library/nginx:latest
  arm:
    image: nginx
    platform: linux/arm64
`);
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ declaredRef: 'nginx', services: ['web', 'proxy'], platform: 'linux/amd64' });
    expect(result.images[1]).toMatchObject({ services: ['arm'], platform: 'linux/arm64' });
  });

  it('reads merged YAML anchors without executing or building the services', () => {
    const result = parseCompose(`x-base: &base
  image: redis:7
  platform: linux/arm64/v8
services:
  cache:
    <<: *base
`);
    expect(result.images[0]).toMatchObject({ declaredRef: 'redis:7', platform: 'linux/arm64/v8' });
    expect(result.images[0].issue).toBeUndefined();
  });

  it('resolves inline defaults, including nested defaults, using an empty environment', () => {
    const result = parseCompose('services:\n  app:\n    image: ${REGISTRY:-docker.io}/library/nginx:${TAG:-${VERSION-1.27}}\n');
    expect(result.images[0].declaredRef).toBe('docker.io/library/nginx:1.27');
    expect(result.images[0].issue).toBeUndefined();
  });

  it('does not use container environment entries to resolve image variables', () => {
    const result = parseCompose('services:\n  app:\n    image: nginx:${TAG}\n    environment:\n      TAG: 1.27\n');
    expect(result.images[0].issue).toContain('TAG');
    expect(result.images[0].declaredRef).toBe('nginx:${TAG}');
  });

  it('does not use the host environment for an image variable', () => {
    const result = parseCompose('services:\n  app:\n    image: nginx:$HOME\n');
    expect(result.images[0].issue).toContain('HOME');
  });

  it('keeps unresolved platform variables visible', () => {
    const result = parseCompose('services:\n  app:\n    image: nginx\n    platform: ${PLATFORM}\n');
    expect(result.images[0].issue).toContain('PLATFORM');
  });

  it('handles an unset alternative expression without inventing an environment', () => {
    const result = parseCompose('services:\n  app:\n    image: ${PREFIX:+private/}nginx:latest\n');
    expect(result.images[0].declaredRef).toBe('nginx:latest');
  });

  it('marks escaped dollars and malformed references as unresolved images', () => {
    const result = parseCompose('services:\n  app:\n    image: nginx:$$TAG\n');
    expect(result.images[0].declaredRef).toBe('nginx:$TAG');
    expect(result.images[0].issue).toContain('이미지 참조');
  });

  it('preserves build-only and externally inherited services instead of claiming no vulnerabilities', () => {
    const result = parseCompose(`include:
  - ./other.yml
services:
  first:
    build: .
  second:
    build: ./other
  inherited:
    extends:
      file: ./base.yml
      service: base
  explicit:
    image: nginx:1.27
    extends:
      file: ./base.yml
      service: base
`);
    expect(result.images).toHaveLength(4);
    expect(result.images[0].issue).toContain('로컬 빌드');
    expect(result.images[2].issue).toContain('외부 Compose');
    expect(result.images[3].issue).toBeUndefined();
    expect(result.warnings).toHaveLength(3);
  });

  it.each([
    'not: compose',
    'services: []',
    'services: {}',
    'services:\n  app: [',
    'services:\n  app:\n    image: nginx\n    image: redis\n',
  ])('rejects a missing or ambiguous service definition', (source) => {
    expect(() => parseCompose(source)).toThrow();
  });

  it('reports an invalid image per service while preserving usable results', () => {
    const result = parseCompose('services:\n  good:\n    image: redis:7\n  bad:\n    image: nginx:${BROKEN\n');
    expect(result.images[0].issue).toBeUndefined();
    expect(result.images[1].issue).toContain('중괄호');
  });
});
