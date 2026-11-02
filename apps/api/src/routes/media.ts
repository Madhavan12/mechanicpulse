import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../db";
import { BUCKET, s3 } from "../lib/s3";
import { presignGet } from "../lib/photos";
import {
  MAX_PHOTOS_PER_FINDING,
  type ConfirmMediaRequest,
  type ConfirmMediaResponse,
  type PresignRequest,
  type PresignResponse,
} from "../../../../packages/shared/types";

const ALLOWED_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;
/** An abandoned upload (tab closed mid-PUT) shouldn't hold a photo slot
 * forever; after this long it stops counting against the cap. A sweeper for
 * the leftover rows and S3 objects is a later job. */
const PENDING_SLOT_MINUTES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: "not_found", message: "That photo or finding doesn't exist." });

const locked = (reply: FastifyReply) =>
  reply.status(409).send({
    error: "job_locked",
    message: "This report has been sent, so its photos can't be changed.",
  });

interface MediaRow {
  id: string;
  storage_key: string;
  state: "pending" | "uploading" | "ready" | "failed";
  inspection_item_id: string;
  job_id: string;
  job_status: string;
}

/** The media row, only if it belongs to a job in this workshop. */
async function findOwnedMedia(mediaId: string, workshopId: string): Promise<MediaRow | null> {
  const { rows } = await db.query<MediaRow>(
    `SELECT m.id, m.storage_key, m.state, m.inspection_item_id,
            j.id AS job_id, j.status AS job_status
       FROM media m
       JOIN inspection_items ii ON ii.id = m.inspection_item_id
       JOIN jobs j              ON j.id = ii.job_id
      WHERE m.id = $1 AND j.workshop_id = $2`,
    [mediaId, workshopId]
  );
  return rows[0] ?? null;
}

