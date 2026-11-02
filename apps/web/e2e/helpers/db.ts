import { Pool } from "pg";
import { readFileSync } from "fs";
import path from "path";

/** Talks to the dev database directly, so a test can assert on what actually
 * landed rather than trusting the API's own response. `pg` is a devDependency
 * of the web app for this reason only — nothing in the shipped app uses it.
 *
 * Deliberately NOT docker-exec based: CI runs Postgres as a service container
 * with no docker CLI available, and this way local and CI behave the same. */
const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:devpass@localhost:5433/mechanicpulse_dev";

const pool = new Pool({ connectionString });

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MIGRATION = path.join(REPO_ROOT, "db/migrations/0001_initial_schema.sql");
const SEED = path.join(REPO_ROOT, "db/seed/dev_seed.sql");

/** Every table that holds test-run state, ordered so CASCADE has nothing to
 * complain about. TRUNCATE rather than DELETE on purpose: the append-only
 * guards on reports/approvals/events are row-level BEFORE DELETE triggers,
 * which TRUNCATE does not fire. */
const TABLES = [
  "approvals",
  "report_items",
  "reports",
  "sms_messages",
  "events",
  "media",
  "inspection_items",
  "jobs",
  "vehicles",
  "customers",
  "mechanics",
  "workshops",
].join(", ");

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

/** One scalar, as a string — convenient for count(*) and single-column lookups. */
export async function scalar(text: string, params: unknown[] = []): Promise<string | null> {
  const rows = await query<Record<string, unknown>>(text, params);
  if (rows.length === 0) return null;
  const value = Object.values(rows[0])[0];
  return value === null || value === undefined ? null : String(value);
}

/** Applies the migration when the database is empty. CI starts with a bare
 * Postgres service, so there's no separate migrate step to forget. */
async function ensureSchema(): Promise<void> {
  const exists = await scalar("SELECT to_regclass('public.workshops') IS NOT NULL");
  if (exists === "true") return;
  await pool.query(readFileSync(MIGRATION, "utf8"));
}

/** Back to the committed seed, every time. Tests assert on absolute counts
 * (0 reports to begin with), so they need a known starting point. */
export async function resetDb(): Promise<void> {
  await ensureSchema();
  await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await pool.query(readFileSync(SEED, "utf8"));
}

/** Points an inspection item's photo at a real S3 object so the presigned-GET
 * path is genuinely exercised. Only meaningful with real AWS credentials —
 * see REAL_S3 in fixtures.ts. */
export async function usePhotoKey(inspectionItemId: string, storageKey: string): Promise<void> {
  await pool.query(
    `UPDATE media SET storage_key = $1, content_type = 'image/webp', bytes = 265400
      WHERE inspection_item_id = $2`,
    [storageKey, inspectionItemId]
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
