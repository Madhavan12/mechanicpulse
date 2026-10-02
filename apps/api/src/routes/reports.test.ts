import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";
import { hashReportToken } from "../lib/reportToken";

const connect = db.connect as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";
const JOB_ID = "00000000-0000-0000-0000-00000000b001";
const REPORT_ID = "00000000-0000-0000-0000-0000000f0001";
const ITEM_1 = "00000000-0000-0000-0000-00000000d001";
const ITEM_2 = "00000000-0000-0000-0000-00000000d002";

interface Route {
  match: RegExp;
  rows?: unknown[];
  throws?: unknown;
}

/** Answers queries by matching the SQL rather than by call order. Order-based
 * mocks break every time a query is added to the transaction. */
function mockClient(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    const route = routes.find((r) => r.match.test(sql));
    if (!route) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    if (route.throws) throw route.throws;
    return { rows: route.rows ?? [] };
  });
  const release = vi.fn();
  connect.mockResolvedValue({ query, release });
  return { calls, query, release };
}

function itemRow(id: string, priceCents: number, position: number) {
  return {
    id,
    title: `Item ${position}`,
    severity: "red",
    note: null,
    price_cents: priceCents,
    position,
  };
}

const HAPPY_ROUTES: Route[] = [
  { match: /FROM jobs WHERE id/i, rows: [{ id: JOB_ID }] },
  { match: /FROM inspection_items/i, rows: [itemRow(ITEM_1, 28900, 0), itemRow(ITEM_2, 4500, 1)] },
  {
    match: /INSERT INTO reports/i,
    rows: [{ id: REPORT_ID, sent_at: "2026-10-02T00:00:00.000Z", expires_at: "2026-10-09T00:00:00.000Z" }],
  },
  { match: /INSERT INTO report_items/i },
  { match: /UPDATE jobs SET status/i },
  { match: /INSERT INTO events/i },
];

/** Routes with one override swapped in, so each test states only what differs. */
function routesWith(override: Route): Route[] {
  return [override, ...HAPPY_ROUTES.filter((r) => r.match.source !== override.match.source)];
}

function send(app: FastifyInstance, token: string, body: unknown = {}, jobId = JOB_ID) {
  return app.inject({
    method: "POST",
    url: `/api/jobs/${jobId}/report`,
    headers: { authorization: `Bearer ${token}` },
    payload: body as object,
  });
}

describe("POST /api/jobs/:id/report", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    connect.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "https://app.example.test" });
    token = app.jwt.sign({ sub: MECHANIC_ID, workshopId: WORKSHOP_ID, role: "owner" });
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "POST", url: `/api/jobs/${JOB_ID}/report`, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it("scopes the job lookup to the caller's workshop", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    await send(app, token);

    const jobLookup = calls.find((c) => /FROM jobs WHERE id/i.test(c.sql));
    expect(jobLookup!.sql).toMatch(/workshop_id\s*=\s*\$2/i);
    expect(jobLookup!.params).toEqual([JOB_ID, WORKSHOP_ID]);
  });

  it("404s for a job in another workshop rather than leaking that it exists", async () => {
    mockClient(routesWith({ match: /FROM jobs WHERE id/i, rows: [] }));
    const res = await send(app, token);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("job_not_found");
  });

  it("refuses to send a job with no inspection items", async () => {
    mockClient(routesWith({ match: /FROM inspection_items/i, rows: [] }));
    const res = await send(app, token);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("no_items");
  });

  it("rejects item ids that aren't on the job", async () => {
    mockClient(HAPPY_ROUTES);
    const res = await send(app, token, { itemIds: [ITEM_1, "00000000-0000-0000-0000-0000000000ff"] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_item");
  });

  it("returns 201 with a token, link and total", async () => {
    mockClient(HAPPY_ROUTES);
    const res = await send(app, token);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.reportId).toBe(REPORT_ID);
    expect(body.totalCents).toBe(33400);
    expect(body.reportUrl).toBe(`https://app.example.test/r/${body.token}`);
    expect(body.expiresAt).toBe("2026-10-09T00:00:00.000Z");
  });

  it("stores only the token's hash, never the token itself", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    const res = await send(app, token);
    const rawToken: string = res.json().token;

    const insert = calls.find((c) => /INSERT INTO reports/i.test(c.sql))!;
    const stored = insert.params[1] as Buffer;

    expect(Buffer.isBuffer(stored)).toBe(true);
    expect(stored).toHaveLength(32); // the CHECK on reports.token_hash
    expect(stored.equals(hashReportToken(rawToken))).toBe(true);
    // The raw token must appear nowhere in what we persist.
    const persisted = JSON.stringify(calls.map((c) => c.params));
    expect(persisted).not.toContain(rawToken);
  });

  it("issues a different token every time", async () => {
    mockClient(HAPPY_ROUTES);
    const first = (await send(app, token)).json().token;
    mockClient(HAPPY_ROUTES);
    const second = (await send(app, token)).json().token;

    expect(first).not.toBe(second);
    // 32 random bytes, base64url: 43 chars, no padding.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("snapshots every item into report_items", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    await send(app, token);

    const snapshots = calls.filter((c) => /INSERT INTO report_items/i.test(c.sql));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.params[1])).toEqual([ITEM_1, ITEM_2]);
    // Price is copied, not referenced — a later edit can't move what was quoted.
    expect(snapshots[0].params[5]).toBe(28900);
  });

  it("includes only the requested items when itemIds is given", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    const res = await send(app, token, { itemIds: [ITEM_2] });

    expect(res.statusCode).toBe(201);
    expect(res.json().totalCents).toBe(4500);
    const snapshots = calls.filter((c) => /INSERT INTO report_items/i.test(c.sql));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].params[1]).toBe(ITEM_2);
  });

  it("moves the job to sent and records a report.sent event", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    await send(app, token);

    expect(calls.some((c) => /UPDATE jobs SET status = 'sent'/i.test(c.sql))).toBe(true);

    const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
    expect(event.sql).toMatch(/'report\.sent'/);
    expect(event.params.slice(0, 4)).toEqual([WORKSHOP_ID, JOB_ID, REPORT_ID, MECHANIC_ID]);
    expect(JSON.parse(event.params[4] as string)).toEqual({ itemCount: 2, totalCents: 33400 });
  });

  it("commits once, on the happy path", async () => {
    const { calls } = mockClient(HAPPY_ROUTES);
    await send(app, token);

    expect(calls.filter((c) => /^\s*COMMIT/i.test(c.sql))).toHaveLength(1);
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(false);
  });

  it("409s when a live report already exists for the job", async () => {
    mockClient(routesWith({ match: /INSERT INTO reports/i, throws: Object.assign(new Error("dup"), { code: "23505" }) }));
    const res = await send(app, token);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("report_already_live");
  });

  it("rolls back and releases the connection when a query fails", async () => {
    const { calls, release } = mockClient(
      routesWith({ match: /INSERT INTO reports/i, throws: new Error("boom") })
    );
    const res = await send(app, token);

    expect(res.statusCode).toBe(500);
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("releases the connection on success too", async () => {
    const { release } = mockClient(HAPPY_ROUTES);
    await send(app, token);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("report tokens", () => {
  it("hashes with plain SHA-256, so lookup is a single indexed equality", () => {
    const expected = createHash("sha256").update("a-known-token").digest();
    expect(hashReportToken("a-known-token").equals(expected)).toBe(true);
  });

  it("produces exactly 32 bytes, matching the column's CHECK", () => {
    expect(hashReportToken("x")).toHaveLength(32);
  });
});
