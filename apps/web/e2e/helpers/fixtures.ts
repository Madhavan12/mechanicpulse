/** Values that come from db/seed/dev_seed.sql. If the seed changes, this
 * changes with it — that's the only coupling, and it's deliberate: tests
 * should break loudly when the fixture they rely on moves. */
export const SEED = {
  workshopId: "00000000-0000-0000-0000-000000000001",
  workshopName: "Demo Auto Care",
  workshopPhone: "+61390000000",
  ownerEmail: "owner@demo.test",
  mechanicEmail: "jo@demo.test",
  password: "password123",
  jobId: "00000000-0000-0000-0000-00000000b001",
  customerName: "Alex Customer",
  vehicle: "Toyota Corolla",
  rego: "ABC123",
  brakeItemId: "00000000-0000-0000-0000-00000000d001",
  brakeTitle: "Front brake pads worn",
  brakeNote: "2mm remaining, metal-on-metal soon",
  brakeCents: 28900,
  wiperItemId: "00000000-0000-0000-0000-00000000d002",
  wiperTitle: "Wiper blades perished",
  wiperCents: 4500,
} as const;

export const TOTAL_CENTS = SEED.brakeCents + SEED.wiperCents; // 33400

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";

/** An S3 object that really exists in the dev bucket. Only used when
 * REAL_S3 is on — otherwise the seed's dangling key is fine, since the point
 * of those assertions is that a missing photo degrades gracefully. */
export const REAL_PHOTO_KEY =
  process.env.E2E_PHOTO_KEY ??
  "00000000-0000-0000-0000-000000000001/2026-10-02/9170d7d4-06a5-4d3e-a40c-f512bf869bf9.webp";

/** Presigning a URL needs no network — the SDK signs locally — so the API
 * returns 200 even with throwaway credentials. Actually *fetching* the object
 * does need real ones. CI has none, so the "photo decodes" assertion only
 * runs when this is set. Everything else runs everywhere. */
export const REAL_S3 = process.env.E2E_REAL_S3 === "1";

export function money(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
