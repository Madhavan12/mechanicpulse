import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

/** Applies db/migrations/*.sql in filename order, once each, recording what
 * ran in schema_migrations. Used to build the staging database; local dev
 * still loads the schema by hand. Files are applied exactly as written (the
 * initial schema carries its own BEGIN/COMMIT), so a failed file leaves
 * nothing half-applied and is simply not recorded. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  // cwd is apps/api both locally and in the container (/app/apps/api).
  const dir = resolve(process.env.MIGRATIONS_DIR ?? "../../db/migrations");
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    // Two deploys racing must not apply the same file twice.
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    );
    const { rows } = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const done = new Set(rows.map((r) => r.filename));

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      console.log(`applying ${file}`);
      await client.query(readFileSync(resolve(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      applied++;
    }
    console.log(applied ? `done, ${applied} applied` : "already up to date");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
