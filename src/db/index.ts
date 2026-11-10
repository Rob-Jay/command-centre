import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __ccDb?: DB };

function createDb(): DB {
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const file = process.env.CC_DB_PATH ?? path.join(dataDir, "cc.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000"); // several server processes share this file in dev
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

/** Single shared connection (survives dev hot reloads). Tables are migrated on first use. */
export const db: DB = globalForDb.__ccDb ?? (globalForDb.__ccDb = createDb());
export { schema };
