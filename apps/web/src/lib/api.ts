import type {
  ApproveRequest,
  ApproveResponse,
  ConfirmMediaRequest,
  ConfirmMediaResponse,
  CreateJobRequest,
  CreateJobResponse,
  CustomerReportResponse,
  FieldError,
  FindingFieldError,
  JobDetail,
  ListJobsResponse,
  LoginRequest,
  LoginResponse,
  PresignRequest,
  PresignResponse,
  SaveFindingRequest,
  SaveFindingResponse,
  SendReportResponse,
} from "../../../../packages/shared/types";

// Unset = local dev. Set to "" (deployed) = same origin: the page and the API
// share one address, so requests go to /api/... with no CORS involved.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "mp_token";
const MECHANIC_KEY = "mp_mechanic";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredMechanic(): LoginResponse["mechanic"] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(MECHANIC_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(MECHANIC_KEY);
}

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Login failed." }));
    throw new Error(err.message || "Login failed.");
  }
  const data: LoginResponse = await res.json();
  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(MECHANIC_KEY, JSON.stringify(data.mechanic));
  return data;
}

export async function listJobs(): Promise<ListJobsResponse> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/jobs`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not load jobs." }));
    throw new Error(err.message || "Could not load jobs.");
  }
  return res.json();
}

/** Carries the API's per-field message so the form can show it by the input. */
export class FieldValidationError extends Error {
  constructor(public field: FieldError["field"] | FindingFieldError["field"], message: string) {
    super(message);
  }
}

export async function createJob(body: CreateJobRequest): Promise<CreateJobResponse> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not create the job." }));
    if (err.error === "invalid_field") throw new FieldValidationError(err.field, err.message);
    throw new Error(err.message || "Could not create the job.");
  }
  return res.json();
}

/** An API error that remembers its HTTP status, so a page can tell
 * "not found" and "locked" apart from "something broke". */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function authed(path: string, init: RequestInit = {}, fallback = "Something went wrong."): Promise<Response> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === "invalid_field") throw new FieldValidationError(err.field, err.message);
    throw new ApiError(res.status, err.message || fallback, err.error);
  }
  return res;
}

export async function getJob(jobId: string): Promise<JobDetail> {
  return (await authed(`/api/jobs/${jobId}`, {}, "Could not load this job.")).json();
}

export async function addFinding(jobId: string, body: SaveFindingRequest): Promise<SaveFindingResponse> {
  const res = await authed(`/api/jobs/${jobId}/items`, { method: "POST", body: JSON.stringify(body) }, "Could not save the finding.");
  return res.json();
}

export async function updateFinding(jobId: string, itemId: string, body: SaveFindingRequest): Promise<SaveFindingResponse> {
  const res = await authed(
    `/api/jobs/${jobId}/items/${itemId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    "Could not save the finding."
  );
  return res.json();
}

export async function deleteFinding(jobId: string, itemId: string): Promise<void> {
  await authed(`/api/jobs/${jobId}/items/${itemId}`, { method: "DELETE" }, "Could not delete the finding.");
}

export async function presign(body: PresignRequest): Promise<PresignResponse> {
  const res = await authed(
    "/api/media/presign",
    { method: "POST", body: JSON.stringify(body) },
    "Could not get an upload URL."
  );
  return res.json();
}

/** Tell the API the PUT to S3 finished. It checks the object really exists
 * before marking the photo ready. */
export async function confirmMedia(mediaId: string, body: ConfirmMediaRequest): Promise<ConfirmMediaResponse> {
  const res = await authed(
    `/api/media/${mediaId}/confirm`,
    { method: "POST", body: JSON.stringify(body) },
    "The photo didn't finish uploading."
  );
  return res.json();
}

/** Best-effort: the measurement layer wants to know an upload failed, but
 * failing to say so must never mask the real error shown to the mechanic. */
export async function reportUploadFailed(mediaId: string, reason: string): Promise<void> {
  try {
    await authed(`/api/media/${mediaId}/fail`, { method: "POST", body: JSON.stringify({ reason }) });
  } catch {
    /* ignore */
  }
}

export async function deleteMedia(mediaId: string): Promise<void> {
  await authed(`/api/media/${mediaId}`, { method: "DELETE" }, "Could not remove the photo.");
}

/* ---------------- Customer report (no auth — the token is the key) ------- */

/** Deliberately sends no Authorization header. The customer has no account;
 * the token in the URL is the whole credential. */
export async function getCustomerReport(token: string): Promise<CustomerReportResponse> {
  const res = await fetch(`${API_URL}/api/report/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not load this report." }));
    throw new Error(err.message || "Could not load this report.");
  }
  return res.json();
}

export async function submitReportDecision(token: string, body: ApproveRequest): Promise<ApproveResponse> {
  const res = await fetch(`${API_URL}/api/report/${encodeURIComponent(token)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not save your decision." }));
    throw new Error(err.message || "Could not save your decision.");
  }
  return res.json();
}

/** POST /api/jobs/:id/report — mechanic side. The response carries the raw
 * token once and only once; there's no way to read it back later. */
export async function sendReport(jobId: string, itemIds?: string[]): Promise<SendReportResponse> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(itemIds?.length ? { itemIds } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not send the report." }));
    throw new Error(err.message || "Could not send the report.");
  }
  return res.json();
}

/** POST /api/jobs/:id/report/resend — revokes the old link and issues a new
 * one for the same quote, texting it. Like sendReport, the raw link is
 * returned only here. */
export async function resendReport(jobId: string): Promise<SendReportResponse> {
  const res = await authed(`/api/jobs/${jobId}/report/resend`, { method: "POST" }, "Could not send a new link.");
  return res.json();
}

/** XHR rather than fetch, so we get upload progress. */
export function putToS3(url: string, blob: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 returned ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network dropped during upload."));
    xhr.send(blob);
  });
}
