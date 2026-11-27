import { Problem } from '@enduva/contracts';
import { describe, expect, it } from 'vitest';

import { codeForStatus, problem, ProblemException, problemStatus } from '../src/problem/problem.js';

describe('problem details', () => {
  it('builds an RFC 9457 body with the status phrase as title', () => {
    expect(problem('not_found')).toEqual({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' });
    expect(new ProblemException('rate_limited', 'try again later').toProblem()).toEqual({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      code: 'rate_limited',
      detail: 'try again later',
    });
  });

  it('maps statuses to stable codes', () => {
    expect(codeForStatus(404)).toBe('not_found');
    expect(codeForStatus(429)).toBe('rate_limited');
    // A status with several codes maps to its generic one.
    expect(codeForStatus(401)).toBe('unauthorized');
    expect(codeForStatus(503)).toBe('database_unavailable');
    expect(codeForStatus(406)).toBe('bad_request');
    expect(codeForStatus(502)).toBe('internal_error');
  });

  it('builds bodies the OpenAPI contract describes, for every code', () => {
    for (const code of Object.keys(problemStatus) as (keyof typeof problemStatus)[]) {
      expect(Problem.strict().parse(problem(code))).toEqual(problem(code));
      expect(Problem.strict().parse(problem(code, 400, 'why'))).toEqual(problem(code, 400, 'why'));
    }
  });
});
