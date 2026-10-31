import { statsPage } from '../src/api.js';

export const onRequestGet = (context) => statsPage(context.request, context.env);
