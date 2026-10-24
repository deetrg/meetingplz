import { handleApi } from '../../src/api.js';

export const onRequest = (context) => handleApi(context.request, context.env, context);
