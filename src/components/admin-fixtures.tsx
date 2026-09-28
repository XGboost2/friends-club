import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock3, MapPin, RefreshCcw, Sparkles, Trash2, Trophy, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useConfirm } from "@/components/confirm-dialog";
import {
  api,
  type PlayerLevel,
  type TournamentCategory,
  type TournamentFormat,
  type TournamentMatch,
  type TournamentMatchStage,
  type TournamentSchedule,
} from "@/lib/api";
import { cn } from "@/lib/utils";

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

const STATUS_TONE = {
  pending: "bg-soft text-muted-foreground",
  reported: "bg-amber/15 text-amber",
  confirmed: "bg-emerald/15 text-emerald",
} as const;

export function AdminFixtures({ tournamentId, categories, onChanged }: {
  tournamentId: number;
  categories: TournamentCategory[];
  onChanged: () => void;
}) {
  const [schedule, setSchedule] = useState<TournamentSchedule[] | null>(null);
  const [scoring, setScoring] = useState<TournamentMatch | null>(null);
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await api<{ categories: TournamentSchedule[] }>(`/api/tournaments/${tournamentId}/schedule`);
      setSchedule(res.categories);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load schedule.");
    }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);

  async function generateGroups(cat: TournamentCategory) {
    if (cat.hasFixtures) {
      const ok = await ask({
        title: "Regenerate groups?",
        message: "This wipes all matches for this category and rebuilds them. Any scores you already entered will be lost.",
        confirmLabel: "Wipe & regenerate",
        tone: "danger",
      });
      if (!ok) return;
      await api(`/api/admin/tournaments/categories/${cat.id}/reset`, { method: "POST" });
    }
    try {
      await api(`/api/admin/tournaments/categories/${cat.id}/generate-groups`, { method: "POST" });
      toast.success("Groups generated.");
      load(); onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate groups.");
    }
  }

  async function generateKnockout(cat: TournamentCategory) {
    try {
      await api(`/api/admin/tournaments/categories/${cat.id}/generate-knockout`, { method: "POST" });
      toast.success("Knockout bracket generated.");
      load(); onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate knockout.");
    }
  }

  async function resetCategory(cat: TournamentCategory) {
    const ok = await ask({
      title: `Reset ${FORMAT_LABEL[cat.format]} · ${LEVEL_LABEL[cat.level]}?`,
      message: "Deletes every match, group and score for this category. Registrations stay.",
      confirmLabel: "Reset",
      tone: "danger",
    });
    if (!ok) return;
    await api(`/api/admin/tournaments/categories/${cat.id}/reset`, { method: "POST" });
    toast.success("Category reset.");
    load(); onChanged();
  }

  async function confirmMatch(m: TournamentMatch) {
    try {
      await api(`/api/admin/tournaments/matches/${m.id}/confirm`, { method: "POST" });
      toast.success("Result confirmed.");
      load(); onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't confirm.");
    }
  }

  async function rejectMatch(m: TournamentMatch) {
    const ok = await ask({
      title: "Reject reported score?",
      message: "The scores are wiped and the match goes back to pending. The reporter can enter it again.",
      confirmLabel: "Reject",
      tone: "warning",
    });
    if (!ok) return;
    await api(`/api/admin/tournaments/matches/${m.id}/reject`, { method: "POST" });
    toast.success("Reported score rejected.");
    load(); onChanged();
  }

  if (!schedule) {
    return <div className="grid min-h-24 place-items-center text-muted-foreground"><Spinner className="size-5" /></div>;
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">Fixtures</h4>
        <button onClick={load} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCcw size={12} /> Refresh
        </button>
      </div>
      <div className="space-y-4">
        {categories.map((cat) => {
          const catSchedule = schedule.find((s) => s.category.id === cat.id);
          return (
            <CategoryFixtures
              key={cat.id}
              cat={cat}
              schedule={catSchedule}
              onGenerateGroups={() => generateGroups(cat)}
              onGenerateKnockout={() => generateKnockout(cat)}
              onReset={() => resetCategory(cat)}
              onScore={setScoring}
              onConfirm={confirmMatch}
              onReject={rejectMatch}
              onScheduleChanged={load}
            />
          );
        })}
      </div>
      <ScoreSheet match={scoring} onClose={() => setScoring(null)} onSaved={() => { setScoring(null); load(); onChanged(); }} />
      {dialog}
    </section>
  );
}

