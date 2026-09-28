import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronRight, MapPin, Search, Sparkles, Swords, Trophy, UserPlus, UserRoundX, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { AuthSheet } from "@/components/auth-sheet";
import { useConfirm } from "@/components/confirm-dialog";
import { api, type PlayerLevel, type Tournament, type TournamentCategory, type TournamentDetail, type TournamentFormat, type TournamentRegistration } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import { fmt } from "@/lib/utils";

const FORMAT_LABEL: Record<TournamentFormat, string> = { singles: "Singles", doubles: "Doubles", mixed: "Mixed doubles" };
const LEVEL_LABEL: Record<PlayerLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const LEVEL_TONE: Record<PlayerLevel, string> = {
  beginner: "border-cyan/30 bg-cyan/10 text-cyan",
  intermediate: "border-primary/30 bg-primary/10 text-primary",
  advanced: "border-violet/30 bg-violet/10 text-violet",
};

export default function TournamentPage() {
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ tournaments: Tournament[] }>("/api/tournaments");
      setTournaments(res.tournaments);
      setSelectedId((cur) => cur ?? res.tournaments[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load tournaments.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!tournaments) {
    return (
      <div className="mx-auto grid min-h-[60vh] max-w-7xl place-items-center px-4">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (tournaments.length === 0) {
    return <TournamentPlaceholder />;
  }

  const selected = tournaments.find((t) => t.id === selectedId) ?? tournaments[0];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-10">
        <Eyebrow>Tournaments</Eyebrow>
        <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
          Bring your A game<span className="text-primary">.</span>
        </h1>
        <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
          Pick a category, grab a partner, and let the rally do the talking. Withdrawals and partner swaps lock 3 days before the tournament.
        </p>
      </div>

      {tournaments.length > 1 && (
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {tournaments.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-left text-xs transition ${t.id === selected.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground"}`}
            >
              <span className="block font-semibold">{t.name}</span>
              {fmt(t.startsOn, "EEE d MMM")}
            </button>
          ))}
        </div>
      )}

      <TournamentBoard tournamentId={selected.id} onChange={load} />
    </div>
  );
}

