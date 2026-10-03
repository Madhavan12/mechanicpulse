import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client: unknown, cmd: { input: { Key: string } }) =>
    `https://signed.example.test/${cmd.input.Key}?sig=abc`
  ),
}));

import { db } from "../db";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildApp } from "../app";
import { hashReportToken } from "../lib/reportToken";

const query = db.query as unknown as ReturnType<typeof vi.fn>;
const connect = db.connect as unknown as ReturnType<typeof vi.fn>;
const signUrl = getSignedUrl as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "00000000-0000-0000-0000-00000000b001";
const REPORT_ID = "00000000-0000-0000-0000-0000000f0001";
const ITEM_1 = "00000000-0000-0000-0000-00000000d001";
const ITEM_2 = "00000000-0000-0000-0000-00000000d002";
const TOKEN = "a-test-report-token";

const future = () => new Date(Date.now() + 6 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

interface Route {
  match: RegExp;
  rows?: unknown[];
  throws?: unknown;
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    job_id: JOB_ID,
    workshop_id: WORKSHOP_ID,
    sent_at: "2026-10-02T00:00:00.000Z",
    expires_at: future(),
    decided_at: null,
    revoked_at: null,
    total_cents: 33400,
    workshop_name: "Demo Auto Care",
    workshop_phone: "+61390000000",
    customer_name: "Alex Customer",
    vehicle_rego: "ABC123",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    ...overrides,
  };
}

function viewRow(id: string, priceCents: number, position: number, overrides: Record<string, unknown> = {}) {
  return {
    inspection_item_id: id,
    title: `Item ${position}`,
    severity: "red",
    note: null,
    price_cents: priceCents,
    position,
    decision: null,
    storage_keys: [`photos/${id}.webp`],
    ...overrides,
  };
}

/** Matches on SQL text rather than call order — the handlers issue a
 * different number of queries depending on the report's state. */
function router(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    const route = routes.find((r) => r.match.test(sql));
    if (!route) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    if (route.throws) throw route.throws;
    return { rows: route.rows ?? [] };
  });
  return { calls, fn };
}

/* ---------------------------- GET the report ---------------------------- */

const GET_ROUTES: Route[] = [
  { match: /FROM\s+reports\s+r/i, rows: [reportRow()] },
  { match: /UPDATE reports SET first_opened_at/i, rows: [{ id: REPORT_ID }] },
  { match: /INSERT INTO events/i },
  { match: /FROM report_items ri/i, rows: [viewRow(ITEM_1, 28900, 0), viewRow(ITEM_2, 4500, 1)] },
];

function getRoutes(override: Route): Route[] {
  return [override, ...GET_ROUTES.filter((r) => r.match.source !== override.match.source)];
}

