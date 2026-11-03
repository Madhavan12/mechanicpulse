import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { generateReportToken, hashReportToken } from "../lib/reportToken";
import { sendReportSms } from "../lib/sendReportSms";
import type {
  SendReportRequest,
  SendReportResponse,
  Severity,
} from "../../../../packages/shared/types";

interface ItemRow {
  id: string;
  title: string;
  severity: Severity;
  note: string | null;
  price_cents: number;
  position: number;
}

interface ReportRow {
  id: string;
  sent_at: string;
  expires_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mechanic-facing report routes. The customer-facing half lives in
 * customerReport.ts and is deliberately a separate file — everything here
 * is behind app.authenticate, nothing there is. */
export async function reportsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: SendReportRequest }>(
    "/api/jobs/:id/report",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      const jobId = req.params.id;
      const itemIds = req.body?.itemIds;

      if (
        itemIds !== undefined &&
        (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== "string"))
      ) {
        return reply.status(400).send({ error: "bad_item_ids", message: "itemIds must be a list of item ids." });
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        // Scoped by workshop_id as well as id — the path is user input, and a
        // mechanic must not be able to send another workshop's job by guessing
        // a uuid. FOR UPDATE so two taps on "Send" can't both get through.
        const { rows: jobs } = await client.query<{ id: string }>(
          `SELECT id FROM jobs WHERE id = $1 AND workshop_id = $2 FOR UPDATE`,
          [jobId, workshopId]
        );
        if (!jobs[0]) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "job_not_found", message: "No such job." });
        }

        const { rows: allItems } = await client.query<ItemRow>(
          `SELECT id, title, severity, note, price_cents, position
             FROM inspection_items WHERE job_id = $1 ORDER BY position`,
          [jobId]
        );

        const items = itemIds?.length ? allItems.filter((i) => itemIds.includes(i.id)) : allItems;

        // Unknown ids first: stale ids that filter down to nothing should say
        // so, not look like a job with no items.
        if (itemIds?.length && items.length !== new Set(itemIds).size) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "unknown_item",
            message: "Some of those items aren't on this job.",
          });
        }
        if (items.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "no_items",
            message: "Add at least one inspection item before sending.",
          });
        }

        const totalCents = items.reduce((sum, i) => sum + i.price_cents, 0);
        const token = generateReportToken();

        const { rows: reportRows } = await client.query<ReportRow>(
          `INSERT INTO reports (job_id, token_hash, sent_by, total_cents)
                VALUES ($1, $2, $3, $4)
             RETURNING id, sent_at, expires_at`,
          [jobId, hashReportToken(token), mechanicId, totalCents]
        );
        const report = reportRows[0];

        // Frozen snapshot. report_items is append-only at the DB level, so
        // whatever the customer agreed to can still be proven later even if
        // the mechanic edits or deletes the inspection item afterwards.
        for (const item of items) {
          await client.query(
            `INSERT INTO report_items
                 (report_id, inspection_item_id, title, severity, note, price_cents, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [report.id, item.id, item.title, item.severity, item.note, item.price_cents, item.position]
          );
        }

        await client.query(`UPDATE jobs SET status = 'sent' WHERE id = $1`, [jobId]);

        await client.query(
          `INSERT INTO events (workshop_id, job_id, report_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, $3, 'report.sent', 'mechanic', $4, $5)`,
          [workshopId, jobId, report.id, mechanicId, JSON.stringify({ itemCount: items.length, totalCents })]
        );

        await client.query("COMMIT");

        // After the commit, deliberately: the report exists and the mechanic
        // has the link whatever happens to the text.
        const reportUrl = `${app.webOrigin}/r/${token}`;
        const sms = await sendReportSms(app, { workshopId, jobId, reportId: report.id, reportUrl });

        const body: SendReportResponse = {
          reportId: report.id,
          token,
          reportUrl,
          sentAt: report.sent_at,
          expiresAt: report.expires_at,
          totalCents,
          sms,
        };
        return reply.status(201).send(body);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});

        // reports_one_live_per_job: a report for this job is already out with
        // the customer. Sending a second would mean two live quotes.
        if ((err as { code?: string }).code === "23505") {
          return reply.status(409).send({
            error: "report_already_live",
            message: "This job already has a live report with the customer.",
          });
        }

        app.log.error(err, "send report failed");
        return reply.status(500).send({ error: "send_failed", message: "Could not send the report." });
      } finally {
        client.release();
      }
    }
  );
  /** New link, same quote. The token is stored only as a hash, so a lost or
   * undelivered link can't be re-shown — the old report is revoked (its link
   * stops working) and a fresh one is issued with a copy of the same frozen
   * findings. Not possible once the customer has decided: that is a record. */
  app.post<{ Params: { id: string } }>(
    "/api/jobs/:id/report/resend",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      const jobId = req.params.id;
      if (!UUID.test(jobId)) return reply.status(404).send({ error: "job_not_found", message: "No such job." });

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const { rows: jobs } = await client.query<{ id: string }>(
          `SELECT id FROM jobs WHERE id = $1 AND workshop_id = $2 FOR UPDATE`,
          [jobId, workshopId]
        );
        if (!jobs[0]) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "job_not_found", message: "No such job." });
        }

        const { rows: latest } = await client.query<{ id: string; decided_at: string | null; total_cents: number }>(
          `SELECT id, decided_at, total_cents FROM reports WHERE job_id = $1 ORDER BY sent_at DESC LIMIT 1`,
          [jobId]
        );
        const previous = latest[0];
        if (!previous) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "no_report", message: "This job hasn't been sent yet." });
        }
        if (previous.decided_at) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "already_decided",
            message: "The customer has already responded to this report.",
          });
        }

        // Revoke first: only one live report per job is allowed.
        const { rowCount: revoked } = await client.query(
          `UPDATE reports SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
          [previous.id]
        );
        if (revoked) {
          await client.query(
            `INSERT INTO events (workshop_id, job_id, report_id, type, actor, mechanic_id, payload)
                  VALUES ($1, $2, $3, 'report.revoked', 'mechanic', $4, $5)`,
            [workshopId, jobId, previous.id, mechanicId, JSON.stringify({ reason: "resend" })]
          );
        }

        const token = generateReportToken();
        const { rows: created } = await client.query<ReportRow>(
          `INSERT INTO reports (job_id, token_hash, sent_by, total_cents)
                VALUES ($1, $2, $3, $4)
             RETURNING id, sent_at, expires_at`,
          [jobId, hashReportToken(token), mechanicId, previous.total_cents]
        );
        const report = created[0];

        const { rowCount: itemCount } = await client.query(
          `INSERT INTO report_items (report_id, inspection_item_id, title, severity, note, price_cents, position)
                SELECT $1, inspection_item_id, title, severity, note, price_cents, position
                  FROM report_items WHERE report_id = $2`,
          [report.id, previous.id]
        );

        await client.query(
          `INSERT INTO events (workshop_id, job_id, report_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, $3, 'report.sent', 'mechanic', $4, $5)`,
          [workshopId, jobId, report.id, mechanicId, JSON.stringify({ itemCount, totalCents: previous.total_cents, resendOf: previous.id })]
        );

        await client.query("COMMIT");

        const reportUrl = `${app.webOrigin}/r/${token}`;
        const sms = await sendReportSms(app, { workshopId, jobId, reportId: report.id, reportUrl });

        const body: SendReportResponse = {
          reportId: report.id,
          token,
          reportUrl,
          sentAt: report.sent_at,
          expiresAt: report.expires_at,
          totalCents: previous.total_cents,
          sms,
        };
        return reply.status(201).send(body);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        app.log.error(err, "resend report failed");
        return reply.status(500).send({ error: "resend_failed", message: "Could not send a new link." });
      } finally {
        client.release();
      }
    }
  );
}
