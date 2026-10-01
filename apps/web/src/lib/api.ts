import type { LoginRequest, LoginResponse, PresignRequest, PresignResponse, ListJobsResponse } from "../../../../packages/shared/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
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

export async function presign(body: PresignRequest): Promise<PresignResponse> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/media/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Could not get an upload URL." }));
    throw new Error(err.message || "Could not get an upload URL.");
  }
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
