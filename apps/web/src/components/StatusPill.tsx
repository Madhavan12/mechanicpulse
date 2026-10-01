import type { JobDisplayStatus } from "../../../../packages/shared/types";

const LABEL: Record<JobDisplayStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};

const STYLE: Record<JobDisplayStatus, string> = {
  not_started: "border border-border text-brass",
  in_progress: "bg-amber text-ink",
  completed: "bg-green text-white",
};

/** amber fill = In Progress, green fill = Completed, outlined = Not Started
 * — see docs/mechanic-pulse-frontend-spec.md */
export function StatusPill({ status }: { status: JobDisplayStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
