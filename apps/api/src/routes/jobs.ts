import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { parseCreateJob } from "../lib/jobInput";
import { loadPhotos } from "../lib/photos";
import { toFinding } from "./findings";
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobStatus,
  JobDisplayStatus,
  JobDetail,
  JobListItem,
  ListJobsResponse,
} from "../../../../packages/shared/types";

interface JobRow {
  id: string;
  status: JobStatus;
  created_at: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_rego: string;
  customer_name: string;
  has_items: boolean;
}

interface DetailRow {
  id: string;
  status: JobStatus;
  created_at: string;
  odometer_km: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_rego: string;
  customer_name: string;
  customer_mobile: string;
  customer_opted_out: boolean;
}

function displayStatusFor(status: JobStatus, hasItems: boolean): JobDisplayStatus {
  if (status !== "open") return "completed";
  return hasItems ? "in_progress" : "not_started";
}

export async function jobsRoutes(app: FastifyInstance) {
  app.get("/api/jobs", { preHandler: app.authenticate }, async (req, reply) => {
    const { workshopId } = req.user as { workshopId: string };

    const { rows } = await db.query<JobRow>(
      `SELECT j.id, j.status, j.created_at,
              v.make AS vehicle_make, v.model AS vehicle_model, v.rego AS vehicle_rego,
              c.name AS customer_name,
              EXISTS (SELECT 1 FROM inspection_items ii WHERE ii.job_id = j.id) AS has_items
       FROM jobs j
       JOIN vehicles v ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
       JOIN customers c ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
       WHERE j.workshop_id = $1
       ORDER BY j.created_at DESC
       LIMIT 200`, // safety cap, not a real answer to "today's" — see docs/test-cases.md
      [workshopId]
    );

    const jobs: JobListItem[] = rows.map((row) => ({
      id: row.id,
      status: row.status,
      displayStatus: displayStatusFor(row.status, row.has_items),
      vehicleMake: row.vehicle_make,
      vehicleModel: row.vehicle_model,
      vehicleRego: row.vehicle_rego,
      customerName: row.customer_name,
      createdAt: row.created_at,
    }));

    const body: ListJobsResponse = { jobs };
    return reply.send(body);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { workshopId } = req.user as { workshopId: string };
    const jobId = req.params.id;
    const notFound = () => reply.status(404).send({ error: "not_found", message: "That job doesn't exist." });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return notFound();

    // Scoped by workshop in the query itself: someone else's job and a job
    // that doesn't exist look identical.
    const { rows } = await db.query<DetailRow>(
      `SELECT j.id, j.status, j.created_at, j.odometer_km,
              v.make AS vehicle_make, v.model AS vehicle_model, v.rego AS vehicle_rego,
              c.name AS customer_name, c.mobile_e164 AS customer_mobile,
              (c.sms_opted_out_at IS NOT NULL) AS customer_opted_out
         FROM jobs j
         JOIN vehicles v ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
         JOIN customers c ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
        WHERE j.id = $1 AND j.workshop_id = $2`,
      [jobId, workshopId]
    );
    const job = rows[0];
    if (!job) return notFound();

    const { rows: itemRows } = await db.query(
      `SELECT id, title, severity, note, price_cents, position
         FROM inspection_items WHERE job_id = $1 ORDER BY position, created_at`,
      [jobId]
    );
    const photos = await loadPhotos(app, itemRows.map((r) => r.id));
    const items = itemRows.map((r) => toFinding(r, photos.get(r.id)));

    const { rows: reportRows } = await db.query(
      `SELECT r.id, r.sent_at, r.expires_at, r.decided_at, r.revoked_at,
              (SELECT s.status FROM sms_messages s WHERE s.report_id = r.id
                ORDER BY s.created_at DESC LIMIT 1) AS sms_status
         FROM reports r WHERE r.job_id = $1 ORDER BY r.sent_at DESC LIMIT 1`,
      [jobId]
    );
    const r = reportRows[0];

    const body: JobDetail = {
      id: job.id,
      status: job.status,
      displayStatus: displayStatusFor(job.status, items.length > 0),
      customerName: job.customer_name,
      customerMobile: job.customer_mobile,
      customerOptedOut: job.customer_opted_out,
      latestReport: r
        ? {
            id: r.id,
            sentAt: r.sent_at,
            expiresAt: r.expires_at,
            state: r.revoked_at ? "revoked" : r.decided_at ? "decided" : new Date(r.expires_at) <= new Date() ? "expired" : "open",
            sms: r.sms_status ?? null,
          }
        : null,
      vehicleMake: job.vehicle_make,
      vehicleModel: job.vehicle_model,
      vehicleRego: job.vehicle_rego,
      odometerKm: job.odometer_km,
      createdAt: job.created_at,
      items,
      totalCents: items.reduce((sum, i) => sum + i.priceCents, 0),
    };
    return reply.send(body);
  });

  app.post<{ Body: CreateJobRequest }>("/api/jobs", { preHandler: app.authenticate }, async (req, reply) => {
    const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };

    const parsed = parseCreateJob(req.body);
    if (!parsed.ok) return reply.status(400).send(parsed.error);
    const input = parsed.value;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Existing customer keeps their stored name: a typo at the counter
      // shouldn't silently rename someone. The no-op UPDATE is only there so
      // RETURNING gives us the id on a conflict.
      const { rows: customerRows } = await client.query<{ id: string }>(
        `INSERT INTO customers (workshop_id, name, mobile_e164)
              VALUES ($1, $2, $3)
         ON CONFLICT (workshop_id, mobile_e164) DO UPDATE SET updated_at = now()
           RETURNING id`,
        [workshopId, input.customerName, input.mobileE164]
      );
      const customerId = customerRows[0].id;

      // A known rego is reused. If it's now with a different customer the car
      // has changed hands: vehicles.customer_id is the *current* owner. Past
      // jobs keep their own customer_id, so history is unaffected.
      const { rows: vehicleRows } = await client.query<{ id: string }>(
        `INSERT INTO vehicles (workshop_id, customer_id, rego, make, model)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workshop_id, rego) DO UPDATE
                 SET customer_id = EXCLUDED.customer_id,
                     make        = COALESCE(EXCLUDED.make,  vehicles.make),
                     model       = COALESCE(EXCLUDED.model, vehicles.model)
           RETURNING id`,
        [workshopId, customerId, input.rego, input.make, input.model]
      );
      const vehicleId = vehicleRows[0].id;

      const { rows: jobRows } = await client.query<{ id: string }>(
        `INSERT INTO jobs (workshop_id, vehicle_id, customer_id, created_by, odometer_km)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
        [workshopId, vehicleId, customerId, mechanicId, input.odometerKm]
      );
      const jobId = jobRows[0].id;

      await client.query(
        `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id)
              VALUES ($1, $2, 'job.created', 'mechanic', $3)`,
        [workshopId, jobId, mechanicId]
      );

      await client.query("COMMIT");
      const body: CreateJobResponse = { jobId };
      return reply.status(201).send(body);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}
