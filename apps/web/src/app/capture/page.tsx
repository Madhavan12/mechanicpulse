"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredMechanic, getToken, presign, putToS3, clearSession } from "@/lib/api";
import { compressImage } from "@/lib/compress";
import { Button } from "@/components/Button";

type Status = "idle" | "compressing" | "requesting" | "uploading" | "done" | "error";

/** Simple dev-facing analytics — console + on-page, no analytics service.
 * Answers "how much did compression actually save" for whoever's testing. */
interface CompressionStats {
  originalBytes: number;
  compressedBytes: number;
  savedPercent: number;
  width: number;
  height: number;
  format: string;
  compressMs: number;
  uploadMs: number;
}

export default function CapturePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mechanicName, setMechanicName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<CompressionStats | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setMechanicName(getStoredMechanic()?.name ?? null);
  }, [router]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setProgress(0);
    setStatus("compressing");
    setMessage("Compressing…");
    setStats(null);

    const originalBytes = file.size;

    try {
      const compressStart = performance.now();
      const { blob, width, height } = await compressImage(file);
      const compressMs = Math.round(performance.now() - compressStart);
      setPreviewUrl(URL.createObjectURL(blob));

      setStatus("requesting");
      setMessage("Asking for an upload URL…");
      const { uploadUrl, storageKey } = await presign({ contentType: blob.type, bytes: blob.size });

      setStatus("uploading");
      setMessage("Uploading…");
      const uploadStart = performance.now();
      await putToS3(uploadUrl, blob, setProgress);
      const uploadMs = Math.round(performance.now() - uploadStart);

      const compressionStats: CompressionStats = {
        originalBytes,
        compressedBytes: blob.size,
        savedPercent: Math.round((1 - blob.size / originalBytes) * 100),
        width,
        height,
        format: blob.type,
        compressMs,
        uploadMs,
      };
      setStats(compressionStats);
      // eslint-disable-next-line no-console
      console.log("[upload] compression stats", compressionStats);

      setStatus("done");
      setMessage(`Uploaded (${width}×${height}, ${(blob.size / 1024).toFixed(0)} KB) → ${storageKey}`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function logout() {
    clearSession();
    router.replace("/login");
  }

  if (!mechanicName) return null;

  const messageColor = status === "error" ? "text-red" : status === "done" ? "text-green" : "text-brass";

  return (
    <main className="min-h-screen bg-surface flex flex-col items-center p-5 gap-6">
      <div className="w-full max-w-sm flex items-center justify-between bg-ink rounded-xl px-4 py-3">
        <span className="text-white font-semibold">Hi, {mechanicName}</span>
        <button onClick={logout} className="text-sm text-white/80 underline">
          Log out
        </button>
      </div>

      <label className="w-full max-w-sm text-center rounded-2xl border border-border bg-card py-10 px-4 font-medium text-ink cursor-pointer">
        Take or choose a photo
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChosen}
          className="hidden"
        />
      </label>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Preview" className="w-full max-w-sm rounded-xl border border-border" />
      )}

      {status === "uploading" && (
        <div className="w-full max-w-sm h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-amber transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      {message && (
        <p className={`text-sm max-w-sm text-center ${messageColor}`}>{message}</p>
      )}

      {stats && (
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 text-sm text-ink">
          <p className="font-semibold mb-2">Compression stats (dev only)</p>
          <p>
            {(stats.originalBytes / 1024).toFixed(0)} KB → {(stats.compressedBytes / 1024).toFixed(0)} KB
            {" "}
            <span className={stats.savedPercent >= 0 ? "text-green" : "text-red"}>
              ({stats.savedPercent >= 0 ? "-" : "+"}
              {Math.abs(stats.savedPercent)}%)
            </span>
          </p>
          <p className="text-brass">
            {stats.width}×{stats.height}, {stats.format} · compressed in {stats.compressMs}ms, uploaded in{" "}
            {stats.uploadMs}ms
          </p>
        </div>
      )}

      {status === "done" && (
        <Button variant="outline" onClick={() => router.push("/jobs")}>
          Back to Jobs
        </Button>
      )}
    </main>
  );
}