function isMissingObject(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post<{ Body: PresignRequest }>("/api/media/presign", { preHandler: app.authenticate }, async (req, reply) => {
    const { contentType, bytes, inspectionItemId } = req.body ?? ({} as PresignRequest);
    const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };

    if (!ALLOWED_TYPES.includes(contentType)) {
      return reply.status(400).send({
        error: "bad_content_type",
        message: `Send one of: ${ALLOWED_TYPES.join(", ")}`,
      });
    }
    if (typeof bytes !== "number" || bytes <= 0 || bytes > MAX_BYTES) {
      return reply.status(400).send({
        error: "bad_size",
        message: `Compress before uploading. Max ${MAX_BYTES} bytes.`,
      });
    }
    if (inspectionItemId !== undefined && (typeof inspectionItemId !== "string" || !UUID.test(inspectionItemId))) {
      return notFound(reply);
    }

    const ext = contentType.split("/")[1];
    const storageKey = `${workshopId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: contentType }),
        { expiresIn: 300 }
      );
    } catch (err) {
      app.log.error(err, "presign failed");
      return reply.status(500).send({ error: "presign_failed", message: "Could not sign the upload." });
    }

    // No finding given: the standalone /capture test page. Nothing to record.
    if (!inspectionItemId) {
      const body: PresignResponse = { uploadUrl, storageKey };
      return reply.send(body);
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Locks the job row so a send can't slip in between this check and the insert.
      const { rows: owner } = await client.query<{ job_id: string; status: string }>(
        `SELECT j.id AS job_id, j.status
           FROM inspection_items ii
           JOIN jobs j ON j.id = ii.job_id
          WHERE ii.id = $1 AND j.workshop_id = $2
            FOR UPDATE OF j`,
        [inspectionItemId, workshopId]
      );
      if (!owner[0]) {
        await client.query("ROLLBACK");
        return notFound(reply);
      }
      if (owner[0].status !== "open") {
        await client.query("ROLLBACK");
        return locked(reply);
      }

      const { rows: taken } = await client.query<{ n: number; next_position: number }>(
        `SELECT count(*) FILTER (
                  WHERE state = 'ready'
                     OR (state IN ('pending', 'uploading') AND created_at > now() - make_interval(mins => $2))
                )::int AS n,
                COALESCE(MAX(position) + 1, 0)::int AS next_position
           FROM media WHERE inspection_item_id = $1`,
        [inspectionItemId, PENDING_SLOT_MINUTES]
      );
      if (taken[0].n >= MAX_PHOTOS_PER_FINDING) {
        await client.query("ROLLBACK");
        return reply.status(409).send({
          error: "photo_limit",
          message: `A finding can have up to ${MAX_PHOTOS_PER_FINDING} photos.`,
        });
      }

      const { rows: created } = await client.query<{ id: string }>(
        `INSERT INTO media (inspection_item_id, storage_key, content_type, bytes, position)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
        [inspectionItemId, storageKey, contentType, bytes, taken[0].next_position]
      );
      const mediaId = created[0].id;

      await client.query(
        `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
              VALUES ($1, $2, 'media.upload_started', 'mechanic', $3, $4)`,
        [workshopId, owner[0].job_id, mechanicId, JSON.stringify({ mediaId, itemId: inspectionItemId, bytes })]
      );

      await client.query("COMMIT");
      const body: PresignResponse = { uploadUrl, storageKey, mediaId };
      return reply.send(body);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      app.log.error(err, "presign failed");
      return reply.status(500).send({ error: "presign_failed", message: "Could not start the upload." });
    } finally {
      client.release();
    }
  });

  /** The browser calls this after its PUT to S3 succeeds. We don't take its
   * word for it: the object must really be there, and its size is read from
   * S3, not from the request. */
  app.post<{ Params: { id: string }; Body: ConfirmMediaRequest }>(
    "/api/media/:id/confirm",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      if (!UUID.test(req.params.id)) return notFound(reply);

      const media = await findOwnedMedia(req.params.id, workshopId);
      if (!media) return notFound(reply);

      // Idempotent: a retried confirm after a dropped response just succeeds.
      if (media.state !== "ready") {
        if (media.job_status !== "open") return locked(reply);

        let size: number | undefined;
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: media.storage_key }));
          size = head.ContentLength;
        } catch (err) {
          if (isMissingObject(err)) {
            return reply.status(409).send({
              error: "not_uploaded",
              message: "The photo didn't finish uploading. Try again.",
            });
          }
          app.log.error({ err, key: media.storage_key }, "could not verify upload");
          return reply.status(502).send({ error: "storage_unavailable", message: "Could not check the upload. Try again." });
        }
        if (!size) {
          return reply.status(409).send({ error: "not_uploaded", message: "The photo didn't finish uploading. Try again." });
        }
        if (size > MAX_BYTES) {
          await db.query(`UPDATE media SET state = 'failed' WHERE id = $1`, [media.id]);
          return reply.status(400).send({ error: "bad_size", message: "That photo is too large." });
        }

        const dim = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
        const width = dim(req.body?.width);
        const height = dim(req.body?.height);

        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE media
                SET state = 'ready', uploaded_at = now(), bytes = $2, width = $3, height = $4
              WHERE id = $1`,
            [media.id, size, width, height]
          );
          await client.query(
            `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
                  VALUES ($1, $2, 'media.upload_succeeded', 'mechanic', $3, $4)`,
            [workshopId, media.job_id, mechanicId, JSON.stringify({ mediaId: media.id, bytes: size })]
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          app.log.error(err, "confirm failed");
          return reply.status(500).send({ error: "confirm_failed", message: "Could not save the photo. Try again." });
        } finally {
          client.release();
        }
      }

      const url = await presignGet(app, media.storage_key);
      if (!url) {
        return reply.status(500).send({ error: "sign_failed", message: "The photo saved but can't be shown yet. Reload the page." });
      }
      const body: ConfirmMediaResponse = { photo: { id: media.id, url } };
      return reply.send(body);
    }
  );

  /** Best-effort report from the browser that an upload didn't make it, so the
   * measurement layer sees upload reliability. Never changes a finished photo. */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/api/media/:id/fail",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
      if (!UUID.test(req.params.id)) return notFound(reply);

      const media = await findOwnedMedia(req.params.id, workshopId);
      if (!media) return notFound(reply);
      if (media.state === "ready" || media.state === "failed") return reply.status(204).send();

      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : undefined;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE media SET state = 'failed' WHERE id = $1 AND state IN ('pending', 'uploading')`, [media.id]);
        await client.query(
          `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
                VALUES ($1, $2, 'media.upload_failed', 'mechanic', $3, $4)`,
          [workshopId, media.job_id, mechanicId, JSON.stringify({ mediaId: media.id, reason })]
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

  /** Remove a photo from a finding. The S3 object is deliberately left in
   * place for now (a cleanup job is a later task) — the row is what makes it
   * disappear from the finding and from any new report. */
  app.delete<{ Params: { id: string } }>("/api/media/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { sub: mechanicId, workshopId } = req.user as { sub: string; workshopId: string };
    if (!UUID.test(req.params.id)) return notFound(reply);

    const media = await findOwnedMedia(req.params.id, workshopId);
    if (!media) return notFound(reply);
    if (media.job_status !== "open") return locked(reply);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM media WHERE id = $1`, [media.id]);
      await client.query(
        `INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id, payload)
              VALUES ($1, $2, 'item.updated', 'mechanic', $3, $4)`,
        [workshopId, media.job_id, mechanicId, JSON.stringify({ itemId: media.inspection_item_id, photoRemoved: media.id })]
      );
      await client.query("COMMIT");
      return reply.status(204).send();
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}
