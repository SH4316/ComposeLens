import { errorResponse, jsonResponse, methodNotAllowed, requiredParam } from '../_lib/http';
import { getImageReport } from '../_lib/images';

export const onRequestGet: PagesFunction = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const reference = requiredParam(url, 'reference');
    const platform = url.searchParams.get('platform') ?? 'linux/amd64';
    return jsonResponse(await getImageReport(reference, platform));
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = methodNotAllowed;
