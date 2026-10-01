/** Desktop: logo + shift pill + mechanic name. Mobile (when `onBack` is
 * given, e.g. Active Job): back chevron + shift pill. "Log out" isn't in
 * the Figma wireframes — added here since the app needs a working one. See
 * docs/mechanic-pulse-frontend-spec.md section 4 (headers). */
export function AppHeader({
  mechanicName,
  onBack,
  onLogout,
}: {
  mechanicName: string;
  onBack?: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="bg-ink px-5 py-4 flex items-center justify-between">
      {onBack ? (
        <button onClick={onBack} className="text-white text-sm font-medium">
          ‹ Jobs
        </button>
      ) : (
        <span className="text-white font-bold">Mechanic Pulse</span>
      )}

      <div className="flex items-center gap-3">
        <span className="rounded-full bg-amber text-ink text-xs font-semibold px-3 py-1">On Shift</span>
        <span className="hidden sm:inline text-white text-sm">{mechanicName}</span>
        {onLogout && (
          <button onClick={onLogout} className="text-white/70 text-xs underline">
            Log out
          </button>
        )}
      </div>
    </header>
  );
}
