import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";
import { SmsSendError, type SmsProvider } from "../lib/sms/provider";
import { hashReportToken } from "../lib/reportToken";

const query = db.query as unknown as ReturnType<typeof vi.fn>;
const connect = db.connect as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";
const JOB_ID = "00000000-0000-0000-0000-00000000b001";
const OLD_REPORT = "00000000-0000-0000-0000-0000000f0001";
const NEW_REPORT = "00000000-0000-0000-0000-0000000f0002";
const SMS_ID = "00000000-0000-0000-0000-0000000c0001";
const ITEM_1 = "00000000-0000-0000-0000-00000000d001";

interface Route {
  match: RegExp;
  rows?: unknown[];
  rowCount?: number;
  throws?: unknown;
}

type Call = { sql: string; params: unknown[] };

/** Answers by matching the SQL, not by call order — see reports.test.ts. */
function router(routes: Route[], calls: Call[]) {
  return vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    const r = routes.find((x) => x.match.test(sql));
    if (!r) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    if (r.throws) throw r.throws;
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
  });
}

/** What the transaction (db.connect) sees. */
function mockTx(routes: Route[]) {
  const calls: Call[] = [];
  connect.mockResolvedValue({ query: router(routes, calls), release: vi.fn() });
  return calls;
}

/** What the post-commit SMS step (db.query) sees. */
function mockSmsDb(over: Route[] = []) {
  const calls: Call[] = [];
  const base: Route[] = [
    {
      match: /FROM jobs j\s+JOIN workshops/i,
      rows: [
        {
          workshop_name: "Acme Motors",
          customer_name: "Sam Customer",
          customer_mobile: "+61412345678",
          opted_out: false,
          vehicle_make: "Toyota",
          vehicle_model: "Corolla",
          vehicle_rego: "ABC123",
          item_count: 2,
        },
      ],
    },
    { match: /FROM sms_messages s LEFT JOIN reports/i, rows: [{ per_job: 0, per_workshop: 0 }] },
    { match: /INSERT INTO sms_messages/i, rows: [{ id: SMS_ID }] },
    { match: /UPDATE sms_messages/i },
    { match: /INSERT INTO events/i },
  ];
  query.mockImplementation(router([...over, ...base.filter((b) => !over.some((o) => o.match.source === b.match.source))], calls));
  return calls;
}

function fakeProvider(send: SmsProvider["send"] = async () => ({ providerMessageId: "SM123", segments: 1 })) {
  const provider: SmsProvider & { send: ReturnType<typeof vi.fn> } = { name: "fake", send: vi.fn(send) };
  return provider;
}

const SEND_TX: Route[] = [
  { match: /FROM jobs WHERE id/i, rows: [{ id: JOB_ID }] },
  {
    match: /FROM inspection_items/i,
    rows: [{ id: ITEM_1, title: "Brake pads", severity: "red", note: null, price_cents: 28900, position: 0 }],
  },
  { match: /INSERT INTO reports/i, rows: [{ id: NEW_REPORT, sent_at: "2026-11-03T00:00:00.000Z", expires_at: "2026-11-10T00:00:00.000Z" }] },
  { match: /INSERT INTO report_items/i },
  { match: /UPDATE jobs SET status/i },
  { match: /INSERT INTO events/i },
];

let app: FastifyInstance;
let token: string;
let provider: ReturnType<typeof fakeProvider>;

async function boot(opts: { publicApiUrl?: string; sms?: ReturnType<typeof fakeProvider> } = {}) {
  provider = opts.sms ?? fakeProvider();
  app = await buildApp({
    jwtSecret: "test-secret",
    webOrigin: "https://app.example.test",
    sms: provider,
    publicApiUrl: opts.publicApiUrl,
  });
  token = app.jwt.sign({ sub: MECHANIC_ID, workshopId: WORKSHOP_ID, role: "owner" });
}

