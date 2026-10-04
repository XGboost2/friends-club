import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, CalendarDays, MapPin, Sparkles } from "lucide-react";
import { useClerk } from "@clerk/react";
import { AboutSection } from "@/components/about-section";
import { MonthCalendar } from "@/components/month-calendar";
import { SessionCard } from "@/components/session-card";
import { JoinSheet } from "@/components/join-sheet";
import { AttendeesSheet } from "@/components/attendees-sheet";
import { ConfirmationCard, type Confirmation } from "@/components/confirmation-card";
import { Button } from "@/components/ui/button";
import { Eyebrow, Spinner } from "@/components/ui/field";
import { api, type Session } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import { fmt, isoDay } from "@/lib/utils";

export default function Home() {
  const { player } = usePlayer();
  const { openSignIn } = useClerk();
  const [today, setToday] = useState(() => isoDay(new Date()));
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [mine, setMine] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [joining, setJoining] = useState<Session | null>(null);
  const [pendingJoin, setPendingJoin] = useState<Session | null>(null);
  const [showPlayers, setShowPlayers] = useState<Session | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, my] = await Promise.all([
        api<{ today: string; sessions: Session[] }>("/api/sessions"),
        player ? api<{ sessions: Session[] }>(`/api/my-sessions`) : Promise.resolve({ sessions: [] as Session[] }),
      ]);
      setToday(all.today);
      setSessions(all.sessions);
      setMine(new Set(my.sessions.map((s) => s.id)));
      setError(null);
      setSelected((cur) => cur ?? all.sessions.find((s) => s.status === "open")?.date ?? all.sessions[0]?.date ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load sessions.");
    }
  }, [player?.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Resume a "join" after the Clerk sign-in modal completes.
  useEffect(() => {
    if (player && pendingJoin) {
      setJoining(pendingJoin);
      setPendingJoin(null);
    }
  }, [player, pendingJoin]);

  const marked = useMemo(() => {
    const map = new Map<string, { voted: boolean; count: number }>();
    for (const s of sessions ?? []) {
      const prev = map.get(s.date);
      map.set(s.date, { voted: (prev?.voted ?? false) || mine.has(s.id), count: (prev?.count ?? 0) + 1 });
    }
    return map;
  }, [sessions, mine]);

  const openCount = sessions?.filter((s) => s.status === "open").length ?? 0;
  const chosen = sessions?.filter((s) => s.date === selected) ?? [];
  const nextOpen = sessions?.find((s) => s.status === "open" && !mine.has(s.id));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12">
      <section className="relative flex flex-col justify-center pb-8 pt-4 sm:min-h-[460px] sm:py-12 lg:min-h-[520px]">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[.16em] text-primary sm:mb-7">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
            <span className="relative size-2 rounded-full bg-primary" />
          </span>
          Your next game starts here
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08 }} className="max-w-5xl font-display text-[clamp(2.2rem,9vw,7.2rem)] font-bold leading-[.98] text-foreground">
          Book your court.
          <br />
          <span className="text-glow text-primary">Bring the smash.</span>
        </motion.h1>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.18 }} className="mt-6 flex flex-col gap-6 sm:mt-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
              Friendly badminton in Prague for all levels. Pick a highlighted date, vote for your spot, bring your friends.
            </p>
            <a href="#calendar" className="group mt-5 hidden items-center gap-3 font-display text-sm font-bold text-primary transition hover:gap-5 sm:inline-flex">
              Explore sessions
              <span className="grid size-9 place-items-center rounded-full border border-primary/30 bg-primary/10 transition group-hover:bg-primary/20">
                <ArrowDownRight size={19} />
              </span>
            </a>
          </div>
          <div className="flex w-fit items-center gap-4 border-l-2 border-primary pl-5">
            <div className="font-display text-3xl font-bold leading-none sm:text-6xl">{sessions ? openCount.toString().padStart(2, "0") : "—"}</div>
            <div className="text-xs font-semibold uppercase leading-relaxed tracking-[.14em] text-muted-foreground">
              Open
              <br />
              <span className="text-primary">polls</span>
            </div>
          </div>
        </motion.div>
        <div className="pointer-events-none absolute bottom-8 right-0 hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground lg:flex">
          <MapPin size={13} className="text-cyan" /> Prague · All levels welcome
        </div>
      </section>

      <div className="mb-8 flex items-center gap-4 border-y border-border py-4 text-xs text-muted-foreground sm:mb-10">
        <span className="flex items-center gap-2 text-primary">
          <Sparkles size={15} /> PLAY MORE, SCROLL LESS
        </span>
        <span className="ml-auto hidden sm:inline">
          OPEN POLLS <span className="mx-3 text-primary">✳</span> GREAT GAMES <span className="mx-3 text-cyan">✳</span> GOOD COMPANY
        </span>
        <CalendarDays size={15} className="ml-auto sm:ml-0" />
      </div>

      <section id="calendar" className="scroll-mt-24 pb-16 sm:pb-28">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
          <div>
            <Eyebrow>Open polls</Eyebrow>
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Find your next game<span className="text-primary">.</span>
            </h2>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">Glowing dates have a poll ready for your vote. A tick means you're already in.</p>
        </div>

        {error && !sessions && (
          <div className="glass-panel rounded-2xl p-6 text-sm text-muted-foreground">
            {error}{" "}
            <Button variant="link" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {!sessions && !error && (
          <div className="glass-panel grid min-h-80 place-items-center rounded-2xl text-muted-foreground">
            <Spinner className="size-6" />
          </div>
        )}

        {sessions && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
            <div className="glass-panel rounded-2xl p-3 sm:p-7">
              <MonthCalendar today={today} initialMonth={selected ?? today} marked={marked} selected={selected} onSelect={setSelected} />
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-1 pt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span className="size-3 rounded border border-primary/40 bg-primary/15" /> Poll posted
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-primary">✓</span> You're in
                </span>
                <span className="ml-auto">Prague time</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Selected day</p>
                  <h3 className="mt-1 font-display text-xl font-bold">{selected ? fmt(selected, "EEEE, d MMMM") : "Pick a date"}</h3>
                </div>
                <span className="rounded-full border border-border bg-soft px-3 py-1.5 text-xs text-muted-foreground">
                  {chosen.length} {chosen.length === 1 ? "session" : "sessions"}
                </span>
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={selected ?? "none"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.23 }} className="space-y-4">
                  {chosen.length ? (
                    chosen.map((s) => <SessionCard key={s.id} session={s} joined={mine.has(s.id)} onJoin={() => (player ? setJoining(s) : (setPendingJoin(s), openSignIn()))} onShowPlayers={() => setShowPlayers(s)} />)
                  ) : (
                    <div className="glass-panel flex min-h-72 flex-col items-center justify-center rounded-2xl px-8 text-center">
                      <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <CalendarDays size={26} />
                      </div>
                      <h4 className="font-display text-xl font-bold">{sessions.length ? "No poll on this day" : "No polls posted yet"}</h4>
                      <p className="mt-2 max-w-64 text-sm leading-relaxed text-muted-foreground">
                        {sessions.length ? "Choose a glowing date to see an open poll." : "Admins will post the next sessions soon. Check back later!"}
                      </p>
                      {nextOpen && (
                        <Button variant="glass" size="sm" className="mt-5" onClick={() => setSelected(nextOpen.date)}>
                          Next open poll <ArrowRight size={15} />
                        </Button>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </section>

      <AboutSection />

      <JoinSheet
        session={joining}
        onClose={() => setJoining(null)}
        onJoined={(session, guests, multisport) => {
          setJoining(null);
          setConfirmation({ session, guests, multisport });
          setMine((m) => new Set(m).add(session.id));
          setSessions((list) => list?.map((s) => (s.id === session.id ? session : s)) ?? list);
        }}
      />
      <AttendeesSheet session={showPlayers} onClose={() => setShowPlayers(null)} />
      <ConfirmationCard data={confirmation} onClose={() => setConfirmation(null)} />
    </div>
  );
}
