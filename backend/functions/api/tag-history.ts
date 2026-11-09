import { handleTagHistory } from '../_lib/handlers';
import { methodNotAllowed } from '../_lib/http';

export const onRequestGet: PagesFunction = ({ request }) => handleTagHistory(request);
export const onRequest: PagesFunction = methodNotAllowed;
