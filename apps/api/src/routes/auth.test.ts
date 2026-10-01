import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

// Mocked before importing anything that pulls in the real db module, so the
// real db.ts (which would process.exit without a live DATABASE_URL) never runs.
vi.mock("../db", () => ({
  db: { query: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";

const query = db.query as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";

let HASH: string;

function mechanicRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: MECHANIC_ID,
    workshop_id: WORKSHOP_ID,
    name: "Sam Owner",
    email: "owner@demo.test",
    password_hash: HASH,
    role: "owner",
    is_active: true,
    ...overrides,
  };
}

describe("POST /api/auth/login", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Low cost factor — this is a test fixture, not a real credential.
    HASH = await bcrypt.hash("password123", 4);
  });

  beforeEach(async () => {
    query.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
  });

  // --- Requirement #1: email lookup is global, not scoped to a workshop ---
  it("looks up the mechanic by email alone, with no workshop in the request", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] });
    query.mockResolvedValueOnce({ rows: [] }); // last_login_at update

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const [sql, params] = query.mock.calls[0];
    // workshop_id is a selected column (needed for the JWT) but must not
    // appear in the WHERE clause — login isn't scoped to a workshop.
    expect(sql).toMatch(/WHERE\s+email\s*=\s*\$1\s*$/i);
    expect(params).toEqual(["owner@demo.test"]);
  });

  // --- Requirement #3: inactive mechanics can't log in ---
  it("rejects a correct password for an inactive mechanic", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow({ is_active: false })] });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    expect(res.statusCode).toBe(401);
  });

  // --- Requirement #4: successful login updates last_login_at ---
  it("updates last_login_at on a successful login", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] });
    query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    const updateCall = query.mock.calls.find(([sql]) => /last_login_at/i.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([MECHANIC_ID]);
  });

  // --- Requirement #5: role comes back on login ---
  it("returns the mechanic's role in the response", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow({ role: "mechanic" })] });
    query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    expect(res.json().mechanic.role).toBe("mechanic");
  });

  // --- Requirement #6: a session token (JWT) comes back, no cookie/session id ---
  it("returns a JWT and sets no session cookie", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] });
    query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    const body = res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3); // header.payload.signature
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  // --- Requirement #15 (flagged as our own addition): no user-enumeration via error messages ---
  it("gives the same error and status for a wrong password and a nonexistent email", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] }); // wrong password case
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "not-it" },
    });

    query.mockResolvedValueOnce({ rows: [] }); // nonexistent email case
    const noSuchEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@demo.test", password: "whatever" },
    });

    expect(wrongPassword.statusCode).toBe(noSuchEmail.statusCode);
    expect(wrongPassword.json()).toEqual(noSuchEmail.json());
  });

  // --- Requirement #16: password hash never leaves the server ---
  it("never includes password_hash anywhere in the response", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] });
    query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    expect(res.payload).not.toMatch(/password/i);
    expect(res.payload).not.toContain(HASH);
  });

  // --- Requirement #17: malformed input fails cleanly, doesn't crash ---
  it("returns 400 for missing email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "password123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an empty-string email rather than querying the database", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "", password: "password123" },
    });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  // --- Requirement #7: no OTP/third-party-IdP step — email+password alone is sufficient ---
  it("logs in with only email and password, no OTP or external-provider fields required", async () => {
    query.mockResolvedValueOnce({ rows: [mechanicRow()] });
    query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@demo.test", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
  });

  // --- Requirement #8: no self-signup path exists ---
  it("has no signup/register endpoint", async () => {
    const signup = await app.inject({ method: "POST", url: "/api/auth/signup", payload: {} });
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: {} });
    expect(signup.statusCode).toBe(404);
    expect(register.statusCode).toBe(404);
  });

  it("does not crash on a malformed JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
