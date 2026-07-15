"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  loading?: boolean;
  children: ReactNode;
};

export function FlareButton({
  variant = "primary",
  loading,
  disabled,
  children,
  className = "",
  ...rest
}: Props) {
  const base =
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-flare-primary text-white hover:bg-flare-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flare-ring"
      : "border border-flare-border-mid bg-white text-flare-ink hover:bg-flare-surface";
  const spinner =
    variant === "primary"
      ? "border-white/30 border-t-white"
      : "border-flare-ink/25 border-t-flare-ink";

  return (
    <button
      type="button"
      className={`${base} ${styles} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <>
          <span
            className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${spinner}`}
          />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
