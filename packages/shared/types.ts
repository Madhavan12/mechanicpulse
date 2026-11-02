/**
 * The contract between the API and the web app.
 *
 * Rule: this file changes first, then both sides follow. If you need a field
 * that isn't here, add it here and tell the other person before your next commit.
 */

export type Severity = "red" | "amber" | "green";
export type MediaState = "pending" | "uploading" | "ready" | "failed";
export type JobStatus = "open" | "sent" | "decided" | "closed";
export type Decision = "approved" | "declined";

/**
 * Mechanic-facing status, shown on the Job List (per
 * docs/mechanic-pulse-frontend-spec.md). Derived, not stored — the
 * `job_status` DB enum (open/sent/decided/closed) is about the customer
 * report lifecycle, not whether the mechanic has started. Not written down
 * anywhere else yet; flagged here as our own mapping, not a fixed
 * requirement: "completed" = sent, decided, or closed; "in_progress" = open
 * with at least one inspection item; "not_started" = open with none.
 */
export type JobDisplayStatus = "not_started" | "in_progress" | "completed";

export interface Workshop {
  id: string;
  name: string;
  timezone: string;
}

export type MechanicRole = "owner" | "mechanic";

/** password_hash is intentionally not here — never send it to the client. */
export interface Mechanic {
  id: string;
  workshopId: string;
  name: string;
  email: string;
  role: MechanicRole;
}

export interface Customer {
  id: string;
  workshopId: string;
  name: string;
  /** E.164 only. Normalise at the edge, never store 0412... */
  mobileE164: string;
}

export interface Vehicle {
  id: string;
  workshopId: string;
  customerId: string;
  /** Unique per workshop, not globally. */
  rego: string;
  make?: string;
  model?: string;
}

export interface Job {
  id: string;
  workshopId: string;
  vehicleId: string;
  customerId: string;
  createdBy: string;
  status: JobStatus;
  odometerKm?: number;
  /** Job card id in the shop's existing workshop software. Unused in v1. */
  externalRef?: string;
  createdAt: string;
  closedAt?: string;
}

/** One row on the Job List — a Job plus enough vehicle/customer info to
 * render it without a second round trip. */
export interface JobListItem {
  id: string;
  status: JobStatus;
  displayStatus: JobDisplayStatus;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleRego: string;
  customerName: string;
  createdAt: string;
}

export interface ListJobsResponse {
  jobs: JobListItem[];
}

export interface InspectionItem {
  id: string;
  jobId: string;
  title: string;
  severity: Severity;
  note?: string;
  /** Integer cents. Never a float, never a string. */
  priceCents: number;
  position: number;
  media: Media[];
}

export interface Media {
  id: string;
  inspectionItemId: string;
  storageKey: string;
  state: MediaState;
  kind: "image" | "video";
  width?: number;
  height?: number;
  bytes?: number;
}

export interface Report {
  id: string;
  jobId: string;
  sentAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface Approval {
  id: string;
  reportId: string;
  itemId: string;
  decision: Decision;
  signedName: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

/** POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  mechanic: Mechanic;
}

/** POST /api/media/presign — requires Authorization: Bearer <token> */
export interface PresignRequest {
  contentType: string;
  /** Bytes, after client-side compression. Used to reject anything absurd. */
  bytes: number;
}

export interface PresignResponse {
  /** PUT the blob here. Expires in minutes, not hours. */
  uploadUrl: string;
  /** Hand this back to the API once the PUT succeeds. */
  storageKey: string;
}

/** Everything below is week 1+. Listed now so both sides can see the shape. */

export interface CreateJobRequest {
  rego: string;
  customerName: string;
  customerMobile: string;
}

export interface CreateItemRequest {
  title: string;
  severity: Severity;
  note?: string;
  priceCents: number;
}

export interface MediaReadyRequest {
  storageKey: string;
  bytes: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Customer report — the link-accessed, unauthenticated half            */
/* ------------------------------------------------------------------ */

/** POST /api/jobs/:id/report — mechanic sends. Requires Authorization.
 * The job id is in the path, not the body. */
export interface SendReportRequest {
  /** Which inspection items to include. Omit (or send []) to include all of them. */
  itemIds?: string[];
}

export interface SendReportResponse {
  reportId: string;
  /** The raw token, returned exactly once. Only its SHA-256 hash is stored
   * (reports.token_hash), so this response is the only chance to read it —
   * put it in the SMS and don't persist it anywhere else. */
  token: string;
  /** The full customer-facing link, ready to text. */
  reportUrl: string;
  sentAt: string;
  expiresAt: string;
  totalCents: number;
}

/** Lifecycle of a report from the customer's point of view. Only "open"
 * accepts a decision; the rest are dead ends the page has to explain. */
export type ReportState = "open" | "decided" | "expired" | "revoked";

export interface ReportItemView {
  inspectionItemId: string;
  title: string;
  severity: Severity;
  note: string | null;
  /** Integer cents. Frozen at send time — a later mechanic edit can't move it. */
  priceCents: number;
  position: number;
  /** Presigned GET URLs, minutes not hours. Empty when no photo is ready. */
  photoUrls: string[];
  /** Null until the customer submits; afterwards, what they chose. */
  decision: Decision | null;
}

/** GET /api/report/:token — public, no auth. For `expired` and `revoked`
 * the items are omitted: there's nothing to act on, so the quote isn't shown. */
export interface CustomerReportResponse {
  state: ReportState;
  workshopName: string;
  workshopPhone: string | null;
  customerName: string;
  vehicleRego: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  sentAt: string;
  expiresAt: string;
  decidedAt: string | null;
  totalCents: number;
  items: ReportItemView[];
}

/** POST /api/report/:token/decision — public. One submission per report:
 * every item must get a decision, and it can't be revised afterwards.
 * A revised quote is a new report. */
export interface ApproveRequest {
  decisions: { itemId: string; decision: Decision }[];
  /** Typed by the customer as their signature. Must not be blank. */
  signedName: string;
}

export interface ApproveResponse {
  decidedAt: string;
  approvedCount: number;
  declinedCount: number;
  /** Approved items only — what the shop is actually cleared to do. */
  approvedTotalCents: number;
}

export interface ApiError {
  error: string;
  message: string;
}
