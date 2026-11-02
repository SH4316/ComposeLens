import { handleImages, handleTags } from '../functions/_lib/handlers';
import { jsonResponse, methodNotAllowed } from '../functions/_lib/http';

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed();

  switch (new URL(request.url).pathname) {
    case '/healthz':
      return jsonResponse({ status: 'ok' });
    case '/api/images':
      return handleImages(request);
    case '/api/tags':
      return handleTags(request);
    default:
      return jsonResponse({ error: '요청한 경로를 찾지 못했습니다.' }, 404);
  }
}
