import { ApiError, errorResponse, jsonResponse, requiredParam } from './http';
import { listTags } from './hub';
import { getImageReport } from './images';
import { listTagHistory } from './tag-history';

export async function handleImages(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const reference = requiredParam(url, 'reference');
    const platform = url.searchParams.get('platform') ?? 'linux/amd64';
    return jsonResponse(await getImageReport(reference, platform));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTags(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const repository = requiredParam(url, 'repository', 255);
    const page = Number(url.searchParams.get('page') ?? '1');
    const search = url.searchParams.get('search')?.trim() ?? '';
    const family = url.searchParams.get('family')?.trim() ?? '';
    if (!Number.isInteger(page) || page < 1 || page > 10_000 || search.length > 128
      || family.length > 128 || (family && !/^v?\d+(?:\.\d+)?$/.test(family))) {
      throw new ApiError('태그 목록의 페이지 또는 검색어를 확인해 주세요.', 400);
    }
    return jsonResponse(await listTags(repository, page, search, family));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTagHistory(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    return jsonResponse(await listTagHistory(requiredParam(url, 'reference'),
      url.searchParams.get('platform') ?? 'linux/amd64', Number(url.searchParams.get('page') ?? '1')));
  } catch (error) {
    return errorResponse(error);
  }
}
