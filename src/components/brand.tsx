import { Link } from "react-router-dom";

export function ShuttleMark({ className = "shuttle-mark size-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M12 21 3 5l5 2 7 11M16 18 12 3l4 4 2 11M20 19l1-16 4 4-2 14M24 21l5-15 2 5-4 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 20c2-2 10-2 14 1l-2 6c-2 3-7 4-10 1l-3-4 1-4Z" fill="currentColor" />
      <path d="M11 22c3-1 9-1 13 1" stroke="var(--primary-foreground)" strokeWidth="1.4" />
    </svg>
  );
}

export function ShuttleLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="inline-flex shrink-0 items-center gap-3" aria-label="Friends Club home">
      <span className="grid size-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[inset_0_1px_0_var(--border)]">
        <ShuttleMark />
      </span>
      {!compact && (
        <span className="font-display text-lg font-bold leading-none text-foreground">
          friends<span className="text-primary">club</span>
          <span className="ml-0.5 text-primary">.</span>
        </span>
      )}
    </Link>
  );
}

export function AmbientBackground() {
  return (
    <div className="ambient-stage" aria-hidden="true">
      <div className="aurora aurora-lime" />
      <div className="aurora aurora-cyan" />
      <div className="aurora aurora-violet" />
      <div className="court-grid" />
      <div className="court-lines" />
    </div>
  );
}