function CategoryFixtures({ cat, schedule, onGenerateGroups, onGenerateKnockout, onReset, onScore, onConfirm, onReject, onScheduleChanged }: {
  cat: TournamentCategory;
  schedule?: TournamentSchedule;
  onGenerateGroups: () => void;
  onGenerateKnockout: () => void;
  onReset: () => void;
  onScore: (m: TournamentMatch) => void;
  onConfirm: (m: TournamentMatch) => void;
  onReject: (m: TournamentMatch) => void;
  onScheduleChanged: () => void;
}) {
  const matches = schedule?.matches ?? [];
  const groups = schedule?.groups ?? [];
  const groupMatches = matches.filter((m) => m.stage === "group");
  const koMatches = matches.filter((m) => m.stage !== "group");
  const groupsDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === "confirmed");
  const canGenerateGroups = cat.structure !== "ko" && cat.entryCount >= 2;
  const canGenerateKnockout =
    cat.entryCount >= 2 && (
      (cat.structure === "ko") ||
      (cat.structure === "group_ko" && groupsDone)
    );

  return (
    <div className="rounded-2xl border border-border bg-soft/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-base font-bold">{FORMAT_LABEL[cat.format]} · {LEVEL_LABEL[cat.level]}</p>
          <p className="text-[11px] text-muted-foreground">
            {cat.entryCount} entries · Structure: {cat.structure} · Groups of {cat.groupSize} · Top {cat.advanceCount} advance
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canGenerateGroups && (
            <Button variant={cat.hasFixtures ? "glass" : "neon"} size="sm" onClick={onGenerateGroups}>
              <Sparkles size={13} /> {groupMatches.length ? "Regenerate groups" : "Generate groups"}
            </Button>
          )}
          {canGenerateKnockout && (
            <Button variant={koMatches.length ? "glass" : "neon"} size="sm" onClick={onGenerateKnockout}>
              <Trophy size={13} /> {koMatches.length ? "Regenerate KO" : "Generate knockout"}
            </Button>
          )}
          {(matches.length > 0) && (
            <Button variant="destructive" size="sm" onClick={onReset}>
              <Trash2 size={13} /> Reset
            </Button>
          )}
        </div>
      </div>

      {matches.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No fixtures yet. Generate to build the draw.
        </p>
      )}

      {groups.length > 0 && (
        <div className="mb-4 space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-xl border border-border bg-background/40 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Group {g.name}</p>
              <StandingsTable entries={g.entries} advance={cat.advanceCount} />
            </div>
          ))}
        </div>
      )}

      {STAGE_ORDER.map((stage) => {
        const list = matches.filter((m) => m.stage === stage);
        if (!list.length) return null;
        return (
          <div key={stage} className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{STAGE_LABEL[stage]}</p>
            <div className="space-y-2">
              {list.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  onScore={() => onScore(m)}
                  onConfirm={() => onConfirm(m)}
                  onReject={() => onReject(m)}
                  onScheduleChanged={onScheduleChanged}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StandingsTable({ entries, advance }: { entries: TournamentSchedule["groups"][number]["entries"]; advance: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">Pair</th>
            <th className="py-1 pr-2 text-right font-normal">W</th>
            <th className="py-1 pr-2 text-right font-normal">L</th>
            <th className="py-1 pr-2 text-right font-normal">Sets</th>
            <th className="py-1 pr-2 text-right font-normal">Pts</th>
            <th className="py-1 pl-2 text-right font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.registrationId} className="border-t border-border/50">
              <td className={cn("py-1.5 pr-2 font-bold", e.rank <= advance ? "text-primary" : "text-muted-foreground")}>{e.rank}</td>
              <td className="py-1.5 pr-2 truncate">
                {e.playerName}{e.partnerName ? <span className="text-muted-foreground"> & {e.partnerName}</span> : null}
              </td>
              <td className="py-1.5 pr-2 text-right">{e.wins}</td>
              <td className="py-1.5 pr-2 text-right">{e.losses}</td>
              <td className="py-1.5 pr-2 text-right">{e.setsWon}–{e.setsLost}</td>
              <td className="py-1.5 pr-2 text-right">{e.pointsFor - e.pointsAgainst > 0 ? "+" : ""}{e.pointsFor - e.pointsAgainst}</td>
              <td className="py-1.5 pl-2 text-right">
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                  e.qualifying === "qualified" ? "bg-emerald/15 text-emerald" :
                  e.qualifying === "eliminated" ? "bg-destructive/15 text-destructive" :
                  "bg-amber/15 text-amber",
                )}>
                  {e.qualifying === "qualified" ? "Qual" : e.qualifying === "eliminated" ? "Out" : "TBD"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchRow({ match, onScore, onConfirm, onReject, onScheduleChanged }: {
  match: TournamentMatch;
  onScore: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onScheduleChanged: () => void;
}) {
  const [court, setCourt] = useState(match.court ?? "");
  const [time, setTime] = useState(match.scheduledAt ? new Date(match.scheduledAt).toISOString().slice(0, 16) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCourt(match.court ?? "");
    setTime(match.scheduledAt ? new Date(match.scheduledAt).toISOString().slice(0, 16) : "");
  }, [match.id, match.court, match.scheduledAt]);

  const dirty = (court || null) !== match.court || (time ? new Date(time).toISOString() : null) !== match.scheduledAt;

  async function saveSchedule() {
    setSaving(true);
    try {
      await api(`/api/admin/tournaments/matches/${match.id}`, {
        method: "PATCH",
        body: {
          court: court.trim() || null,
          scheduledAt: time ? new Date(time).toISOString() : null,
        },
      });
      toast.success("Schedule updated.");
      onScheduleChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const label = (side: TournamentMatch["entryA"]) => side
    ? `${side.playerName}${side.partnerName ? ` & ${side.partnerName}` : ""}`
    : <span className="italic text-muted-foreground">TBD</span>;

  const scoreText = [match.set1, match.set2, match.set3]
    .filter((s): s is [number, number] => !!s)
    .map((s) => `${s[0]}–${s[1]}`)
    .join(", ");

  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm">
            <span className={cn(match.winnerEntryId === match.entryA?.id && "font-bold text-primary")}>{label(match.entryA)}</span>
            <span className="mx-2 text-muted-foreground">vs</span>
            <span className={cn(match.winnerEntryId === match.entryB?.id && "font-bold text-primary")}>{label(match.entryB)}</span>
          </div>
          {scoreText && <p className="mt-0.5 text-xs text-muted-foreground">{scoreText}</p>}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", STATUS_TONE[match.status])}>
          {match.status}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="relative">
          <MapPin size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="field h-9 pl-8 text-sm" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="Court" maxLength={40} />
        </div>
        <div className="relative">
          <Clock3 size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="field h-9 pl-8 text-sm" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button variant="glass" size="sm" onClick={saveSchedule} disabled={saving}>
              {saving && <Spinner />} Save
            </Button>
          )}
          {match.status === "reported" && (
            <>
              <Button variant="neon" size="sm" onClick={onConfirm}>Confirm</Button>
              <Button variant="destructive" size="sm" onClick={onReject}>Reject</Button>
            </>
          )}
          {match.status !== "confirmed" && match.entryA && match.entryB && (
            <Button variant={match.status === "reported" ? "ghost" : "glass"} size="sm" onClick={onScore}>
              {match.status === "reported" ? "Edit score" : "Enter score"}
            </Button>
          )}
          {match.status === "confirmed" && (
            <Button variant="ghost" size="sm" onClick={onReject} title="Reset scores">
              <Undo2 size={13} /> Revert
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreSheet({ match, onClose, onSaved }: { match: TournamentMatch | null; onClose: () => void; onSaved: () => void }) {
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
      await api(`/api/admin/tournaments/matches/${match!.id}/result`, {
        method: "POST",
        body: {
          set1: [Number(s1a), Number(s1b)],
          set2: [Number(s2a), Number(s2b)],
          set3: needsSet3 ? [Number(s3a), Number(s3b)] : null,
        },
      });
      toast.success("Score saved & confirmed.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save score.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!match} onClose={onClose} title="Enter match result" subtitle={`${labelA} vs ${labelB}`}>
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
        <p className="rounded-xl border border-cyan/20 bg-cyan/[.06] px-3 py-2 text-xs text-cyan">
          Admin entry: this saves and confirms in one step. Use "Reject" on the row to undo.
        </p>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} Save result
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
