import { ApiError, errorResponse, jsonResponse, methodNotAllowed, requiredParam } from '../_lib/http';
import { listTags } from '../_lib/hub';

export const onRequestGet: PagesFunction = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const repository = requiredParam(url, 'repository', 255);
    const page = Number(url.searchParams.get('page') ?? '1');
    const search = url.searchParams.get('search')?.trim() ?? '';
    if (!Number.isInteger(page) || page < 1 || page > 10_000 || search.length > 128) {
      throw new ApiError('태그 목록의 페이지 또는 검색어를 확인해 주세요.', 400);
    }
    return jsonResponse(await listTags(repository, page, search));
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = methodNotAllowed;
