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
  status: JobStatus;
  /** Job card id in the shop's existing workshop software. Unused in v1. */
  externalRef?: string;
  createdAt: string;
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

export interface SendReportRequest {
  jobId: string;
  itemIds: string[];
}

export interface ApproveRequest {
  decisions: { itemId: string; decision: Decision }[];
  signedName: string;
}

export interface ApiError {
  error: string;
  message: string;
}
