/** Resolves the external base of a Dockerfile target without executing build instructions. */
import { parseImageReference } from '@composelens/shared/image-reference';

export interface DockerfileOptions {
  args?: Record<string, string | null>;
  /** Explicit Compose argument values containing unresolved environment variables. */
  unresolvedArgs?: string[];
  target?: string;
  platform?: string;
}

export interface ResolvedDockerfile {
  reference: string;
  platform: string;
  /** Selected stage name, or its zero-based index when unnamed. */
  stage: string;
  warnings: string[];
}

interface Instruction {
  name: string;
  arguments: string;
  line: number;
}

interface Expanded {
  value: string;
  missing: string[];
  issue?: string;
}

interface Stage {
  name?: string;
  base: string;
  platform?: string;
  line: number;
}

type Arguments = Map<string, Expanded>;

const DEFAULT_PLATFORM = 'linux/amd64';
const PLATFORM = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)?$/;
const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STAGE_NAME = /^[a-z][a-z0-9_.-]*$/i;
const INSTRUCTIONS = new Set([
  'ADD', 'ARG', 'CMD', 'COPY', 'ENTRYPOINT', 'ENV', 'EXPOSE', 'FROM', 'HEALTHCHECK',
  'LABEL', 'MAINTAINER', 'ONBUILD', 'RUN', 'SHELL', 'STOPSIGNAL', 'USER', 'VOLUME', 'WORKDIR',
]);

function atLine(line: number, message: string): Error {
  return new Error(`Dockerfile ${line}행: ${message}`);
}

/** Split shell words without removing quotes or expanding any environment. */
function words(input: string, escape: string): string[] {
  const result: string[] = [];
  let word = '';
  let quote = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === escape && quote !== "'") {
      word += character;
      if (index + 1 < input.length) word += input[++index];
      continue;
    }
    if (quote) {
      word += character;
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
      word += character;
    } else if (/\s/.test(character)) {
      if (word) result.push(word);
      word = '';
    } else {
      word += character;
    }
  }
  if (quote) throw new Error('따옴표가 닫히지 않았습니다.');
  if (word) result.push(word);
  return result;
}

function braceEnd(input: string, start: number, escape: string): number {
  let depth = 1;
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === escape) {
      index += 1;
      continue;
    }
    if (input[index] === '{') depth += 1;
    if (input[index] === '}' && --depth === 0) return index;
  }
  throw new Error('ARG 표현식의 닫는 중괄호가 없습니다.');
}

function literal(value: string): Expanded {
  return { value, missing: [] };
}

/** Docker interpolation is sequential and is independent of Compose interpolation. */
function expand(input: string, environment: Arguments, escape: string): Expanded {
  let value = '';
  let quote = '';
  let issue: string | undefined;
  const missing = new Set<string>();
  const append = (part: Expanded) => {
    value += part.value;
    part.missing.forEach((name) => missing.add(name));
    issue ??= part.issue;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === escape && quote !== "'") {
      const next = input[index + 1];
      if (next === undefined) throw new Error('줄 끝의 이스케이프 문자를 확인해주세요.');
      if (quote === '"' && next !== '$' && next !== '"' && next !== escape) value += character;
      else {
        value += next;
        index += 1;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      if (!quote) quote = character;
      else if (quote === character) quote = '';
      else value += character;
      continue;
    }
    if (character !== '$' || quote === "'") {
      value += character;
      continue;
    }

    if (input[index + 1] === '{') {
      const end = braceEnd(input, index + 2, escape);
      const expression = input.slice(index + 2, end);
      const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\+|\+)([\s\S]*))?$/);
      if (!match) throw new Error(`지원하지 않는 ARG 표현식입니다: \${${expression}}`);
      const [, name, operator, fallback = ''] = match;
      const current = environment.get(name);
      issue ??= current?.issue;
      const hasValue = current !== undefined && (!operator?.startsWith(':') || current.value !== '');
      if (operator === ':-' || operator === '-') {
        append(hasValue ? current! : expand(fallback, environment, escape));
      } else if (operator === ':+' || operator === '+') {
        append(hasValue ? expand(fallback, environment, escape) : literal(''));
        // A symbolic value cannot establish whether a non-empty alternative applies.
        if (hasValue && current?.missing.length && operator === ':+') append({ ...current, value: '' });
      } else {
        append(current ?? { value: '', missing: [name] });
      }
      index = end;
      continue;
    }

    const name = input.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (name) {
      append(environment.get(name) ?? { value: '', missing: [name] });
      index += name.length;
    } else {
      value += '$';
    }
  }
  if (quote) throw new Error('따옴표가 닫히지 않았습니다.');
  return { value, missing: [...missing], ...(issue ? { issue } : {}) };
}

interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
}

function heredocOperator(token: string): number {
  let quote = '';
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === '\\' && quote !== "'") index += 1;
    else if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '<' && token[index + 1] === '<') return index;
  }
  return -1;
}

function heredocs(instruction: Instruction): Heredoc[] {
  let name = instruction.name;
  let body = instruction.arguments;
  if (name === 'ONBUILD') {
    const nested = body.match(/^(\w+)\s+([\s\S]*)$/);
    if (!nested) return [];
    [, name, body] = nested;
    name = name.toUpperCase();
  }
  if (!['RUN', 'COPY', 'ADD'].includes(name) || !body.includes('<<')) return [];

  // The Dockerfile parser does not read heredocs from JSON exec arguments.
  const tokens = words(body, '\\');
  const command = tokens.findIndex((token) => !token.startsWith('--'));
  if (command >= 0 && tokens[command].startsWith('[')) {
    try {
      const json = JSON.parse(tokens.slice(command).join(' '));
      if (Array.isArray(json) && json.every((item) => typeof item === 'string')) return [];
    } catch { /* Invalid JSON falls back to shell form in Docker. */ }
  }

  const result: Heredoc[] = [];
  for (const token of tokens) {
    if (heredocOperator(token) < 0) continue;
    const match = token.match(/^(?:\d*)<<(-?)(.+)$/);
    if (match) {
      const raw = match[2];
      if (raw.includes('<<') || /[;$()]/.test(raw)) {
        throw new Error('복잡한 heredoc 구문을 해석할 수 없습니다. 구분자를 확인해주세요.');
      }
      const delimiter = expand(raw, new Map(), '\\');
      if (!delimiter.value || delimiter.missing.length) throw new Error('heredoc 구분자를 확인해주세요.');
      result.push({ delimiter: delimiter.value, stripTabs: match[1] === '-' });
    } else {
      throw new Error('지원하지 않는 heredoc 구문입니다. <<EOF 형식의 구분자를 사용해주세요.');
    }
  }
  return result;
}

