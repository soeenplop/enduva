/**
 * The access token's `sub` and `email`, read without verification: for display and for telling which account a page
 * was rendered for. Authorisation never relies on them; the API verifies the token itself. Null if it isn't a JWT.
 */
export function readClaims(accessToken: string): { sub: string; email: string } | null {
  try {
    const payload = accessToken.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown> | null;
    if (typeof claims?.['sub'] !== 'string') return null;
    return { sub: claims['sub'], email: typeof claims['email'] === 'string' ? claims['email'] : '' };
  } catch {
    return null;
  }
}
