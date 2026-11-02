import type { ParsedImageReference } from './types';

const DOCKER_HUB_ALIASES = new Set([
  'docker.io',
  'index.docker.io',
  'registry-1.docker.io',
]);

const REPOSITORY_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST = /^(?:sha256:[a-fA-F0-9]{64}|sha512:[a-fA-F0-9]{128})$/;

function invalidReference(): never {
  throw new Error('이미지 참조 형식을 확인해주세요. 예: nginx:1.27 또는 nginx@sha256:…');
}

function isRegistry(component: string): boolean {
  return component === 'localhost' || /[.:]/.test(component);
}

function validRegistry(registry: string): boolean {
  const match = registry.match(/^([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)(?::([0-9]+))?$/);
  if (!match) return false;
  return !match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535);
}

/** Parse an OCI-style reference without consulting a registry or environment. */
export function parseImageReference(input: string): ParsedImageReference {
  const reference = input.trim();
  if (!reference || /\s|:\/\/|[?#\\]/.test(reference)) invalidReference();

  const digestParts = reference.split('@');
  if (digestParts.length > 2) invalidReference();

  let name = digestParts[0];
  const digest = digestParts[1]?.toLowerCase() ?? null;
  if (digest !== null && !DIGEST.test(digest)) invalidReference();

  let tag: string | null = null;
  const lastColon = name.lastIndexOf(':');
  if (lastColon > name.lastIndexOf('/')) {
    tag = name.slice(lastColon + 1);
    name = name.slice(0, lastColon);
    if (!TAG.test(tag)) invalidReference();
  }

  const components = name.split('/');
  if (components.some((component) => !component)) invalidReference();

  let registry = 'docker.io';
  if (components.length > 1 && isRegistry(components[0])) {
    registry = components.shift()!.toLowerCase();
    if (!validRegistry(registry)) invalidReference();
  }

  if (DOCKER_HUB_ALIASES.has(registry)) registry = 'docker.io';
  if (!components.every((component) => REPOSITORY_COMPONENT.test(component))) invalidReference();
  if (registry === 'docker.io' && components.length === 1) components.unshift('library');

  const repository = components.join('/');
  if (repository.length > 255) invalidReference();
  if (!tag && !digest) tag = 'latest';

  return {
    registry,
    repository,
    tag,
    digest,
    normalized: `${registry}/${repository}${tag ? `:${tag}` : ''}${digest ? `@${digest}` : ''}`,
    pinned: digest !== null,
  };
}
