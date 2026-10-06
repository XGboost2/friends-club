import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40", checked ? "border-primary bg-primary" : "border-border bg-soft")}>
      <span className={cn("absolute top-0.5 size-5.5 rounded-full shadow transition-all", checked ? "left-[calc(100%-1.5rem)] bg-primary-foreground" : "left-0.5 bg-muted-foreground")} style={{ width: 22, height: 22 }} />
    </button>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-primary", className)}>
      <span className="h-px w-6 bg-primary" /> {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Avatar({ name, index = 0, className }: { name: string; index?: number; className?: string }) {
  const palette = ["bg-accent text-accent-foreground", "bg-violet/25 text-foreground", "bg-cyan/20 text-cyan", "bg-primary/20 text-primary", "bg-amber/20 text-amber"];
  const letters = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <span title={name} className={cn("grid size-8 shrink-0 place-items-center rounded-full border-2 border-background text-[10px] font-bold", palette[index % palette.length], className)}>
      {letters}
    </span>
  );
}
