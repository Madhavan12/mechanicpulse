"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import type { JobDetail, LatestReport, SendReportResponse, SmsStatus } from "../../../../packages/shared/types";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

const REPORT: Record<LatestReport["state"], string> = {
  open: "Waiting for the customer",
  decided: "Customer has responded",
  expired: "Link expired",
  revoked: "Link replaced",
};

function textLine(sms: SmsStatus | null, optedOut: boolean): { label: string; bad: boolean } {
  if (sms === "delivered") return { label: "Text delivered", bad: false };
  if (sms === "sent" || sms === "queued") return { label: "Text sent", bad: false };
  if (sms === "failed" || sms === "undelivered") return { label: "Text failed", bad: true };
  return { label: optedOut ? "Not texted — customer opted out" : "Not texted", bad: true };
}

/** Where the report stands once it's out, and the way to get a new link to
 * the customer if the text didn't land. Resending revokes the old link, so
 * it asks first. Not offered after the customer has responded. */
export function ReportStatusCard({
  job,
  onResend,
}: {
  job: JobDetail;
  onResend: () => Promise<SendReportResponse>;
}) {
  const report = job.latestReport;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!report) return null;

  const text = textLine(report.sms, job.customerOptedOut);
  const canResend = report.state !== "decided";

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onResend();
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a new link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Report status" className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ink">
          Report sent {fmt(report.sentAt)} · {REPORT[report.state]}
        </p>
        <p className={`text-sm ${text.bad ? "text-red" : "text-brass"}`} data-testid="text-status">{text.label}</p>
        {report.state === "open" && <p className="text-xs text-brass">Link expires {fmt(report.expiresAt)}.</p>}
      </div>

      {canResend && !confirming && (
        <Button variant="outline" onClick={() => setConfirming(true)} className="self-start">
          Send a new link
        </Button>
      )}

      {confirming && (
        <div role="group" aria-label="Send a new link" className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-sm text-ink">
            {job.customerName.split(" ")[0]} will get a new text with a new link. <strong>The old link will stop working.</strong> The
            findings stay exactly as they were.
          </p>
          {error && <p role="alert" className="text-sm text-red">{error}</p>}
          <div className="flex gap-3">
            <Button disabled={busy} onClick={go}>{busy ? "Sending…" : "Send new link"}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
