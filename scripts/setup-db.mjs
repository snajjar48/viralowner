// Creates the database tables. Run with: npm run db:setup
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Run `vercel env pull .env.local` first (see README).",
  );
  process.exit(1);
}

const sql = neon(url);
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

// Strip comment lines, then run each statement separately.
const statements = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}

console.log(`Database ready (${statements.length} statements applied).`);
