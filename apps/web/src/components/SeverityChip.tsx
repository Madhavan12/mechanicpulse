import type { Severity } from "../../../../packages/shared/types";

/** Mechanic-facing wording for the three severities: green = Good, amber =
 * Monitor, red = Urgent (docs/mechanic-pulse-frontend-spec.md, Active Job).
 * The customer page uses its own wording — see SeverityDot. */
export const SEVERITY_CHIP_LABEL: Record<Severity, string> = {
  green: "Good",
  amber: "Monitor",
  red: "Urgent",
};

const STYLE: Record<Severity, string> = {
  green: "bg-green text-white",
  amber: "bg-amber text-ink",
  red: "bg-red text-white",
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${STYLE[severity]}`}>
      {SEVERITY_CHIP_LABEL[severity]}
    </span>
  );
}
