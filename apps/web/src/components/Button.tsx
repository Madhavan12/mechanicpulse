import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline";
  fullWidth?: boolean;
}

/** Primary (brass fill) / outline (brass border) — see docs/mechanic-pulse-frontend-spec.md */
export function Button({ variant = "primary", fullWidth, className = "", ...props }: ButtonProps) {
  const variants = {
    primary: "bg-brass text-white hover:opacity-90",
    outline: "border border-brass text-brass bg-transparent hover:bg-brass/10",
  };

  return (
    <button
      className={`h-11 rounded-lg px-4 text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
