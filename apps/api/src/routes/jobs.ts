import type { FastifyInstance } from "fastify";
import { db } from "../db";
import type { JobStatus, JobDisplayStatus, JobListItem, ListJobsResponse } from "../../../../packages/shared/types";

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
       ORDER BY j.created_at DESC`,
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
}
