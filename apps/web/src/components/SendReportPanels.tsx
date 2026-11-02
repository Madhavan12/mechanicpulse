"use client";

import { useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/Button";
import type { JobDetail, SendReportResponse } from "../../../../packages/shared/types";

function Overlay({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 lg:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[92vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-5 pb-[34px] lg:max-w-[480px] lg:rounded-2xl lg:pb-5"
      >
        {children}
      </div>
    </div>
  );
}

/** The two steps around sending: "are you sure" before, and the one-time
 * link after. Sending freezes the findings, so it gets a confirm; the link
 * is never retrievable again, so it gets a prominent Copy and a way to text
 * it straight from the mechanic's own phone (SMS delivery isn't built yet). */
export function SendReportPanels({
  job,
  confirming,
  sending,
  error,
  sent,
  onConfirm,
  onCancel,
  onDone,
}: {
  job: JobDetail;
  confirming: boolean;
  sending: boolean;
  error: string | null;
  sent: SendReportResponse | null;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  if (sent) {
    const firstName = job.customerName.split(" ")[0];
    const sms = `sms:${job.customerMobile}?&body=${encodeURIComponent(
      `Hi ${firstName}, here's the health report for your ${job.vehicleRego}: ${sent.reportUrl}`
    )}`;

    async function copy() {
      try {
        await navigator.clipboard.writeText(sent!.reportUrl);
      } catch {
        // Older/locked-down browsers: select the text so a long-press copy works.
        linkRef.current?.select();
        document.execCommand?.("copy");
      }
      setCopied(true);
    }

    return (
      <Overlay label="Report sent">
        <h2 className="text-lg font-bold text-ink">Report ready to send</h2>
        <p className="text-sm text-ink">
          Send this link to {job.customerName}. <strong>It won&apos;t be shown again</strong>, so copy it now. It expires on{" "}
          {new Date(sent.expiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
        <input
          ref={linkRef}
          readOnly
          value={sent.reportUrl}
          aria-label="Report link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 rounded-lg border border-border bg-white px-3 text-sm text-ink"
        />
        <div className="flex flex-col gap-3">
          <Button fullWidth onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</Button>
          <a
            href={sms}
            className="flex h-11 items-center justify-center rounded-lg border border-brass text-sm font-medium text-brass hover:bg-brass/10"
          >
            Text it to {firstName}
          </a>
          <Button variant="outline" fullWidth onClick={onDone}>Done</Button>
        </div>
      </Overlay>
    );
  }

  if (confirming) {
    const n = job.items.length;
    return (
      <Overlay label="Send report">
        <h2 className="text-lg font-bold text-ink">Send this report?</h2>
        <p className="text-sm text-ink">
          {n} finding{n === 1 ? "" : "s"}, {formatCents(job.totalCents)} total, for {job.customerName}. After you send it, the
          findings can&apos;t be changed.
        </p>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex flex-col gap-3">
          <Button fullWidth disabled={sending} onClick={onConfirm}>{sending ? "Sending…" : "Send Report"}</Button>
          <Button variant="outline" fullWidth disabled={sending} onClick={onCancel}>Cancel</Button>
        </div>
      </Overlay>
    );
  }

  return null;
}
