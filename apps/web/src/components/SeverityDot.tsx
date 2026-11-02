import type { Severity } from "../../../../packages/shared/types";

const STYLE: Record<Severity, string> = {
  red: "bg-red",
  amber: "bg-amber",
  green: "bg-green",
};

const LABEL: Record<Severity, string> = {
  red: "Needs attention",
  amber: "Monitor",
  green: "Good",
};

/** The coloured status dot on the Customer Report's inspection results.
 * Carries a text label for screen readers — colour alone isn't accessible,
 * and this is the only thing distinguishing urgent from fine. */
export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STYLE[severity]}`} aria-hidden="true" />
      <span className="sr-only">{LABEL[severity]}:</span>
    </span>
  );
}

export { LABEL as SEVERITY_LABEL };
