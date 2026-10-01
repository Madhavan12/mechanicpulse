"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredMechanic, getToken, clearSession, listJobs } from "@/lib/api";
import type { JobListItem } from "../../../../../packages/shared/types";
import { AppHeader } from "@/components/AppHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatusPill } from "@/components/StatusPill";
import { ListBar } from "@/components/ListBar";
import { Button } from "@/components/Button";

type DesktopFilter = "all" | "not_started" | "in_progress" | "completed";
type MobileFilter = "all" | "active" | "completed";

export default function JobsPage() {
  const router = useRouter();
  const [mechanicName, setMechanicName] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DesktopFilter>("all");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setMechanicName(getStoredMechanic()?.name ?? null);
    listJobs()
      .then((res) => setJobs(res.jobs))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load jobs."));
  }, [router]);

  if (!mechanicName) return null;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  const mobileFilter: MobileFilter = filter === "not_started" || filter === "in_progress" ? "active" : filter;

  const filtered = (jobs ?? []).filter((job) => {
    if (filter === "all") return true;
    return job.displayStatus === filter;
  });

  return (
    <main className="min-h-screen bg-surface">
      <AppHeader mechanicName={mechanicName} onLogout={logout} />

      <div className="px-5 py-6 lg:px-12 lg:py-8 flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-xl font-bold text-ink">Today&apos;s Jobs ({jobs?.length ?? 0})</h1>

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden lg:block">
              <SegmentedControl
                value={filter}
                onChange={setFilter}
                options={[
                  { label: "All", value: "all" },
                  { label: "Not Started", value: "not_started" },
                  { label: "In Progress", value: "in_progress" },
                  { label: "Completed", value: "completed" },
                ]}
              />
            </div>
            <div className="lg:hidden">
              <SegmentedControl
                value={mobileFilter}
                onChange={(v) => setFilter(v === "active" ? "all" : v)}
                options={[
                  { label: "All", value: "all" },
                  { label: "Active", value: "active" },
                  { label: "Completed", value: "completed" },
                ]}
              />
            </div>

            {/* "Create Job" — not in the original Figma wireframes, added
                per docs/mechanic-pulse-frontend-spec.md update. 44px tap
                target (h-11 via Button), labelled rather than icon-only. */}
            <Button onClick={() => router.push("/jobs/new")}>+ New Job</Button>
          </div>
        </div>

        {error && <p className="text-sm text-red">{error}</p>}

        <div className="flex flex-col gap-[10px]">
          {filtered.map((job) => {
            const open = () => router.push(`/jobs/${job.id}`);
            const vehicleLabel = [job.vehicleMake, job.vehicleModel].filter(Boolean).join(" ") || job.vehicleRego;

            return (
              <ListBar key={job.id} onClick={open}>
                {/* Mobile: status pill on top, then vehicle name, then customer + Open */}
                <div className="flex flex-col gap-2 lg:hidden">
                  <StatusPill status={job.displayStatus} />
                  <p className="font-semibold text-ink">
                    {vehicleLabel} — {job.vehicleRego}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-brass">{job.customerName}</p>
                    <Button variant="outline" onClick={(e) => { e.stopPropagation(); open(); }}>
                      Open
                    </Button>
                  </div>
                </div>

                {/* Desktop: single-line row, vehicle+customer left, pill+Open right */}
                <div className="hidden lg:flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-ink">
                      {vehicleLabel} — {job.vehicleRego}
                    </p>
                    <p className="text-sm text-brass">{job.customerName}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={job.displayStatus} />
                    <Button variant="outline" onClick={(e) => { e.stopPropagation(); open(); }}>
                      Open
                    </Button>
                  </div>
                </div>
              </ListBar>
            );
          })}

          {jobs !== null && filtered.length === 0 && (
            <p className="text-sm text-brass text-center py-10">No jobs match this filter.</p>
          )}
        </div>
      </div>
    </main>
  );
}
