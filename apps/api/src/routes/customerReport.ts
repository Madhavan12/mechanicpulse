import type { FastifyInstance } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../db";
import { BUCKET, s3 } from "../lib/s3";
import { hashReportToken } from "../lib/reportToken";
import type {
  ApproveRequest,
  ApproveResponse,
  CustomerReportResponse,
  Decision,
  ReportItemView,
  ReportState,
  Severity,
} from "../../../../packages/shared/types";

/** Long enough for a customer to read the report and think about it, short
 * enough that a forwarded screenshot URL stops working. */
const PHOTO_URL_TTL_SECONDS = 15 * 60;

interface ReportRow {
  id: string;
  job_id: string;
  workshop_id: string;
  sent_at: string;
  expires_at: string;
  decided_at: string | null;
  revoked_at: string | null;
  total_cents: number;
  workshop_name: string;
  workshop_phone: string | null;
  customer_name: string;
  vehicle_rego: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
}

interface ItemRow {
  inspection_item_id: string;
  title: string;
  severity: Severity;
  note: string | null;
  price_cents: number;
  position: number;
  decision: Decision | null;
  storage_keys: string[];
}

function stateOf(row: ReportRow): ReportState {
  if (row.revoked_at) return "revoked";
  if (row.decided_at) return "decided";
  if (new Date(row.expires_at) <= new Date()) return "expired";
  return "open";
}

const REPORT_SQL = `
  SELECT r.id, r.job_id, j.workshop_id,
         r.sent_at, r.expires_at, r.decided_at, r.revoked_at, r.total_cents,
         w.name AS workshop_name, w.phone_e164 AS workshop_phone,
         c.name AS customer_name,
         v.rego AS vehicle_rego, v.make AS vehicle_make, v.model AS vehicle_model
    FROM reports r
    JOIN jobs      j ON j.id = r.job_id
    JOIN workshops w ON w.id = j.workshop_id
    JOIN customers c ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
    JOIN vehicles  v ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
   WHERE r.token_hash = $1`;

/** Customer-facing report routes. Nothing here is authenticated — the token
 * in the URL is the only credential, so every handler must treat the path as
 * hostile and must never reveal whether a token nearly matched. */
