import { createHash } from 'node:crypto';

/**
 * A strong ETag for one user's profile at one version: `"<version>-<digest>"`, the digest an opaque hash of user and
 * version. Two accounts at the same version get different tags, so a tag left over from an account switch can't
 * match: not in a conditional GET (Express answers 304 only for this exact tag) and not in `If-Match`.
 */
export function etag(userId: string, version: number): string {
  // The canonical (lower-case) UUID, as PostgreSQL returns it: the verifier also accepts an upper-case `sub`.
  const digest = createHash('sha256')
    .update(`enduva.me:${userId.toLowerCase()}:${version}`)
    .digest('base64url')
    .slice(0, 22);
  return `"${version}-${digest}"`;
}

/**
 * The version a single strong `If-Match` names, if it is this user's tag. Anything else names none: another user's
 * tag, a weak tag, `*` or a list, although HTTP allows the last two (the endpoint takes exactly one current tag).
 */
export function ifMatchVersion(header: string, userId: string): number | undefined {
  const value = header.trim();
  const match = /^"([1-9]\d{0,15})-[\w-]{22}"$/.exec(value);
  if (match?.[1] === undefined) return undefined;
  const version = Number(match[1]);
  return value === etag(userId, version) ? version : undefined;
}
