import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn() },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c: unknown, cmd: { input: { Key: string } }) => `https://signed.example.test/${cmd.input.Key}`),
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

describe("GET /api/jobs/:id", () => {
  let app: FastifyInstance;
  let token: string;
  const JOB_ID = "00000000-0000-0000-0000-00000000b001";
  const detailRow = (o: Partial<Record<string, unknown>> = {}) => ({
    id: JOB_ID,
    status: "open",
    created_at: "2026-10-01T00:00:00.000Z",
    odometer_km: 85000,
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    vehicle_rego: "ABC123",
    customer_name: "Alex Customer",
    customer_mobile: "+61412345678",
    ...o,
  });
  const itemRow = (id: string, price: number, position: number) => ({
    id, title: `Item ${position}`, severity: "amber", note: null, price_cents: price, position,
  });
  const get = (id = JOB_ID) => app.inject({ method: "GET", url: `/api/jobs/${id}`, headers: { authorization: `Bearer ${token}` } });

  beforeEach(async () => {
    query.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
    token = app.jwt.sign({ sub: "mechanic-1", workshopId: WORKSHOP_ID, role: "owner" });
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: `/api/jobs/${JOB_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("scopes the lookup to the token's workshop", async () => {
    query.mockResolvedValueOnce({ rows: [detailRow()] }).mockResolvedValueOnce({ rows: [] });
    await get();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/j\.id\s*=\s*\$1\s+AND\s+j\.workshop_id\s*=\s*\$2/i);
    expect(params).toEqual([JOB_ID, WORKSHOP_ID]);
  });

  it("returns the job with its findings and their total in cents", async () => {
    query
      .mockResolvedValueOnce({ rows: [detailRow()] })
      .mockResolvedValueOnce({ rows: [itemRow("i1", 28900, 0), itemRow("i2", 4500, 1)] })
      .mockResolvedValueOnce({ rows: [{ id: "m1", inspection_item_id: "i1", storage_key: "w/d/a.webp" }] });
    const body = (await get()).json();

    expect(body).toMatchObject({
      id: JOB_ID, status: "open", displayStatus: "in_progress", customerName: "Alex Customer",
      vehicleRego: "ABC123", vehicleMake: "Toyota", odometerKm: 85000, totalCents: 33400,
      customerMobile: "+61412345678",
    });
    // Only finished uploads, as short-lived presigned links, grouped by finding.
    expect(body.items[0].photos).toEqual([{ id: "m1", url: "https://signed.example.test/w/d/a.webp" }]);
    expect(body.items[1].photos).toEqual([]);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ id: "i1", priceCents: 28900, position: 0 });
  });

  it("shows a job with no findings as not_started with a zero total", async () => {
    query.mockResolvedValueOnce({ rows: [detailRow()] }).mockResolvedValueOnce({ rows: [] });
    expect((await get()).json()).toMatchObject({ displayStatus: "not_started", items: [], totalCents: 0 });
  });

  it("404s for a job that isn't in this workshop, without looking up findings", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await get();
    expect(res.statusCode).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("404s on an id that isn't a UUID instead of a database error", async () => {
    const res = await get("nope");
    expect(res.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
});

