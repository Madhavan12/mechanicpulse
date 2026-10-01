import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

/** Label above a 44px bordered input — see docs/mechanic-pulse-frontend-spec.md */
export function TextField({ label, id, className = "", ...props }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        className={`h-11 rounded-lg border border-border bg-white px-3 text-sm text-ink placeholder:text-border focus:outline-none focus:ring-2 focus:ring-brass/40 ${className}`}
        {...props}
      />
    </div>
  );
}