describe("GET /api/report/:token", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    query.mockReset();
    signUrl.mockClear();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "https://app.example.test" });
  });

  function fetchReport(token = TOKEN) {
    return app.inject({ method: "GET", url: `/api/report/${token}` });
  }

  it("needs no Authorization header — the token is the whole credential", async () => {
    const { fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    const res = await fetchReport();
    expect(res.statusCode).toBe(200);
  });

  it("looks the report up by hash, never by the raw token", async () => {
    const { calls, fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    await fetchReport();

    const lookup = calls.find((c) => /FROM\s+reports\s+r/i.test(c.sql))!;
    expect(lookup.sql).toMatch(/token_hash\s*=\s*\$1/i);
    expect((lookup.params[0] as Buffer).equals(hashReportToken(TOKEN))).toBe(true);
    expect(lookup.params).not.toContain(TOKEN);
  });

  it("404s on an unknown token with a message that reveals nothing", async () => {
    const { fn } = router(getRoutes({ match: /FROM\s+reports\s+r/i, rows: [] }));
    query.mockImplementation(fn);
    const res = await fetchReport("nope");

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "This link isn't valid." });
  });

  it("returns the live report with its items and total", async () => {
    const { fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    const body = (await fetchReport()).json();

    expect(body.state).toBe("open");
    expect(body.totalCents).toBe(33400);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ inspectionItemId: ITEM_1, priceCents: 28900, decision: null });
    expect(body.workshopName).toBe("Demo Auto Care");
  });

  it("presigns each photo instead of exposing a durable S3 URL", async () => {
    const { fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    const body = (await fetchReport()).json();

    expect(body.items[0].photoUrls).toEqual([`https://signed.example.test/photos/${ITEM_1}.webp?sig=abc`]);
    expect(signUrl).toHaveBeenCalledTimes(2);
    // Minutes, not hours — a forwarded screenshot URL should stop working.
    expect(signUrl.mock.calls[0][2]).toMatchObject({ expiresIn: 900 });
  });

  it("drops a photo that won't sign rather than failing the whole report", async () => {
    const { fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    signUrl.mockRejectedValueOnce(new Error("no credentials"));

    const body = (await fetchReport()).json();
    expect(body.items[0].photoUrls).toEqual([]);
    expect(body.items[1].photoUrls).toHaveLength(1);
    expect(body.state).toBe("open");
  });

  it("records report.opened on the first open only", async () => {
    const { calls, fn } = router(GET_ROUTES);
    query.mockImplementation(fn);
    await fetchReport();

    const update = calls.find((c) => /UPDATE reports SET first_opened_at/i.test(c.sql))!;
    // The WHERE clause is what makes a reload idempotent.
    expect(update.sql).toMatch(/first_opened_at IS NULL/i);

    const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
    expect(event.sql).toMatch(/'report\.opened'/);
    expect(event.sql).toMatch(/'customer'/);
    expect(event.params).toEqual([WORKSHOP_ID, JOB_ID, REPORT_ID]);
  });

  it("does not record a second open when the report was already opened", async () => {
    const { calls, fn } = router(getRoutes({ match: /UPDATE reports SET first_opened_at/i, rows: [] }));
    query.mockImplementation(fn);
    await fetchReport();

    expect(calls.some((c) => /INSERT INTO events/i.test(c.sql))).toBe(false);
  });

  it("shows a decided report read-only, with the customer's own answers", async () => {
    const { calls, fn } = router([
      { match: /FROM\s+reports\s+r/i, rows: [reportRow({ decided_at: "2026-10-03T00:00:00.000Z" })] },
      {
        match: /FROM report_items ri/i,
        rows: [viewRow(ITEM_1, 28900, 0, { decision: "approved" }), viewRow(ITEM_2, 4500, 1, { decision: "declined" })],
      },
    ]);
    query.mockImplementation(fn);
    const body = (await fetchReport()).json();

    expect(body.state).toBe("decided");
    expect(body.items.map((i: { decision: string }) => i.decision)).toEqual(["approved", "declined"]);
    // A decided report isn't a new "open".
    expect(calls.some((c) => /INSERT INTO events/i.test(c.sql))).toBe(false);
  });

  it("reports an expired link as expired and withholds the quote", async () => {
    const { fn } = router([{ match: /FROM\s+reports\s+r/i, rows: [reportRow({ expires_at: past() })] }]);
    query.mockImplementation(fn);
    const body = (await fetchReport()).json();

    expect(body.state).toBe("expired");
    expect(body.items).toEqual([]);
    // The shop's number still comes through so the customer can call.
    expect(body.workshopPhone).toBe("+61390000000");
  });

  it("reports a revoked link as revoked and withholds the quote", async () => {
    const { fn } = router([
      { match: /FROM\s+reports\s+r/i, rows: [reportRow({ revoked_at: "2026-10-03T00:00:00.000Z" })] },
    ]);
    query.mockImplementation(fn);
    const body = (await fetchReport()).json();

    expect(body.state).toBe("revoked");
    expect(body.items).toEqual([]);
  });

  it("treats revoked as the overriding state, even if it was also decided", async () => {
    const { fn } = router([
      {
        match: /FROM\s+reports\s+r/i,
        rows: [reportRow({ revoked_at: past(), decided_at: past(), expires_at: past() })],
      },
    ]);
    query.mockImplementation(fn);
    expect((await fetchReport()).json().state).toBe("revoked");
  });
});

/* --------------------------- POST the decision -------------------------- */

const DECIDE_ROUTES: Route[] = [
  { match: /FROM\s+reports\s+r/i, rows: [reportRow()] },
  {
    match: /FROM report_items WHERE report_id/i,
    rows: [
      { inspection_item_id: ITEM_1, price_cents: 28900 },
      { inspection_item_id: ITEM_2, price_cents: 4500 },
    ],
  },
  { match: /INSERT INTO approvals/i },
  { match: /UPDATE reports SET decided_at/i, rows: [{ decided_at: "2026-10-03T01:02:03.000Z" }] },
  { match: /UPDATE jobs SET status/i },
  { match: /INSERT INTO events/i },
];

function decideRoutes(override: Route): Route[] {
  return [override, ...DECIDE_ROUTES.filter((r) => r.match.source !== override.match.source)];
}

