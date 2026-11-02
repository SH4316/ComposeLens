import { describe, expect, it } from 'vitest';
import { resolveDockerfile } from './dockerfile-base-resolver';

describe('resolveDockerfile', () => {
  it('resolves only the final runtime base and ignores builder and COPY sources', () => {
    const result = resolveDockerfile(`FROM node:24-alpine AS builder
RUN npm run build
FROM nginx:1.31.8-alpine-slim AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=busybox:1.37 /bin/busybox /bin/busybox
`);
    expect(result).toEqual({ reference: 'nginx:1.31.8-alpine-slim', platform: 'linux/amd64', stage: 'runtime', warnings: [] });
  });

  it('selects a named build target instead of the final stage', () => {
    const source = 'FROM node:24-alpine AS builder\nFROM nginx:alpine AS runtime';
    expect(resolveDockerfile(source, { target: 'builder' }).reference).toBe('node:24-alpine');
    expect(() => resolveDockerfile(source, { target: 'missing' })).toThrow(/target.*missing/);
  });

  it('follows FROM stage inheritance to the external image', () => {
    expect(resolveDockerfile(`FROM node:22-alpine AS base
RUN npm ci
FROM base AS build
FROM build AS runtime
COPY --from=base /app /app`)).toMatchObject({ reference: 'node:22-alpine', stage: 'runtime' });
  });

  it('does not let later stage aliases shadow an earlier external image', () => {
    expect(resolveDockerfile('FROM nginx AS base\nFROM redis:7 AS nginx\nFROM base AS runtime')).toMatchObject({ reference: 'nginx', stage: 'runtime' });
    expect(resolveDockerfile('FROM node AS node\nFROM node AS runtime').reference).toBe('node');
    expect(resolveDockerfile('FROM b AS a\nFROM a AS b').reference).toBe('b');
  });

  it('matches Docker stage names without case sensitivity', () => {
    expect(resolveDockerfile('FROM redis:7 AS Base\nFROM BASE AS Runtime', { target: 'RUNTIME' })).toMatchObject({ reference: 'redis:7', stage: 'Runtime' });
  });

  it('preserves the written reference and its digest instead of adding default tags', () => {
    const reference = `registry.example:5000/team/nginx:Stable@sha256:${'A'.repeat(64)}`;
    expect(resolveDockerfile(`FROM ${reference}`).reference).toBe(reference);
    expect(resolveDockerfile('FROM nginx').reference).toBe('nginx');
  });

  it('expands sequential global defaults, nested defaults, and quotes', () => {
    expect(resolveDockerfile(`ARG REGISTRY=docker.io IMAGE=nginx
ARG VERSION="1.27"
ARG BASE=\${REGISTRY}/library/\${IMAGE}:\${TAG:-\${VERSION}}
FROM "\${BASE}"`)).toMatchObject({ reference: 'docker.io/library/nginx:1.27' });
  });

  it('overrides declared global ARG defaults with Compose build arguments', () => {
    const source = `ARG VERSION=1.27
ARG BASE=nginx:\${VERSION}
FROM \${BASE}`;
    expect(resolveDockerfile(source, { args: { VERSION: '1.31.8' } }).reference).toBe('nginx:1.31.8');
    expect(resolveDockerfile(source, { args: { BASE: 'redis:7' } }).reference).toBe('redis:7');
  });

  it('uses Dockerfile defaults for omitted null args and reports missing values', () => {
    expect(resolveDockerfile('ARG BASE=nginx:alpine\nFROM $BASE', { args: { BASE: null } }).reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile('ARG BASE\nFROM $BASE', { args: { BASE: null } })).toThrow(/ARG.*BASE/);
  });

  it('treats an explicit empty argument as an override', () => {
    const source = 'ARG TAG=1.27\nFROM nginx:${TAG}';
    expect(() => resolveDockerfile(source, { args: { TAG: '' } })).toThrow(/이미지 참조/);
    expect(resolveDockerfile('ARG TAG=1.27\nFROM nginx:${TAG:-alpine}', { args: { TAG: '' } }).reference).toBe('nginx:alpine');
  });

  it('does not recursively expand argument values or use unresolved Compose values as defaults', () => {
    const source = 'ARG TAG=alpine\nARG BASE=redis:7\nFROM ${BASE:-nginx:latest}';
    expect(() => resolveDockerfile(source, { args: { BASE: 'nginx:$TAG' } })).toThrow(/이미지 참조/);
    expect(() => resolveDockerfile(source, { args: { BASE: '${UNSET}' } })).toThrow(/이미지 참조/);
  });

  it.each(['${BASE:-nginx:alpine}', '${BASE-nginx:alpine}', '${BASE:+redis:7}', '${BASE+redis:7}'])(
    'does not choose a branch for an unresolved Compose argument: %s',
    (expression) => {
      for (const value of ['', '${UNSET}']) {
        expect(() => resolveDockerfile(`ARG BASE=nginx:alpine\nFROM ${expression}`, {
          args: { BASE: value }, unresolvedArgs: ['BASE'],
        })).toThrow(/build.args.*ARG BASE/);
      }
    },
  );

  it('propagates unresolved Compose arguments through derived defaults and platforms', () => {
    expect(() => resolveDockerfile('ARG INPUT=known\nARG BASE=${INPUT:+nginx:alpine}\nFROM ${BASE:-redis:7}', {
      args: { INPUT: '' }, unresolvedArgs: ['INPUT'],
    })).toThrow(/ARG INPUT/);
    expect(() => resolveDockerfile('ARG PLATFORM=linux/arm64\nFROM --platform=${PLATFORM:-linux/amd64} nginx', {
      args: { PLATFORM: '' }, unresolvedArgs: ['PLATFORM'],
    })).toThrow(/ARG PLATFORM/);
  });

  it('does not block unrelated runtime stages with unresolved Compose builder arguments', () => {
    const source = 'ARG BASE=node:24\nFROM ${BASE:+node:22} AS builder\nFROM nginx:alpine AS runtime';
    const options = { args: { BASE: '' }, unresolvedArgs: ['BASE'] };
    expect(resolveDockerfile(source, options).reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile(source, { ...options, target: 'builder' })).toThrow(/ARG BASE/);
    expect(resolveDockerfile('FROM nginx:alpine', options).reference).toBe('nginx:alpine');
  });

  it('does not use supplied args unless declared globally', () => {
    expect(() => resolveDockerfile('FROM $BASE', { args: { BASE: 'nginx:alpine' } })).toThrow(/ARG.*BASE/);
    expect(() => resolveDockerfile('FROM node:24 AS builder\nARG BASE=nginx:alpine\nFROM $BASE', { args: { BASE: 'nginx:alpine' } })).toThrow(/ARG.*BASE/);
  });

  it('keeps stage-local ARG and ENV out of subsequent FROM instructions', () => {
    expect(resolveDockerfile(`ARG TAG=22-alpine
FROM node:$TAG AS builder
ARG TAG=24-alpine
ENV TAG=latest
FROM node:$TAG AS runtime`).reference).toBe('node:22-alpine');
  });

  it('does not fail for unknown arguments used only by an unselected builder', () => {
    const source = 'ARG BUILDER\nFROM $BUILDER AS builder\nFROM nginx:alpine AS runtime\nCOPY --from=builder /out /app';
    expect(resolveDockerfile(source).reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile(source, { target: 'builder' })).toThrow(/ARG.*BUILDER/);
  });

  it('does not fail for unsupported ARG defaults that the runtime does not use', () => {
    expect(resolveDockerfile('ARG BUILDER=${IMAGE#prefix}\nFROM $BUILDER AS builder\nFROM nginx:alpine').reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile('ARG BASE=${IMAGE#prefix}\nFROM $BASE')).toThrow(/지원하지 않는 ARG/);
    expect(() => resolveDockerfile('ARG BASE=${IMAGE#prefix}\nFROM ${BASE:-nginx:alpine}')).toThrow(/지원하지 않는 ARG/);
  });

  it('applies Docker unset and empty default and alternative operators', () => {
    expect(resolveDockerfile('ARG TAG\nFROM nginx:${TAG-alpine}').reference).toBe('nginx:alpine');
    expect(resolveDockerfile('ARG TAG=""\nFROM nginx:${TAG:-alpine}').reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile('ARG TAG=""\nFROM nginx:${TAG-alpine}')).toThrow(/이미지 참조/);
    expect(resolveDockerfile('ARG PREFIX\nFROM ${PREFIX:+private/}nginx:alpine').reference).toBe('nginx:alpine');
    expect(resolveDockerfile('ARG PRESENT=""\nFROM nginx:${PRESENT+alpine}').reference).toBe('nginx:alpine');
  });

  it('does not expand values inside single quotes or escaped dollars', () => {
    expect(() => resolveDockerfile("ARG TAG=alpine\nARG BASE='nginx:$TAG'\nFROM $BASE")).toThrow(/이미지 참조/);
    expect(() => resolveDockerfile(String.raw`ARG TAG=alpine
FROM nginx:\$TAG`)).toThrow(/이미지 참조/);
  });

  it('uses the service platform for automatic target arguments and default FROM platforms', () => {
    expect(resolveDockerfile('FROM --platform=$TARGETPLATFORM nginx:alpine', { platform: 'linux/arm64/v8' }).platform).toBe('linux/arm64/v8');
    expect(resolveDockerfile('FROM nginx:alpine', { platform: 'linux/arm64' }).platform).toBe('linux/arm64');
    expect(resolveDockerfile('FROM --platform=${TARGETOS}/${TARGETARCH} nginx:alpine', { platform: 'linux/arm64' }).platform).toBe('linux/arm64');
  });

  it('honors explicit FROM platforms and inherits the original stage platform', () => {
    const source = 'FROM --platform=linux/arm64 nginx:alpine AS base\nFROM base AS runtime';
    expect(resolveDockerfile(source).platform).toBe('linux/arm64');
    const conflicting = resolveDockerfile('FROM --platform=linux/arm64 nginx AS base\nFROM --platform=linux/amd64 base');
    expect(conflicting.platform).toBe('linux/arm64');
    expect(conflicting.warnings[0]).toContain('linux/arm64');
  });

  it('reports an unknown build host platform instead of borrowing the analysis host', () => {
    const source = 'FROM --platform=$BUILDPLATFORM node:24 AS builder\nFROM nginx:alpine';
    expect(resolveDockerfile(source).reference).toBe('nginx:alpine');
    expect(() => resolveDockerfile(source, { target: 'builder' })).toThrow(/BUILDPLATFORM/);
    expect(resolveDockerfile('ARG BUILDPLATFORM\nFROM --platform=$BUILDPLATFORM nginx', { args: { BUILDPLATFORM: 'linux/arm64' } }).platform).toBe('linux/arm64');
  });

  it('handles CRLF, a byte-order mark, leading whitespace and full-line comments', () => {
    expect(resolveDockerfile('\uFEFF# syntax=docker/dockerfile:1\r\n\r\n # FROM redis:7\r\n  from nginx:alpine as runtime\r\n').reference).toBe('nginx:alpine');
  });

  it('joins continuation lines without inserting characters and skips comment lines', () => {
    const source = 'ARG TAG=1.\\\n# ignored comment\\\n27\nFROM nginx:\\\n$TAG \\\n AS runtime';
    expect(resolveDockerfile(source)).toMatchObject({ reference: 'nginx:1.27', stage: 'runtime' });
  });

  it('honors an escape directive and ignores directives after ordinary comments', () => {
    expect(resolveDockerfile('# escape=`\n\nARG TAG=alpine\nFROM nginx:`\n${TAG} AS runtime').reference).toBe('nginx:alpine');
    expect(resolveDockerfile('# ordinary comment\n# escape=`\nFROM nginx:\\\nalpine').reference).toBe('nginx:alpine');
  });

  it('never treats RUN, COPY, ADD or ONBUILD heredoc contents as FROM instructions', () => {
    const result = resolveDockerfile(`FROM nginx:alpine AS runtime
RUN <<'SCRIPT'
FROM redis:7 AS fake
ARG BASE=redis:7
SCRIPT
COPY <<-"FILE" /example
FROM node:24 AS another-fake
\tFILE
ADD <<CONTENT /another
FROM alpine:3
CONTENT
ONBUILD RUN <<EOF
FROM busybox:1
EOF`);
    expect(result).toMatchObject({ reference: 'nginx:alpine', stage: 'runtime' });
  });

  it('supports multiple heredocs and quoted delimiter fragments', () => {
    expect(resolveDockerfile(`FROM nginx:alpine
RUN <<FIRST cat && <<E"OF" cat
FROM redis:7
FIRST
FROM node:24
EOF`).reference).toBe('nginx:alpine');
  });

  it('does not consume literal heredoc strings in JSON commands or quoted shell words', () => {
    expect(resolveDockerfile('FROM node:24\nRUN ["echo", "<<EOF"]\nFROM nginx:alpine').reference).toBe('nginx:alpine');
    expect(resolveDockerfile('FROM node:24\nRUN echo "<<EOF"\nFROM nginx:alpine').reference).toBe('nginx:alpine');
    expect(resolveDockerfile('FROM node:24\nRUN echo prefix"<<EOF"\nFROM nginx:alpine').reference).toBe('nginx:alpine');
  });

  it('rejects unclosed or unsupported heredocs instead of inventing stages', () => {
    expect(() => resolveDockerfile('FROM nginx:alpine\nRUN <<EOF\nFROM redis:7')).toThrow(/heredoc.*닫히지/);
    expect(() => resolveDockerfile('FROM nginx:alpine\nRUN cat<<EOF\nFROM redis:7\nEOF')).toThrow(/heredoc/);
  });

  it('reports scratch even when reached through a stage alias', () => {
    expect(() => resolveDockerfile('FROM scratch AS base\nFROM base AS runtime')).toThrow(/scratch.*외부 기반 이미지/);
    expect(resolveDockerfile('FROM scratch AS builder\nFROM nginx:alpine').reference).toBe('nginx:alpine');
  });

  it('rejects ambiguous stage names', () => {
    expect(() => resolveDockerfile('FROM nginx AS base\nFROM redis AS base')).toThrow(/중복/);
  });

  it.each([
    ['', /FROM/],
    ['# comment', /FROM/],
    ['RUN echo hello\nFROM nginx', /전역 ARG/],
    ['FROM nginx:alpine # inline comment', /FROM/],
    ['FROM --platform= nginx', /platform/],
    ['FROM --unknown=linux/amd64 nginx', /platform/],
    ['FROM --platform=local nginx', /플랫폼/],
    ['FROM nginx AS 0invalid', /단계 이름/],
    ['FROM nginx:alpine AS $TARGET', /단계 이름/],
    ['ARG BASE=${TAG\nFROM $BASE', /중괄호/],
    ['FROM ${BASE?required}', /지원하지 않는 ARG/],
    ['# syntax=example/custom:1\nFROM nginx', /syntax/],
    ['# escape=^\nFROM nginx', /escape/],
    ['FROM HTTPS://example.com/image', /이미지 참조/],
  ])('rejects invalid or unresolved input: %s', (source, message) => {
    expect(() => resolveDockerfile(source)).toThrow(message);
  });
});
