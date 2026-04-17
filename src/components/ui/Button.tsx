"use client";

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  primary:
    "bg-accent text-ink-950 hover:bg-amber-400 active:bg-amber-500 border border-accent-dark",
  secondary:
    "bg-ink-800 text-ink-50 hover:bg-ink-700 active:bg-ink-600 border border-ink-700",
  ghost:
    "bg-transparent text-ink-100 hover:bg-ink-800 border border-transparent",
  danger:
    "bg-loss text-ink-50 hover:bg-red-700 active:bg-red-800 border border-loss-dark",
};

const sizeClass: Record<Size, string> = {
  xs: "text-[11px] px-2 py-1",
  sm: "text-xs px-3 py-2",
  md: "text-sm px-4 py-2.5",
  lg: "text-base px-5 py-3",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
    />
  );
}
