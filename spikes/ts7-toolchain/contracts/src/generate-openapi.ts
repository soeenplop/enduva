import { writeFileSync } from 'node:fs';
import { openApiDocument } from './openapi.js';

const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, `${JSON.stringify(openApiDocument, null, 2)}\n`);
console.log(`wrote ${out}`);
