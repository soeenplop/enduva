import * as z from 'zod';
import { createDocument, type ZodOpenApiResponseObject } from 'zod-openapi';

import { HealthStatus } from './health.js';
import { Me, MeUpdate } from './me.js';
import { Problem, PROBLEM_CONTENT_TYPE } from './problem.js';

/** An error answered as problem details; `headers` adds the ones that status always carries. */
const problem = (description: string, headers?: ZodOpenApiResponseObject['headers']): ZodOpenApiResponseObject => ({
  description,
  ...(headers === undefined ? {} : { headers }),
  content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
});

const json = (description: string, schema: z.ZodType, headers?: ZodOpenApiResponseObject['headers']) => ({
  description,
  ...(headers === undefined ? {} : { headers }),
  content: { 'application/json': { schema } },
});

/**
 * `X.nullable()` renders as `anyOf: [X, { type: 'null' }]`, which swift-openapi-generator drops (the property
 * vanishes from the Swift type). Render it in the OpenAPI 3.1 form `type: [X, 'null']` instead, which it maps to an
 * Optional. Only for a plain typed `X`; anything else stays as Zod rendered it.
 */
function typeArrayNullable(jsonSchema: Record<string, unknown>): void {
  const { anyOf } = jsonSchema;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return;
  const schemas = anyOf as Record<string, unknown>[];
  const isNull = (schema: Record<string, unknown>) => schema.type === 'null' && Object.keys(schema).length === 1;
  const inner = schemas.find((schema) => !isNull(schema));
  if (inner === undefined || !schemas.some(isNull) || typeof inner.type !== 'string') return;
  delete jsonSchema.anyOf;
  Object.assign(jsonSchema, inner, { type: [inner.type, 'null'] });
  if (Array.isArray(inner.enum)) jsonSchema.enum = [...(inner.enum as unknown[]), null];
}

const strongEtag = z.string().meta({
  description: 'Strong entity tag of the returned version. Opaque: send it back unchanged, never parse it.',
  example: '"3-Yk1oQ2J4dE9wN3F1cjVzVg"',
});

/** Errors every authenticated route can answer, besides its own. */
const authenticatedErrors = {
  '401': problem(
    '`unauthorized`: missing, invalid or revoked token or session. `device_revoked`: wipe local data',
    z.object({ 'WWW-Authenticate': z.literal('Bearer') }),
  ),
  '429': problem('`rate_limited`', z.object({ 'Retry-After': z.string().meta({ description: 'Seconds to wait' }) })),
  '503': problem('`database_unavailable` or `auth_unavailable`'),
  default: problem('Any other error, e.g. `internal_error`'),
} satisfies Record<string, ZodOpenApiResponseObject>;

export const openApiDocument = createDocument(
  {
    openapi: '3.1.0',
    info: {
      title: 'Enduva API',
      version: '1',
      description: 'Generated from the Zod contracts in `@enduva/contracts`. Do not edit `openapi.json` by hand.',
    },
    security: [{ bearer: [] }],
    paths: {
      '/v1/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Liveness',
          security: [],
          responses: { '200': json('The process serves requests', HealthStatus), default: problem('Any error') },
        },
      },
      '/v1/health/ready': {
        get: {
          operationId: 'getReadiness',
          summary: 'Readiness: the database is reachable',
          security: [],
          responses: {
            '200': json('Ready', HealthStatus),
            '503': problem('`database_unavailable`'),
            default: problem('Any other error'),
          },
        },
      },
      '/v1/me': {
        get: {
          operationId: 'getMe',
          summary: "The signed-in user's profile",
          requestParams: {
            header: z.object({
              'If-None-Match': z.string().optional().meta({ description: 'ETag of a cached copy' }),
            }),
          },
          responses: {
            '200': json('The profile', Me, z.object({ ETag: strongEtag })),
            '304': { description: 'The cached copy named by `If-None-Match` is current' },
            ...authenticatedErrors,
          },
        },
        patch: {
          operationId: 'updateMe',
          summary: 'Update the user-editable profile fields',
          description:
            'JSON merge semantics: a missing field stays, `null` clears it. Needs the current ETag from `GET` in `If-Match`.',
          requestParams: {
            header: z.object({
              'If-Match': z.string().meta({ description: 'Exactly one strong ETag: the current one. No `*`, no list' }),
            }),
          },
          requestBody: { required: true, content: { 'application/json': { schema: MeUpdate } } },
          responses: {
            '200': json('The updated profile', Me, z.object({ ETag: strongEtag })),
            '400': problem('`bad_request`: the body is invalid. Echoes no input'),
            '412': problem('`precondition_failed`: `If-Match` is outdated or not a single strong tag of this user'),
            '428': problem('`precondition_required`: `If-Match` is missing'),
            ...authenticatedErrors,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token' },
      },
    },
  },
  {
    override: ({ jsonSchema, io }) => {
      typeArrayNullable(jsonSchema);
      // Response objects stay open, so a field added later doesn't break clients built before it (the Swift
      // generator refuses unknown keys when `additionalProperties` is false). Request bodies stay closed: the API
      // refuses them.
      if (io === 'output' && jsonSchema.additionalProperties === false) delete jsonSchema.additionalProperties;
    },
  },
);
