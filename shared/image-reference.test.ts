import { describe, expect, it } from 'vitest';
import { parseImageReference } from './image-reference';

const digest = `sha256:${'a'.repeat(64)}`;

describe('parseImageReference', () => {
  it('normalizes official image shorthand and an implicit latest tag', () => {
    expect(parseImageReference('nginx')).toEqual({
      registry: 'docker.io',
      repository: 'library/nginx',
      tag: 'latest',
      digest: null,
      normalized: 'docker.io/library/nginx:latest',
      pinned: false,
    });
  });

  it.each(['docker.io', 'index.docker.io', 'registry-1.docker.io'])(
    'normalizes the Docker Hub alias %s',
    (registry) => {
      expect(parseImageReference(`${registry}/nginx:1.27`).normalized).toBe('docker.io/library/nginx:1.27');
    },
  );

  it('distinguishes a registry port from an image tag', () => {
    expect(parseImageReference('localhost:5000/team/image:RC.1')).toMatchObject({
      registry: 'localhost:5000',
      repository: 'team/image',
      tag: 'RC.1',
    });
  });

  it('retains a non-Docker registry so callers can disclose unsupported registries', () => {
    expect(parseImageReference('ghcr.io/owner/nested/image')).toMatchObject({
      registry: 'ghcr.io', repository: 'owner/nested/image', tag: 'latest',
    });
  });

  it('supports a digest without adding latest', () => {
    expect(parseImageReference(`nginx@${digest}`)).toMatchObject({
      tag: null, digest, pinned: true, normalized: `docker.io/library/nginx@${digest}`,
    });
  });

  it('keeps tag and digest when both are declared', () => {
    expect(parseImageReference(`nginx:1.27@${digest}`)).toMatchObject({ tag: '1.27', digest, pinned: true });
  });

  it.each([
    '', 'nginx:', 'Nginx:latest', 'nginx bad', 'https://docker.io/nginx',
    'nginx@sha256:abc', `nginx@@${digest}`, 'owner//image', '../nginx',
    'nginx?secret=1', 'nginx#fragment', 'nginx:tag:other', 'registry.io:0/image',
  ])('rejects malformed reference %j', (reference) => {
    expect(() => parseImageReference(reference)).toThrow('이미지 참조');
  });
});
