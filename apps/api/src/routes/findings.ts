import type { FastifyInstance, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { db } from "../db";
import { parseFinding } from "../lib/findingInput";
import { loadPhotos } from "../lib/photos";
import type { Finding, FindingPhoto, SaveFindingRequest, SaveFindingResponse } from "../../../../packages/shared/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ItemRow {
  id: string;
  title: string;
  severity: Finding["severity"];
  note: string | null;
  price_cents: number;
  position: number;
}

export function toFinding(row: ItemRow, photos: FindingPhoto[] = []): Finding {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity,
    note: row.note,
    priceCents: row.price_cents,
    position: row.position,
    photos,
  };
}

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: "not_found", message: "That job or finding doesn't exist." });

/** Locks the job row and checks it belongs to this workshop. Returns null
 * for "no such job" and "someone else's job" alike — one answer, so ids
 * can't be probed across workshops. */
async function lockOwnedJob(client: PoolClient, jobId: string, workshopId: string) {
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM jobs WHERE id = $1 AND workshop_id = $2 FOR UPDATE`,
    [jobId, workshopId]
  );
  return rows[0] ?? null;
}

function locked(reply: FastifyReply) {
  return reply.status(409).send({
    error: "job_locked",
    message: "This report has been sent, so its findings can't be changed.",
  });
}

/** Mechanic-side finding (inspection_items) CRUD. Every route is behind
 * app.authenticate and scoped to the token's workshop; a sent job is
 * read-only because the customer's report is a frozen snapshot of it. */
export async function findingsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: SaveFindingRequest }>(
    "/api/jobs/:id/items",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      const jobId = req.params.id;
      if (!UUID.test(jobId)) return notFound(reply);

      const parsed = parseFinding(req.body);
      if (!parsed.ok) return reply.status(400).send(parsed.error);
      const f = parsed.value;

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const job = await lockOwnedJob(client, jobId, workshopId);
        if (!job) {
          await client.query("ROLLBACK");
          return notFound(reply);
        }
        if (job.status !== "open") {
          await client.query("ROLLBACK");
          return locked(reply);
        }

        const { rows } = await client.query<ItemRow>(
          `INSERT INTO inspection_items (job_id, title, severity, note, price_cents, position, created_by)
                SELECT $1, $2, $3, $4, $5, COALESCE(MAX(position) + 1, 0), $6
                  FROM inspection_items WHERE job_id = $1
             RETURNING id, title, severity, note, price_cents, position`,
          [jobId, f.title, f.severity, f.note, f.priceCents, mechanicId]
        );
        const item = rows[0];

        await client.query(
          `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, 'item.added', 'mechanic', $3, $4)`,
          [workshopId, jobId, mechanicId, JSON.stringify({ itemId: item.id })]
        );

        await client.query("COMMIT");
        const body: SaveFindingResponse = { item: toFinding(item) };
        return reply.status(201).send(body);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  );

  app.patch<{ Params: { id: string; itemId: string }; Body: SaveFindingRequest }>(
    "/api/jobs/:id/items/:itemId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      const { id: jobId, itemId } = req.params;
      if (!UUID.test(jobId) || !UUID.test(itemId)) return notFound(reply);

      const parsed = parseFinding(req.body);
      if (!parsed.ok) return reply.status(400).send(parsed.error);
      const f = parsed.value;

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const job = await lockOwnedJob(client, jobId, workshopId);
        if (!job) {
          await client.query("ROLLBACK");
          return notFound(reply);
        }
        if (job.status !== "open") {
          await client.query("ROLLBACK");
          return locked(reply);
        }

        const { rows } = await client.query<ItemRow>(
          `UPDATE inspection_items
              SET title = $3, severity = $4, note = $5, price_cents = $6
            WHERE id = $1 AND job_id = $2
        RETURNING id, title, severity, note, price_cents, position`,
          [itemId, jobId, f.title, f.severity, f.note, f.priceCents]
        );
        if (!rows[0]) {
          await client.query("ROLLBACK");
          return notFound(reply);
        }

        await client.query(
          `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, 'item.updated', 'mechanic', $3, $4)`,
          [workshopId, jobId, mechanicId, JSON.stringify({ itemId })]
        );

        await client.query("COMMIT");
        const photos = (await loadPhotos(app, [itemId])).get(itemId) ?? [];
        const body: SaveFindingResponse = { item: toFinding(rows[0], photos) };
        return reply.send(body);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    "/api/jobs/:id/items/:itemId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      const { id: jobId, itemId } = req.params;
      if (!UUID.test(jobId) || !UUID.test(itemId)) return notFound(reply);

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const job = await lockOwnedJob(client, jobId, workshopId);
        if (!job) {
          await client.query("ROLLBACK");
          return notFound(reply);
        }
        if (job.status !== "open") {
          await client.query("ROLLBACK");
          return locked(reply);
        }

        const { rowCount } = await client.query(`DELETE FROM inspection_items WHERE id = $1 AND job_id = $2`, [
          itemId,
          jobId,
        ]);
        if (!rowCount) {
          await client.query("ROLLBACK");
          return notFound(reply);
        }

        await client.query(
          `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, 'item.deleted', 'mechanic', $3, $4)`,
          [workshopId, jobId, mechanicId, JSON.stringify({ itemId })]
        );

        await client.query("COMMIT");
        return reply.status(204).send();
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  );
}
