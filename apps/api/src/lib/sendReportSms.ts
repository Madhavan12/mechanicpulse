import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { buildReportMessage } from "./reportMessage";
import { SmsSendError } from "./sms/provider";
import type { SmsOutcome } from "../../../../packages/shared/types";

/** A bug or a hammered Resend button must not be able to spam a customer or
 * run up the bill. Generous for a human, tight for a loop. */
export const MAX_SMS_PER_JOB_PER_HOUR = 5;
export const MAX_SMS_PER_WORKSHOP_PER_DAY = 300;

interface Context {
  workshop_name: string;
  customer_name: string;
  customer_mobile: string;
  opted_out: boolean;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_rego: string;
  item_count: number;
}

/** Texts the report link. Never throws and never touches the report: by now
 * the report is committed and the mechanic has the link, so any failure here
 * only changes what we tell them ("send it yourself"). Every attempt that
 * reaches the provider leaves an sms_messages row and an sms.* event. */
export async function sendReportSms(
  app: FastifyInstance,
  opts: { workshopId: string; jobId: string; reportId: string; reportUrl: string }
): Promise<SmsOutcome> {
  const { workshopId, jobId, reportId, reportUrl } = opts;
  try {
    const { rows } = await db.query<Context>(
      `SELECT w.name AS workshop_name, c.name AS customer_name, c.mobile_e164 AS customer_mobile,
              (c.sms_opted_out_at IS NOT NULL) AS opted_out,
              v.make AS vehicle_make, v.model AS vehicle_model, v.rego AS vehicle_rego,
              (SELECT count(*)::int FROM report_items ri WHERE ri.report_id = $2) AS item_count
         FROM jobs j
         JOIN workshops w ON w.id = j.workshop_id
         JOIN customers c ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
         JOIN vehicles  v ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
        WHERE j.id = $1 AND j.workshop_id = $3`,
      [jobId, reportId, workshopId]
    );
    const ctx = rows[0];
    if (!ctx) return { status: "failed", message: "Couldn't find the customer to text." };

    // Spam Act: a STOP is honoured even for a quote they're waiting on.
    if (ctx.opted_out) return { status: "skipped", reason: "opted_out" };

    const { rows: usage } = await db.query<{ per_job: number; per_workshop: number }>(
      `SELECT count(*) FILTER (WHERE r.job_id = $1 AND s.created_at > now() - interval '1 hour')::int AS per_job,
              count(*) FILTER (WHERE s.created_at > now() - interval '1 day')::int                    AS per_workshop
         FROM sms_messages s LEFT JOIN reports r ON r.id = s.report_id
        WHERE s.workshop_id = $2 AND s.created_at > now() - interval '1 day'`,
      [jobId, workshopId]
    );
    if (usage[0].per_job >= MAX_SMS_PER_JOB_PER_HOUR || usage[0].per_workshop >= MAX_SMS_PER_WORKSHOP_PER_DAY) {
      return { status: "skipped", reason: "rate_limited" };
    }

    const body = buildReportMessage({
      workshopName: ctx.workshop_name,
      customerName: ctx.customer_name,
      vehicle: [ctx.vehicle_make, ctx.vehicle_model].filter(Boolean).join(" ") || ctx.vehicle_rego,
      itemCount: ctx.item_count,
      url: reportUrl,
    });

    // Row first, so a crash mid-send still leaves a trace of the attempt.
    const { rows: created } = await db.query<{ id: string }>(
      `INSERT INTO sms_messages (workshop_id, report_id, to_e164, body, provider)
            VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [workshopId, reportId, ctx.customer_mobile, body, app.sms.name]
    );
    const smsId = created[0].id;

    try {
      const receipt = await app.sms.send({
        to: ctx.customer_mobile,
        body,
        statusCallbackUrl: app.smsStatusCallbackUrl,
      });
      await db.query(
        `UPDATE sms_messages SET status = 'sent', provider_message_id = $2, segments = $3 WHERE id = $1`,
        [smsId, receipt.providerMessageId, receipt.segments]
      );
      await recordEvent(workshopId, jobId, reportId, "sms.sent", { smsId, provider: app.sms.name });
      return { status: "sent" };
    } catch (err) {
      const code = err instanceof SmsSendError ? err.code : null;
      app.log.error({ err, smsId }, "sms send failed");
      await db.query(`UPDATE sms_messages SET status = 'failed', error_code = $2 WHERE id = $1`, [smsId, code]);
      await recordEvent(workshopId, jobId, reportId, "sms.failed", { smsId, provider: app.sms.name, errorCode: code });
      return { status: "failed", message: "The text didn't go through." };
    }
  } catch (err) {
    app.log.error(err, "sms delivery crashed");
    return { status: "failed", message: "The text didn't go through." };
  }
}

async function recordEvent(workshopId: string, jobId: string, reportId: string, type: string, payload: object) {
  await db.query(
    `INSERT INTO events (workshop_id, job_id, report_id, type, actor, payload)
          VALUES ($1, $2, $3, $4, 'system', $5)`,
    [workshopId, jobId, reportId, type, JSON.stringify(payload)]
  );
}
