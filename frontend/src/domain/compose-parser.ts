/** Parses Compose services, image references and build declarations without I/O. */
import { parseDocument } from 'yaml';
import { parseImageReference } from '@composelens/shared/image-reference';
import type { BuildSpec, ImageSpec, ParsedCompose } from './analysis-types';

type Mapping = Record<string, unknown>;

interface ExpandedValue {
  value: string;
  missing: string[];
}

const DEFAULT_PLATFORM = 'linux/amd64';
const PLATFORM = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)?$/;

function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closingBrace(input: string, start: number): number {
  let depth = 1;
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === '{') depth += 1;
    if (input[index] === '}' && --depth === 0) return index;
  }
  throw new Error('환경변수 표현식의 닫는 중괄호가 없습니다.');
}

function expandBraced(expression: string): ExpandedValue {
  const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?|:\+|\+)([\s\S]*))?$/);
  if (!match) throw new Error('지원하지 않는 환경변수 표현식이 있습니다.');

  const [, name, operator, fallback = ''] = match;
  if (operator === ':-' || operator === '-') return expandDefaults(fallback);
  if (operator === ':+' || operator === '+') return { value: '', missing: [] };
  return { value: `\${${expression}}`, missing: [name] };
}

/** The app has no deployment environment; only defaults embedded in the file apply. */
function expandDefaults(input: string): ExpandedValue {
  let value = '';
  const missing = new Set<string>();

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== '$') {
      value += character;
      continue;
    }

    if (input[index + 1] === '$') {
      value += '$';
      index += 1;
      continue;
    }

    if (input[index + 1] === '{') {
      const end = closingBrace(input, index + 2);
      const expanded = expandBraced(input.slice(index + 2, end));
      value += expanded.value;
      expanded.missing.forEach((name) => missing.add(name));
      index = end;
      continue;
    }

    const variable = input.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    value += variable ? `$${variable}` : '$';
    if (variable) {
      missing.add(variable);
      index += variable.length;
    }
  }

  return { value, missing: [...missing] };
}

function missingVariables(names: string[]): string {
  return `기본값이 없는 환경변수: ${names.join(', ')}. 실행 환경의 값을 확인해주세요.`;
}

function buildString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
  const expanded = expandDefaults(value.trim());
  if (expanded.missing.length) throw new Error(missingVariables(expanded.missing));
  if (!expanded.value.trim()) throw new Error(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
  return expanded.value;
}

function localBuildPath(path: string, label: string): void {
  if (path.startsWith('/') || path.startsWith('~') || path.includes('\\') || /^[a-z]:\//i.test(path)) {
    throw new Error(`${label}: 호스트의 절대 경로는 읽을 수 없습니다. 저장소 안의 상대 경로를 지정해주세요.`);
  }
  if (/^(?:[a-z][a-z\d+.-]*:|[^/]+@[^/]+:|(?:github\.com|gitlab\.com|bitbucket\.org)\/)/i.test(path)) {
    throw new Error(`${label}: 원격 빌드 컨텍스트는 지원하지 않습니다. 같은 GitHub 저장소의 파일 경로를 지정해주세요.`);
  }
}

function readBuildArgs(value: unknown): Pick<BuildSpec, 'args' | 'unresolvedArgs'> {
  if (value === undefined) return { args: {} };
  let entries: [string, unknown][];
  if (Array.isArray(value)) {
    entries = value.map((argument) => {
      if (typeof argument !== 'string') throw new Error('build.args 목록에는 문자열만 지정할 수 있습니다.');
      const separator = argument.indexOf('=');
      return separator < 0 ? [argument, null] : [argument.slice(0, separator), argument.slice(separator + 1)];
    });
  } else if (isMapping(value)) {
    entries = Object.entries(value);
  } else {
    throw new Error('build.args는 객체 또는 KEY=value 문자열 목록이어야 합니다.');
  }

  const unresolved = new Set<string>();
  const args = Object.fromEntries(entries.map(([name, argument]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`빌드 인자 이름을 확인해주세요: ${name}`);
    unresolved.delete(name);
    if (argument === null) return [name, null];
    if (!['string', 'number', 'boolean'].includes(typeof argument)) {
      throw new Error(`빌드 인자 ${name}은 문자열, 숫자, 불리언 또는 null이어야 합니다.`);
    }
    const expanded = expandDefaults(String(argument));
    if (expanded.missing.length) unresolved.add(name);
    return [name, expanded.value];
  }));
  return unresolved.size ? { args, unresolvedArgs: [...unresolved] } : { args };
}

