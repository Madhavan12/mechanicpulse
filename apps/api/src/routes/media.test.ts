import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_c: unknown, cmd: { input: { Key: string } }) => `https://signed.example.test/${cmd.input.Key}?sig=abc`),
}));
vi.mock("../lib/s3", () => ({ BUCKET: "test-bucket", s3: { send: vi.fn() } }));

import { db } from "../db";
import { s3 } from "../lib/s3";
import { buildApp } from "../app";

const connect = db.connect as unknown as ReturnType<typeof vi.fn>;
const query = db.query as unknown as ReturnType<typeof vi.fn>;
const s3send = s3.send as unknown as ReturnType<typeof vi.fn>;

const WORKSHOP_ID = "00000000-0000-0000-0000-000000000001";
const MECHANIC_ID = "00000000-0000-0000-0000-00000000a001";
const JOB_ID = "00000000-0000-0000-0000-00000000b001";
const ITEM_ID = "00000000-0000-0000-0000-00000000d001";
const MEDIA_ID = "00000000-0000-0000-0000-0000000f0001";
const KEY = `${WORKSHOP_ID}/2026-11-02/abc.webp`;

interface Route {
  match: RegExp;
  rows?: unknown[];
  throws?: unknown;
}

function mockClient(extra: Route[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const routes: Route[] = [
    ...extra,
    { match: /FOR UPDATE OF j/i, rows: [{ job_id: JOB_ID, status: "open" }] },
    { match: /SELECT status FROM jobs/i, rows: [{ status: "open" }] },
    { match: /FROM media WHERE inspection_item_id = \$1 AND state = 'ready'/i, rows: [{ n: 0 }] },
    { match: /count\(\*\) FILTER/i, rows: [{ n: 0, next_position: 0 }] },
    { match: /INSERT INTO media/i, rows: [{ id: MEDIA_ID }] },
    { match: /INSERT INTO events/i },
    { match: /UPDATE media/i },
    { match: /DELETE FROM media/i },
  ];
  const q = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    const r = routes.find((x) => x.match.test(sql));
    if (!r) throw new Error(`unmocked SQL in test: ${sql.trim().slice(0, 90)}`);
    if (r.throws) throw r.throws;
    return { rows: r.rows ?? [] };
  });
  connect.mockResolvedValue({ query: q, release: vi.fn() });
  return { calls };
}

/** The scoped media lookup that confirm / fail / delete start with (db.query). */
function mediaRow(over: Partial<Record<string, unknown>> = {}) {
  return { id: MEDIA_ID, storage_key: KEY, state: "pending", inspection_item_id: ITEM_ID, job_id: JOB_ID, job_status: "open", ...over };
}

