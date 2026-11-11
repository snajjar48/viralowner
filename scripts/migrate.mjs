// Applies new database migrations in order. Run with: npm run db:migrate
//
// Each file in db/migrations runs once, inside a transaction, and is recorded
// in schema_migrations. To change the schema, add a new numbered file; never
// edit one that has already been applied.
import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Run `vercel env pull .env.local --environment=production` first (see README).",
  );
  process.exit(1);
}

const sql = neon(url);
const dir = new URL("../db/migrations/", import.meta.url);

await sql.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
const applied = new Set((await sql.query("SELECT name FROM schema_migrations")).map((r) => r.name));
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  // Strip comment lines, then split into statements (no semicolons inside
  // statements, please; keep migrations to plain DDL).
  const statements = (await readFile(new URL(file, dir), "utf8"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  await sql.transaction([
    ...statements.map((s) => sql.query(s)),
    sql.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]),
  ]);
  console.log(`applied ${file} (${statements.length} statements)`);
  count++;
}

console.log(count ? `Done: ${count} migration(s) applied.` : "Database is up to date.");
