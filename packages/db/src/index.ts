import "./env.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const client = postgres(process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5432/predioon");
export const db = drizzle(client, { schema });
export * from "./schema.js";
