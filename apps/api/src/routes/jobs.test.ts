import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";

const query = db.query as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-00000000b001",
    status: "open",
    created_at: "2026-10-01T00:00:00.000Z",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    vehicle_rego: "ABC123",
    customer_name: "Alex Customer",
    has_items: false,
    ...overrides,
  };
}

describe("GET /api/jobs", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    query.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
    token = app.jwt.sign({ sub: "mechanic-1", workshopId: WORKSHOP_ID, role: "owner" });
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(401);
  });

  it("only returns jobs for the authenticated mechanic's workshop", async () => {
    query.mockResolvedValueOnce({ rows: [jobRow()] });

    await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE\s+j\.workshop_id\s*=\s*\$1/i);
    expect(params).toEqual([WORKSHOP_ID]);
  });

  it("maps an open job with no items to not_started", async () => {
    query.mockResolvedValueOnce({ rows: [jobRow({ status: "open", has_items: false })] });
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    expect(res.json().jobs[0].displayStatus).toBe("not_started");
  });

  it("maps an open job with items to in_progress", async () => {
    query.mockResolvedValueOnce({ rows: [jobRow({ status: "open", has_items: true })] });
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    expect(res.json().jobs[0].displayStatus).toBe("in_progress");
  });

  it.each(["sent", "decided", "closed"])("maps a %s job to completed", async (status) => {
    query.mockResolvedValueOnce({ rows: [jobRow({ status, has_items: true })] });
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    expect(res.json().jobs[0].displayStatus).toBe("completed");
  });

  it("includes vehicle and customer info on each job", async () => {
    query.mockResolvedValueOnce({ rows: [jobRow()] });
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    const job = res.json().jobs[0];
    expect(job).toMatchObject({
      vehicleMake: "Toyota",
      vehicleModel: "Corolla",
      vehicleRego: "ABC123",
      customerName: "Alex Customer",
    });
  });

  it("returns an empty array when the workshop has no jobs", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    expect(res.json().jobs).toEqual([]);
  });

  it("orders jobs newest first", async () => {
    query.mockResolvedValueOnce({ rows: [jobRow()] });
    await app.inject({ method: "GET", url: "/api/jobs", headers: { authorization: `Bearer ${token}` } });
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY\s+j\.created_at\s+DESC/i);
  });
});
