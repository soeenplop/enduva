// Creates supabase/signing_keys.json (one ES256 key) for the local Auth server unless it exists.
// Local only and gitignored: the key signs local access tokens, so the API's JWKS path is
// tested locally as in the hosted projects (ADR-0002). Never commit the file.
//
// Same JWK shape as `supabase gen signing-key --algorithm ES256`, generated here because the CLI
// refuses to run while config.toml points at a keys file that doesn't exist yet.
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keysFile = fileURLToPath(new URL('../../../supabase/signing_keys.json', import.meta.url));

if (existsSync(keysFile)) {
  console.log(`Signing keys already exist: ${keysFile}`);
} else {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', privateKey);
  const key = {
    kty,
    kid: randomUUID(),
    use: 'sig',
    key_ops: ['sign', 'verify'],
    alg: 'ES256',
    ext: true,
    d,
    crv,
    x,
    y,
  };
  writeFileSync(keysFile, `${JSON.stringify([key], null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Wrote a new ES256 signing key: ${keysFile}`);
}
