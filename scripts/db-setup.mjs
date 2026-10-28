#!/usr/bin/env node
// Creates the bets table and indexes in the Neon/Postgres database named by DATABASE_URL
// (or POSTGRES_URL). Safe to run repeatedly: every statement is "if not exists".
//
// Usage: npm run db:setup
// Locally, put DATABASE_URL in .env.local (the npm script loads it if the file exists).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local or export it, then re-run.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "..", "db", "schema.sql");
const sqlText = await readFile(schemaPath, "utf8");

// Strip comment lines and split on semicolons. The schema contains no semicolons inside string literals.
const statements = sqlText
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = neon(url);
for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Schema applied (${statements.length} statements).`);
