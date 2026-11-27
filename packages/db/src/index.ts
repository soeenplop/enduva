/** Quotes a schema-qualified Postgres identifier, e.g. `public.profiles` → `"public"."profiles"`. */
export function qualifiedName(schema: string, table: string): string {
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
  return `${quote(schema)}.${quote(table)}`;
}

export * from './schema/index.js';
