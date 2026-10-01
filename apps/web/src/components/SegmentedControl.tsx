/** Single rounded track, one highlighted active segment — not separate pill
 * buttons. See docs/mechanic-pulse-frontend-spec.md */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-border/50 p-1" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-9 rounded-full px-3 text-sm font-medium transition-colors ${
            value === opt.value ? "bg-ink text-white" : "text-brass"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
