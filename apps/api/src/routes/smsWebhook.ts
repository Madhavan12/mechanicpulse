import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { validTwilioSignature } from "../lib/sms/twilioSignature";

interface Options {
  authToken: string | undefined;
  /** The exact URL we told Twilio to call; it is part of what Twilio signs. */
  callbackUrl: string | undefined;
}

/** Twilio's MessageStatus → what we do with it. Intermediate states
 * (accepted, sending…) change nothing. */
const TERMINAL = ["queued", "sent"]; // statuses a final result may replace
const FINAL: Record<string, { status: "delivered" | "undelivered" | "failed"; event: "sms.delivered" | "sms.failed" }> = {
  delivered: { status: "delivered", event: "sms.delivered" },
  undelivered: { status: "undelivered", event: "sms.failed" },
  failed: { status: "failed", event: "sms.failed" },
};

/** Provider → us delivery receipts. Public by necessity, so the signature is
 * the only thing standing between this and anyone marking texts delivered.
 * Every outcome other than a bad signature is a 204: the provider retries on
 * errors, and an unknown message id is not worth a retry storm. */
export async function smsWebhookRoutes(app: FastifyInstance, opts: Options) {
  // Twilio posts form bodies, which Fastify doesn't parse out of the box.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post("/api/sms/twilio/status", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const signature = req.headers["x-twilio-signature"];

    if (
      !opts.authToken ||
      !opts.callbackUrl ||
      !validTwilioSignature(opts.authToken, opts.callbackUrl, params, typeof signature === "string" ? signature : undefined)
    ) {
      return reply.status(403).send({ error: "bad_signature", message: "Not a valid callback." });
    }

    const messageId = params.MessageSid;
    const mapped = FINAL[params.MessageStatus];
    if (!messageId || !mapped) return reply.status(204).send();

    // One statement so the status change and its event can't disagree, and
    // an out-of-order callback (a late "sent" after "delivered") can't
    // overwrite a final result: only queued/sent rows are updated.
    await db.query(
      `WITH upd AS (
         UPDATE sms_messages
            SET status = $2::sms_status, error_code = COALESCE($3::text, error_code)
          WHERE provider = 'twilio' AND provider_message_id = $1 AND status = ANY($4::sms_status[])
          RETURNING id, workshop_id, report_id
       )
       INSERT INTO events (workshop_id, job_id, report_id, type, actor, payload)
            SELECT u.workshop_id, r.job_id, u.report_id, $5, 'system',
                   jsonb_build_object('smsId', u.id, 'status', $2::text, 'errorCode', $3::text)
              FROM upd u LEFT JOIN reports r ON r.id = u.report_id`,
      [messageId, mapped.status, params.ErrorCode || null, TERMINAL, mapped.event]
    );
    return reply.status(204).send();
  });
}
