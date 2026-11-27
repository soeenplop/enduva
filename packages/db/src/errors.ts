/**
 * pg's server error class (pg-protocol's `DatabaseError`), the one node-postgres throws for an error response from
 * Postgres. Re-exported so callers can check errors against the class itself, not a name a thrown value can fake.
 */
export { DatabaseError } from 'pg';
