import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import * as path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignRequest, PresignResponse } from "../../../packages/shared/types";

const PORT = process.env.PORT || 3001;
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || "ap-southeast-2";

if (!BUCKET) {
  console.error("S3_BUCKET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const s3 = new S3Client({
  region: REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const app = express();

app.use(express.json());
// Wide open on purpose: this is a throwaway spike. Lock it down in week 1.
app.use(cors({ origin: true }));

const ALLOWED_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;

// Serve the spike page from the API too, so a phone needs only one URL (e.g. through a tunnel).
app.use(express.static(path.join(__dirname, "../../spike")));

app.get("/health", (_req, res) => res.json({ ok: true, bucket: BUCKET, region: REGION }));

app.post("/api/media/presign", async (req, res) => {
  const { contentType, bytes } = req.body as PresignRequest;

  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({
      error: "bad_content_type",
      message: `Send one of: ${ALLOWED_TYPES.join(", ")}`,
    });
  }
  if (typeof bytes !== "number" || bytes <= 0 || bytes > MAX_BYTES) {
    return res.status(400).json({
      error: "bad_size",
      message: `Compress before uploading. Max ${MAX_BYTES} bytes.`,
    });
  }

  const ext = contentType.split("/")[1];
  const storageKey = `spike/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: contentType }),
      { expiresIn: 300 }
    );
    const body: PresignResponse = { uploadUrl, storageKey };
    res.json(body);
  } catch (err) {
    console.error("presign failed", err);
    res.status(500).json({ error: "presign_failed", message: "Could not sign the upload." });
  }
});

app.listen(PORT, () => {
  console.log(`API on :${PORT}  bucket=${BUCKET}  region=${REGION}`);
});
