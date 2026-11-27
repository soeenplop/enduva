import { describe, expect, it } from 'vitest';

import { HealthStatus, isProblemCode, Me, openApiDocument, Problem, PROBLEM_CONTENT_TYPE } from '../src/index.js';

type Json = Record<string, any>;
const doc = openApiDocument as Json;
const schemas = doc.components.schemas as Json;
const operations = Object.entries(doc.paths as Json).flatMap(([path, item]) =>
  Object.entries(item as Json).map(([method, op]) => ({ name: `${method.toUpperCase()} ${path}`, op: op as Json })),
);
const operation = (name: string) => operations.find((o) => o.name === name)!.op;

const me = {
  id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
  displayName: null,
  birthDate: '1990-02-28',
  sex: null,
  heightCm: 181.5,
  locale: 'de',
  timeZone: 'Europe/Berlin',
  role: 'user',
  onboardingCompletedAt: '2026-11-27T08:00:00.123Z',
  version: 3,
};

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 with the existing routes and unique operation IDs', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(operations.map((o) => o.name).sort()).toEqual([
      'GET /v1/health',
      'GET /v1/health/ready',
      'GET /v1/me',
      'PATCH /v1/me',
    ]);
    const ids = operations.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('requires the bearer token everywhere but on the public health routes', () => {
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.security).toEqual([{ bearer: [] }]);
    for (const { name, op } of operations)
      expect(op.security, name).toEqual(name.startsWith('GET /v1/health') ? [] : undefined);
    for (const name of ['GET /v1/me', 'PATCH /v1/me'])
      expect(operation(name).responses['401'].headers['WWW-Authenticate'].schema).toEqual({
        type: 'string',
        const: 'Bearer',
      });
  });

  it('describes every error as problem+json and nothing else', () => {
    for (const { name, op } of operations)
      for (const [status, response] of Object.entries(op.responses as Json)) {
        if (status.startsWith('2') || status === '304') continue;
        expect(Object.keys(response.content as Json), `${name} ${status}`).toEqual([PROBLEM_CONTENT_TYPE]);
        expect(response.content[PROBLEM_CONTENT_TYPE].schema).toEqual({ $ref: '#/components/schemas/Problem' });
      }
    expect(schemas.Problem.required).toEqual(['type', 'title', 'status', 'code']);
  });

  it('returns the ETag on /v1/me and needs it in If-Match to update', () => {
    for (const name of ['GET /v1/me', 'PATCH /v1/me'])
      expect(operation(name).responses['200'].headers.ETag).toMatchObject({ required: true });
    expect(operation('GET /v1/me').responses).toHaveProperty('304');
    const patch = operation('PATCH /v1/me');
    expect(patch.parameters).toContainEqual(
      expect.objectContaining({ in: 'header', name: 'If-Match', required: true }),
    );
    expect(Object.keys(patch.responses as Json)).toEqual(expect.arrayContaining(['400', '412', '428']));
  });

  it('keeps response objects open and request bodies closed', () => {
    for (const name of ['Me', 'Problem', 'HealthStatus'])
      expect(schemas[name]).not.toHaveProperty('additionalProperties');
    expect(schemas.MeUpdate).toMatchObject({ additionalProperties: false, minProperties: 1 });
    expect(Object.keys(schemas.MeUpdate.properties as Json)).not.toContain('role');
    // Nullable fields use the 3.1 type array: swift-openapi-generator drops `anyOf: [X, { type: 'null' }]` properties.
    expect(JSON.stringify(doc)).not.toContain('"anyOf"');
    expect(schemas.Me.properties.sex).toEqual({ type: ['string', 'null'], enum: ['female', 'male', null] });
    expect(schemas.MeUpdate.properties.heightCm).toEqual({ type: ['number', 'null'], minimum: 50, maximum: 300 });
    // The Zod regex is case-insensitive, which a JSON Schema pattern can't express: no pattern rather than a wrong one.
    expect(schemas.MeUpdate.properties.timeZone).not.toHaveProperty('pattern');
  });
});

describe('response schemas', () => {
  it('accept what the API returns', () => {
    expect(Me.parse(me)).toEqual(me);
    expect(HealthStatus.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    const body = { type: 'about:blank', title: 'Precondition Required', status: 428, code: 'precondition_required' };
    expect(Problem.parse(body)).toEqual(body);
  });

  it('refuse malformed bodies', () => {
    expect(Me.safeParse({ ...me, onboardingCompletedAt: '2026-11-27' }).success).toBe(false);
    expect(Me.safeParse({ ...me, version: 0 }).success).toBe(false);
    expect(Me.safeParse({ ...me, role: 'owner' }).success).toBe(false);
    expect(Problem.safeParse({ type: 'about:blank', title: 'OK', status: 200, code: 'x' }).success).toBe(false);
  });

  it('decode a problem with a code this build does not know yet', () => {
    const body = { type: 'about:blank', title: 'Conflict', status: 409, code: 'some_future_code' };
    expect(Problem.parse(body).code).toBe('some_future_code');
    expect(isProblemCode(body.code)).toBe(false);
    expect(isProblemCode('device_revoked')).toBe(true);
  });
});
