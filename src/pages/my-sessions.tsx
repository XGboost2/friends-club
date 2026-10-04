import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, CalendarDays, Clock3, CreditCard, Layers3, MapPin, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Eyebrow, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { AttendeesSheet } from "@/components/attendees-sheet";
import { api, type Session } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import { courtsLabel, fmt } from "@/lib/utils";

export default function MySessions() {
  const { player, loading } = usePlayer();
  const { openSignIn } = useClerk();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [leaving, setLeaving] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPlayers, setShowPlayers] = useState<Session | null>(null);

  const load = useCallback(async () => {
    if (!player) { setSessions([]); return; }
    try {
      const res = await api<{ sessions: Session[] }>(`/api/my-sessions`);
      setSessions(res.sessions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your sessions.");
      setSessions([]);
    }
  }, [player?.id]);

  useEffect(() => {
    if (!loading) load();
  }, [loading, load]);

  async function leave() {
    if (!leaving) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${leaving.id}/leave`, { method: "POST" });
      toast.success("You've left the session.");
      setLeaving(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't leave the session.");
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !player) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-5 text-center">
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <CalendarDays size={26} />
        </div>
        <h1 className="font-display text-3xl font-bold">Sign in to see your sessions</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">Your bookings are tied to your account and follow you across devices.</p>
        <Button variant="neon" size="lg" className="mt-6" onClick={() => openSignIn()}>
          Sign in or register
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-8 sm:pt-12 lg:px-12 lg:pt-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>Your lineup</Eyebrow>
          <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-7xl">
            My sessions<span className="text-primary">.</span>
          </h1>
          <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
            {player?.name ? `Hey ${player.name.split(" ")[0]} — here's` : "Here's"} every upcoming game you've voted for. Court numbers appear once an admin assigns them.
          </p>
        </div>
        <Button variant="glass" className="h-11" asChild>
          <Link to="/">
            Browse polls <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CalendarDays size={17} className="text-primary" /> Upcoming
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{sessions?.length ?? "…"}</span>
        </span>
        <span className="text-xs text-muted-foreground">Prague time</span>
      </div>

      {!sessions && (
        <div className="grid min-h-60 place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      )}

      {sessions && sessions.length === 0 && (
        <div className="glass-panel mx-auto max-w-xl rounded-2xl p-8 text-center">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays size={26} />
          </div>
          <h2 className="font-display text-2xl font-bold">No sessions yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Join a poll from the calendar and it will show up here.</p>
          <Button variant="neon" className="mt-6" asChild>
            <Link to="/">Find a game</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AnimatePresence>
          {sessions?.map((s, i) => {
            const courts = courtsLabel(s.courtNumbers);
            return (
              <motion.article key={s.id} layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.06, duration: 0.35 }} className="glass-panel glow-hover rounded-2xl p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-xl border border-primary/30 bg-primary/10 leading-none">
                      <span className="font-display text-2xl font-bold text-primary">{fmt(s.date, "dd")}</span>
                      <span className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">{fmt(s.date, "MMM")}</span>
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold">{fmt(s.date, "EEEE")} rally</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{fmt(s.date, "d MMMM yyyy")}</p>
                    </div>
                  </div>
                  {s.me?.multisport ? (
                    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${s.me.status === "paid" ? "bg-emerald/15 text-emerald" : "bg-primary/10 text-primary"}`}>
                      <CreditCard size={11} /> {s.me.status === "paid" ? "Checked in" : "Multisport"}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pay at venue</span>
                  )}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5 text-sm">
                  <Info icon={<Clock3 size={17} className="text-primary" />} label="Time" value={`${s.startTime}–${s.endTime}`} />
                  <button onClick={() => setShowPlayers(s)} className="text-left transition hover:opacity-80">
                    <Info icon={<Users size={17} className="text-cyan" />} label="Players" value={`${s.total} of ${s.capacity} going`} />
                  </button>
                  <Info icon={<Layers3 size={17} className="text-primary" />} label="Court" value={courts ?? <span className="text-amber">To be assigned</span>} />
                  <Info icon={<MapPin size={17} className="text-violet" />} label="Venue" value={s.venue} />
                </div>
                {(s.me?.guests.length ?? 0) > 0 && (
                  <p className="mt-4 flex items-center gap-2 rounded-lg bg-soft px-3 py-2 text-xs text-muted-foreground">
                    <UserPlus size={14} className="text-cyan" /> Guests: {s.me?.guests.join(", ")}
                  </p>
                )}
                {s.me?.isMine && (
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                    {!s.me.canLeave && (
                      <span className="text-xs text-muted-foreground">Cancellation locks 25h before start</span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setLeaving(s)} disabled={!s.me.canLeave}>
                      Can't make it? Leave
                    </Button>
                  </div>
                )}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>

      <Sheet open={!!leaving} onClose={() => setLeaving(null)} title="Leave this session?" subtitle={leaving ? `${fmt(leaving.date, "EEEE, d MMMM")} · ${leaving.venue}` : null}>
        <p className="pt-3 text-sm leading-relaxed text-muted-foreground">Your spot{leaving?.me?.guests.length ? " and your guests' spots" : ""} will open up for others. You can join again later if there's still room.</p>
        <div className="grid gap-3 pb-4 pt-6 sm:grid-cols-2">
          <Button variant="glass" size="lg" onClick={() => setLeaving(null)}>
            Keep my spot
          </Button>
          <Button variant="destructive" size="lg" onClick={leave} disabled={busy}>
            {busy && <Spinner />} Leave session
          </Button>
        </div>
      </Sheet>
      <AttendeesSheet session={showPlayers} onClose={() => setShowPlayers(null)} />
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate">{value}</span>
      </span>
    </div>
  );
}
