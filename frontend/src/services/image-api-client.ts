/** Fetches image reports and tags through the application API. */
import type { ImageReport, TagHistoryPage, TagPage } from '@composelens/shared';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : `조회 요청에 실패했습니다. (${response.status})`;
    throw new Error(message);
  }

  if (!body || typeof body !== 'object') {
    throw new Error('조회 서버가 올바른 응답을 보내지 않았습니다. 잠시 후 다시 시도해주세요.');
  }

  return body as T;
}

export function fetchImageReport(reference: string, platform: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ reference, platform });
  return getJson<ImageReport>(`/api/images?${query}`, signal);
}

export function fetchTags(repository: string, search: string, page: number, signal?: AbortSignal, family = '') {
  const query = new URLSearchParams({ repository, search, page: String(page) });
  if (family) query.set('family', family);
  return getJson<TagPage>(`/api/tags?${query}`, signal);
}

export function fetchTagHistory(reference: string, platform: string, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ reference, platform, page: String(page) });
  return getJson<TagHistoryPage>(`/api/tag-history?${query}`, signal);
}