function readInstructions(source: string): { instructions: Instruction[]; escape: string; warnings: string[] } {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const instructions: Instruction[] = [];
  const warnings: string[] = [];
  const directives = new Set<string>();
  let allowDirectives = true;
  let escape = '\\';
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trimStart();
    const lineNumber = index + 1;
    if (allowDirectives) {
      const directive = line.match(/^#\s*(syntax|escape|check)\s*=\s*(.*?)\s*$/i);
      if (directive) {
        const name = directive[1].toLowerCase();
        const value = directive[2];
        if (directives.has(name)) throw atLine(lineNumber, `${name} 지시문이 중복되었습니다.`);
        directives.add(name);
        if (name === 'escape') {
          if (value !== '\\' && value !== '`') throw atLine(lineNumber, 'escape는 \\ 또는 ` 이어야 합니다.');
          escape = value;
        }
        if (name === 'syntax' && !/^(?:docker\.io\/)?docker\/dockerfile(?:-upstream)?(?::[A-Za-z0-9_.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/.test(value)) {
          throw atLine(lineNumber, `지원하지 않는 Dockerfile syntax입니다: ${value}`);
        }
        continue;
      }
      allowDirectives = false;
    }
    if (!line.trim() || line.startsWith('#')) continue;
    // Match Docker's continuation rule: a trailing escape cannot itself be escaped.
    while (true) {
      const trimmed = line.trimEnd();
      const end = trimmed.length - 1;
      if (trimmed[end] !== escape || (end > 0 && trimmed[end - 1] === escape)) break;
      line = trimmed.slice(0, end);
      let continued = false;
      while (++index < lines.length) {
        if (lines[index].trimStart().startsWith('#')) continue;
        if (!lines[index].trim()) {
          warnings.push(`Dockerfile ${index + 1}행: 줄 연속 구문에 빈 줄이 있습니다.`);
          continue;
        }
        line += lines[index];
        continued = true;
        break;
      }
      if (!continued) throw atLine(lineNumber, '줄 연속 구문이 끝나지 않았습니다.');
    }
    const match = line.match(/^(\w+)(?:\s+([\s\S]*))?$/);
    if (!match || !INSTRUCTIONS.has(match[1].toUpperCase())) {
      throw atLine(lineNumber, '지원하지 않거나 잘못된 Dockerfile 명령입니다.');
    }
    const instruction: Instruction = { name: match[1].toUpperCase(), arguments: (match[2] ?? '').trim(), line: lineNumber };
    instructions.push(instruction);
    let documents: Heredoc[];
    try {
      documents = heredocs(instruction);
    } catch (error) {
      throw atLine(lineNumber, error instanceof Error ? error.message : 'heredoc을 읽을 수 없습니다.');
    }
    for (const document of documents) {
      let closed = false;
      while (++index < lines.length) {
        const candidate = document.stripTabs ? lines[index].replace(/^\t+/, '') : lines[index];
        if (candidate === document.delimiter) {
          closed = true;
          break;
        }
      }
      if (!closed) throw atLine(lineNumber, `heredoc ${document.delimiter} 구분자가 닫히지 않았습니다.`);
    }
  }
  return { instructions, escape, warnings };
}

function readArguments(instruction: Instruction, environment: Arguments, options: DockerfileOptions, escape: string): void {
  let declarations: string[];
  try {
    declarations = words(instruction.arguments, escape);
  } catch (error) {
    throw atLine(instruction.line, error instanceof Error ? error.message : 'ARG를 읽을 수 없습니다.');
  }
  if (!declarations.length) throw atLine(instruction.line, 'ARG 이름이 필요합니다.');
  for (const declaration of declarations) {
    const equals = declaration.indexOf('=');
    const name = equals < 0 ? declaration : declaration.slice(0, equals);
    if (!ARG_NAME.test(name)) throw atLine(instruction.line, 'ARG 이름과 기본값 형식을 확인해주세요.');
    const override = options.args && Object.hasOwn(options.args, name) ? options.args[name] : undefined;
    // A null Compose argument has no supplied value; Dockerfile defaults still apply.
    if (options.unresolvedArgs?.includes(name)) {
      environment.set(name, {
        value: override ?? '',
        missing: [name],
        issue: atLine(instruction.line, `build.args의 ARG ${name} 값을 알 수 없습니다. Compose 환경변수를 확인해주세요.`).message,
      });
    } else if (override !== undefined && override !== null) {
      environment.set(name, literal(override));
    } else if (equals >= 0) {
      try {
        environment.set(name, expand(declaration.slice(equals + 1), environment, escape));
      } catch (error) {
        // A default used only by an unselected builder must not block the runtime base.
        environment.set(name, { value: '', missing: [], issue: atLine(instruction.line, error instanceof Error ? error.message : 'ARG를 해석할 수 없습니다.').message });
      }
    }
  }
}

function readStage(instruction: Instruction): Stage {
  const tokens = instruction.arguments.split(/\s+/).filter(Boolean);
  let platform: string | undefined;
  while (tokens[0]?.startsWith('--')) {
    const flag = tokens.shift()!;
    if (!flag.startsWith('--platform=') || platform !== undefined) throw atLine(instruction.line, 'FROM의 --platform 형식을 확인해주세요.');
    platform = flag.slice('--platform='.length);
    if (!platform) throw atLine(instruction.line, 'FROM의 --platform 값이 비어 있습니다.');
  }
  if (tokens.length !== 1 && !(tokens.length === 3 && tokens[1].toUpperCase() === 'AS')) {
    throw atLine(instruction.line, 'FROM은 이미지와 선택적인 AS 단계 이름으로 작성해주세요.');
  }
  const name = tokens[2];
  if (name && !STAGE_NAME.test(name)) throw atLine(instruction.line, 'FROM의 단계 이름 형식을 확인해주세요.');
  return { base: tokens[0], name, platform, line: instruction.line };
}

function known(input: string, environment: Arguments, escape: string, line: number): string {
  let result: Expanded;
  try {
    result = expand(input, environment, escape);
  } catch (error) {
    throw atLine(line, error instanceof Error ? error.message : 'ARG를 해석할 수 없습니다.');
  }
  if (result.issue) throw new Error(result.issue);
  if (result.missing.length) {
    if (result.missing.some((name) => /^BUILD(?:PLATFORM|OS|ARCH|VARIANT)$/.test(name))) {
      throw atLine(line, `빌드 호스트 플랫폼 ARG 값을 알 수 없습니다: ${result.missing.join(', ')}. 전역 ARG와 build.args로 값을 명시해주세요.`);
    }
    throw atLine(line, `기본값이 없는 ARG: ${result.missing.join(', ')}. build.args 또는 전역 ARG 기본값을 지정해주세요.`);
  }
  return result.value;
}

/**
 * Resolve only the selected stage's FROM ancestry, never COPY sources or builder bases.
 * Docker semantics: https://docs.docker.com/reference/dockerfile/#understand-how-arg-and-from-interact
 */
export function resolveDockerfile(source: string, options: DockerfileOptions = {}): ResolvedDockerfile {
  const targetPlatform = options.platform ?? DEFAULT_PLATFORM;
  if (!PLATFORM.test(targetPlatform)) throw new Error('플랫폼 형식을 확인해주세요. 예: linux/amd64 또는 linux/arm64/v8');
  const { instructions, escape, warnings } = readInstructions(source);
  const [os, architecture, variant = ''] = targetPlatform.split('/');
  const environment: Arguments = new Map([
    ['TARGETPLATFORM', literal(targetPlatform)], ['TARGETOS', literal(os)],
    ['TARGETARCH', literal(architecture)], ['TARGETVARIANT', literal(variant)],
  ]);
  const stages: Stage[] = [];
  const namedStages = new Map<string, number>();
  for (const instruction of instructions) {
    if (instruction.name === 'FROM') {
      const stage = readStage(instruction);
      if (stage.name) {
        const key = stage.name.toLowerCase();
        if (key === 'scratch' || namedStages.has(key)) throw atLine(stage.line, `단계 이름 ${stage.name}이 예약되어 있거나 중복되었습니다.`);
        namedStages.set(key, stages.length);
      }
      stages.push(stage);
    } else if (!stages.length) {
      if (instruction.name !== 'ARG') throw atLine(instruction.line, '첫 FROM 앞에는 전역 ARG만 지정할 수 있습니다.');
      readArguments(instruction, environment, options, escape);
    }
    // Stage-local ARG and ENV never participate in later FROM instructions.
  }
  if (!stages.length) throw new Error('Dockerfile에 FROM 단계가 없습니다.');
  const selected = options.target === undefined ? stages.length - 1 : namedStages.get(options.target.toLowerCase());
  if (selected === undefined) throw new Error(`Dockerfile에서 target 단계 ${options.target}을 찾을 수 없습니다.`);
  const ancestry: { stage: Stage; platform?: string }[] = [];
  let current = selected;
  while (true) {
    const stage = stages[current];
    const reference = known(stage.base, environment, escape, stage.line);
    const platform = stage.platform === undefined ? undefined : known(stage.platform, environment, escape, stage.line);
    if (platform !== undefined && !PLATFORM.test(platform)) throw atLine(stage.line, 'FROM의 플랫폼 형식을 확인해주세요. 예: linux/amd64');
    ancestry.push({ stage, platform });
    const parent = namedStages.get(reference.toLowerCase());
    // Stage names become available only after that stage's FROM has been read.
    // A matching future or self alias still denotes an external image here.
    if (parent !== undefined && parent < current) {
      current = parent;
      continue;
    }
    if (reference.toLowerCase() === 'scratch') throw atLine(stage.line, 'scratch 기반 단계에는 분석할 외부 기반 이미지가 없습니다.');
    try {
      parseImageReference(reference);
    } catch (error) {
      throw atLine(stage.line, error instanceof Error ? error.message : '기반 이미지 참조를 해석할 수 없습니다.');
    }
    const basePlatform = platform ?? targetPlatform;
    for (const child of ancestry.slice(0, -1)) {
      if (child.platform !== undefined && child.platform !== basePlatform) {
        warnings.push(`Dockerfile ${child.stage.line}행: 기존 단계의 FROM --platform은 원본 기반 이미지의 플랫폼 ${basePlatform}을 바꾸지 않습니다.`);
      }
    }
    return { reference, platform: basePlatform, stage: stages[selected].name ?? String(selected), warnings };
  }
}
