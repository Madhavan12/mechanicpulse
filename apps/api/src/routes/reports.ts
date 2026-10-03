import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { generateReportToken, hashReportToken } from "../lib/reportToken";
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

        if (items.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "no_items",
            message: "Add at least one inspection item before sending.",
          });
        }
        if (itemIds?.length && items.length !== new Set(itemIds).size) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "unknown_item",
            message: "Some of those items aren't on this job.",
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

        const body: SendReportResponse = {
          reportId: report.id,
          token,
          reportUrl: `${app.webOrigin}/r/${token}`,
          sentAt: report.sent_at,
          expiresAt: report.expires_at,
          totalCents,
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
}