function TournamentPlaceholder() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-5 text-center">
      <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 12, stiffness: 220 }} className="mb-6 grid size-20 place-items-center rounded-3xl bg-primary/15 text-primary shadow-[0_0_45px_oklch(0.92_0.22_123/18%)]">
        <Trophy size={38} />
      </motion.div>
      <Eyebrow>Tournaments</Eyebrow>
      <h1 className="font-display text-4xl font-bold leading-[1.02] sm:text-6xl">
        Something big is warming up<span className="text-primary">.</span>
      </h1>
      <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">
        No tournament is open just yet — but the next one is coming. Keep drilling those clears, tighten up your net play, and be ready to sign up the moment the bracket goes live.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { icon: <Swords size={18} />, text: "Sharpen your smashes" },
          { icon: <Users2 size={18} />, text: "Line up a partner" },
          { icon: <Sparkles size={18} />, text: "Check back soon" },
        ].map((tip) => (
          <div key={tip.text} className="glass-panel flex items-center gap-3 rounded-xl px-4 py-3 text-sm">
            <span className="text-primary">{tip.icon}</span>
            <span>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TournamentBoard({ tournamentId, onChange }: { tournamentId: number; onChange: () => void }) {
  const { player } = usePlayer();
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [mine, setMine] = useState<TournamentRegistration[]>([]);
  const [registerCategory, setRegisterCategory] = useState<TournamentCategory | null>(null);
  const [changePartner, setChangePartner] = useState<TournamentRegistration | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await api<{ tournament: TournamentDetail; mine: TournamentRegistration[] }>(`/api/tournaments/${tournamentId}`);
      setDetail(res.tournament);
      setMine(res.mine);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load tournament.");
    }
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function withdraw(reg: TournamentRegistration) {
    const ok = await ask({
      title: "Withdraw from this category?",
      message: `${FORMAT_LABEL[reg.format]} · ${LEVEL_LABEL[reg.level]}. This can be undone by re-registering while it's still open.`,
      confirmLabel: "Withdraw",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await api(`/api/tournaments/registrations/${reg.id}`, { method: "DELETE" });
      toast.success("Withdrawn.");
      load();
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't withdraw.");
    }
  }

  if (!detail) {
    return (
      <div className="grid min-h-40 place-items-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }

  const closed = detail.status !== "open";
  const openCategories = detail.categories.filter((c) => c.isOpen);
  const groupedByLevel = new Map<PlayerLevel, TournamentCategory[]>();
  for (const c of openCategories) {
    const list = groupedByLevel.get(c.level) ?? [];
    list.push(c);
    groupedByLevel.set(c.level, list);
  }
  const levelsOrder: PlayerLevel[] = ["beginner", "intermediate", "advanced"];
  const alreadyIn = new Set(mine.map((m) => m.categoryId));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
      <section>
        <div className="glass-panel rounded-3xl p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold">{detail.name}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><CalendarDays size={15} /> {fmt(detail.startsOn, "EEEE, d MMMM")}{detail.startTime ? ` · ${detail.startTime}` : ""}</span>
                <span className="flex items-center gap-1.5"><MapPin size={15} /> {detail.venue}</span>
              </p>
              {detail.description && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{detail.description}</p>}
            </div>
            <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${closed ? "bg-amber/15 text-amber" : "bg-primary/10 text-primary"}`}>
              {closed ? "Registration closed" : "Registration open"}
            </span>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {levelsOrder.map((lvl) => {
            const cats = groupedByLevel.get(lvl) ?? [];
            if (!cats.length) return null;
            return (
              <div key={lvl}>
                <h3 className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${LEVEL_TONE[lvl]}`}>
                  {LEVEL_LABEL[lvl]}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {cats.map((c) => {
                    const registered = alreadyIn.has(c.id);
                    const full = c.maxEntries != null && c.entryCount >= c.maxEntries;
                    return (
                      <div key={c.id} className={`glass-panel flex flex-col justify-between gap-3 rounded-2xl p-4 ${registered ? "border-primary/40" : ""}`}>
                        <div>
                          <p className="font-display text-lg font-bold">{FORMAT_LABEL[c.format]}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}
                            {c.maxEntries != null && ` · cap ${c.maxEntries}`}
                          </p>
                        </div>
                        <Button
                          variant={registered ? "glass" : "neon"}
                          size="sm"
                          disabled={closed || registered || full}
                          onClick={() => (player ? setRegisterCategory(c) : setAuthOpen(true))}
                        >
                          {registered ? "You're in" : full ? "Full" : "Register"} <ChevronRight size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!openCategories.length && (
            <div className="glass-panel rounded-2xl p-8 text-center text-sm text-muted-foreground">
              No categories are open right now. Admins will unlock them soon.
            </div>
          )}
        </div>
      </section>

      <aside>
        <div className="glass-panel sticky top-6 rounded-3xl p-5 sm:p-7">
          <h3 className="font-display text-lg font-bold">Your entries</h3>
          <p className="mt-1 text-xs text-muted-foreground">You can withdraw or swap partners up to 3 days before the tournament.</p>
          {!player && (
            <div className="mt-5 space-y-3 text-sm">
              <p className="text-muted-foreground">Sign in to see or manage your entries.</p>
              <Button variant="neon" size="lg" className="w-full" onClick={() => setAuthOpen(true)}>Sign in or register</Button>
            </div>
          )}
          {player && mine.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">You haven't entered any category yet.</p>
          )}
          {player && mine.length > 0 && (
            <ul className="mt-4 space-y-3">
              {mine.map((r) => (
                <li key={r.id} className="rounded-2xl border border-border bg-soft p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-sm font-bold">{FORMAT_LABEL[r.format]} · {LEVEL_LABEL[r.level]}</p>
                      {r.partnerName && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserPlus size={12} className="text-cyan" /> Partner: {r.partnerName}
                        </p>
                      )}
                      {!r.imOwner && <p className="mt-1 text-[11px] text-muted-foreground">You were added by {r.playerName}. Ask them to make changes.</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {r.imOwner && r.format !== "singles" && (
                      <Button variant="glass" size="sm" onClick={() => setChangePartner(r)}>
                        <UserPlus size={13} /> Change partner
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => withdraw(r)}>
                      <UserRoundX size={13} /> Withdraw
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <RegisterSheet
        category={registerCategory}
        tournament={detail}
        onClose={() => setRegisterCategory(null)}
        onDone={() => { setRegisterCategory(null); load(); onChange(); }}
      />
      <PartnerSheet
        registration={changePartner}
        tournament={detail}
        onClose={() => setChangePartner(null)}
        onDone={() => { setChangePartner(null); load(); onChange(); }}
      />
      <AuthSheet open={authOpen} onClose={() => setAuthOpen(false)} onSignedIn={load} />
      {dialog}
    </div>
  );
}

type PartnerValue = { partnerId: number | null; partnerName: string };

function PartnerPicker({ label, players, exclude, taken, value, onChange }: {
  label: string;
  players: TournamentDetail["players"];
  exclude: Set<number>;
  taken: Set<number>;
  value: PartnerValue;
  onChange: (v: PartnerValue) => void;
}) {
  const [mode, setMode] = useState<"existing" | "manual">(value.partnerId != null || !value.partnerName ? "existing" : "manual");
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const list = (players ?? []).filter((p) => !exclude.has(p.id));
    if (!q.trim()) return list.slice(0, 60);
    const s = q.trim().toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 60);
  }, [players, q, exclude]);
  const picked = players?.find((p) => p.id === value.partnerId);

  function switchMode(next: "existing" | "manual") {
    setMode(next);
    if (next === "existing") onChange({ partnerId: null, partnerName: "" });
    else onChange({ partnerId: null, partnerName: value.partnerName });
  }

  return (
    <Field label={label}>
      <div className="mb-2 flex rounded-xl border border-border bg-soft p-1 text-xs">
        <button type="button" onClick={() => switchMode("existing")} className={`flex-1 rounded-lg py-2 font-semibold transition ${mode === "existing" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          From club roster
        </button>
        <button type="button" onClick={() => switchMode("manual")} className={`flex-1 rounded-lg py-2 font-semibold transition ${mode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Not on the app
        </button>
      </div>

      {mode === "existing" ? (
        picked ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">{picked.name}</span>
            <button type="button" onClick={() => onChange({ partnerId: null, partnerName: "" })} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
              Change
            </button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="field pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a player" />
            </div>
            <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-soft">
              {filtered.length === 0 && (
                <li className="p-3 text-center text-xs text-muted-foreground">No matching players.</li>
              )}
              {filtered.map((p) => {
                const isTaken = taken.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={isTaken}
                      onClick={() => onChange({ partnerId: p.id, partnerName: "" })}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${isTaken ? "opacity-40" : "hover:bg-background/60"}`}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isTaken ? "Taken" : LEVEL_LABEL[p.level]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : (
        <div>
          <input
            className="field"
            value={value.partnerName}
            onChange={(e) => onChange({ partnerId: null, partnerName: e.target.value })}
            placeholder="Partner's full name"
            maxLength={60}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            They'll be listed by name only — they won't see or manage this entry themselves.
          </p>
        </div>
      )}
    </Field>
  );
}

function RegisterSheet({ category, tournament, onClose, onDone }: { category: TournamentCategory | null; tournament: TournamentDetail; onClose: () => void; onDone: () => void }) {
  const { player } = usePlayer();
  const [partner, setPartner] = useState<PartnerValue>({ partnerId: null, partnerName: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (category) setPartner({ partnerId: null, partnerName: "" });
  }, [category?.id]);

  if (!category || !player) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const requiresPartner = category.format !== "singles";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hasPartner = partner.partnerId != null || partner.partnerName.trim();
    if (requiresPartner && !hasPartner) return toast.error("Pick a partner first.");
    setBusy(true);
    try {
      await api("/api/tournaments/register", {
        body: {
          categoryId: category!.id,
          partnerId: requiresPartner ? partner.partnerId : null,
          partnerName: requiresPartner && !partner.partnerId ? (partner.partnerName.trim() || null) : null,
        },
      });
      toast.success("You're in! Good luck.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't register.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!category}
      onClose={onClose}
      title={`Enter ${FORMAT_LABEL[category.format]}`}
      subtitle={`${LEVEL_LABEL[category.level]} · ${tournament.name}`}
    >
      <form onSubmit={submit} className="space-y-5 pb-4 pt-3">
        <div className="rounded-2xl border border-border bg-soft px-4 py-3 text-sm">
          <p className="font-semibold">{player.name}</p>
          <p className="text-xs text-muted-foreground">Signed in as {player.email}</p>
        </div>

        {requiresPartner && (
          <PartnerPicker
            label={`Partner (${FORMAT_LABEL[category.format].toLowerCase()})`}
            players={tournament.players}
            exclude={new Set([player.id])}
            taken={new Set()}
            value={partner}
            onChange={setPartner}
          />
        )}

        <p className="rounded-xl border border-amber/20 bg-amber/[.06] px-3 py-2 text-xs text-amber">
          You can withdraw or change partner up to 3 days before the tournament.
        </p>

        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} Confirm entry
        </Button>
      </form>
    </Sheet>
  );
}

function PartnerSheet({ registration, tournament, onClose, onDone }: { registration: TournamentRegistration | null; tournament: TournamentDetail; onClose: () => void; onDone: () => void }) {
  const { player } = usePlayer();
  const [partner, setPartner] = useState<PartnerValue>({ partnerId: null, partnerName: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (registration) {
      setPartner({
        partnerId: registration.partnerId,
        partnerName: registration.partnerId ? "" : (registration.partnerName ?? ""),
      });
    }
  }, [registration?.id]);

  if (!registration || !player) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hasPartner = partner.partnerId != null || partner.partnerName.trim();
    if (!hasPartner) return toast.error("Pick a new partner.");
    setBusy(true);
    try {
      await api(`/api/tournaments/registrations/${registration!.id}`, {
        method: "PATCH",
        body: {
          partnerId: partner.partnerId,
          partnerName: partner.partnerId ? null : (partner.partnerName.trim() || null),
        },
      });
      toast.success("Partner updated.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update partner.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!registration}
      onClose={onClose}
      title="Swap partner"
      subtitle={`${FORMAT_LABEL[registration.format]} · ${LEVEL_LABEL[registration.level]}`}
    >
      <form onSubmit={submit} className="space-y-5 pb-4 pt-3">
        <PartnerPicker
          label="New partner"
          players={tournament.players}
          exclude={new Set([player.id])}
          taken={new Set()}
          value={partner}
          onChange={setPartner}
        />
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} Save partner
        </Button>
      </form>
    </Sheet>
  );
}
