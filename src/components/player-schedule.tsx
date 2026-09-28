import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Clock3, MapPin, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import {
  api,
  type Player,
  type PlayerLevel,
  type TournamentFormat,
  type TournamentMatch,
  type TournamentMatchStage,
  type TournamentRegistration,
  type TournamentSchedule,
} from "@/lib/api";
import { cn, fmt } from "@/lib/utils";

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  mens_singles: "Men's singles",
  womens_singles: "Women's singles",
  mens_doubles: "Men's doubles",
  womens_doubles: "Women's doubles",
  mixed: "Mixed doubles",
};
const LEVEL_LABEL: Record<PlayerLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

const STAGE_LABEL: Record<TournamentMatchStage, string> = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  quarter: "Quarter-final",
  semi: "Semi-final",
  final: "Final",
};
const STAGE_ORDER: TournamentMatchStage[] = ["group", "r32", "r16", "quarter", "semi", "final"];

const QUAL_TONE = {
  qualified: "bg-emerald/15 text-emerald",
  eliminated: "bg-destructive/15 text-destructive",
  "in-contention": "bg-amber/15 text-amber",
} as const;

export function PlayerSchedule({ tournamentId, player, mine }: {
  tournamentId: number;
  player: Player | null;
  mine: TournamentRegistration[];
}) {
  const [schedule, setSchedule] = useState<TournamentSchedule[] | null>(null);
  const [reporting, setReporting] = useState<TournamentMatch | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ categories: TournamentSchedule[] }>(`/api/tournaments/${tournamentId}/schedule`);
      setSchedule(res.categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load schedule.");
    }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);

  const myRegistrationIds = useMemo(() => new Set(mine.map((r) => r.id)), [mine]);
  const canReport = (m: TournamentMatch) =>
    !!player &&
    m.status !== "confirmed" &&
    !!m.entryA && !!m.entryB &&
    // Either registered player in the pair can report — server enforces the same rule.
    (myRegistrationIds.has(m.entryA?.id ?? -1) || myRegistrationIds.has(m.entryB?.id ?? -1));

  async function retract(m: TournamentMatch) {
    try {
      await api(`/api/tournaments/matches/${m.id}/report`, { method: "DELETE" });
      toast.success("Report retracted.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't retract.");
    }
  }

  if (!schedule) {
    return <div className="grid min-h-24 place-items-center text-muted-foreground"><Spinner className="size-5" /></div>;
  }

  const anyMatches = schedule.some((s) => s.matches.length > 0);
  if (!anyMatches) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-center text-sm text-muted-foreground">
        Fixtures haven't been drawn yet. Once admin publishes the draw, matches and standings will show here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {schedule.map((s) => {
        if (!s.matches.length) return null;
        return (
          <div key={s.category.id} className="glass-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-bold">{FORMAT_LABEL[s.category.format]} · {LEVEL_LABEL[s.category.level]}</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {s.category.structure === "group" ? "Round-robin" : s.category.structure === "ko" ? "Knockout" : "Groups + KO"}
              </span>
            </div>

            {s.groups.length > 0 && (
              <div className="mb-4 space-y-3">
                {s.groups.map((g) => (
                  <div key={g.id} className="rounded-xl border border-border bg-soft/40 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Group {g.name}</p>
                    <ol className="space-y-1">
                      {g.entries.map((e) => (
                        <li key={e.registrationId} className={cn("flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm", myRegistrationIds.has(e.registrationId) ? "bg-primary/10" : "")}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn("w-5 text-right text-xs font-bold", e.rank <= s.category.advanceCount ? "text-primary" : "text-muted-foreground")}>{e.rank}.</span>
                            <span className="min-w-0 truncate">
                              {e.playerName}{e.partnerName ? <span className="text-muted-foreground"> & {e.partnerName}</span> : null}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{e.wins}-{e.losses}</span>
                            <span>({e.pointsFor - e.pointsAgainst > 0 ? "+" : ""}{e.pointsFor - e.pointsAgainst})</span>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", QUAL_TONE[e.qualifying])}>
                              {e.qualifying === "qualified" ? "Q" : e.qualifying === "eliminated" ? "Out" : "TBD"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}

            {STAGE_ORDER.map((stage) => {
              const list = s.matches.filter((m) => m.stage === stage);
              if (!list.length) return null;
              return (
                <div key={stage} className="mt-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{STAGE_LABEL[stage]}</p>
                  <ul className="space-y-2">
                    {list.map((m) => {
                      const isMine = myRegistrationIds.has(m.entryA?.id ?? -1) || myRegistrationIds.has(m.entryB?.id ?? -1);
                      const scoreText = [m.set1, m.set2, m.set3].filter((x): x is [number, number] => !!x).map((x) => `${x[0]}–${x[1]}`).join(", ");
                      return (
                        <li key={m.id} className={cn("rounded-xl border p-3 text-sm", isMine ? "border-primary/40 bg-primary/[.05]" : "border-border bg-background/40")}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className={cn(m.winnerEntryId === m.entryA?.id && "font-bold text-primary")}>{sideLabel(m.entryA)}</span>
                              <span className="mx-2 text-muted-foreground">vs</span>
                              <span className={cn(m.winnerEntryId === m.entryB?.id && "font-bold text-primary")}>{sideLabel(m.entryB)}</span>
                              {scoreText && <p className="mt-0.5 text-xs text-muted-foreground">{scoreText}</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {m.court && <span className="flex items-center gap-1 text-muted-foreground"><MapPin size={12} /> {m.court}</span>}
                              {m.scheduledAt && <span className="flex items-center gap-1 text-muted-foreground"><Clock3 size={12} /> {fmt(m.scheduledAt, "d MMM · HH:mm")}</span>}
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                m.status === "confirmed" ? "bg-emerald/15 text-emerald" : m.status === "reported" ? "bg-amber/15 text-amber" : "bg-soft text-muted-foreground",
                              )}>{m.status}</span>
                              {canReport(m) && m.status !== "reported" && (
                                <Button variant="neon" size="sm" onClick={() => setReporting(m)}>
                                  <Send size={12} /> Report result
                                </Button>
                              )}
                              {canReport(m) && m.status === "reported" && m.reportedBy === player?.id && (
                                <Button variant="glass" size="sm" onClick={() => retract(m)}>
                                  <Undo2 size={12} /> Retract
                                </Button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        );
      })}
      <ReportSheet match={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); load(); }} />
    </div>
  );
}

function sideLabel(entry: TournamentMatch["entryA"]) {
  if (!entry) return <span className="italic text-muted-foreground">TBD</span>;
  return <>{entry.playerName}{entry.partnerName ? <span className="text-muted-foreground"> & {entry.partnerName}</span> : null}</>;
}

function ReportSheet({ match, onClose, onSaved }: { match: TournamentMatch | null; onClose: () => void; onSaved: () => void }) {
  const [s1a, setS1a] = useState(""); const [s1b, setS1b] = useState("");
  const [s2a, setS2a] = useState(""); const [s2b, setS2b] = useState("");
  const [s3a, setS3a] = useState(""); const [s3b, setS3b] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!match) return;
    setS1a(match.set1 ? String(match.set1[0]) : ""); setS1b(match.set1 ? String(match.set1[1]) : "");
    setS2a(match.set2 ? String(match.set2[0]) : ""); setS2b(match.set2 ? String(match.set2[1]) : "");
    setS3a(match.set3 ? String(match.set3[0]) : ""); setS3b(match.set3 ? String(match.set3[1]) : "");
    setBusy(false);
  }, [match?.id]);

  const set1Split = s1a && s1b && Number(s1a) !== Number(s1b);
  const set2Split = s2a && s2b && Number(s2a) !== Number(s2b);
  const needsSet3 = useMemo(() => {
    if (!set1Split || !set2Split) return false;
    const s1Winner = Number(s1a) > Number(s1b) ? "a" : "b";
    const s2Winner = Number(s2a) > Number(s2b) ? "a" : "b";
    return s1Winner !== s2Winner;
  }, [s1a, s1b, s2a, s2b, set1Split, set2Split]);

  if (!match) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const labelA = match.entryA ? `${match.entryA.playerName}${match.entryA.partnerName ? ` & ${match.entryA.partnerName}` : ""}` : "TBD";
  const labelB = match.entryB ? `${match.entryB.playerName}${match.entryB.partnerName ? ` & ${match.entryB.partnerName}` : ""}` : "TBD";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!s1a || !s1b || !s2a || !s2b) return toast.error("Enter both sets 1 and 2.");
    if (needsSet3 && (!s3a || !s3b)) return toast.error("Split sets — enter set 3.");
    setBusy(true);
    try {
      await api(`/api/tournaments/matches/${match!.id}/report`, {
        body: {
          set1: [Number(s1a), Number(s1b)],
          set2: [Number(s2a), Number(s2b)],
          set3: needsSet3 ? [Number(s3a), Number(s3b)] : null,
        },
      });
      toast.success("Reported — an admin will confirm it shortly.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!match} onClose={onClose} title="Report result" subtitle={`${labelA} vs ${labelB}`}>
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <SetRow label="Set 1" a={s1a} b={s1b} onA={setS1a} onB={setS1b} labelA={labelA} labelB={labelB} />
        <SetRow label="Set 2" a={s2a} b={s2b} onA={setS2a} onB={setS2b} labelA={labelA} labelB={labelB} />
        <AnimatePresence initial={false}>
          {needsSet3 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <SetRow label="Set 3 (decider)" a={s3a} b={s3b} onA={setS3a} onB={setS3b} labelA={labelA} labelB={labelB} />
            </motion.div>
          )}
        </AnimatePresence>
        <p className="rounded-xl border border-amber/20 bg-amber/[.06] px-3 py-2 text-xs text-amber">
          Admin will confirm before it counts. If you got a set wrong, retract and re-submit before they confirm.
        </p>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} <CalendarDays size={14} /> Submit result
        </Button>
      </form>
    </Sheet>
  );
}

function SetRow({ label, a, b, onA, onB, labelA, labelB }: { label: string; a: string; b: string; onA: (v: string) => void; onB: (v: string) => void; labelA: string; labelB: string }) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input className="field text-center font-mono text-lg" inputMode="numeric" value={a} onChange={(e) => onA(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="0" aria-label={labelA} />
        <span className="text-xs text-muted-foreground">vs</span>
        <input className="field text-center font-mono text-lg" inputMode="numeric" value={b} onChange={(e) => onB(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="0" aria-label={labelB} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="truncate">{labelA}</span>
        <span className="truncate text-right">{labelB}</span>
      </div>
    </Field>
  );
}