describe("media routes", () => {
  let app: FastifyInstance;
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeEach(async () => {
    connect.mockReset();
    query.mockReset();
    s3send.mockReset();
    app = await buildApp({ jwtSecret: "test-secret", webOrigin: "http://localhost:3000" });
    token = app.jwt.sign({ sub: MECHANIC_ID, workshopId: WORKSHOP_ID, role: "mechanic" });
  });

  describe("POST /api/media/presign", () => {
    const body = { inspectionItemId: ITEM_ID, contentType: "image/webp", bytes: 200_000 };
    const presign = (payload: unknown = body) =>
      app.inject({ method: "POST", url: "/api/media/presign", headers: auth(), payload: payload as never });

    it("requires authentication", async () => {
      const res = await app.inject({ method: "POST", url: "/api/media/presign", payload: body });
      expect(res.statusCode).toBe(401);
    });

    it("creates a pending media row for the finding and returns its id with an upload URL", async () => {
      const { calls } = mockClient();
      const res = await presign();

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.mediaId).toBe(MEDIA_ID);
      expect(json.uploadUrl).toMatch(/^https:\/\/signed\.example\.test\//);
      expect(json.storageKey.startsWith(`${WORKSHOP_ID}/`)).toBe(true);

      const insert = calls.find((c) => /INSERT INTO media/i.test(c.sql))!;
      expect(insert.params).toEqual([ITEM_ID, json.storageKey, "image/webp", 200_000, 0]);
      expect(insert.sql).not.toMatch(/'ready'/); // pending until confirmed
    });

    it("scopes the finding to the token's workshop and locks the job", async () => {
      const { calls } = mockClient();
      await presign();
      const lookup = calls.find((c) => /FOR UPDATE OF j/i.test(c.sql))!;
      expect(lookup.sql).toMatch(/j\.workshop_id = \$2/i);
      expect(lookup.params).toEqual([ITEM_ID, WORKSHOP_ID]);
    });

    it("records a media.upload_started event in the same transaction", async () => {
      const { calls } = mockClient();
      await presign();
      const ev = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
      expect(ev.sql).toMatch(/'media\.upload_started'/);
      expect(calls[0].sql).toMatch(/BEGIN/);
      expect(calls[calls.length - 1].sql).toMatch(/COMMIT/);
    });

    it("404s for a finding in another workshop, or one that doesn't exist", async () => {
      const { calls } = mockClient([{ match: /FOR UPDATE OF j/i, rows: [] }]);
      const res = await presign();
      expect(res.statusCode).toBe(404);
      expect(calls.some((c) => /INSERT INTO media/i.test(c.sql))).toBe(false);
    });

    it("404s on an id that isn't a UUID without touching the database", async () => {
      mockClient();
      expect((await presign({ ...body, inspectionItemId: "nope" })).statusCode).toBe(404);
      expect(connect).not.toHaveBeenCalled();
    });

    it.each(["sent", "decided", "closed"])("409s when the job is %s", async (status) => {
      const { calls } = mockClient([{ match: /FOR UPDATE OF j/i, rows: [{ job_id: JOB_ID, status }] }]);
      const res = await presign();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("job_locked");
      expect(calls.some((c) => /INSERT INTO media/i.test(c.sql))).toBe(false);
    });

    it("refuses a fifth photo", async () => {
      const { calls } = mockClient([{ match: /count\(\*\) FILTER/i, rows: [{ n: 4, next_position: 4 }] }]);
      const res = await presign();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("photo_limit");
      expect(calls.some((c) => /INSERT INTO media/i.test(c.sql))).toBe(false);
    });

    it("lets a fourth photo through", async () => {
      mockClient([{ match: /count\(\*\) FILTER/i, rows: [{ n: 3, next_position: 3 }] }]);
      expect((await presign()).statusCode).toBe(200);
    });

    it("only counts finished photos and recent in-flight ones against the cap (failed and abandoned don't)", async () => {
      const { calls } = mockClient();
      await presign();
      const sql = calls.find((c) => /count\(\*\) FILTER/i.test(c.sql))!.sql;
      expect(sql).toMatch(/state = 'ready'/i);
      expect(sql).toMatch(/state IN \('pending', 'uploading'\) AND created_at >/i);
      expect(sql).not.toMatch(/'failed'/i);
    });

    it.each([
      ["a content type that isn't an image we accept", { ...body, contentType: "image/gif" }, "bad_content_type"],
      ["a file over 10 MB", { ...body, bytes: 11 * 1024 * 1024 }, "bad_size"],
      ["a zero-byte file", { ...body, bytes: 0 }, "bad_size"],
      ["a non-numeric size", { ...body, bytes: "big" }, "bad_size"],
    ])("rejects %s with a 400 before touching the database", async (_l, payload, error) => {
      mockClient();
      const res = await presign(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(error);
      expect(connect).not.toHaveBeenCalled();
    });

    it("still works without a finding (the standalone /capture page): URL only, no row", async () => {
      mockClient();
      const res = await presign({ contentType: "image/jpeg", bytes: 1000 });
      expect(res.statusCode).toBe(200);
      expect(res.json().mediaId).toBeUndefined();
      expect(connect).not.toHaveBeenCalled();
    });

    it("rolls back and returns 500 when the insert fails", async () => {
      const { calls } = mockClient([{ match: /INSERT INTO media/i, throws: new Error("boom") }]);
      const res = await presign();
      expect(res.statusCode).toBe(500);
      expect(calls.some((c) => /^\s*ROLLBACK/i.test(c.sql))).toBe(true);
    });
  });

  describe("POST /api/media/:id/confirm", () => {
    const confirm = (payload: unknown = { width: 1600, height: 1200 }, id = MEDIA_ID) =>
      app.inject({ method: "POST", url: `/api/media/${id}/confirm`, headers: auth(), payload: payload as never });

    it("requires authentication", async () => {
      const res = await app.inject({ method: "POST", url: `/api/media/${MEDIA_ID}/confirm`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("verifies the object in S3, then marks the row ready with S3's own size", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockResolvedValueOnce({ ContentLength: 183_000 });
      const { calls } = mockClient();
      const res = await confirm();

      expect(res.statusCode).toBe(200);
      expect(res.json().photo).toEqual({ id: MEDIA_ID, url: `https://signed.example.test/${KEY}?sig=abc` });
      expect(s3send.mock.calls[0][0].input).toEqual({ Bucket: "test-bucket", Key: KEY });

      const update = calls.find((c) => /UPDATE media/i.test(c.sql))!;
      expect(update.sql).toMatch(/state = 'ready'/i);
      expect(update.params).toEqual([MEDIA_ID, 183_000, 1600, 1200]); // size from S3, not from the request
      expect(calls.find((c) => /INSERT INTO events/i.test(c.sql))!.sql).toMatch(/'media\.upload_succeeded'/);
    });

    it("scopes the lookup to the token's workshop", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const res = await confirm();
      expect(res.statusCode).toBe(404);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/j\.workshop_id = \$2/i);
      expect(params).toEqual([MEDIA_ID, WORKSHOP_ID]);
      expect(s3send).not.toHaveBeenCalled();
    });

    it("404s on an id that isn't a UUID", async () => {
      expect((await confirm({}, "nope")).statusCode).toBe(404);
      expect(query).not.toHaveBeenCalled();
    });

    it("409 not_uploaded when the object isn't in S3 — the row stays pending", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockRejectedValueOnce(Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
      const { calls } = mockClient();
      const res = await confirm();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("not_uploaded");
      expect(calls.some((c) => /UPDATE media/i.test(c.sql))).toBe(false);
    });

    it("409 not_uploaded for an empty object", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockResolvedValueOnce({ ContentLength: 0 });
      mockClient();
      expect((await confirm()).json().error).toBe("not_uploaded");
    });

    it("502 when S3 itself can't be reached, leaving the row to retry", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockRejectedValueOnce(new Error("socket hang up"));
      const { calls } = mockClient();
      const res = await confirm();
      expect(res.statusCode).toBe(502);
      expect(calls.some((c) => /UPDATE media/i.test(c.sql))).toBe(false);
    });

    it("rejects an object over 10 MB and marks it failed", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] }).mockResolvedValueOnce({ rows: [] });
      s3send.mockResolvedValueOnce({ ContentLength: 11 * 1024 * 1024 });
      mockClient();
      const res = await confirm();
      expect(res.statusCode).toBe(400);
      expect(query.mock.calls[1][0]).toMatch(/state = 'failed'/i);
    });

    it("is idempotent: confirming an already-ready photo just returns it, without re-checking S3", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ state: "ready" })] });
      const { calls } = mockClient();
      const res = await confirm();
      expect(res.statusCode).toBe(200);
      expect(res.json().photo.id).toBe(MEDIA_ID);
      expect(s3send).not.toHaveBeenCalled();
      expect(calls.some((c) => /UPDATE media/i.test(c.sql))).toBe(false);
    });

    it("409s if the report was sent while the photo was uploading", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ job_status: "sent" })] });
      mockClient();
      const res = await confirm();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("job_locked");
      expect(s3send).not.toHaveBeenCalled();
    });

    it("409s and writes nothing if the report is sent between the check and the write", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockResolvedValueOnce({ ContentLength: 1234 });
      const { calls } = mockClient([{ match: /SELECT status FROM jobs/i, rows: [{ status: "sent" }] }]);
      const res = await confirm();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("job_locked");
      expect(calls.some((c) => /UPDATE media/i.test(c.sql))).toBe(false);
      expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
    });

    it("409s photo_limit if the finding filled up while this stale upload was in flight", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockResolvedValueOnce({ ContentLength: 1234 });
      const { calls } = mockClient([{ match: /FROM media WHERE inspection_item_id = \$1 AND state = 'ready'/i, rows: [{ n: 4 }] }]);
      const res = await confirm();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("photo_limit");
      expect(calls.some((c) => /SET state = 'ready'/i.test(c.sql))).toBe(false);
      expect(calls.some((c) => /SET state = 'failed'/i.test(c.sql))).toBe(true);
    });

    it("ignores nonsense dimensions rather than storing them", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      s3send.mockResolvedValueOnce({ ContentLength: 1000 });
      const { calls } = mockClient();
      await confirm({ width: -5, height: "tall" });
      expect(calls.find((c) => /UPDATE media/i.test(c.sql))!.params).toEqual([MEDIA_ID, 1000, null, null]);
    });
  });

  describe("POST /api/media/:id/fail", () => {
    const fail = (payload: unknown = { reason: "Network dropped during upload." }) =>
      app.inject({ method: "POST", url: `/api/media/${MEDIA_ID}/fail`, headers: auth(), payload: payload as never });

    it("marks a pending upload failed and records media.upload_failed", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow()] });
      const { calls } = mockClient();
      const res = await fail();

      expect(res.statusCode).toBe(204);
      expect(calls.find((c) => /UPDATE media/i.test(c.sql))!.sql).toMatch(/state = 'failed'/i);
      const ev = calls.find((c) => /INSERT INTO events/i.test(c.sql))!;
      expect(ev.sql).toMatch(/'media\.upload_failed'/);
      expect(JSON.parse(ev.params[3] as string).reason).toBe("Network dropped during upload.");
    });

    it("never downgrades a finished photo", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ state: "ready" })] });
      const { calls } = mockClient();
      expect((await fail()).statusCode).toBe(204);
      expect(calls).toHaveLength(0);
    });

    it("404s for another workshop's photo", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      expect((await fail()).statusCode).toBe(404);
    });

    it("requires authentication", async () => {
      const res = await app.inject({ method: "POST", url: `/api/media/${MEDIA_ID}/fail`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("DELETE /api/media/:id", () => {
    const remove = () => app.inject({ method: "DELETE", url: `/api/media/${MEDIA_ID}`, headers: auth() });

    it("requires authentication", async () => {
      expect((await app.inject({ method: "DELETE", url: `/api/media/${MEDIA_ID}` })).statusCode).toBe(401);
    });

    it("removes the photo from the finding and records it", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ state: "ready" })] });
      const { calls } = mockClient();
      const res = await remove();

      expect(res.statusCode).toBe(204);
      expect(calls.find((c) => /DELETE FROM media/i.test(c.sql))!.params).toEqual([MEDIA_ID]);
      expect(calls.find((c) => /INSERT INTO events/i.test(c.sql))!.sql).toMatch(/'item\.updated'/);
    });

    it("404s for another workshop's photo and deletes nothing", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const { calls } = mockClient();
      expect((await remove()).statusCode).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it("409s once the report has been sent", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ state: "ready", job_status: "sent" })] });
      const { calls } = mockClient();
      expect((await remove()).statusCode).toBe(409);
      expect(calls.some((c) => /DELETE FROM media/i.test(c.sql))).toBe(false);
    });

    it("409s and deletes nothing if the report is sent between the check and the write", async () => {
      query.mockResolvedValueOnce({ rows: [mediaRow({ state: "ready" })] });
      const { calls } = mockClient([{ match: /SELECT status FROM jobs/i, rows: [{ status: "sent" }] }]);
      expect((await remove()).statusCode).toBe(409);
      expect(calls.some((c) => /DELETE FROM media/i.test(c.sql))).toBe(false);
    });
  });
});
