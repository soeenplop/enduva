# @enduva/contracts

Zod 4 schemas for the API's requests and responses, shared by the API and the clients, and the OpenAPI 3.1 document
generated from them with `zod-openapi` ([ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md)).

- [`src/problem.ts`](src/problem.ts): the stable problem codes and the RFC 9457 `Problem` body. `code` is a plain
  string on the wire, so older clients still decode a code added later.
- [`src/health.ts`](src/health.ts), [`src/me.ts`](src/me.ts): the bodies of `/v1/health` and `/v1/me`.
- [`src/openapi.ts`](src/openapi.ts): the document. Every route, its auth (`bearer`, except the public health
  routes), its headers (`ETag`, `If-Match`, `If-None-Match`, `WWW-Authenticate`, `Retry-After`) and every error as
  `application/problem+json`. Response objects stay open (no `additionalProperties: false`), so adding a field
  doesn't break clients built before it; request bodies are closed, as the API refuses unknown fields.

`apps/api` writes the document to [`apps/api/openapi.json`](../../apps/api/openapi.json) (`pnpm generate` there),
which is committed and checked for drift in CI. A new route or schema change goes here first, then into the API.
