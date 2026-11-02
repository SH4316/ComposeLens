import { handleTags } from '../_lib/handlers';
import { methodNotAllowed } from '../_lib/http';

export const onRequestGet: PagesFunction = ({ request }) => handleTags(request);

export const onRequest: PagesFunction = methodNotAllowed;
