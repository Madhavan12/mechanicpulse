"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getCustomerReport, submitReportDecision } from "@/lib/api";
import { Button } from "@/components/Button";
import { ListBar } from "@/components/ListBar";
import { SeverityDot, SEVERITY_LABEL } from "@/components/SeverityDot";
import type {
  CustomerReportResponse,
  Decision,
  ReportItemView,
  Severity,
} from "../../../../../../packages/shared/types";

/** The customer report. Mobile-only by design (see
 * docs/mechanic-pulse-frontend-spec.md) — opened from an SMS link, no login,
 * no navigation back into the mechanic app.
 *
 * Severity drives what the customer notices first; price drives what they
 * decide. Both have to survive being read one-handed in a driveway. */
export default function CustomerReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [report, setReport] = useState<CustomerReportResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Decision>>({});
  const [signedName, setSignedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCustomerReport(token)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        // A report that's already been decided shows the customer's own
        // answers back to them, read-only.
        const existing: Record<string, Decision> = {};
        for (const item of data.items) {
          if (item.decision) existing[item.inspectionItemId] = item.decision;
        }
        setChoices(existing);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const decided = report?.state === "decided";
  const live = report?.state === "open";

  const allAnswered = useMemo(
    () => !!report && report.items.every((i) => choices[i.inspectionItemId]),
    [report, choices]
  );

  const approvedTotal = useMemo(
    () =>
      (report?.items ?? [])
        .filter((i) => choices[i.inspectionItemId] === "approved")
        .reduce((sum, i) => sum + i.priceCents, 0),
    [report, choices]
  );

  async function onSubmit() {
    if (!report || !allAnswered || !signedName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitReportDecision(token, {
        signedName: signedName.trim(),
        decisions: report.items.map((i) => ({
          itemId: i.inspectionItemId,
          decision: choices[i.inspectionItemId],
        })),
      });
      // Re-fetch rather than patching local state: the server is the only
      // thing that knows the real decided_at, and it may have rejected
      // something we thought was fine.
      setReport(await getCustomerReport(token));
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <DeadEnd title="This link isn't valid" body={loadError} />;
  if (!report) return <Centered>Loading your report…</Centered>;

  if (report.state === "expired") {
    return (
      <DeadEnd
        title="This link has expired"
        body={`Reports stay open for 7 days. Call ${report.workshopName} and they can send you a new one.`}
        phone={report.workshopPhone}
      />
    );
  }
  if (report.state === "revoked") {
    return (
      <DeadEnd
        title="This report was withdrawn"
        body={`${report.workshopName} has taken this quote back. Give them a call and they'll explain.`}
        phone={report.workshopPhone}
      />
    );
  }

  const vehicle = [report.vehicleMake, report.vehicleModel].filter(Boolean).join(" ") || report.vehicleRego;
  const worst = worstSeverity(report.items);
  const urgent = report.items.filter((i) => i.severity === "red").length;

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] pb-44">
      <header className="bg-ink px-5 py-5 text-white">
        <p className="text-xs font-medium tracking-wide opacity-75">{report.workshopName}</p>
        <h1 className="mt-1 text-[22px] leading-tight font-bold">Vehicle Health Report</h1>
        <p className="mt-1 text-[13px] opacity-75">
          {vehicle} · {report.vehicleRego} · {formatDate(report.sentAt)}
        </p>
      </header>

      {decided ? (
        <div className="bg-green px-5 py-4 text-white">
          <p className="text-[15px] font-semibold">Thanks, {report.customerName.split(" ")[0]} — you&apos;re done.</p>
          <p className="mt-0.5 text-[13px] opacity-90">
            Sent back to the workshop on {formatDate(report.decidedAt!)}. Nothing else to do.
          </p>
        </div>
      ) : (
        <div className={`px-5 py-4 text-white ${BANNER[worst]}`}>
          <p className="text-[15px] font-semibold">
            {urgent > 0
              ? `${urgent} item${urgent > 1 ? "s" : ""} need${urgent > 1 ? "" : "s"} your attention`
              : "No urgent problems found"}
          </p>
          <p className="mt-0.5 text-[13px] opacity-90">{breakdown(report.items)}</p>
        </div>
      )}

      <section className="px-5 py-5">
        <h2 className="mb-3 text-[15px] font-semibold">Inspection Results</h2>
        <ul className="flex flex-col gap-2.5">
          {report.items.map((item) => (
            <li key={item.inspectionItemId}>
              <ListBar>
                <div className="flex items-start gap-2">
                  <span className="mt-[7px]">
                    <SeverityDot severity={item.severity} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug font-medium">{item.title}</p>
                    {item.note && <p className="mt-0.5 text-[13px] text-brass">{item.note}</p>}
                    <p className="mt-0.5 text-[11px] text-brass/70">{SEVERITY_LABEL[item.severity]}</p>
                    {item.photoUrls.length > 0 && <Photos urls={item.photoUrls} title={item.title} />}
                  </div>
                </div>
              </ListBar>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 pb-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Recommended Work &amp; Estimate</h2>
          {live && !allAnswered && (
            <button
              type="button"
              onClick={() =>
                setChoices(Object.fromEntries(report.items.map((i) => [i.inspectionItemId, "approved" as Decision])))
              }
              className="text-[13px] font-medium text-brass underline underline-offset-2"
            >
              Approve all
            </button>
          )}
        </div>

        {/* Receipt-style flat dividers, not list bars — these rows sum to a
            total rather than being independent items. Spec section 3. */}
        <div className="divide-y divide-border">
          {report.items.map((item) => (
            <div key={item.inspectionItemId} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px]">{item.title}</span>
                <span className="shrink-0 text-[14px] font-medium tabular-nums">{money(item.priceCents)}</span>
              </div>
              <div className="mt-2">
                {decided ? (
                  <DecisionBadge decision={choices[item.inspectionItemId]} />
                ) : (
                  <DecisionToggle
                    value={choices[item.inspectionItemId]}
                    onChange={(d) => setChoices((prev) => ({ ...prev, [item.inspectionItemId]: d }))}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t-2 border-ink pt-3">
          <span className="text-[15px] font-semibold">{decided ? "Approved total" : "If you approve everything"}</span>
          <span className="text-[17px] font-bold tabular-nums">
            {money(decided ? approvedTotal : report.totalCents)}
          </span>
        </div>
        {!decided && allAnswered && approvedTotal !== report.totalCents && (
          <p className="mt-1 text-right text-[13px] text-brass">Your selection: {money(approvedTotal)}</p>
        )}
      </section>

      {live && (
        <section className="px-5 pb-6">
          <label htmlFor="signed-name" className="block text-[13px] font-medium">
            Your name
          </label>
          <input
            id="signed-name"
            type="text"
            autoComplete="name"
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder="Type your name to confirm"
            className="mt-1.5 h-11 w-full rounded-lg border border-border bg-card px-3 text-[15px] outline-none focus:border-brass"
          />
          <p className="mt-1.5 text-[11px] text-brass/80">
            This stands in for your signature. The workshop keeps a record of what you chose.
          </p>
        </section>
      )}

      {submitError && (
        <p role="alert" className="mx-5 mb-4 rounded-lg bg-red px-3 py-2 text-[13px] text-white">
          {submitError}
        </p>
      )}

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-[430px] border-t border-border bg-card px-5 pt-3 pb-[34px]">
        {live ? (
          <>
            <Button
              fullWidth
              disabled={!allAnswered || !signedName.trim() || submitting}
              onClick={onSubmit}
            >
              {submitting ? "Sending…" : allAnswered ? "Send my decision" : "Choose for every item"}
            </Button>
            <CallButton phone={report.workshopPhone} name={report.workshopName} />
          </>
        ) : (
          <CallButton phone={report.workshopPhone} name={report.workshopName} />
        )}
      </footer>
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

const BANNER: Record<Severity, string> = {
  red: "bg-red",
  amber: "bg-amber text-ink",
  green: "bg-green",
};

function DecisionToggle({ value, onChange }: { value?: Decision; onChange: (d: Decision) => void }) {
  return (
    <div className="flex gap-2" role="group">
      {(["approved", "declined"] as const).map((d) => {
        const active = value === d;
        const activeStyle = d === "approved" ? "bg-green text-white border-green" : "bg-red text-white border-red";
        return (
          <button
            key={d}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(d)}
            className={`h-11 flex-1 rounded-lg border text-[14px] font-medium ${
              active ? activeStyle : "border-border bg-card text-brass"
            }`}
          >
            {d === "approved" ? "Approve" : "Decline"}
          </button>
        );
      })}
    </div>
  );
}

function DecisionBadge({ decision }: { decision?: Decision }) {
  if (!decision) return null;
  const approved = decision === "approved";
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        approved ? "bg-green text-white" : "bg-red text-white"
      }`}
    >
      {approved ? "Approved" : "Declined"}
    </span>
  );
}

/** Photos are presigned and expire. If one has gone stale, drop it rather
 * than leaving a broken-image icon in the middle of a quote. */
function Photos({ urls, title }: { urls: string[]; title: string }) {
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const usable = urls.filter((_, i) => !broken[i]);
  if (usable.length === 0) return null;

  return (
    <div className="mt-2.5 flex gap-2 overflow-x-auto">
      {urls.map((url, i) =>
        broken[i] ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL, not a known host for next/image
          <img
            key={url}
            src={url}
            alt={`${title} — photo ${i + 1}`}
            loading="lazy"
            onError={() => setBroken((prev) => ({ ...prev, [i]: true }))}
            className="h-28 w-28 shrink-0 rounded-lg border border-border object-cover"
          />
        )
      )}
    </div>
  );
}

function CallButton({ phone, name }: { phone: string | null; name: string }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} className="mt-2 block">
      <Button variant="outline" fullWidth tabIndex={-1}>
        Call {name}
      </Button>
    </a>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] items-center justify-center px-5 text-center text-[15px] text-brass">
      {children}
    </div>
  );
}

function DeadEnd({ title, body, phone }: { title: string; body: string; phone?: string | null }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center px-5 text-center">
      <h1 className="text-[22px] font-bold">{title}</h1>
      <p className="mt-2 text-[15px] text-brass">{body}</p>
      {phone && (
        <a href={`tel:${phone}`} className="mt-5 w-full">
          <Button variant="outline" fullWidth tabIndex={-1}>
            Call the workshop
          </Button>
        </a>
      )}
    </div>
  );
}

/* ------------------------------- helpers ------------------------------- */

const SEVERITY_RANK: Record<Severity, number> = { green: 0, amber: 1, red: 2 };

function worstSeverity(items: ReportItemView[]): Severity {
  return items.reduce<Severity>(
    (worst, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[worst] ? item.severity : worst),
    "green"
  );
}

function breakdown(items: ReportItemView[]): string {
  const counts = { red: 0, amber: 0, green: 0 };
  for (const item of items) counts[item.severity]++;
  const parts: string[] = [];
  if (counts.amber) parts.push(`${counts.amber} to keep an eye on`);
  if (counts.green) parts.push(`${counts.green} looking good`);
  return parts.length ? parts.join(", ") : `${items.length} item${items.length > 1 ? "s" : ""} to review`;
}

/** Cents to dollars. Integer cents in, never a float — see the data model. */
function money(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
