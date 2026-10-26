import { legacyRedirect } from '../src/legacy.js';

export const onRequest = (context) => legacyRedirect(context.request.url) || context.next();
