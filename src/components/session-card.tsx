import { Check, Clock3, Layers3, MapPin, MoveUpRight, Users, Lock } from "lucide-react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/field";
import type { Session } from "@/lib/api";
import { courtsLabel, fmt } from "@/lib/utils";

export function SessionCard({ session, joined, onJoin, onShowPlayers }: { session: Session; joined: boolean; onJoin: () => void; onShowPlayers: () => void }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(useSpring(y, { stiffness: 170, damping: 22 }), [-0.5, 0.5], [3, -3]);
  const rotateY = useTransform(useSpring(x, { stiffness: 170, damping: 22 }), [-0.5, 0.5], [-3, 3]);
  const left = Math.max(0, session.capacity - session.total);
  const full = left === 0;
  const closed = session.status === "closed";
  const circumference = 2 * Math.PI * 26;
  const courts = courtsLabel(session.courtNumbers);

  function handleMove(event: MouseEvent<HTMLElement>) {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - rect.left) / rect.width - 0.5);
    y.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  return (
    <motion.article
      onMouseMove={handleMove}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
      style={{ rotateX, rotateY, transformPerspective: 1100 }}
      whileHover={{ y: reduced ? 0 : -3 }}
      className="glass-panel glow-hover relative rounded-2xl p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-soft leading-none">
            <span className="font-display text-2xl font-bold">{fmt(session.date, "dd")}</span>
            <span className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">{fmt(session.date, "MMM")}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">{fmt(session.date, "EEEE")} rally</p>
            {joined ? (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald">
                <Check size={11} strokeWidth={3} /> You're in
              </span>
            ) : closed ? (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Lock size={10} /> Voting closed
              </span>
            ) : (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                <span className="size-1.5 rounded-full bg-primary" /> Poll open
              </span>
            )}
          </div>
        </div>
        <div className="relative flex size-16 shrink-0 items-center justify-center">
          <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border)" strokeWidth="4" />
            <motion.circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke={full ? "var(--amber)" : "var(--primary)"}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: circumference * (1 - Math.min(1, session.total / session.capacity)) }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </svg>
          <span className="text-center">
            <strong className={`block font-display text-lg leading-none ${full ? "text-amber" : "text-primary"}`}>{left}</strong>
            <small className="text-[9px] text-muted-foreground">{left === 1 ? "spot left" : "spots left"}</small>
          </span>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-3 border-y border-border py-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Clock3 className="size-4 shrink-0 text-primary" />
          {session.startTime}–{session.endTime}
        </span>
        <span className="flex items-center gap-2">
          <Layers3 className="size-4 shrink-0 text-cyan" />
          {courts ?? <span className="text-amber">Court TBA</span>}
        </span>
        <span className="col-span-2 flex min-w-0 items-center gap-2">
          <MapPin className="size-4 shrink-0 text-violet" />
          <span className="truncate">{session.venue}</span>
        </span>
        {session.notes && <p className="col-span-2 rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed">{session.notes}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onShowPlayers} className="flex min-w-0 items-center gap-2.5 rounded-lg text-left transition hover:opacity-80">
          <div className="flex -space-x-2">
            {session.players.slice(0, 4).map((name, i) => (
              <Avatar key={`${name}-${i}`} name={name} index={i} />
            ))}
            {session.players.length === 0 && <span className="grid size-8 place-items-center rounded-full border-2 border-dashed border-border text-muted-foreground"><Users size={13} /></span>}
          </div>
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{session.total}</strong>/{session.capacity} going
          </span>
        </button>
        {joined ? (
          <Button variant="glass" size="sm" className="h-10 px-4" onClick={onShowPlayers}>
            See who's in
          </Button>
        ) : (
          <Button variant="neon" className="h-10 px-5" disabled={full || closed} onClick={onJoin}>
            {full ? "Full" : closed ? "Closed" : "Join"} {!full && !closed && <MoveUpRight size={15} />}
          </Button>
        )}
      </div>
    </motion.article>
  );
}
