import { createDocument } from 'zod-openapi';
import { Activity, ActivityParams, ActivityQuery, Problem } from './activity.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: { title: 'Enduva TS7 spike API', version: '0.0.0' },
  paths: {
    '/v1/activities/{activityId}': {
      get: {
        operationId: 'getActivity',
        summary: 'Get one activity',
        security: [{ bearer: [] }],
        requestParams: { path: ActivityParams, query: ActivityQuery },
        responses: {
          '200': { description: 'The activity', content: { 'application/json': { schema: Activity } } },
          '400': problem('Invalid request'),
          '401': problem('Missing or invalid token'),
          '404': problem('Not found'),
        },
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  },
});
