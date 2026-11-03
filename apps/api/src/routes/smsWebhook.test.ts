import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

import { db } from "../db";
import { buildApp } from "../app";
import { twilioSignature } from "../lib/sms/twilioSignature";

const query = db.query as unknown as ReturnType<typeof vi.fn>;

const AUTH_TOKEN = "twilio-secret";
const PUBLIC = "https://api.example.test";
const URL = `${PUBLIC}/api/sms/twilio/status`;

let app: FastifyInstance;

async function post(params: Record<string, string>, signature: string | undefined = twilioSignature(AUTH_TOKEN, URL, params)) {
  return app.inject({
    method: "POST",
    url: "/api/sms/twilio/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature ? { "x-twilio-signature": signature } : {}),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

beforeEach(async () => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
  app = await buildApp({ jwtSecret: "s", webOrigin: "http://localhost:3000", publicApiUrl: PUBLIC, twilioAuthToken: AUTH_TOKEN });
});

describe("POST /api/sms/twilio/status", () => {
  it("marks a delivered message delivered and records sms.delivered", async () => {
    const res = await post({ MessageSid: "SM1", MessageStatus: "delivered" });
    expect(res.statusCode).toBe(204);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE sms_messages/);
    expect(sql).toMatch(/provider = 'twilio' AND provider_message_id = \$1/);
    expect(params).toEqual(["SM1", "delivered", null, ["queued", "sent"], "sms.delivered"]);
  });

  it("records an undelivered message as a failure event with Twilio's error code", async () => {
    await post({ MessageSid: "SM1", MessageStatus: "undelivered", ErrorCode: "30003" });
    expect(query.mock.calls[0][1]).toEqual(["SM1", "undelivered", "30003", ["queued", "sent"], "sms.failed"]);
  });

  it("only ever updates messages that aren't already final, so a late callback can't overwrite 'delivered'", async () => {
    await post({ MessageSid: "SM1", MessageStatus: "failed" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status = ANY\(\$4::sms_status\[\]\)/);
    expect(params[3]).toEqual(["queued", "sent"]);
  });

  it.each(["queued", "accepted", "sending", "sent", "read"])("ignores the intermediate status %s", async (status) => {
    const res = await post({ MessageSid: "SM1", MessageStatus: status });
    expect(res.statusCode).toBe(204);
    expect(query).not.toHaveBeenCalled();
  });

  it("answers 204 for a message id we don't have, rather than inviting retries", async () => {
    expect((await post({ MessageSid: "SMunknown", MessageStatus: "delivered" })).statusCode).toBe(204);
  });

  it("rejects a missing signature", async () => {
    const res = await post({ MessageSid: "SM1", MessageStatus: "delivered" }, "");
    expect(res.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a signature made with the wrong secret", async () => {
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const res = await post(params, twilioSignature("someone-else", URL, params));
    expect(res.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a body that was changed after signing", async () => {
    const signed = twilioSignature(AUTH_TOKEN, URL, { MessageSid: "SM1", MessageStatus: "failed" });
    const res = await post({ MessageSid: "SM1", MessageStatus: "delivered" }, signed);
    expect(res.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses everything when no auth token is configured", async () => {
    app = await buildApp({ jwtSecret: "s", webOrigin: "http://localhost:3000", publicApiUrl: PUBLIC });
    const res = await post({ MessageSid: "SM1", MessageStatus: "delivered" });
    expect(res.statusCode).toBe(403);
  });

  it("refuses everything when the API has no public URL to verify against", async () => {
    app = await buildApp({ jwtSecret: "s", webOrigin: "http://localhost:3000", twilioAuthToken: AUTH_TOKEN });
    const res = await post({ MessageSid: "SM1", MessageStatus: "delivered" });
    expect(res.statusCode).toBe(403);
  });
});
