import { ApiError } from './http';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_LENGTH = 10 * 1024 * 1024;

interface JsonRequestOptions {
  label: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export async function requestJson<T>(url: URL | string, options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ComposeLens/0.1',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (!response.ok) throw upstreamError(response, options.label);

    const text = await response.text();
    if (text.length > MAX_RESPONSE_LENGTH) {
      throw new ApiError(`${options.label} 응답이 너무 큽니다. 다른 이미지 버전을 선택해 주세요.`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(`${options.label}에서 올바른 JSON 응답을 받지 못했습니다.`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(`${options.label} 응답 시간이 초과됐습니다. 다시 시도해 주세요.`, 504);
    }
    throw new ApiError(`${options.label}에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamError(response: Response, label: string): ApiError {
  if (response.status === 404) return new ApiError(`${label}에서 해당 이미지나 태그를 찾지 못했습니다.`, 404);
  if (response.status === 429) {
    return new ApiError(
      `${label}의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.`,
      429,
      response.headers.get('Retry-After') ?? undefined,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError(`${label}에서 공개 정보 조회를 허용하지 않았습니다.`);
  }
  return new ApiError(`${label} 조회 중 오류가 발생했습니다. (${response.status})`);
}
