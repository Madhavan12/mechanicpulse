import type { KeyboardEvent, ReactNode } from "react";

/** The reusable rounded-card list item — a white card (bg-card, 14px
 * radius) floating on the cream section background. See
 * docs/mechanic-pulse-frontend-spec.md section 3.
 *
 * Renders as a div with button semantics, not a real <button>, because
 * list bars (e.g. Job List) contain their own nested interactive buttons
 * ("Open") — a <button> can't contain another <button>, that's invalid
 * HTML and breaks hydration. */
export function ListBar({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (!onClick) {
    return <div className="bg-card rounded-[14px] p-4">{children}</div>;
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="w-full text-left bg-card rounded-[14px] p-4 cursor-pointer"
    >
      {children}
    </div>
  );
}
