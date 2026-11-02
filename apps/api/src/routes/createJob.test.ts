import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";

const connect = db.connect as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";
const CUSTOMER_ID = "00000000-0000-0000-0000-0000000c0001";
const VEHICLE_ID = "00000000-0000-0000-0000-0000000e0001";
const JOB_ID = "00000000-0000-0000-0000-00000000b002";

/** Answers by matching the SQL, not by call order. */
function mockClient(overrides: Array<{ match: RegExp; throws?: unknown }> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rows: Array<[RegExp, unknown[]]> = [
    [/INSERT INTO customers/i, [{ id: CUSTOMER_ID }]],
    [/INSERT INTO vehicles/i, [{ id: VEHICLE_ID }]],
    [/INSERT INTO jobs/i, [{ id: JOB_ID }]],
    [/INSERT INTO events/i, []],
  ];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const bad = overrides.find((o) => o.match.test(sql));
    if (bad?.throws) throw bad.throws;
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    const hit = rows.find(([re]) => re.test(sql));
    if (!hit) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    return { rows: hit[1] };
  });
  const release = vi.fn();
  connect.mockResolvedValue({ query, release });
  return { calls, release };
}

describe("POST /api/jobs", () => {
  let app: FastifyInstance;
  let token: string;
  const body = { customerName: "Sam Owner", customerMobile: "0412 345 678", rego: "xyz 789", make: "Mazda", model: "3", odometerKm: 120000 };

  function create(payload: unknown = body, auth = true) {
    return app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload: payload as never,
    });
  }

  beforeEach(async () => {
    connect.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
    token = app.jwt.sign({ sub: MECHANIC_ID, workshopId: WORKSHOP_ID, role: "mechanic" });
  });

  it("requires authentication", async () => {
    mockClient();
    expect((await create(body, false)).statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it("creates the job and returns its id", async () => {
    mockClient();
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ jobId: JOB_ID });
  });

  it("takes workshop and mechanic from the token, never the body", async () => {
    const { calls } = mockClient();
    await create({ ...body, workshopId: "evil", createdBy: "evil" });

    const job = calls.find((c) => /INSERT INTO jobs/i.test(c.sql))!;
    expect(job.params).toEqual([WORKSHOP_ID, VEHICLE_ID, CUSTOMER_ID, MECHANIC_ID, 120000]);
    for (const c of calls) expect(c.params).not.toContain("evil");
  });

  it("stores the mobile as E.164 and the rego normalised", async () => {
    const { calls } = mockClient();
    await create();

    expect(calls.find((c) => /INSERT INTO customers/i.test(c.sql))!.params).toEqual([WORKSHOP_ID, "Sam Owner", "+61412345678"]);
    expect(calls.find((c) => /INSERT INTO vehicles/i.test(c.sql))!.params).toEqual([WORKSHOP_ID, CUSTOMER_ID, "XYZ789", "Mazda", "3"]);
  });

  it("reuses an existing customer and vehicle instead of duplicating (upsert on the unique keys)", async () => {
    const { calls } = mockClient();
    await create();

    expect(calls.find((c) => /INSERT INTO customers/i.test(c.sql))!.sql).toMatch(/ON CONFLICT \(workshop_id, mobile_e164\)/i);
    const vehicle = calls.find((c) => /INSERT INTO vehicles/i.test(c.sql))!.sql;
    expect(vehicle).toMatch(/ON CONFLICT \(workshop_id, rego\)/i);
    // Ownership follows the job's customer.
    expect(vehicle).toMatch(/SET customer_id = EXCLUDED\.customer_id/i);
  });

  it("does not overwrite an existing customer's name", async () => {
    const { calls } = mockClient();
    await create();
    const sql = calls.find((c) => /INSERT INTO customers/i.test(c.sql))!.sql;
    expect(sql).not.toMatch(/SET\s+name/i);
  });

  it("writes a job.created event in the same transaction", async () => {
    const { calls } = mockClient();
    await create();

    const order = calls.map((c) => c.sql.trim().split(/\s+/)[0].toUpperCase() + (/INSERT INTO (\w+)/i.exec(c.sql)?.[1] ?? ""));
    expect(order).toEqual(["BEGIN", "INSERTcustomers", "INSERTvehicles", "INSERTjobs", "INSERTevents", "COMMIT"]);
    const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
    expect(event.sql).toMatch(/'job\.created'/);
    expect(event.params).toEqual([WORKSHOP_ID, JOB_ID, MECHANIC_ID]);
  });

  it("allows the optional fields to be left out", async () => {
    const { calls } = mockClient();
    const res = await create({ customerName: "Sam", customerMobile: "0412345678", rego: "ABC1" });
    expect(res.statusCode).toBe(201);
    expect(calls.find((c) => /INSERT INTO jobs/i.test(c.sql))!.params[4]).toBeNull();
  });

  it.each([
    ["a blank name", { ...body, customerName: "" }, "customerName"],
    ["a bad mobile", { ...body, customerMobile: "12345" }, "customerMobile"],
    ["a bad rego", { ...body, rego: "AB-12" }, "rego"],
    ["a negative odometer", { ...body, odometerKm: -5 }, "odometerKm"],
  ])("rejects %s with a 400 naming the field, before touching the database", async (_label, payload, field) => {
    mockClient();
    const res = await create(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_field", field });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rolls back and releases the connection if a step fails, leaving no orphan rows", async () => {
    const { calls, release } = mockClient([{ match: /INSERT INTO jobs/i, throws: new Error("boom") }]);
    const res = await create();

    expect(res.statusCode).toBe(500);
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /^\s*COMMIT/i.test(c.sql))).toBe(false);
    expect(release).toHaveBeenCalled();
  });
});