export async function customerReportRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>("/api/report/:token", async (req, reply) => {
    const tokenHash = hashReportToken(req.params.token);

    const { rows } = await db.query<ReportRow>(REPORT_SQL, [tokenHash]);
    const report = rows[0];

    // One generic 404 for "no such token". Never distinguish a malformed
    // token from a real one that's gone, or the link becomes an oracle.
    if (!report) {
      return reply.status(404).send({ error: "not_found", message: "This link isn't valid." });
    }

    const state = stateOf(report);

    // First open is a measurement moment (time-to-open). The WHERE clause
    // makes it idempotent: whoever wins the race writes the event, reloads
    // don't. Dead links aren't counted as opens.
    if (state === "open") {
      const { rows: firstOpen } = await db.query<{ id: string }>(
        `UPDATE reports SET first_opened_at = now()
          WHERE id = $1 AND first_opened_at IS NULL
          RETURNING id`,
        [report.id]
      );
      if (firstOpen[0]) {
        await db.query(
          `INSERT INTO events (workshop_id, job_id, report_id, type, actor)
                VALUES ($1, $2, $3, 'report.opened', 'customer')`,
          [report.workshop_id, report.job_id, report.id]
        );
      }
    }

    // Expired and revoked reports show the shop's details so the customer can
    // call, but not the itemised quote — there's nothing to act on.
    const items = state === "expired" || state === "revoked" ? [] : await loadItems(app, report.id);

    const body: CustomerReportResponse = {
      state,
      workshopName: report.workshop_name,
      workshopPhone: report.workshop_phone,
      customerName: report.customer_name,
      vehicleRego: report.vehicle_rego,
      vehicleMake: report.vehicle_make,
      vehicleModel: report.vehicle_model,
      sentAt: report.sent_at,
      expiresAt: report.expires_at,
      decidedAt: report.decided_at,
      totalCents: report.total_cents,
      items,
    };
    return reply.send(body);
  });

  app.post<{ Params: { token: string }; Body: ApproveRequest }>(
    "/api/report/:token/decision",
    async (req, reply) => {
      const signedName = req.body?.signedName?.trim();
      const decisions = req.body?.decisions;

      if (!signedName) {
        return reply.status(400).send({ error: "name_required", message: "Type your name to confirm." });
      }
      if (!Array.isArray(decisions) || decisions.length === 0) {
        return reply.status(400).send({ error: "no_decisions", message: "Choose approve or decline for each item." });
      }
      if (decisions.some((d) => d.decision !== "approved" && d.decision !== "declined")) {
        return reply.status(400).send({ error: "bad_decision", message: "Each item must be approved or declined." });
      }

      const tokenHash = hashReportToken(req.params.token);
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const { rows } = await client.query<ReportRow>(`${REPORT_SQL} FOR UPDATE OF r`, [tokenHash]);
        const report = rows[0];
        if (!report) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "not_found", message: "This link isn't valid." });
        }

        const state = stateOf(report);
        if (state === "decided") {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "already_decided",
            message: "This report has already been submitted.",
          });
        }
        if (state === "expired" || state === "revoked") {
          await client.query("ROLLBACK");
          return reply.status(410).send({
            error: state,
            message: "This link is no longer active. Please call the workshop.",
          });
        }

        // Every item must be decided, exactly once. A partial submission would
        // leave the shop guessing, and the model only allows one submission.
        const { rows: itemRows } = await client.query<{ inspection_item_id: string; price_cents: number }>(
          `SELECT inspection_item_id, price_cents FROM report_items WHERE report_id = $1`,
          [report.id]
        );
        const expected = new Set(itemRows.map((r) => r.inspection_item_id));
        const given = new Map(decisions.map((d) => [d.itemId, d.decision]));

        if (given.size !== decisions.length) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "duplicate_item", message: "An item was listed twice." });
        }
        if (given.size !== expected.size || [...given.keys()].some((id) => !expected.has(id))) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "incomplete",
            message: "Choose approve or decline for every item.",
          });
        }

        const userAgent = req.headers["user-agent"] ?? null;
        for (const [itemId, decision] of given) {
          await client.query(
            `INSERT INTO approvals
                 (report_id, inspection_item_id, decision, signed_name, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [report.id, itemId, decision, signedName, req.ip, userAgent]
          );
        }

        const { rows: decidedRows } = await client.query<{ decided_at: string }>(
          `UPDATE reports SET decided_at = now() WHERE id = $1 RETURNING decided_at`,
          [report.id]
        );

        await client.query(`UPDATE jobs SET status = 'decided' WHERE id = $1`, [report.job_id]);

        const approved = [...given.values()].filter((d) => d === "approved").length;
        const approvedTotalCents = itemRows
          .filter((r) => given.get(r.inspection_item_id) === "approved")
          .reduce((sum, r) => sum + r.price_cents, 0);

        await client.query(
          `INSERT INTO events (workshop_id, job_id, report_id, type, actor, payload)
                VALUES ($1, $2, $3, 'approval.submitted', 'customer', $4)`,
          [
            report.workshop_id,
            report.job_id,
            report.id,
            JSON.stringify({
              approvedCount: approved,
              declinedCount: given.size - approved,
              approvedTotalCents,
              totalCents: report.total_cents,
            }),
          ]
        );

        await client.query("COMMIT");

        const body: ApproveResponse = {
          decidedAt: decidedRows[0].decided_at,
          approvedCount: approved,
          declinedCount: given.size - approved,
          approvedTotalCents,
        };
        return reply.send(body);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const code = (err as { code?: string }).code;

        // 23505: the unique index on (report_id, inspection_item_id).
        // P0001: the approvals_require_live_report trigger fired.
        // Both mean someone else submitted between our check and our insert.
        if (code === "23505" || code === "P0001") {
          return reply.status(409).send({
            error: "already_decided",
            message: "This report has already been submitted.",
          });
        }

        app.log.error(err, "approval failed");
        return reply.status(500).send({ error: "approval_failed", message: "Could not save your decision." });
      } finally {
        client.release();
      }
    }
  );
}

/** Report items plus short-lived presigned photo URLs. The bucket stays
 * private — the customer never gets a durable object URL. */
async function loadItems(app: FastifyInstance, reportId: string): Promise<ReportItemView[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ri.inspection_item_id, ri.title, ri.severity, ri.note, ri.price_cents, ri.position,
            a.decision,
            COALESCE(
              (SELECT array_agg(m.storage_key ORDER BY m.position, m.created_at)
                 FROM media m
                WHERE m.inspection_item_id = ri.inspection_item_id AND m.state = 'ready'),
              '{}'
            ) AS storage_keys
       FROM report_items ri
       LEFT JOIN approvals a
              ON a.report_id = ri.report_id
             AND a.inspection_item_id = ri.inspection_item_id
      WHERE ri.report_id = $1
      ORDER BY ri.position`,
    [reportId]
  );

  return Promise.all(
    rows.map(async (row) => ({
      inspectionItemId: row.inspection_item_id,
      title: row.title,
      severity: row.severity,
      note: row.note,
      priceCents: row.price_cents,
      position: row.position,
      photoUrls: await signPhotos(app, row.storage_keys),
      decision: row.decision,
    }))
  );
}

async function signPhotos(app: FastifyInstance, keys: string[]): Promise<string[]> {
  const signed = await Promise.all(
    keys.map(async (key) => {
      try {
        return await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
          expiresIn: PHOTO_URL_TTL_SECONDS,
        });
      } catch (err) {
        // A photo that won't sign must not take the whole report down — the
        // customer can still read the text and decide.
        app.log.error({ err, key }, "could not sign report photo");
        return null;
      }
    })
  );
  return signed.filter((url): url is string => url !== null);
}
