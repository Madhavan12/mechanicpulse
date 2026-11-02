import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c: unknown, cmd: { input: { Key: string } }) => `https://signed.example.test/${cmd.input.Key}`),
}));

import { db } from "../db";
import { buildApp } from "../app";

const connect = db.connect as unknown as ReturnType<typeof vi.fn>;
const query = db.query as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";
const JOB_ID = "00000000-0000-0000-0000-00000000b001";
const ITEM_ID = "00000000-0000-0000-0000-00000000d001";

const ITEM_ROW = { id: ITEM_ID, title: "Front brake pads worn", severity: "red", note: null, price_cents: 28900, position: 0 };

interface Route {
  match: RegExp;
  rows?: unknown[];
  rowCount?: number;
  throws?: unknown;
}

/** Answers by matching the SQL, not by call order. */
function mockClient(jobStatus: string | null = "open", extra: Route[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const routes: Route[] = [
    ...extra,
    { match: /FROM jobs WHERE id/i, rows: jobStatus ? [{ status: jobStatus }] : [] },
    { match: /INSERT INTO inspection_items/i, rows: [ITEM_ROW] },
    { match: /UPDATE inspection_items/i, rows: [ITEM_ROW] },
    { match: /DELETE FROM inspection_items/i, rows: [], rowCount: 1 },
    { match: /INSERT INTO events/i },
  ];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    const route = routes.find((r) => r.match.test(sql));
    if (!route) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    if (route.throws) throw route.throws;
    return { rows: route.rows ?? [], rowCount: route.rowCount ?? route.rows?.length ?? 0 };
  });
  const release = vi.fn();
  connect.mockResolvedValue({ query, release });
  return { calls, release };
}