function readBuildService(name: string, service: Mapping, fallback: ImageSpec): ImageSpec {
  const build: BuildSpec = { context: '.', dockerfile: 'Dockerfile', args: {} };
  const spec: ImageSpec = { ...fallback, id: `build:${name}`, declaredRef: '(로컬 빌드)', build };
  if (typeof service.image === 'string' && service.image.trim()) {
    // This is the build's output tag, not a registry image to inspect. An unknown
    // output tag does not prevent reading a known Dockerfile base image.
    build.outputRef = service.image.trim();
    try { build.outputRef = expandDefaults(build.outputRef).value; } catch { /* Keep the declared output tag visible. */ }
    spec.declaredRef = build.outputRef;
  }

  try {
    const platform = expandDefaults(typeof service.platform === 'string' ? service.platform : DEFAULT_PLATFORM);
    spec.platform = platform.value;
    if (platform.missing.length) throw new Error(missingVariables(platform.missing));
    if (!PLATFORM.test(platform.value)) throw new Error('플랫폼 형식을 확인해주세요. 예: linux/amd64 또는 linux/arm64/v8');

    const configuration = service.build;
    if (typeof configuration === 'string') {
      build.context = buildString(configuration, 'build.context');
    } else if (isMapping(configuration)) {
      if (configuration.extra_contexts !== undefined || configuration.additional_contexts !== undefined) {
        throw new Error('추가 빌드 컨텍스트(extra_contexts/additional_contexts)는 지원하지 않습니다.');
      }
      if (configuration.context !== undefined) build.context = buildString(configuration.context, 'build.context');
      if (configuration.dockerfile !== undefined) build.dockerfile = buildString(configuration.dockerfile, 'build.dockerfile');
      if (configuration.dockerfile_inline !== undefined) {
        if (configuration.dockerfile !== undefined) throw new Error('build.dockerfile과 dockerfile_inline은 함께 지정할 수 없습니다.');
        if (typeof configuration.dockerfile_inline !== 'string' || !configuration.dockerfile_inline.trim()) {
          throw new Error('build.dockerfile_inline은 비어 있지 않은 문자열이어야 합니다.');
        }
        const inline = expandDefaults(configuration.dockerfile_inline);
        if (inline.missing.length) throw new Error(missingVariables(inline.missing));
        build.dockerfileInline = inline.value;
      }
      if (configuration.target !== undefined) build.target = buildString(configuration.target, 'build.target');
      Object.assign(build, readBuildArgs(configuration.args));
    } else {
      throw new Error('build는 컨텍스트 경로 문자열 또는 빌드 설정 객체여야 합니다.');
    }
    localBuildPath(build.context, 'build.context');
    localBuildPath(build.dockerfile, 'build.dockerfile');
    return spec;
  } catch (error) {
    return { ...spec, issue: error instanceof Error ? error.message : '빌드 설정을 해석할 수 없습니다.' };
  }
}

function readService(name: string, service: unknown): ImageSpec {
  const fallback: ImageSpec = {
    id: `service:${name}`,
    services: [name],
    declaredRef: '(이미지 미지정)',
    platform: DEFAULT_PLATFORM,
  };

  if (!isMapping(service)) return { ...fallback, issue: '서비스 설정이 객체가 아닙니다.' };
  if (service.build !== undefined) return readBuildService(name, service, fallback);
  if (typeof service.image !== 'string' || !service.image.trim()) {
    const issue = service.extends
        ? '외부 Compose 파일의 이미지가 필요합니다. 단일 파일 분석에서는 읽지 않습니다.'
        : '서비스에 image가 지정되어 있지 않습니다.';
    return { ...fallback, issue };
  }

  const spec: ImageSpec = { ...fallback, declaredRef: service.image.trim() };
  try {
    const image = expandDefaults(spec.declaredRef);
    const platform = expandDefaults(
      typeof service.platform === 'string' ? service.platform : DEFAULT_PLATFORM,
    );
    spec.declaredRef = image.value;
    spec.platform = platform.value;

    const missing = [...new Set([...image.missing, ...platform.missing])];
    if (missing.length) {
      return { ...spec, issue: missingVariables(missing) };
    }
    if (!PLATFORM.test(platform.value)) {
      return { ...spec, issue: '플랫폼 형식을 확인해주세요. 예: linux/amd64 또는 linux/arm64/v8' };
    }

    const reference = parseImageReference(image.value);
    return {
      ...spec,
      id: `image:${encodeURIComponent(reference.normalized)}:${encodeURIComponent(platform.value)}`,
    };
  } catch (error) {
    return { ...spec, issue: error instanceof Error ? error.message : '이미지를 해석할 수 없습니다.' };
  }
}

export function parseCompose(source: string): ParsedCompose {
  const document = parseDocument(source, { merge: true, uniqueKeys: true });
  if (document.errors.length) {
    throw new Error(`Compose YAML을 읽을 수 없습니다: ${document.errors[0].message}`);
  }

  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 100 });
  } catch {
    throw new Error('YAML 앵커 참조가 너무 많거나 순환합니다. Compose 파일을 확인해주세요.');
  }
  if (!isMapping(data) || !isMapping(data.services)) {
    throw new Error('Compose 파일에 services 객체가 필요합니다. 파일 경로와 내용을 확인해주세요.');
  }
  if (!Object.keys(data.services).length) throw new Error('Compose 파일에 분석할 서비스가 없습니다.');

  const warnings = document.warnings.map((warning) => warning.message);
  if (data.include !== undefined) warnings.push('include로 연결된 외부 Compose 파일은 읽지 않았습니다.');

  const byImage = new Map<string, ImageSpec>();
  for (const [name, service] of Object.entries(data.services)) {
    if (isMapping(service) && service.extends !== undefined) {
      warnings.push(`${name}: extends로 연결된 외부 설정은 읽지 않았습니다.`);
    }
    const image = readService(name, service);
    const existing = byImage.get(image.id);
    if (existing) existing.services.push(name);
    else byImage.set(image.id, image);
  }

  return { images: [...byImage.values()], warnings };
}
