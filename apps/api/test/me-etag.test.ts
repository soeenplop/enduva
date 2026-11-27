import { describe, expect, it } from 'vitest';

import { etag, ifMatchVersion } from '../src/me/etag.js';

const user = '0000000a-0000-4000-8000-00000000000a';
const other = '0000000b-0000-4000-8000-00000000000b';

describe('/v1/me ETags', () => {
  it('are bound to user and version', () => {
    expect(etag(user, 3)).toMatch(/^"3-[\w-]{22}"$/);
    expect(etag(user, 3)).not.toBe(etag(other, 3));
    expect(etag(user, 3)).not.toBe(etag(user, 4));
  });

  it('match whatever case the verified sub has, as the database spells UUIDs in lower case', () => {
    expect(etag(user.toUpperCase(), 3)).toBe(etag(user, 3));
    expect(ifMatchVersion(etag(user, 3), user.toUpperCase())).toBe(3);
  });

  it.each([
    ["another user's tag", etag(other, 3)],
    ['a weak tag', `W/${etag(user, 3)}`],
    ['the wildcard', '*'],
    ['a list', `${etag(user, 3)}, ${etag(user, 2)}`],
    ['a bare version', '"3"'],
  ])('name no version for %s', (_case, header) => {
    expect(ifMatchVersion(header, user)).toBeUndefined();
  });
});