const auth = () => ({ authorization: `Bearer ${token}` });
const send = () => app.inject({ method: "POST", url: `/api/jobs/${JOB_ID}/report`, headers: auth(), payload: {} });

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe("POST /api/jobs/:id/report — texting the customer", () => {
  it("texts the report link, records the message and an sms.sent event, and says so", async () => {
    mockTx(SEND_TX);
    const calls = mockSmsDb();
    await boot();
    const res = await send();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sms).toEqual({ status: "sent" });

    expect(provider.send).toHaveBeenCalledTimes(1);
    const sent = provider.send.mock.calls[0][0];
    expect(sent.to).toBe("+61412345678");
    expect(sent.body).toContain(body.reportUrl);
    expect(sent.body).toContain("Acme Motors");
    expect(sent.body).toContain("2 items on your Toyota Corolla");

    const insert = calls.find((c) => /INSERT INTO sms_messages/i.test(c.sql))!;
    expect(insert.params).toEqual([WORKSHOP_ID, NEW_REPORT, "+61412345678", sent.body, "fake"]);
    const update = calls.find((c) => /UPDATE sms_messages/i.test(c.sql))!;
    expect(update.sql).toMatch(/status = 'sent'/);
    expect(update.params).toEqual([SMS_ID, "SM123", 1]);
    const event = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
    expect(event.params.slice(0, 4)).toEqual([WORKSHOP_ID, JOB_ID, NEW_REPORT, "sms.sent"]);
    expect(event.sql).toMatch(/'system'/);
  });

  it("asks the provider to report delivery to the API's public callback URL", async () => {
    mockTx(SEND_TX);
    mockSmsDb();
    await boot({ publicApiUrl: "https://api.example.test/" });
    await send();
    expect(provider.send.mock.calls[0][0].statusCallbackUrl).toBe("https://api.example.test/api/sms/twilio/status");
  });

  it("sends no callback URL when the API has no public address", async () => {
    mockTx(SEND_TX);
    mockSmsDb();
    await boot();
    await send();
    expect(provider.send.mock.calls[0][0].statusCallbackUrl).toBeUndefined();
  });

  it("still returns the report and link when the provider fails, and records the failure", async () => {
    mockTx(SEND_TX);
    const calls = mockSmsDb();
    await boot({ sms: fakeProvider(async () => { throw new SmsSendError("nope", "21211"); }) });
    const res = await send();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.reportUrl).toContain(body.token);
    expect(body.sms).toEqual({ status: "failed", message: "The text didn't go through." });

    const update = calls.find((c) => /UPDATE sms_messages/i.test(c.sql))!;
    expect(update.sql).toMatch(/status = 'failed'/);
    expect(update.params).toEqual([SMS_ID, "21211"]);
    expect(calls.find((c) => /INSERT INTO events/i.test(c.sql))!.params[3]).toBe("sms.failed");
  });

  it("does not text a customer who has opted out, and leaves no message row", async () => {
    mockTx(SEND_TX);
    const calls = mockSmsDb([
      { match: /FROM jobs j\s+JOIN workshops/i, rows: [{ workshop_name: "Acme", customer_name: "Sam", customer_mobile: "+61412345678", opted_out: true, vehicle_make: null, vehicle_model: null, vehicle_rego: "ABC123", item_count: 1 }] },
    ]);
    await boot();
    const res = await send();

    expect(res.statusCode).toBe(201);
    expect(res.json().sms).toEqual({ status: "skipped", reason: "opted_out" });
    expect(provider.send).not.toHaveBeenCalled();
    expect(calls.some((c) => /INSERT INTO sms_messages/i.test(c.sql))).toBe(false);
  });

  it.each([
    ["this job has had too many texts this hour", { per_job: 5, per_workshop: 5 }],
    ["the workshop has hit its daily limit", { per_job: 0, per_workshop: 300 }],
  ])("skips the text when %s", async (_why, usage) => {
    mockTx(SEND_TX);
    mockSmsDb([{ match: /FROM sms_messages s LEFT JOIN reports/i, rows: [usage] }]);
    await boot();
    const res = await send();
    expect(res.statusCode).toBe(201);
    expect(res.json().sms).toEqual({ status: "skipped", reason: "rate_limited" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("falls back to the registration plate when the car has no make or model", async () => {
    mockTx(SEND_TX);
    mockSmsDb([
      { match: /FROM jobs j\s+JOIN workshops/i, rows: [{ workshop_name: "Acme", customer_name: "Sam", customer_mobile: "+61412345678", opted_out: false, vehicle_make: null, vehicle_model: null, vehicle_rego: "ABC123", item_count: 1 }] },
    ]);
    await boot();
    await send();
    expect(provider.send.mock.calls[0][0].body).toContain("1 item on your ABC123");
  });

  it("never lets an unexpected database error in the text step undo or hide the report", async () => {
    mockTx(SEND_TX);
    query.mockRejectedValue(new Error("db down"));
    await boot();
    const res = await send();
    expect(res.statusCode).toBe(201);
    expect(res.json().sms.status).toBe("failed");
    expect(res.json().token).toBeTruthy();
  });

  it("does not text at all when the report itself could not be created", async () => {
    mockTx([{ match: /FROM jobs WHERE id/i, rows: [] }]);
    mockSmsDb();
    await boot();
    expect((await send()).statusCode).toBe(404);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/:id/report/resend", () => {
  const resend = (id = JOB_ID) => app.inject({ method: "POST", url: `/api/jobs/${id}/report/resend`, headers: auth() });

  const RESEND_TX = (over: Route[] = []): Route[] => {
    const base: Route[] = [
      { match: /FROM jobs WHERE id/i, rows: [{ id: JOB_ID }] },
      { match: /FROM reports WHERE job_id/i, rows: [{ id: OLD_REPORT, decided_at: null, total_cents: 33400 }] },
      { match: /UPDATE reports SET revoked_at/i, rowCount: 1 },
      { match: /INSERT INTO reports/i, rows: [{ id: NEW_REPORT, sent_at: "2026-11-03T02:00:00.000Z", expires_at: "2026-11-10T02:00:00.000Z" }] },
      { match: /INSERT INTO report_items/i, rowCount: 2 },
      { match: /INSERT INTO events/i },
    ];
    return [...over, ...base.filter((b) => !over.some((o) => o.match.source === b.match.source))];
  };

  it("requires authentication", async () => {
    await boot();
    const res = await app.inject({ method: "POST", url: `/api/jobs/${JOB_ID}/report/resend` });
    expect(res.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it("404s for a malformed id without touching the database", async () => {
    await boot();
    expect((await resend("not-a-uuid")).statusCode).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });

  it("scopes the job to the caller's workshop and 404s for someone else's", async () => {
    const calls = mockTx(RESEND_TX([{ match: /FROM jobs WHERE id/i, rows: [] }]));
    await boot();
    const res = await resend();
    expect(res.statusCode).toBe(404);
    expect(calls.find((c) => /FROM jobs WHERE id/i.test(c.sql))!.params).toEqual([JOB_ID, WORKSHOP_ID]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("409s when the job was never sent", async () => {
    mockTx(RESEND_TX([{ match: /FROM reports WHERE job_id/i, rows: [] }]));
    await boot();
    const res = await resend();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no_report");
  });

  it("409s once the customer has responded — that is a record, not something to replace", async () => {
    const calls = mockTx(RESEND_TX([{ match: /FROM reports WHERE job_id/i, rows: [{ id: OLD_REPORT, decided_at: "2026-11-03T01:00:00.000Z", total_cents: 100 }] }]));
    await boot();
    const res = await resend();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_decided");
    expect(calls.some((c) => /UPDATE reports/i.test(c.sql))).toBe(false);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("revokes the old link, issues a new report with the same frozen findings, texts it, and returns the new link once", async () => {
    const calls = mockTx(RESEND_TX());
    const smsCalls = mockSmsDb();
    await boot();
    const res = await resend();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ reportId: NEW_REPORT, totalCents: 33400, sms: { status: "sent" } });
    expect(body.reportUrl).toBe(`https://app.example.test/r/${body.token}`);

    // Order matters: only one live report per job, so revoke before inserting.
    const sqls = calls.map((c) => c.sql);
    const revokeAt = sqls.findIndex((q) => /UPDATE reports SET revoked_at/i.test(q));
    const insertAt = sqls.findIndex((q) => /INSERT INTO reports/i.test(q));
    expect(revokeAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(insertAt);
    expect(calls[revokeAt].params).toEqual([OLD_REPORT]);

    // The new row stores only the hash of the new token, with the old total.
    const insert = calls[insertAt];
    expect(insert.params[0]).toBe(JOB_ID);
    expect(insert.params[1]).toEqual(hashReportToken(body.token));
    expect(insert.params[2]).toBe(MECHANIC_ID);
    expect(insert.params[3]).toBe(33400);

    // Same findings: copied from the old report's snapshot, not re-read from
    // inspection_items (which the mechanic can no longer edit anyway).
    const copy = calls.find((c) => /INSERT INTO report_items/i.test(c.sql))!;
    expect(copy.sql).toMatch(/FROM report_items WHERE report_id = \$2/);
    expect(copy.params).toEqual([NEW_REPORT, OLD_REPORT]);

    const events = calls.filter((c) => /INSERT INTO events/i.test(c.sql));
    expect(events.map((e) => e.sql.match(/'(report\.\w+)'/)![1])).toEqual(["report.revoked", "report.sent"]);
    expect(JSON.parse(events[1].params[4] as string)).toMatchObject({ resendOf: OLD_REPORT, itemCount: 2 });

    expect(provider.send.mock.calls[0][0].body).toContain(body.reportUrl);
    expect(smsCalls.find((c) => /INSERT INTO sms_messages/i.test(c.sql))!.params[1]).toBe(NEW_REPORT);
  });

  it("doesn't log a revoke for a report that was already revoked or expired-and-revoked", async () => {
    const calls = mockTx(RESEND_TX([{ match: /UPDATE reports SET revoked_at/i, rowCount: 0 }]));
    mockSmsDb();
    await boot();
    expect((await resend()).statusCode).toBe(201);
    expect(calls.filter((c) => /INSERT INTO events/i.test(c.sql)).map((e) => e.sql.match(/'(report\.\w+)'/)![1])).toEqual(["report.sent"]);
  });

  it("still hands over the new link when the text fails", async () => {
    mockTx(RESEND_TX());
    mockSmsDb();
    await boot({ sms: fakeProvider(async () => { throw new SmsSendError("down"); }) });
    const res = await resend();
    expect(res.statusCode).toBe(201);
    expect(res.json().sms.status).toBe("failed");
    expect(res.json().token).toBeTruthy();
  });

  it("rolls everything back if creating the new report fails", async () => {
    const calls = mockTx(RESEND_TX([{ match: /INSERT INTO reports/i, throws: new Error("boom") }]));
    await boot();
    const res = await resend();
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("resend_failed");
    expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
    expect(provider.send).not.toHaveBeenCalled();
  });
});
