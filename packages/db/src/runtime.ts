// API entrypoint: never import index.ts, which constructs the owner pool.
export * from "./schema.js";
export * from "./context.js";
export * from "./features.js";
export { verifyRestrictedDatabaseRole } from "./runtime-connection.js";
