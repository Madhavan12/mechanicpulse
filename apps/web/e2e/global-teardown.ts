import { closeDb, resetDb } from "./helpers/db";

/** The pg pool is a module-level singleton shared by every spec in the worker,
 * so it has to be closed once at the very end — a per-file afterAll would
 * pull it out from under the files that run later.
 *
 * Also puts the database back to the committed seed. Without this the last
 * test's leftovers stay behind (e.g. the seed job marked "sent"), and anyone
 * clicking around the dev app afterwards finds a read-only job and a
 * confusing "can't edit". */
export default async function globalTeardown(): Promise<void> {
  await resetDb();
  await closeDb();
}
