import "dotenv/config";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";

/** Creates a workshop (if it doesn't exist yet) and an owner login, for real
 * environments where the demo seed (a shared, public password) must never be
 * loaded. Everything comes from environment variables. Leave MECHANIC_PASSWORD
 * unset to have one generated and printed once: that keeps it out of shell
 * history and out of an ECS task's command line, which AWS keeps for a while.
 * There is no change-password screen yet, so treat the printed one as the
 * login's password.
 *
 *   WORKSHOP_NAME="Acme Motors" WORKSHOP_PHONE=+61390000000 \
 *   MECHANIC_NAME="Sam Owner" MECHANIC_EMAIL=sam@acme.example \
 *   npm run db:create-mechanic
 */
async function main() {
  const need = (k: string) => {
    const v = process.env[k]?.trim();
    if (!v) throw new Error(`${k} is required.`);
    return v;
  };
  const url = need("DATABASE_URL");
  const workshopName = need("WORKSHOP_NAME");
  const name = need("MECHANIC_NAME");
  const email = need("MECHANIC_EMAIL");
  const supplied = process.env.MECHANIC_PASSWORD?.trim();
  const password = supplied || randomBytes(15).toString("base64url"); // 20 chars
  const phone = process.env.WORKSHOP_PHONE?.trim() || null;
  if (supplied && supplied.length < 12) throw new Error("MECHANIC_PASSWORD must be at least 12 characters.");

  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>("SELECT id FROM workshops WHERE name = $1 LIMIT 1", [workshopName]);
    const workshopId =
      existing.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          "INSERT INTO workshops (name, phone_e164) VALUES ($1, $2) RETURNING id",
          [workshopName, phone]
        )
      ).rows[0].id;
    await client.query(
      "INSERT INTO mechanics (workshop_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'owner')",
      [workshopId, name, email, await bcrypt.hash(password, 10)]
    );
    await client.query("COMMIT");
    console.log(`created owner ${email} for workshop "${workshopName}"`);
    if (!supplied) console.log(`generated password (shown once): ${password}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
