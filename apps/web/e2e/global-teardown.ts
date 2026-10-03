import { closeDb } from "./helpers/db";

/** The pg pool is a module-level singleton shared by every spec in the worker,
 * so it has to be closed once at the very end — a per-file afterAll would
 * pull it out from under the files that run later. */
export default async function globalTeardown(): Promise<void> {
  await closeDb();
}
