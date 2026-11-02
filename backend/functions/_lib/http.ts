export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function errorResponse(error: unknown): Response {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError('정보를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.');

  return jsonResponse(
    { error: apiError.message },
    apiError.status,
    apiError.retryAfter ? { 'Retry-After': apiError.retryAfter } : undefined,
  );
}

export function methodNotAllowed(): Response {
  return jsonResponse({ error: 'GET 요청만 지원합니다.' }, 405, { Allow: 'GET' });
}

export function requiredParam(url: URL, name: string, maxLength = 512): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value || value.length > maxLength) {
    throw new ApiError(`${name} 값을 확인해 주세요.`, 400);
  }
  return value;
}
