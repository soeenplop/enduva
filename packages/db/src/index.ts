export { createDatabase, type Database, type DatabaseOptions, type Schema, type Transaction } from './client.js';
export { DatabaseError } from './errors.js';
export { withUserTx, withWorkerTx, type VerifiedClaims } from './identity.js';
export * from './schema/index.js';
