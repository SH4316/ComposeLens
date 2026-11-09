import { parseImageReference } from '@composelens/shared/image-reference';
import type { HistoricalImage, TagHistoryPage } from '@composelens/shared';
import { ApiError } from './http';
import { findPlatform, isDigest, validatePlatform } from './platform';
import { requestJson, requestText } from './upstream';

const PAGE_SIZE = 8;
interface Commit { sha: string; commit: { committer: { date: string } } }

function parseObservation(markdown: string, repository: string, tag: string, platform: string) {
  const name = repository.slice('library/'.length);
  const reference = `${name}:${tag}`;
  if (!markdown.startsWith(`## \`${reference}\``)) throw new ApiError('과거 이미지 기록의 응답 형식이 변경되었습니다.');
  const indexDigest = markdown.split(/^### /m)[0].match(/\$ docker pull \S+@(sha256:[a-f0-9]{64})/)?.[1];
  if (!isDigest(indexDigest)) throw new ApiError('과거 이미지 기록에서 digest를 확인하지 못했습니다.');

  const platforms = markdown.split(/^### /m).slice(1).flatMap((section) => {
    const heading = section.split('\n', 1)[0];
    const prefix = `\`${reference}\` - `;
    if (!heading.startsWith(prefix)) return [];
    const [osDescription, architectureDescription] = heading.slice(prefix.length).split('; ');
    const os = osDescription.match(/^([a-z0-9]+)(?: version .+)?$/)?.[1];
    const architecture = architectureDescription?.match(/^([a-z0-9]+)(?: variant ([a-z0-9]+))?$/);
    const digest = section.match(/\$ docker pull \S+@(sha256:[a-f0-9]{64})/)?.[1];
    if (!os || !architecture || os === 'unknown' || architecture[1] === 'unknown' || !isDigest(digest)) return [];
    const variable = `${name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_VERSION`;
    const version = section.match(new RegExp(`^ENV ${variable}(?:=| +)([0-9][A-Za-z0-9_.+-]{0,63})(?=\\s|$)`, 'm'))?.[1] ?? null;
    return [{ os, architecture: architecture[1], variant: architecture[2], digest, version }];
  });
  const selected = findPlatform(platforms, platform);
  return selected ? {
    digest: selected.digest, indexDigest, version: selected.version,
    platform: [selected.os, selected.architecture, selected.variant].filter(Boolean).join('/'),
  } : null;
}

export async function listTagHistory(input: string, platform: string, page: number): Promise<TagHistoryPage> {
  let reference;
  try { reference = parseImageReference(input); }
  catch { throw new ApiError('과거 기록을 조회할 이미지 참조를 확인해 주세요.', 400); }
  validatePlatform(platform);
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new ApiError('과거 기록의 페이지를 확인해 주세요.', 400);
  if (reference.registry !== 'docker.io' || !reference.repository.startsWith('library/')
    || reference.repository.split('/').length !== 2 || !reference.tag) {
    return { status: 'unsupported', entries: [], nextPage: null, message: '태그가 있는 Docker 공식 이미지의 과거 기록을 지원합니다.' };
  }

  const name = reference.repository.slice('library/'.length);
  const tag = reference.tag;
  const path = `repos/${name}/remote/${tag}.md`;
  const url = new URL('https://api.github.com/repos/docker-library/repo-info/commits');
  url.search = new URLSearchParams({ path, per_page: String(PAGE_SIZE), page: String(page) }).toString();
  const data = await requestJson<unknown>(url, { label: 'GitHub 과거 이미지 기록' });
  if (!Array.isArray(data) || data.length > PAGE_SIZE || data.some((entry) => !entry || !/^[a-f0-9]{40}$/.test(entry.sha)
    || typeof entry.commit?.committer?.date !== 'string' || !Number.isFinite(Date.parse(entry.commit.committer.date)))) {
    throw new ApiError('과거 이미지 기록의 커밋 응답 형식이 변경되었습니다.');
  }
  const commits = data as Commit[];
  const entries: HistoricalImage[] = [];
  const failures: unknown[] = [];
  // Bound fan-out; immutable raw files do not consume GitHub's REST quota.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, commits.length) }, async () => {
    while (cursor < commits.length) {
      const commit = commits[cursor++];
      const sourceUrl = `https://github.com/docker-library/repo-info/blob/${commit.sha}/${path}`;
      try {
        const markdown = await requestText(`https://raw.githubusercontent.com/docker-library/repo-info/${commit.sha}/${path}`, { label: 'GitHub 과거 이미지 기록' });
        const observation = parseObservation(markdown, reference.repository, tag, platform);
        if (observation) entries.push({ ...observation, sourceReference: `${reference.repository}:${tag}`, recordedAt: commit.commit.committer.date, sourceUrl });
      } catch (error) {
        // A file-deletion commit has no snapshot at that revision.
        if (!(error instanceof ApiError && error.status === 404)) failures.push(error);
      }
    }
  }));
  if (failures.length && entries.length === 0) throw failures[0];
  entries.sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  const unique = entries.filter((entry, index) => entries.findIndex((other) => other.digest === entry.digest) === index);
  return {
    status: 'available', entries: unique,
    nextPage: commits.length === PAGE_SIZE ? page + 1 : null,
    ...(failures.length ? { message: '일부 과거 기록을 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.' } : {}),
  };
}
