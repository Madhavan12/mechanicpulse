import type { FastifyInstance } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../db";
import { BUCKET, s3 } from "./s3";
import type { FindingPhoto } from "../../../../packages/shared/types";

/** Minutes, not hours — a forwarded screenshot of the page shouldn't keep
 * working. The bucket stays private; nothing durable is ever handed out. */
const PHOTO_URL_TTL_SECONDS = 900;

export async function presignGet(app: FastifyInstance, key: string): Promise<string | null> {
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
      expiresIn: PHOTO_URL_TTL_SECONDS,
    });
  } catch (err) {
    // A photo that won't sign must not take the whole page down.
    app.log.error({ err, key }, "could not sign photo");
    return null;
  }
}

/** Finished uploads only (state 'ready'), grouped by finding, in display order. */
export async function loadPhotos(app: FastifyInstance, itemIds: string[]): Promise<Map<string, FindingPhoto[]>> {
  const byItem = new Map<string, FindingPhoto[]>();
  if (itemIds.length === 0) return byItem;

  const { rows } = await db.query<{ id: string; inspection_item_id: string; storage_key: string }>(
    `SELECT id, inspection_item_id, storage_key
       FROM media
      WHERE inspection_item_id = ANY($1::uuid[]) AND state = 'ready'
      ORDER BY position, created_at`,
    [itemIds]
  );

  await Promise.all(
    rows.map(async (row) => {
      const url = await presignGet(app, row.storage_key);
      if (!url) return;
      const list = byItem.get(row.inspection_item_id) ?? [];
      list.push({ id: row.id, url });
      byItem.set(row.inspection_item_id, list);
    })
  );
  // Promise.all finishes out of order; put each list back in query order.
  const order = new Map(rows.map((r, i) => [r.id, i]));
  for (const list of byItem.values()) list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return byItem;
}
