import { describe, expect, it } from 'vitest';

import { codeForStatus, problem, ProblemException } from '../src/problem/problem.js';

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
    expect(codeForStatus(406)).toBe('bad_request');
    expect(codeForStatus(502)).toBe('internal_error');
  });
});
