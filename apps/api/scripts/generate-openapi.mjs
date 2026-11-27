// Writes the OpenAPI 3.1 spec generated from the Zod contracts to apps/api/openapi.json (committed). Turbo runs it as
// `generate` after building @enduva/contracts; CI fails if the committed file differs from a fresh run.
import { writeFileSync } from 'node:fs';

import { openApiDocument } from '@enduva/contracts';

const out = new URL('../openapi.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(openApiDocument, null, 2)}\n`);
