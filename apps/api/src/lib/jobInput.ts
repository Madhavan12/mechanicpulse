import type { CreateJobRequest, FieldError } from "../../../../packages/shared/types";

export interface CleanJobInput {
  customerName: string;
  mobileE164: string;
  rego: string;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
}

type Result = { ok: true; value: CleanJobInput } | { ok: false; error: FieldError };

function fail(field: FieldError["field"], message: string): Result {
  return { ok: false, error: { error: "invalid_field", field, message } };
}

/** Australian mobiles only (04xx / +614xx), because SMS goes to a mobile.
 * Returns E.164 or null. */
export function normaliseAuMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, "");
  let national: string;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\+?61\d{9}$/.test(digits)) national = digits.replace(/^\+?61/, "");
  else return null;
  return /^4\d{8}$/.test(national) ? `+61${national}` : null;
}

/** Matches the vehicles.rego CHECK: upper-case, no spaces, 1-9 of A-Z0-9. */
export function normaliseRego(raw: string): string | null {
  const rego = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{1,9}$/.test(rego) ? rego : null;
}

function optionalText(value: unknown, field: "make" | "model", max: number): string | null | FieldError {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return { error: "invalid_field", field, message: `${field} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: "invalid_field", field, message: `Keep ${field} under ${max} characters.` };
  return trimmed || null;
}

/** Untrusted body in, clean values out. Everything the form checks is
 * re-checked here — the browser is not a trust boundary. */
export function parseCreateJob(body: Partial<Record<keyof CreateJobRequest, unknown>> | undefined | null): Result {
  const b = body ?? {};

  const customerName = typeof b.customerName === "string" ? b.customerName.trim() : "";
  if (!customerName) return fail("customerName", "Enter the customer's name.");
  if (customerName.length > 100) return fail("customerName", "Keep the name under 100 characters.");

  const mobileE164 = typeof b.customerMobile === "string" ? normaliseAuMobile(b.customerMobile) : null;
  if (!mobileE164) return fail("customerMobile", "Enter an Australian mobile number, like 0412 345 678.");

  const rego = typeof b.rego === "string" ? normaliseRego(b.rego) : null;
  if (!rego) return fail("rego", "Enter a rego of up to 9 letters and numbers.");

  const make = optionalText(b.make, "make", 50);
  if (make !== null && typeof make === "object") return { ok: false, error: make };
  const model = optionalText(b.model, "model", 50);
  if (model !== null && typeof model === "object") return { ok: false, error: model };

  let odometerKm: number | null = null;
  if (b.odometerKm !== undefined && b.odometerKm !== null) {
    if (typeof b.odometerKm !== "number" || !Number.isInteger(b.odometerKm) || b.odometerKm < 0 || b.odometerKm > 9_999_999) {
      return fail("odometerKm", "Odometer must be a whole number of kilometres.");
    }
    odometerKm = b.odometerKm;
  }

  return { ok: true, value: { customerName, mobileE164, rego, make: make as string | null, model: model as string | null, odometerKm } };
}
