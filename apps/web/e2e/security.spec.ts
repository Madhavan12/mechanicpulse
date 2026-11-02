import { test, expect } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, sendReport } from "./helpers/api";
import { API_URL, SEED } from "./helpers/fixtures";

test.beforeEach(resetDb);

test.describe("Auth boundary", () => {
  test("every mechanic endpoint refuses an anonymous caller", async ({ request }) => {
    const calls = [
      ["GET", `${API_URL}/api/jobs`, undefined],
      ["POST", `${API_URL}/api/media/presign`, { contentType: "image/jpeg", bytes: 1000 }],
      ["POST", `${API_URL}/api/jobs/${SEED.jobId}/report`, {}],
    ] as const;

    for (const [method, url, data] of calls) {
      const res = await request.fetch(url, { method, data });
      expect(res.status(), `${method} ${url}`).toBe(401);
    }
  });

  test("a garbage bearer token is not a session", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/jobs`, {
      headers: { Authorization: "Bearer not.a.real.jwt" },
    });
    expect(res.status()).toBe(401);
  });

  test("the customer endpoints need no credentials at all", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    // No Authorization header anywhere — the token in the path is the whole key.
    const res = await request.get(`${API_URL}/api/report/${report.token}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).state).toBe("open");
  });

  test("a mechanic cannot send a report for another workshop's job", async ({ request }) => {
    const jwt = await loginViaApi(request);

    // A second workshop with its own job, invisible to the first.
    const [other] = await query<{ job_id: string }>(`
      WITH w AS (
        INSERT INTO workshops (name, phone_e164) VALUES ('Rival Motors', '+61390000001') RETURNING id
      ), m AS (
        INSERT INTO mechanics (workshop_id, name, email, password_hash, role)
        -- password_hash has a CHECK (LIKE '$2%') — bcrypt only. This hash is
        -- never used to log in; the row exists so the job has a valid owner.
        SELECT id, 'Rival Mechanic', 'rival@demo.test', '$2b$10$notarealhashjustshapedlikeone0000000000000000000000000000',
               'owner' FROM w RETURNING id, workshop_id
      ), c AS (
        INSERT INTO customers (workshop_id, name, mobile_e164)
        SELECT workshop_id, 'Rival Customer', '+61412345679' FROM m RETURNING id, workshop_id
      ), v AS (
        INSERT INTO vehicles (workshop_id, customer_id, rego, make, model)
        SELECT workshop_id, id, 'XYZ789', 'Mazda', '3' FROM c RETURNING id, workshop_id
      )
      INSERT INTO jobs (workshop_id, vehicle_id, customer_id, created_by)
      SELECT v.workshop_id, v.id, c.id, m.id FROM v, c, m
      RETURNING id AS job_id
    `);

    const res = await request.post(`${API_URL}/api/jobs/${other.job_id}/report`, {
      headers: { Authorization: `Bearer ${jwt}` },
      data: {},
    });

    // 404, not 403 — knowing the job exists is itself information.
    expect(res.status()).toBe(404);
    expect(await scalar("SELECT count(*) FROM reports")).toBe("0");
  });

  test("the job list only ever shows the caller's own workshop", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await request.get(`${API_URL}/api/jobs`, { headers: { Authorization: `Bearer ${jwt}` } });
    const { jobs } = await res.json();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].vehicleRego).toBe(SEED.rego);
  });
});

test.describe("Data integrity", () => {
  test("a report token is stored only as a 32-byte hash", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    expect(await scalar("SELECT length(token_hash) FROM reports")).toBe("32");

    // Nothing resembling the raw token should be recoverable from the row.
    const stored = await scalar("SELECT encode(token_hash, 'base64') FROM reports");
    expect(stored).not.toContain(report.token.slice(0, 16));
  });

  test("approvals cannot be rewritten or deleted", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: {
        signedName: "Alex Customer",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "approved" },
          { itemId: SEED.wiperItemId, decision: "declined" },
        ],
      },
    });

    // The database is the last line of defence, independent of the API.
    await expect(query("UPDATE approvals SET decision = 'approved'")).rejects.toThrow(/append-only/);
    await expect(query("DELETE FROM approvals")).rejects.toThrow(/append-only/);
    expect(await scalar("SELECT count(*) FROM approvals WHERE decision = 'declined'")).toBe("1");
  });

  test("events cannot be rewritten or deleted", async () => {
    await expect(query("DELETE FROM events")).rejects.toThrow(/append-only/);
    await expect(query("UPDATE events SET type = 'job.closed'")).rejects.toThrow(/append-only/);
  });

  test("a report snapshot cannot be edited after the fact", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);

    await expect(query("UPDATE report_items SET price_cents = 1")).rejects.toThrow(/append-only/);
  });
});
