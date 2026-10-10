import { createPortal } from "react-dom";
import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { CalendarCheck, Clock3, CreditCard, Layers3, MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShuttleMark } from "@/components/brand";
import type { Session } from "@/lib/api";
import { courtsLabel, fmt } from "@/lib/utils";

const lines = [
  "Warm up those wrists — the shuttle won't smash itself.",
  "Hydrate, stretch, and bring your best drop shot.",
  "Your future self is already celebrating that winning rally.",
  "Fast feet, soft hands, big smile. See you on court!",
  "Every champion started by showing up. You just did.",
  "Grip it, rip it, and don't forget to call 'out' loudly.",
  "Tonight's forecast: 100% chance of smashes.",
];

export type Confirmation = { session: Session; guests: string[]; multisport: boolean };

export function ConfirmationCard({ data, onClose }: { data: Confirmation | null; onClose: () => void }) {
  const navigate = useNavigate();
  const line = useMemo(() => lines[Math.floor(Math.random() * lines.length)], [data?.session.id]);

  useEffect(() => {
    if (!data) return;
    const colors = ["#d7141a", "#ffc72c", "#0b0f1a", "#ffffff"];
    const burst = (x: number) => confetti({ particleCount: 90, spread: 75, startVelocity: 48, origin: { x, y: 0.65 }, colors, ticks: 220, scalar: 1.05, zIndex: 80 });
    burst(0.2);
    burst(0.8);
    const t = setTimeout(() => confetti({ particleCount: 140, spread: 120, origin: { y: 0.35 }, colors, zIndex: 80 }), 350);
    return () => clearTimeout(t);
  }, [data]);

  return createPortal(
    <AnimatePresence>
      {data && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ scale: 0.8, y: 40, rotateX: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, rotateX: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 18, stiffness: 200 }}
            style={{ transformPerspective: 1200 }}
            className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-primary/30 bg-popover text-popover-foreground p-7 text-center shadow-[0_0_80px_color-mix(in_oklab,var(--primary)_22%,transparent)] sm:p-9"
          >
            <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-primary/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -right-10 size-60 rounded-full bg-cyan/15 blur-3xl" />
            <motion.div
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", damping: 10, stiffness: 180, delay: 0.15 }}
              className="relative mx-auto grid size-24 place-items-center rounded-[1.75rem] bg-primary text-primary-foreground shadow-[0_0_60px_color-mix(in_oklab,var(--primary)_45%,transparent)]"
            >
              <motion.div animate={{ y: [0, -6, 0], rotate: [-8, 6, -8] }} transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}>
                <ShuttleMark className="size-14 [&_path:last-child]:stroke-primary" />
              </motion.div>
            </motion.div>
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative mt-7 text-xs font-bold uppercase tracking-[.25em] text-primary">
              You're on the list
            </motion.p>
            <motion.h2 id="confirm-title" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }} className="relative mt-3 font-display text-4xl font-bold leading-[1.05] sm:text-[2.6rem]">
              Congratulations!!
              <br />
              <span className="text-glow text-primary">Tie up your shoes 👟</span>
            </motion.h2>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="relative mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {line}
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.58 }} className="relative mt-7 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-soft p-4 text-left text-sm">
              <span className="flex items-center gap-2">
                <CalendarCheck size={16} className="shrink-0 text-primary" />
                {fmt(data.session.date, "EEE, d MMM")}
              </span>
              <span className="flex items-center gap-2">
                <Clock3 size={16} className="shrink-0 text-primary" />
                {data.session.startTime}–{data.session.endTime}
              </span>
              <span className="col-span-2 flex min-w-0 items-center gap-2">
                <MapPin size={16} className="shrink-0 text-violet" />
                <span className="truncate">{data.session.venue}</span>
              </span>
              <span className="flex items-center gap-2">
                <Layers3 size={16} className="shrink-0 text-cyan" />
                {courtsLabel(data.session.courtNumbers) ?? "Court TBA"}
              </span>
              <span className="flex items-center gap-2">
                <Users size={16} className="shrink-0 text-cyan" />
                {data.session.total} going
              </span>
              <span className="col-span-2 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <CreditCard size={15} className="mt-0.5 shrink-0 text-amber" />
                {data.multisport ? "Scan your Multisport card at the entrance to check in." : "You'll pay at the venue."}
                {data.guests.length > 0 && ` Your ${data.guests.length === 1 ? "guest pays" : `${data.guests.length} guests pay`} at the venue.`}
              </span>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="relative mt-6 grid gap-3 sm:grid-cols-2">
              <Button variant="glass" size="lg" onClick={() => { onClose(); navigate("/my-sessions"); }}>
                My sessions
              </Button>
              <Button variant="neon" size="lg" onClick={onClose}>
                Let's go!
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
