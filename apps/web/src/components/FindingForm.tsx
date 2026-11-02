"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  addFinding,
  ApiError,
  confirmMedia,
  deleteFinding,
  deleteMedia,
  FieldValidationError,
  presign,
  putToS3,
  reportUploadFailed,
  updateFinding,
} from "@/lib/api";
import { compressImage } from "@/lib/compress";
import { centsToDollarsInput, parseDollars } from "@/lib/money";
import { SEVERITY_CHIP_LABEL } from "@/components/SeverityChip";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { MAX_PHOTOS_PER_FINDING } from "@/lib/photoLimit";
import type { Finding, Severity } from "../../../../packages/shared/types";

type Errors = Partial<Record<"title" | "severity" | "priceCents" | "note", string>>;

/** A photo that is on its way to S3 (or didn't make it). Finished photos
 * live on the finding itself, as presigned URLs from the API. */
interface Upload {
  key: string;
  preview: string;
  blob: Blob;
  width: number;
  height: number;
  state: "uploading" | "failed";
  progress: number;
  error?: string;
}

const SEVERITIES: Severity[] = ["green", "amber", "red"];
const SELECTED: Record<Severity, string> = {
  green: "bg-green text-white border-green",
  amber: "bg-amber text-ink border-amber",
  red: "bg-red text-white border-red",
};

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && (err.code === "photo_limit" || err.code === "job_locked")) return err.message;
  return err instanceof Error ? err.message : "Upload failed.";
}

/** Add / edit a finding, including its photos. A bottom sheet on mobile, a
 * centred card on desktop. `finding` set = editing (and Delete is offered).
 *
 * Photos need a saved finding to attach to, so choosing one on a brand-new
 * finding saves the finding first; from then on the form is editing it. That
 * is why `onChanged` exists apart from `onClose`: the page's list must follow
 * every save, even while the form stays open. */
