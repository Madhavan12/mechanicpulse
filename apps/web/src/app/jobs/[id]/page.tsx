"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, clearSession, getJob, getStoredMechanic, getToken, resendReport, sendReport } from "@/lib/api";
import { formatCents } from "@/lib/money";
import type { Finding, JobDetail, SendReportResponse } from "../../../../../../packages/shared/types";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { FindingForm } from "@/components/FindingForm";
import { ReportStatusCard } from "@/components/ReportStatusCard";
import { SendReportPanels } from "@/components/SendReportPanels";
import { ListBar } from "@/components/ListBar";
import { SeverityChip } from "@/components/SeverityChip";
import { StatusPill } from "@/components/StatusPill";

/** `adding` = the empty form; a Finding = editing that one; null = closed. */
type Editing = "adding" | Finding | null;

export default function ActiveJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [mechanicName, setMechanicName] = useState<string | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** The raw link, held only in memory: the API never returns it again. */
  const [sent, setSent] = useState<SendReportResponse | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setMechanicName(getStoredMechanic()?.name ?? null);
    getJob(id)
      .then(setJob)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError({
          message: err instanceof Error ? err.message : "Could not load this job.",
          notFound: err instanceof ApiError && err.status === 404,
        });
      });
  }, [id, router]);

  const close = useCallback(() => setEditing(null), []);

  if (!mechanicName) return null;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  // The list and total are derived from `items`, so they can never disagree.
  function withItems(job: JobDetail, items: Finding[]): JobDetail {
    return {
      ...job,
      items,
      totalCents: items.reduce((sum, i) => sum + i.priceCents, 0),
      displayStatus: job.status !== "open" ? "completed" : items.length > 0 ? "in_progress" : "not_started",
    };
  }

  /** Keeps the list in step with the form, which stays open while photos upload. */
  function onChanged(item: Finding) {
    setJob((j) => {
      if (!j) return j;
      const exists = j.items.some((i) => i.id === item.id);
      const items = exists ? j.items.map((i) => (i.id === item.id ? item : i)) : [...j.items, item];
      return withItems(j, items);
    });
  }

  function onDeleted(itemId: string) {
    setJob((j) => (j ? withItems(j, j.items.filter((i) => i.id !== itemId)) : j));
    setEditing(null);
  }

  async function onSend() {
    if (!job || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await sendReport(job.id);
      setSent(result);
      setConfirmingSend(false);
      // The job is now read-only; reflect that straight away, then pull the
      // report status for the card behind the dialog.
      setJob((j) => (j ? { ...j, status: "sent", displayStatus: "completed" } : j));
      getJob(job.id).then(setJob).catch(() => {});
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setSending(false);
    }
  }

  /** A new link was issued: show it (once), and refresh the card behind it. */
  async function onResend() {
    const result = await resendReport(id);
    setSent(result);
    getJob(id).then(setJob).catch(() => {});
    return result;
  }

  const header = <AppHeader mechanicName={mechanicName} onBack={() => router.push("/jobs")} onLogout={logout} />;

  if (error) {
    return (
      <main className="min-h-screen bg-surface">
        {header}
        <div className="flex flex-col items-start gap-4 px-5 py-8 lg:px-12">
          <h1 className="text-xl font-bold text-ink">{error.notFound ? "Job not found" : "Couldn't load this job"}</h1>
          <p role="alert" className="text-sm text-brass">{error.notFound ? "It may have been removed, or it isn't in your workshop." : error.message}</p>
          <Link href="/jobs" className="text-sm font-medium text-brass underline">Back to Jobs</Link>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen bg-surface">
        {header}
        <p className="px-5 py-8 text-sm text-brass lg:px-12">Loading…</p>
      </main>
    );
  }

  const open = job.status === "open";
  const vehicle = [job.vehicleMake, job.vehicleModel].filter(Boolean).join(" ") || job.vehicleRego;
  const priced = job.items.filter((i) => i.priceCents > 0);

  return (
    <main className="min-h-screen bg-surface">
      {header}

      <div className={`flex flex-col gap-5 px-5 py-6 lg:px-12 lg:py-8 ${open ? "pb-32" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">{vehicle} — {job.vehicleRego}</h1>
            <p className="text-sm text-brass">
              {job.customerName}
              {job.odometerKm !== null && ` · ${job.odometerKm.toLocaleString("en-AU")} km`}
            </p>
          </div>
          <StatusPill status={job.displayStatus} />
        </div>

        {!open && (
          <p role="status" className="rounded-[14px] border border-border bg-card p-4 text-sm text-ink">
            This report has been sent to the customer, so the findings can no longer be changed.
          </p>
        )}

        {!open && <ReportStatusCard job={job} onResend={onResend} />}

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <section aria-label="Findings" className="flex flex-col gap-[10px] lg:w-[65%]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Findings ({job.items.length})</h2>
              {open && <Button onClick={() => setEditing("adding")}>+ Add Finding</Button>}
            </div>

            {job.items.length === 0 && (
              <p className="py-10 text-center text-sm text-brass">No findings yet — add the first one.</p>
            )}

            {job.items.map((item) => (
              <ListBar key={item.id} onClick={open ? () => setEditing(item) : undefined}>
                <div className="flex items-start justify-between gap-3">
                  {item.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photos[0].url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{item.title}</p>
                    {item.note && <p className="truncate text-sm text-brass">{item.note}</p>}
                    {item.photos.length > 0 && (
                      <p className="text-xs text-brass">{item.photos.length} photo{item.photos.length === 1 ? "" : "s"}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <SeverityChip severity={item.severity} />
                    <span className="text-sm font-medium text-ink">{formatCents(item.priceCents)}</span>
                  </div>
                </div>
              </ListBar>
            ))}
          </section>

          <aside aria-label="Estimate" className="lg:w-[35%]">
            <div className="rounded-[14px] bg-card p-4">
              <h2 className="mb-3 text-base font-semibold text-ink">Estimate</h2>
              {priced.length === 0 ? (
                <p className="text-sm text-brass">Nothing priced yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {priced.map((i) => (
                    <li key={i.id} className="flex justify-between gap-3 py-2 text-sm text-ink">
                      <span>{i.title}</span>
                      <span>{formatCents(i.priceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex justify-between border-t border-ink pt-3 font-bold text-ink">
                <span>Total</span>
                <span data-testid="estimate-total">{formatCents(job.totalCents)}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {open && (
        <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-5 pb-[34px] pt-3 lg:px-12 lg:pb-4">
          <Button fullWidth disabled={job.items.length === 0} onClick={() => setConfirmingSend(true)} className="lg:mx-auto lg:block lg:max-w-[480px]">
            Send Report to Customer
          </Button>
          {job.items.length === 0 && (
            <p className="mt-2 text-center text-xs text-brass">Add at least one finding to send a report.</p>
          )}
        </footer>
      )}

      <SendReportPanels
        job={job}
        confirming={confirmingSend}
        sending={sending}
        error={sendError}
        sent={sent}
        onConfirm={onSend}
        onCancel={() => { setConfirmingSend(false); setSendError(null); }}
        onDone={() => setSent(null)}
      />

      {editing && (
        <FindingForm
          jobId={job.id}
          finding={editing === "adding" ? undefined : editing}
          onChanged={onChanged}
          onDeleted={onDeleted}
          onClose={close}
        />
      )}
    </main>
  );
}
