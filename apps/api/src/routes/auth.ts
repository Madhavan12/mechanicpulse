import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { db } from "../db";
import type { LoginRequest, LoginResponse, Mechanic } from "../../../../packages/shared/types";

interface MechanicRow {
  id: string;
  workshop_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "owner" | "mechanic";
  is_active: boolean;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginRequest }>("/api/auth/login", async (req, reply) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return reply.status(400).send({ error: "bad_request", message: "Email and password are required." });
    }

    const { rows } = await db.query<MechanicRow>(
      `SELECT id, workshop_id, name, email, password_hash, role, is_active
       FROM mechanics WHERE email = $1`,
      [email]
    );
    const row = rows[0];

    // Same response whether the email doesn't exist or the password is wrong,
    // so login can't be used to find out which mechanic emails are real.
    const invalid = () => reply.status(401).send({ error: "invalid_credentials", message: "Wrong email or password." });

    if (!row || !row.is_active) return invalid();

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return invalid();

    await db.query("UPDATE mechanics SET last_login_at = now() WHERE id = $1", [row.id]);

    const mechanic: Mechanic = {
      id: row.id,
      workshopId: row.workshop_id,
      name: row.name,
      email: row.email,
      role: row.role,
    };

    const token = app.jwt.sign({ sub: mechanic.id, workshopId: mechanic.workshopId, role: mechanic.role }, { expiresIn: "12h" });

    const body: LoginResponse = { token, mechanic };
    return reply.send(body);
  });
}