export function FindingForm({
  jobId,
  finding,
  onChanged,
  onDeleted,
  onClose,
}: {
  jobId: string;
  finding?: Finding;
  onChanged: (item: Finding) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<Finding | undefined>(finding);
  const [title, setTitle] = useState(finding?.title ?? "");
  const [severity, setSeverity] = useState<Severity | null>(finding?.severity ?? null);
  const [price, setPrice] = useState(finding ? centsToDollarsInput(finding.priceCents) : "");
  const [note, setNote] = useState(finding?.note ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const uploading = uploads.some((u) => u.state === "uploading");
  const locked = busy || uploading;
  const photos = saved?.photos ?? [];
  const slotsUsed = photos.length + uploads.length;
  const atLimit = slotsUsed >= MAX_PHOTOS_PER_FINDING;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  function validate(): { body: { title: string; severity: Severity; priceCents: number; note?: string } } | null {
    const found: Errors = {};
    if (!title.trim()) found.title = "Enter a title for this finding.";
    if (!severity) found.severity = "Choose Good, Monitor or Urgent.";
    const priceCents = parseDollars(price);
    if (priceCents === null) found.priceCents = "Enter a price in dollars, like 289 or 289.50. Use 0 for no charge.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !severity || priceCents === null) return null;
    return { body: { title: title.trim(), severity, priceCents, ...(note.trim() && { note: note.trim() }) } };
  }

  function showSaveError(err: unknown) {
    if (err instanceof FieldValidationError) setErrors({ [err.field]: err.message });
    else setFormError(err instanceof Error ? err.message : "Could not save the finding.");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    setFormError(null);
    const valid = validate();
    if (!valid) return;

    setBusy(true);
    try {
      const { item } = saved
        ? await updateFinding(jobId, saved.id, valid.body)
        : await addFinding(jobId, valid.body);
      onChanged(item);
      onClose();
    } catch (err) {
      showSaveError(err);
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!saved || locked) return;
    setBusy(true);
    setFormError(null);
    try {
      await deleteFinding(jobId, saved.id);
      onDeleted(saved.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not delete the finding.");
      setBusy(false);
    }
  }

  /** The finding to attach photos to: the saved one, or — for a brand-new
   * finding — one created now from whatever is in the form. */
  async function ensureSaved(): Promise<Finding | null> {
    if (savedRef.current) return savedRef.current;
    const valid = validate();
    if (!valid) return null;
    try {
      const { item } = await addFinding(jobId, valid.body);
      setSaved(item);
      savedRef.current = item;
      onChanged(item);
      return item;
    } catch (err) {
      showSaveError(err);
      return null;
    }
  }

  function patchUpload(key: string, patch: Partial<Upload>) {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }

  /** presign -> PUT to S3 -> confirm. A failure at any step leaves the
   * thumbnail in place with Retry; the finding itself is never lost. */
  async function run(upload: Upload, itemId: string) {
    patchUpload(upload.key, { state: "uploading", progress: 0, error: undefined });
    let mediaId: string | undefined;
    try {
      const signed = await presign({ inspectionItemId: itemId, contentType: upload.blob.type, bytes: upload.blob.size });
      mediaId = signed.mediaId;
      await putToS3(signed.uploadUrl, upload.blob, (f) => patchUpload(upload.key, { progress: f }));
      const { photo } = await confirmMedia(signed.mediaId!, { width: upload.width, height: upload.height });

      URL.revokeObjectURL(upload.preview);
      setUploads((list) => list.filter((u) => u.key !== upload.key));
      const current = savedRef.current!;
      const next = { ...current, photos: [...current.photos, photo] };
      setSaved(next);
      savedRef.current = next;
      onChanged(next);
    } catch (err) {
      const message = uploadErrorMessage(err);
      if (mediaId) void reportUploadFailed(mediaId, message);
      patchUpload(upload.key, { state: "failed", error: message });
    }
  }

  async function onFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // lets the same photo be chosen again
    if (files.length === 0 || locked) return;
    setPhotoError(null);
    setFormError(null);

    const item = await ensureSaved();
    if (!item) return;

    const room = MAX_PHOTOS_PER_FINDING - (item.photos.length + uploads.length);
    if (files.length > room) {
      setPhotoError(`A finding can have up to ${MAX_PHOTOS_PER_FINDING} photos.`);
    }

    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        const { blob, width, height } = await compressImage(file);
        const upload: Upload = {
          key: crypto.randomUUID(),
          preview: URL.createObjectURL(blob),
          blob,
          width,
          height,
          state: "uploading",
          progress: 0,
        };
        setUploads((list) => [...list, upload]);
        void run(upload, item.id);
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : "Could not read that photo.");
      }
    }
  }

  function dismissUpload(key: string) {
    setUploads((list) => {
      const u = list.find((x) => x.key === key);
      if (u) URL.revokeObjectURL(u.preview);
      return list.filter((x) => x.key !== key);
    });
  }

  async function removePhoto(photoId: string) {
    if (!saved || locked) return;
    setPhotoError(null);
    try {
      await deleteMedia(photoId);
      const next = { ...saved, photos: saved.photos.filter((p) => p.id !== photoId) };
      setSaved(next);
      savedRef.current = next;
      onChanged(next);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not remove the photo.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 lg:items-center" onClick={() => !locked && onClose()}>
      <form
        onSubmit={onSubmit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={finding ? "Edit finding" : "Add finding"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-5 pb-[34px] lg:max-w-[480px] lg:rounded-2xl lg:pb-5"
      >
        <h2 className="text-lg font-bold text-ink">{finding ? "Edit Finding" : "Add Finding"}</h2>

        <TextField label="Title" autoFocus autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
        {errors.title && <p role="alert" className="-mt-3 text-sm text-red">{errors.title}</p>}

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Severity">
          <span className="text-sm font-medium text-ink">Severity</span>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={severity === s}
                onClick={() => setSeverity(s)}
                className={`h-11 rounded-lg border text-sm font-medium ${
                  severity === s ? SELECTED[s] : "border-border bg-white text-ink"
                }`}
              >
                {SEVERITY_CHIP_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {errors.severity && <p role="alert" className="-mt-3 text-sm text-red">{errors.severity}</p>}

        <TextField label="Price ($)" inputMode="decimal" autoComplete="off" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        {errors.priceCents && <p role="alert" className="-mt-3 text-sm text-red">{errors.priceCents}</p>}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="finding-note" className="text-sm font-medium text-ink">Note (optional)</label>
          <textarea
            id="finding-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brass/40"
          />
        </div>
        {errors.note && <p role="alert" className="-mt-3 text-sm text-red">{errors.note}</p>}

        <section aria-label="Photos" className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">
            Photos ({slotsUsed}/{MAX_PHOTOS_PER_FINDING})
          </span>

          {slotsUsed > 0 && (
            <ul className="grid grid-cols-4 gap-2">
              {photos.map((p) => (
                <li key={p.id} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="Finding photo" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    disabled={locked}
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-xs text-white disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}

              {uploads.map((u) => (
                <li key={u.key} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-white" data-state={u.state}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u.preview} alt="Photo being uploaded" className={`h-full w-full object-cover ${u.state === "failed" ? "opacity-40" : "opacity-70"}`} />
                  {u.state === "uploading" ? (
                    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-border" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(u.progress * 100)}>
                      <div className="h-full bg-amber transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1 text-center">
                      <span className="text-[11px] font-semibold text-red">Failed</span>
                      <button type="button" onClick={() => run(u, savedRef.current!.id)} className="rounded bg-brass px-2 py-1 text-[11px] font-medium text-white">
                        Retry
                      </button>
                      <button type="button" aria-label="Dismiss failed photo" onClick={() => dismissUpload(u.key)} className="text-[11px] underline text-ink">
                        Dismiss
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {uploads.filter((u) => u.state === "failed").map((u) => (
            <p key={u.key} role="alert" className="text-sm text-red">{u.error}</p>
          ))}

          <label
            className={`flex h-11 items-center justify-center rounded-lg border border-brass text-sm font-medium text-brass ${
              atLimit || locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-brass/10"
            }`}
          >
            + Add Photo
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={atLimit || locked}
              onChange={onFilesChosen}
              className="hidden"
              data-testid="photo-input"
            />
          </label>
          {atLimit && <p className="text-sm text-brass">That&apos;s the most photos a finding can have.</p>}
          {!saved && <p className="text-sm text-brass">Adding a photo saves the finding first.</p>}
          {photoError && <p role="alert" className="text-sm text-red">{photoError}</p>}
          {uploading && <p role="status" className="text-sm text-brass">Uploading — keep this open until it finishes.</p>}
        </section>

        {formError && <p role="alert" className="text-sm text-red">{formError}</p>}

        <div className="flex flex-col gap-3">
          <Button type="submit" fullWidth disabled={locked}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" fullWidth disabled={locked} onClick={onClose}>
            {saved && !finding ? "Close" : "Cancel"}
          </Button>
        </div>

        {saved &&
          (confirmingDelete ? (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <span className="text-sm text-ink">Delete this finding?</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={onDelete}
                  className="h-11 rounded-lg bg-red px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Yes, delete
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={locked} onClick={() => setConfirmingDelete(true)} className="text-sm font-medium text-red underline">
              Delete finding
            </button>
          ))}
      </form>
    </div>
  );
}