describe("POST /api/report/:token/decision", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    connect.mockReset();
    query.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "https://app.example.test" });
  });

  function mockClient(routes: Route[]) {
    const { calls, fn } = router(routes);
    const release = vi.fn();
    connect.mockResolvedValue({ query: fn, release });
    return { calls, release };
  }

  function decide(payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: `/api/report/${TOKEN}/decision`,
      payload: payload as object,
      headers,
    });
  }

  const bothApproved = {
    signedName: "Alex Customer",
    decisions: [
      { itemId: ITEM_1, decision: "approved" },
      { itemId: ITEM_2, decision: "approved" },
    ],
  };

  it("needs no Authorization header", async () => {
    mockClient(DECIDE_ROUTES);
    expect((await decide(bothApproved)).statusCode).toBe(200);
  });

  it.each([
    ["a blank name", { ...bothApproved, signedName: "   " }, "name_required"],
    ["no decisions", { signedName: "Alex", decisions: [] }, "no_decisions"],
    ["a decision that isn't approve or decline", { signedName: "Alex", decisions: [{ itemId: ITEM_1, decision: "maybe" }] }, "bad_decision"],
  ])("rejects %s before touching the database", async (_label, payload, error) => {
    mockClient(DECIDE_ROUTES);
    const res = await decide(payload);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(error);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a partial submission — every item must be decided", async () => {
    mockClient(DECIDE_ROUTES);
    const res = await decide({ signedName: "Alex", decisions: [{ itemId: ITEM_1, decision: "approved" }] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("incomplete");
  });

  it("rejects the same item listed twice", async () => {
    mockClient(DECIDE_ROUTES);
    const res = await decide({
      signedName: "Alex",
      decisions: [
        { itemId: ITEM_1, decision: "approved" },
        { itemId: ITEM_1, decision: "declined" },
      ],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("duplicate_item");
  });

  it("rejects an item that isn't on this report", async () => {
    mockClient(DECIDE_ROUTES);
    const res = await decide({
      signedName: "Alex",
      decisions: [
        { itemId: ITEM_1, decision: "approved" },
        { itemId: "00000000-0000-0000-0000-0000000000ff", decision: "approved" },
      ],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("incomplete");
  });

  it("404s on an unknown token", async () => {
    mockClient(decideRoutes({ match: /FROM\s+reports\s+r/i, rows: [] }));
    expect((await decide(bothApproved)).statusCode).toBe(404);
  });

  it("409s when the report was already submitted", async () => {
    mockClient(decideRoutes({ match: /FROM\s+reports\s+r/i, rows: [reportRow({ decided_at: past() })] }));
    const res = await decide(bothApproved);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_decided");
  });

  it.each([
    ["expired", { expires_at: past() }],
    ["revoked", { revoked_at: past() }],
  ])("410s on a %s link", async (error, overrides) => {
    mockClient(decideRoutes({ match: /FROM\s+reports\s+r/i, rows: [reportRow(overrides)] }));
    const res = await decide(bothApproved);

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe(error);
  });

  it("counts only the approved items towards the approved total", async () => {
    mockClient(DECIDE_ROUTES);
    const res = await decide({
      signedName: "Alex Customer",
      decisions: [
        { itemId: ITEM_1, decision: "approved" },
        { itemId: ITEM_2, decision: "declined" },
      ],
    });

    expect(res.json()).toEqual({
      decidedAt: "2026-10-03T01:02:03.000Z",
      approvedCount: 1,
      declinedCount: 1,
      approvedTotalCents: 28900,
    });
  });

  it("writes one approval per item, with the signature and audit trail", async () => {
    const { calls } = mockClient(DECIDE_ROUTES);
    await decide({ ...bothApproved, signedName: "  Alex Customer  " }, { "user-agent": "TestAgent/1.0" });

    const approvals = calls.filter((c) => /INSERT INTO approvals/i.test(c.sql));
    expect(approvals).toHaveLength(2);

    const [reportId, itemId, decision, signedName, ip, userAgent] = approvals[0].params;
    expect(reportId).toBe(REPORT_ID);
    expect(itemId).toBe(ITEM_1);
    expect(decision).toBe("approved");
    expect(signedName).toBe("Alex Customer"); // trimmed — the CHECK rejects blank
    expect(ip).toBe("127.0.0.1");
    expect(userAgent).toBe("TestAgent/1.0");
  });

  it("stamps the report decided and moves the job on", async () => {
    const { calls } = mockClient(DECIDE_ROUTES);
    await decide(bothApproved);

    expect(calls.some((c) => /UPDATE reports SET decided_at = now\(\)/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /UPDATE jobs SET status = 'decided'/i.test(c.sql))).toBe(true);
  });

  it("records approval.submitted with the numbers the funnel needs", async () => {
    const { calls } = mockClient(DECIDE_ROUTES);
    await decide({
      signedName: "Alex",
      decisions: [
        { itemId: ITEM_1, decision: "approved" },
        { itemId: ITEM_2, decision: "declined" },
      ],
    });

    const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
    expect(event.sql).toMatch(/'approval\.submitted'/);
    expect(event.sql).toMatch(/'customer'/);
    expect(JSON.parse(event.params[3] as string)).toEqual({
      approvedCount: 1,
      declinedCount: 1,
      approvedTotalCents: 28900,
      totalCents: 33400,
    });
  });

  it("commits once and releases the connection", async () => {
    const { calls, release } = mockClient(DECIDE_ROUTES);
    await decide(bothApproved);

    expect(calls.filter((c) => /^\s*COMMIT/i.test(c.sql))).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the unique index", "23505"],
    ["the live-report trigger", "P0001"],
  ])("turns a race lost to %s into a 409, not a 500", async (_label, code) => {
    const { calls } = mockClient(
      decideRoutes({ match: /INSERT INTO approvals/i, throws: Object.assign(new Error("race"), { code }) })
    );
    const res = await decide(bothApproved);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_decided");
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
  });

  it("rolls back and releases on an unexpected failure", async () => {
    const { calls, release } = mockClient(
      decideRoutes({ match: /INSERT INTO approvals/i, throws: new Error("boom") })
    );
    const res = await decide(bothApproved);

    expect(res.statusCode).toBe(500);
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
    expect(release).toHaveBeenCalled();
  });
});