describe("findings routes", () => {
  let app: FastifyInstance;
  let token: string;
  const body = { title: "Front brake pads worn", severity: "red", priceCents: 28900, note: "  2mm left " };

  beforeEach(async () => {
    connect.mockReset();
    query.mockReset();
    query.mockResolvedValue({ rows: [] }); // photo lookup: none by default
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
    token = app.jwt.sign({ sub: MECHANIC_ID, workshopId: WORKSHOP_ID, role: "mechanic" });
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const add = (payload: unknown = body, jobId = JOB_ID) =>
    app.inject({ method: "POST", url: `/api/jobs/${jobId}/items`, headers: auth(), payload: payload as never });
  const edit = (payload: unknown = body, itemId = ITEM_ID) =>
    app.inject({ method: "PATCH", url: `/api/jobs/${JOB_ID}/items/${itemId}`, headers: auth(), payload: payload as never });
  const remove = (itemId = ITEM_ID) =>
    app.inject({ method: "DELETE", url: `/api/jobs/${JOB_ID}/items/${itemId}`, headers: auth() });

  it.each([
    ["POST", `/api/jobs/${JOB_ID}/items`],
    ["PATCH", `/api/jobs/${JOB_ID}/items/${ITEM_ID}`],
    ["DELETE", `/api/jobs/${JOB_ID}/items/${ITEM_ID}`],
  ])("%s %s requires authentication", async (method, url) => {
    mockClient();
    const res = await app.inject({ method: method as "POST", url, payload: body });
    expect(res.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  describe("add", () => {
    it("creates the finding in cents, appended after the last position", async () => {
      const { calls } = mockClient();
      const res = await add();

      expect(res.statusCode).toBe(201);
      expect(res.json().item).toEqual({
        id: ITEM_ID, title: "Front brake pads worn", severity: "red", note: null, priceCents: 28900, position: 0, photos: [],
      });
      const insert = calls.find((c) => /INSERT INTO inspection_items/i.test(c.sql))!;
      expect(insert.sql).toMatch(/COALESCE\(MAX\(position\) \+ 1, 0\)/i);
      expect(insert.params).toEqual([JOB_ID, "Front brake pads worn", "red", "2mm left", 28900, MECHANIC_ID]);
    });

    it("scopes the job lookup to the token's workshop, locking the row", async () => {
      const { calls } = mockClient();
      await add();
      const lookup = calls.find((c) => /FROM jobs WHERE id/i.test(c.sql))!;
      expect(lookup.sql).toMatch(/workshop_id = \$2/i);
      expect(lookup.sql).toMatch(/FOR UPDATE/i);
      expect(lookup.params).toEqual([JOB_ID, WORKSHOP_ID]);
    });

    it("writes an item.added event in the same transaction", async () => {
      const { calls } = mockClient();
      await add();
      const order = calls.map((c) => (/INSERT INTO (\w+)/i.exec(c.sql)?.[1] ?? c.sql.trim().split(/\s+/)[0].toUpperCase()));
      expect(order.filter((o) => /BEGIN|COMMIT|events/.test(o))).toEqual(["BEGIN", "events", "COMMIT"]);
      const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
      expect(event.sql).toMatch(/'item\.added'/);
      expect(event.params).toEqual([WORKSHOP_ID, JOB_ID, MECHANIC_ID, JSON.stringify({ itemId: ITEM_ID })]);
    });

    it("404s for a job in another workshop or one that doesn't exist — the same answer", async () => {
      const { calls } = mockClient(null);
      const res = await add();
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
      expect(calls.some((c) => /INSERT INTO inspection_items/i.test(c.sql))).toBe(false);
    });

    it("404s on an id that isn't a UUID instead of a database error", async () => {
      mockClient();
      const res = await add(body, "not-a-uuid");
      expect(res.statusCode).toBe(404);
      expect(connect).not.toHaveBeenCalled();
    });

    it.each(["sent", "decided", "closed"])("409s when the job is %s", async (status) => {
      const { calls } = mockClient(status);
      const res = await add();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("job_locked");
      expect(calls.some((c) => /INSERT INTO inspection_items/i.test(c.sql))).toBe(false);
    });

    it.each([
      ["a blank title", { ...body, title: "" }, "title"],
      ["a bad severity", { ...body, severity: "blue" }, "severity"],
      ["a negative price", { ...body, priceCents: -1 }, "priceCents"],
      ["a fractional price", { ...body, priceCents: 1.5 }, "priceCents"],
    ])("rejects %s with a 400 naming the field, before touching the database", async (_l, payload, field) => {
      mockClient();
      const res = await add(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "invalid_field", field });
      expect(connect).not.toHaveBeenCalled();
    });

    it("accepts a price of zero", async () => {
      mockClient();
      expect((await add({ ...body, priceCents: 0 })).statusCode).toBe(201);
    });

    it("rolls back and releases the connection when a step fails", async () => {
      const { calls, release } = mockClient("open", [{ match: /INSERT INTO inspection_items/i, throws: new Error("boom") }]);
      expect((await add()).statusCode).toBe(500);
      expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
      expect(calls.some((c) => /^\s*COMMIT/i.test(c.sql))).toBe(false);
      expect(release).toHaveBeenCalled();
    });
  });

  describe("edit", () => {
    it("updates the finding, restricted to this job, and records item.updated", async () => {
      const { calls } = mockClient();
      const res = await edit();

      expect(res.statusCode).toBe(200);
      expect(res.json().item.id).toBe(ITEM_ID);
      const update = calls.find((c) => /UPDATE inspection_items/i.test(c.sql))!;
      expect(update.sql).toMatch(/WHERE id = \$1 AND job_id = \$2/i);
      expect(update.params.slice(0, 2)).toEqual([ITEM_ID, JOB_ID]);
      expect(calls.find((c) => /INSERT INTO events/i.test(c.sql))!.sql).toMatch(/'item\.updated'/);
    });

    it("returns the finding's existing photos so the form doesn't lose them", async () => {
      mockClient();
      query.mockResolvedValue({ rows: [{ id: "m1", inspection_item_id: ITEM_ID, storage_key: "w/2026-11-02/a.webp" }] });
      const res = await edit();
      expect(res.json().item.photos).toEqual([{ id: "m1", url: "https://signed.example.test/w/2026-11-02/a.webp" }]);
    });

    it("404s when the finding isn't on this job (another job's item id)", async () => {
      const { calls } = mockClient("open", [{ match: /UPDATE inspection_items/i, rows: [] }]);
      const res = await edit();
      expect(res.statusCode).toBe(404);
      expect(calls.some((c) => /INSERT INTO events/i.test(c.sql))).toBe(false);
    });

    it("409s once the report has been sent", async () => {
      mockClient("sent");
      expect((await edit()).statusCode).toBe(409);
    });

    it("rejects a bad body with a 400 before touching the database", async () => {
      mockClient();
      expect((await edit({ ...body, title: " " })).statusCode).toBe(400);
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes the finding and records item.deleted", async () => {
      const { calls } = mockClient();
      const res = await remove();

      expect(res.statusCode).toBe(204);
      expect(calls.find((c) => /DELETE FROM inspection_items/i.test(c.sql))!.params).toEqual([ITEM_ID, JOB_ID]);
      expect(calls.find((c) => /INSERT INTO events/i.test(c.sql))!.sql).toMatch(/'item\.deleted'/);
    });

    it("404s for a finding that isn't there", async () => {
      mockClient("open", [{ match: /DELETE FROM inspection_items/i, rows: [], rowCount: 0 }]);
      expect((await remove()).statusCode).toBe(404);
    });

    it("404s for another workshop's job", async () => {
      mockClient(null);
      expect((await remove()).statusCode).toBe(404);
    });

    it("409s once the report has been sent", async () => {
      const { calls } = mockClient("sent");
      expect((await remove()).statusCode).toBe(409);
      expect(calls.some((c) => /DELETE FROM/i.test(c.sql))).toBe(false);
    });
  });
});
