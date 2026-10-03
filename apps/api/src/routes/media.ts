import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET, s3 } from "../lib/s3";
import type { PresignRequest, PresignResponse } from "../../../../packages/shared/types";

const ALLOWED_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function mediaRoutes(app: FastifyInstance) {
  app.post<{ Body: PresignRequest }>(
    "/api/media/presign",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { contentType, bytes } = req.body;

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

      const { workshopId } = req.user as { workshopId: string };
      const ext = contentType.split("/")[1];
      const storageKey = `${workshopId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

      try {
        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: contentType }),
          { expiresIn: 300 }
        );
        const body: PresignResponse = { uploadUrl, storageKey };
        return reply.send(body);
      } catch (err) {
        app.log.error(err, "presign failed");
        return reply.status(500).send({ error: "presign_failed", message: "Could not sign the upload." });
      }
    }
  );
}
