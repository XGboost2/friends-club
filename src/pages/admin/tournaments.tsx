import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Layers3, MapPin, Pencil, Plus, Trash2, Trophy, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useConfirm } from "@/components/confirm-dialog";
import { api, type PlayerLevel, type Tournament, type TournamentCategory, type TournamentDetail, type TournamentFormat, type TournamentRegistration, type TournamentStatus } from "@/lib/api";
import { cn, fmt, isoDay } from "@/lib/utils";

const FORMATS: TournamentFormat[] = ["singles", "doubles", "mixed"];
const LEVELS: PlayerLevel[] = ["beginner", "intermediate", "advanced"];
const FORMAT_LABEL: Record<TournamentFormat, string> = { singles: "Singles", doubles: "Doubles", mixed: "Mixed" };
const LEVEL_LABEL: Record<PlayerLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const STATUS_TONE: Record<TournamentStatus, string> = {
  draft: "bg-soft text-muted-foreground",
  open: "bg-primary/15 text-primary",
  closed: "bg-amber/15 text-amber",
  completed: "bg-emerald/15 text-emerald",
};

export default function AdminTournaments() {
  const [list, setList] = useState<(Tournament & { entryCount: number })[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await api<{ tournaments: (Tournament & { entryCount: number })[] }>("/api/admin/tournaments");
      setList(res.tournaments);
      setOpenId((cur) => cur ?? res.tournaments[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load tournaments.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(t: Tournament) {
    const ok = await ask({
      title: `Delete "${t.name}"?`,
      message: "All categories and player entries will be removed.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/tournaments/${t.id}`, { method: "DELETE" });
      toast.success("Tournament deleted.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>The clubhouse / Tournaments</Eyebrow>
          <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">Run the bracket<span className="text-primary">.</span></h1>
          <p className="mt-3 max-w-xl text-muted-foreground">Set up tournaments, pick which categories are open, edit anyone's partner or level. Fixtures & courts are next.</p>
        </div>
        <Button variant="neon" size="lg" onClick={() => setCreating(true)}>
          <Plus size={16} /> New tournament
        </Button>
      </div>

      {!list && (
        <div className="grid min-h-60 place-items-center text-muted-foreground"><Spinner className="size-6" /></div>
      )}
      {list && list.length === 0 && (
        <div className="glass-panel mx-auto max-w-lg rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Trophy size={24} />
          </div>
          <h2 className="font-display text-2xl font-bold">No tournaments yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Create one to open registration.</p>
        </div>
      )}

      <div className="space-y-4">
        {list?.map((t) => (
          <TournamentCard
            key={t.id}
            summary={t}
            isOpen={openId === t.id}
            onToggle={() => setOpenId(openId === t.id ? null : t.id)}
            onChanged={load}
            onDelete={() => remove(t)}
          />
        ))}
      </div>

      <CreateSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      {dialog}
    </div>
  );
}

function TournamentCard({ summary, isOpen, onToggle, onChanged, onDelete }: {
  summary: Tournament & { entryCount: number };
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingReg, setEditingReg] = useState<TournamentRegistration | null>(null);
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    if (!isOpen) return;
    try {
      const res = await api<{ tournament: TournamentDetail; registrations: TournamentRegistration[] }>(`/api/admin/tournaments/${summary.id}`);
      setDetail(res.tournament);
      setRegs(res.registrations);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load details.");
    }
  }, [summary.id, isOpen]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(status: TournamentStatus) {
    try {
      await api(`/api/admin/tournaments/${summary.id}`, { method: "PATCH", body: { status } });
      toast.success(`Marked ${status}.`);
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update.");
    }
  }

  async function toggleCategory(cat: TournamentCategory) {
    try {
      await api(`/api/admin/tournaments/categories/${cat.id}`, { method: "PATCH", body: { isOpen: !cat.isOpen } });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update category.");
    }
  }

  async function deleteCategory(cat: TournamentCategory) {
    const ok = await ask({
      title: `Remove ${FORMAT_LABEL[cat.format]} · ${LEVEL_LABEL[cat.level]}?`,
      message: cat.entryCount ? `${cat.entryCount} entries will be dropped.` : "This category has no entries yet.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/tournaments/categories/${cat.id}`, { method: "DELETE" });
      toast.success("Category removed.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove.");
    }
  }

  async function removeReg(reg: TournamentRegistration) {
    const ok = await ask({
      title: `Remove ${reg.playerName}${reg.partnerName ? ` & ${reg.partnerName}` : ""}?`,
      message: `From ${FORMAT_LABEL[reg.format]} · ${LEVEL_LABEL[reg.level]}. This can't be undone.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/tournaments/registrations/${reg.id}`, { method: "DELETE" });
      toast.success("Entry removed.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove entry.");
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TournamentRegistration[]>();
    for (const r of regs) {
      const key = `${r.level}-${r.format}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [regs]);

  return (
    <div className="glass-panel overflow-hidden rounded-2xl">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Trophy size={22} />
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">{summary.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CalendarDays size={12} /> {fmt(summary.startsOn, "EEE d MMM")}{summary.startTime ? ` · ${summary.startTime}` : ""}</span>
              <span className="flex items-center gap-1"><MapPin size={12} /> {summary.venue}</span>
              <span className="flex items-center gap-1"><Users2 size={12} /> {summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", STATUS_TONE[summary.status])}>{summary.status}</span>
          <ChevronDown size={18} className={cn("text-muted-foreground transition", isOpen && "rotate-180")} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
            <div className="space-y-6 p-4 sm:p-5">
              {!detail ? (
                <div className="grid min-h-24 place-items-center text-muted-foreground"><Spinner className="size-5" /></div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(["draft", "open", "closed", "completed"] as TournamentStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(s)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${summary.status === s ? "border-primary bg-primary/15 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground"}`}
                      >
                        {s}
                      </button>
                    ))}
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button variant="glass" size="sm" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</Button>
                      <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 size={13} /> Delete</Button>
                    </div>
                  </div>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">Categories</h4>
                      <Button variant="ghost" size="sm" onClick={() => setAddingCategory(true)}><Plus size={13} /> Add category</Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detail.categories.map((c) => (
                        <div key={c.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${c.isOpen ? "border-primary/30 bg-primary/[.04]" : "border-border bg-soft"}`}>
                          <div>
                            <p className="text-sm font-semibold">{FORMAT_LABEL[c.format]} · {LEVEL_LABEL[c.level]}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {c.entryCount} entries{c.maxEntries != null && ` · cap ${c.maxEntries}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCategory(c)}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${c.isOpen ? "bg-primary/15 text-primary" : "bg-amber/15 text-amber"}`}
                            >
                              {c.isOpen ? "Open" : "Closed"}
                            </button>
                            <button onClick={() => deleteCategory(c)} className="rounded-lg p-1 text-muted-foreground transition hover:text-destructive" aria-label="Remove category">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {!detail.categories.length && (
                        <p className="col-span-full rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No categories yet. Add one to open registration.
                        </p>
                      )}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">Registrations</h4>
                    <div className="space-y-4">
                      {detail.categories.map((c) => {
                        const list = grouped.get(`${c.level}-${c.format}`) ?? [];
                        return (
                          <div key={c.id} className="rounded-xl border border-border bg-soft/40 p-3">
                            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              {FORMAT_LABEL[c.format]} · {LEVEL_LABEL[c.level]} — {list.length}
                            </p>
                            {list.length === 0 ? (
                              <p className="py-1 text-xs text-muted-foreground">No entries yet.</p>
                            ) : (
                              <ul className="space-y-1">
                                {list.map((r) => (
                                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-background/40 px-3 py-2 text-sm">
                                    <div className="min-w-0">
                                      <p className="truncate">{r.playerName}{r.partnerName ? <span className="text-muted-foreground"> & </span> : null}{r.partnerName}</p>
                                    </div>
                                    <div className="flex gap-1">
                                      <button onClick={() => setEditingReg(r)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground" aria-label="Edit">
                                        <Pencil size={13} />
                                      </button>
                                      <button onClick={() => removeReg(r)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive" aria-label="Remove">
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {detail && <CategorySheet open={addingCategory} onClose={() => setAddingCategory(false)} tournamentId={summary.id} existing={detail.categories} onCreated={() => { setAddingCategory(false); load(); onChanged(); }} />}
      {detail && <EditTournamentSheet open={editing} onClose={() => setEditing(false)} summary={summary} onSaved={() => { setEditing(false); load(); onChanged(); }} />}
      {detail && <EditRegistrationSheet registration={editingReg} onClose={() => setEditingReg(null)} categories={detail.categories} players={detail.players ?? []} onSaved={() => { setEditingReg(null); load(); onChanged(); }} />}
      {dialog}
    </div>
  );
}

function CreateSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(isoDay(new Date()));
  const [startTime, setStartTime] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(""); setStartsOn(isoDay(new Date())); setStartTime(""); setVenue(""); setDescription("");
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !venue.trim()) return toast.error("Fill in name and venue.");
    setBusy(true);
    try {
      await api("/api/admin/tournaments", { body: { name: name.trim(), startsOn, startTime: startTime || null, venue: venue.trim(), description: description.trim() || null } });
      toast.success("Tournament created.");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New tournament" subtitle="Set the basics — you'll add categories next.">
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <Field label="Name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Winter smash 2026" maxLength={120} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><input className="field" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required /></Field>
          <Field label="Start time (optional)"><input className="field" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
        </div>
        <Field label="Venue">
          <input className="field" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Sportlife arena" maxLength={120} required />
        </Field>
        <Field label="Description (optional)">
          <textarea className="field h-24 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Format notes, entry fee, prizes…" />
        </Field>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} Create tournament
        </Button>
      </form>
    </Sheet>
  );
}

function EditTournamentSheet({ open, onClose, summary, onSaved }: { open: boolean; onClose: () => void; summary: Tournament; onSaved: () => void }) {
  const [name, setName] = useState(summary.name);
  const [startsOn, setStartsOn] = useState(summary.startsOn);
  const [startTime, setStartTime] = useState(summary.startTime ?? "");
  const [venue, setVenue] = useState(summary.venue);
  const [description, setDescription] = useState(summary.description ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(summary.name); setStartsOn(summary.startsOn); setStartTime(summary.startTime ?? ""); setVenue(summary.venue); setDescription(summary.description ?? "");
  }, [open, summary.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/admin/tournaments/${summary.id}`, {
        method: "PATCH",
        body: { name: name.trim(), startsOn, startTime: startTime || null, venue: venue.trim(), description: description.trim() || null },
      });
      toast.success("Saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Edit tournament" subtitle={summary.name}>
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><input className="field" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required /></Field>
          <Field label="Start time"><input className="field" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
        </div>
        <Field label="Venue"><input className="field" value={venue} onChange={(e) => setVenue(e.target.value)} required /></Field>
        <Field label="Description"><textarea className="field h-24 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>{busy && <Spinner />} Save</Button>
      </form>
    </Sheet>
  );
}

function CategorySheet({ open, onClose, tournamentId, existing, onCreated }: { open: boolean; onClose: () => void; tournamentId: number; existing: TournamentCategory[]; onCreated: () => void }) {
  const [format, setFormat] = useState<TournamentFormat>("doubles");
  const [level, setLevel] = useState<PlayerLevel>("intermediate");
  const [maxEntries, setMaxEntries] = useState("");
  const [busy, setBusy] = useState(false);

  const dup = existing.some((c) => c.format === format && c.level === level);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (dup) return toast.error("That format + level already exists.");
    setBusy(true);
    try {
      await api(`/api/admin/tournaments/${tournamentId}/categories`, {
        body: { format, level, isOpen: true, maxEntries: maxEntries ? Number(maxEntries) : null },
      });
      toast.success("Category added.");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add category" subtitle="Choose format, level, and optional cap.">
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <Field label="Format">
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button key={f} type="button" onClick={() => setFormat(f)} className={`rounded-xl border px-3 py-2 text-sm font-semibold capitalize transition ${format === f ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground"}`}>
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Level">
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button key={l} type="button" onClick={() => setLevel(l)} className={`rounded-xl border px-3 py-2 text-sm font-semibold capitalize transition ${level === l ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground"}`}>
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Max entries (optional)">
          <input className="field" type="number" min="1" max="500" value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} placeholder="Leave empty for no cap" />
        </Field>
        {dup && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">That format + level combo already exists.</p>}
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy || dup}>{busy && <Spinner />} <Layers3 size={15} /> Add category</Button>
      </form>
    </Sheet>
  );
}

function EditRegistrationSheet({ registration, onClose, categories, players, onSaved }: {
  registration: TournamentRegistration | null;
  onClose: () => void;
  categories: TournamentCategory[];
  players: NonNullable<TournamentDetail["players"]>;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number>(0);
  const [playerId, setPlayerId] = useState<number>(0);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerMode, setPartnerMode] = useState<"existing" | "manual">("existing");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!registration) return;
    setCategoryId(registration.categoryId);
    setPlayerId(registration.playerId);
    if (registration.partnerId) {
      setPartnerMode("existing");
      setPartnerId(registration.partnerId);
      setPartnerName("");
    } else if (registration.partnerName) {
      setPartnerMode("manual");
      setPartnerId(null);
      setPartnerName(registration.partnerName);
    } else {
      setPartnerMode("existing");
      setPartnerId(null);
      setPartnerName("");
    }
  }, [registration?.id]);

  if (!registration) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const cat = categories.find((c) => c.id === categoryId);
  const partnerNeeded = cat && cat.format !== "singles";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (partnerNeeded) {
      if (partnerMode === "existing" && !partnerId) return toast.error("Pick a partner.");
      if (partnerMode === "manual" && !partnerName.trim()) return toast.error("Enter a partner name.");
    }
    setBusy(true);
    try {
      await api(`/api/admin/tournaments/registrations/${registration!.id}`, {
        method: "PATCH",
        body: {
          categoryId,
          playerId,
          partnerId: partnerNeeded && partnerMode === "existing" ? partnerId : null,
          partnerName: partnerNeeded && partnerMode === "manual" ? partnerName.trim() : null,
        },
      });
      toast.success("Entry updated.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!registration} onClose={onClose} title="Edit entry" subtitle="Move a pair between categories or swap the players.">
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <Field label="Category">
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{FORMAT_LABEL[c.format]} · {LEVEL_LABEL[c.level]}</option>
            ))}
          </select>
        </Field>
        <Field label="Player">
          <select className="field" value={playerId} onChange={(e) => setPlayerId(Number(e.target.value))}>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {partnerNeeded && (
          <Field label="Partner">
            <div className="mb-2 flex rounded-xl border border-border bg-soft p-1 text-xs">
              <button type="button" onClick={() => { setPartnerMode("existing"); setPartnerName(""); }} className={`flex-1 rounded-lg py-2 font-semibold transition ${partnerMode === "existing" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                From roster
              </button>
              <button type="button" onClick={() => { setPartnerMode("manual"); setPartnerId(null); }} className={`flex-1 rounded-lg py-2 font-semibold transition ${partnerMode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                Not on the app
              </button>
            </div>
            {partnerMode === "existing" ? (
              <select className="field" value={partnerId ?? ""} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— pick a player —</option>
                {players.filter((p) => p.id !== playerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <input className="field" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Partner's full name" maxLength={60} />
            )}
          </Field>
        )}
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>{busy && <Spinner />} Save entry</Button>
      </form>
    </Sheet>
  );
}
