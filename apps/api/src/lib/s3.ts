import { S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
const region = process.env.AWS_REGION || "ap-southeast-2";

if (!bucket) {
  console.error("S3_BUCKET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

export const BUCKET = bucket;

/** One client for the whole API. `requestChecksumCalculation: WHEN_REQUIRED`
 * is load-bearing, not tidiness — the SDK's default full-object checksums
 * break presigned uploads from a browser. See docs/infra-decisions.md. */
export const s3 = new S3Client({
  region,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
