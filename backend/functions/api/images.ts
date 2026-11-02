import { handleImages } from '../_lib/handlers';
import { methodNotAllowed } from '../_lib/http';

export const onRequestGet: PagesFunction = ({ request }) => handleImages(request);

export const onRequest: PagesFunction = methodNotAllowed;
