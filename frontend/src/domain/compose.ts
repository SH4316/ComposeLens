import { parseDocument } from 'yaml';
import { parseImageReference } from '@composelens/shared/image-reference';
import type { ImageSpec, ParsedCompose } from './types';

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

function readService(name: string, service: unknown): ImageSpec {
  const fallback: ImageSpec = {
    id: `service:${name}`,
    services: [name],
    declaredRef: '(이미지 미지정)',
    platform: DEFAULT_PLATFORM,
  };

  if (!isMapping(service)) return { ...fallback, issue: '서비스 설정이 객체가 아닙니다.' };
  if (typeof service.image !== 'string' || !service.image.trim()) {
    const issue = service.build
      ? '로컬 빌드만 지정되어 있습니다. 공개 레지스트리 이미지를 결정할 수 없습니다.'
      : service.extends
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
      return { ...spec, issue: `기본값이 없는 환경변수: ${missing.join(', ')}. 실행 환경의 값을 확인해주세요.` };
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
