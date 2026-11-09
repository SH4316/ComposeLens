import { describe, expect, it } from 'vitest';
import type { ImageState } from './analysis-types';
import { versionSource } from './version-source';

const digest = `sha256:${'a'.repeat(64)}`;
function image(selectedRef: string, declaredRef = 'python:3.11'): ImageState {
  return { selectedRef, spec: { id: 'python', declaredRef, platform: 'linux/amd64', services: ['web'] }, report: null, status: 'done', error: null };
}
describe('version browsing source', () => {
  it('uses the selected tag and falls back to the original tag for a digest in the same repository', () => {
    expect(versionSource(image('python:3.12'))).toBe('python:3.12');
    expect(versionSource(image(`library/python@${digest}`))).toBe('python:3.11');
  });
  it('does not borrow tag history from another repository or a digest-only declaration', () => {
    expect(versionSource(image(`redis@${digest}`))).toBeNull();
    expect(versionSource(image(`python@${digest}`, `python@${digest}`))).toBeNull();
  });
  it('retains the tag whose observation was selected', () => {
    const selected = image(`python@${digest}`);
    selected.history = { sourceReference: 'library/python:3.12', digest, indexDigest: digest,
      platform: 'linux/amd64', recordedAt: '2026-10-28T00:00:00Z', sourceUrl: 'https://github.com/docker-library/repo-info', version: '3.12.1' };
    expect(versionSource(selected)).toBe('library/python:3.12');
  });
});
