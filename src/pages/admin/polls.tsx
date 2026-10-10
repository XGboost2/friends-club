import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarPlus, Check, Clock3, CreditCard, Layers3, Lock, LockOpen, MapPin, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { MonthCalendar } from "@/components/month-calendar";
import { api, type Admin, type Session, type SessionDetail } from "@/lib/api";
import { useConfirm } from "@/components/confirm-dialog";
import { cn, fmt, isoDay, maskCard } from "@/lib/utils";

const VENUES_KEY = "friends-club.venues";
function rememberedVenues(): string[] {
  try {
    return JSON.parse(localStorage.getItem(VENUES_KEY) || "[]");
  } catch {
    return [];
  }
}
function rememberVenue(venue: string) {
  try {
    const list = [venue, ...rememberedVenues().filter((v) => v !== venue)].slice(0, 6);
    localStorage.setItem(VENUES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export default function AdminPolls() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Session | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [reopening, setReopening] = useState<Session | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ sessions: Session[] }>("/api/admin/sessions");
      setSessions(res.sessions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load polls.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const venues = useMemo(() => [...new Set([...rememberedVenues(), ...(sessions ?? []).map((s) => s.venue)])].slice(0, 6), [sessions]);

  async function patch(id: number, body: Record<string, unknown>, message?: string) {
    try {
      await api(`/api/admin/sessions/${id}`, { method: "PATCH", body });
      if (message) toast.success(message);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api(`/api/admin/sessions/${deleting.id}`, { method: "DELETE" });
      toast.success("Poll deleted.");
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <Eyebrow>The clubhouse / Polls</Eyebrow>
          <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
            Plan the next rally<span className="text-primary">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">Post polls for any dates, then fill in court numbers once you've booked them.</p>
        </div>
        <Button variant="neon" size="lg" onClick={() => setCreating(true)}>
          <CalendarPlus size={18} /> Post a poll
        </Button>
      </div>

      {!sessions && (
        <div className="grid min-h-60 place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      )}
      {sessions?.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarPlus size={26} />
          </div>
          <h2 className="font-display text-2xl font-bold">No upcoming polls</h2>
          <p className="mt-2 text-sm text-muted-foreground">Post your first one — players will see the dates light up on their calendar.</p>
          <Button variant="neon" className="mt-6" onClick={() => setCreating(true)}>
            Post a poll
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AnimatePresence>
          {sessions?.map((s, i) => (
            <PollCard
              key={s.id}
              session={s}
              index={i}
              onCourts={(value) => patch(s.id, { courtNumbers: value }, value ? "Court numbers saved." : "Court numbers cleared.")}
              onClose={() => patch(s.id, { status: "closed" }, "Voting closed.")}
              onReopen={() => setReopening(s)}
              onEdit={() => setEditing(s)}
              onDelete={() => setDeleting(s)}
              onOpen={() => setDetail(s)}
            />
          ))}
        </AnimatePresence>
      </div>

      <AdminTeam />

      <PollForm open={creating} onClose={() => setCreating(false)} venues={venues} onSaved={load} />
      <PollForm open={!!editing} session={editing} onClose={() => setEditing(null)} venues={venues} onSaved={load} />
      <PollDetail session={detail} onClose={() => setDetail(null)} onChanged={load} />
      <ReopenSheet
        session={reopening}
        onClose={() => setReopening(null)}
        onReopen={async (minutes) => {
          if (!reopening) return;
          await patch(reopening.id, { status: "open", reopenMinutes: minutes }, `Voting reopened for ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes} min`}.`);
          setReopening(null);
        }}
      />
      <Sheet open={!!deleting} onClose={() => setDeleting(null)} title="Delete this poll?" subtitle={deleting ? `${fmt(deleting.date, "EEEE, d MMMM")} · ${deleting.total} signed up` : null}>
        <p className="pt-3 text-sm leading-relaxed text-muted-foreground">Everyone who joined will lose their spot. This can't be undone.</p>
        <div className="grid gap-3 pb-4 pt-6 sm:grid-cols-2">
          <Button variant="glass" size="lg" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={remove}>
            <Trash2 size={16} /> Delete poll
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function PollCard({ session: s, index, onCourts, onClose, onReopen, onEdit, onDelete, onOpen }: { session: Session; index: number; onCourts: (v: string) => void; onClose: () => void; onReopen: () => void; onEdit: () => void; onDelete: () => void; onOpen: () => void }) {
  const [courts, setCourts] = useState(s.courtNumbers ?? "");
  const [menu, setMenu] = useState(false);
  useEffect(() => setCourts(s.courtNumbers ?? ""), [s.courtNumbers]);
  const pct = Math.min(100, (s.total / s.capacity) * 100);
  const dirty = courts.trim() !== (s.courtNumbers ?? "");
  const reopenActive = s.status === "open" && s.reopenUntil && new Date(s.reopenUntil).getTime() > Date.now();

  return (
    <motion.article layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ delay: index * 0.04 }} className={cn("glass-panel relative rounded-2xl p-5 sm:p-6", s.status === "closed" && "opacity-80")}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="flex min-w-0 items-center gap-4 text-left">
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-soft leading-none">
            <span className="font-display text-2xl font-bold">{fmt(s.date, "dd")}</span>
            <span className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">{fmt(s.date, "MMM")}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">{fmt(s.date, "EEEE")}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock3 size={12} /> {s.startTime}–{s.endTime}
              </span>
              <span className="flex min-w-0 items-center gap-1">
                <MapPin size={12} /> <span className="truncate">{s.venue}</span>
              </span>
            </p>
          </div>
        </button>
        <div className="relative flex shrink-0 items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", reopenActive ? "bg-amber/15 text-amber" : s.status === "open" ? "bg-primary/10 text-primary" : "bg-soft text-muted-foreground")}>
            {reopenActive ? `Reopened · until ${fmt(s.reopenUntil!, "HH:mm")}` : s.status === "open" ? "Open" : "Closed"}
          </span>
          <button onClick={() => setMenu((m) => !m)} className="grid size-9 place-items-center rounded-lg border border-border bg-soft text-muted-foreground transition hover:text-foreground" aria-label="Poll actions">
            <MoreHorizontal size={17} />
          </button>
          <AnimatePresence>
            {menu && (
              <>
                <button className="fixed inset-0 z-20 cursor-default" onClick={() => setMenu(false)} aria-label="Close menu" />
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} className="absolute right-0 top-11 z-30 w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-2xl">
                  {[
                    { label: "See players", icon: Users, fn: onOpen },
                    { label: "Edit details", icon: Pencil, fn: onEdit },
                    { label: s.status === "open" ? "Close voting" : "Reopen voting", icon: s.status === "open" ? Lock : LockOpen, fn: s.status === "open" ? onClose : onReopen },
                    { label: "Delete poll", icon: Trash2, fn: onDelete, danger: true },
                  ].map(({ label, icon: Icon, fn, danger }) => (
                    <button key={label} onClick={() => { setMenu(false); fn(); }} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-soft", danger && "text-destructive")}>
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <button onClick={onOpen} className="mt-5 block w-full text-left">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users size={13} className="text-cyan" /> <strong className="text-foreground">{s.total}</strong>/{s.capacity}
            </span>
            <span className="flex items-center gap-1">
              <CreditCard size={13} className="text-primary" /> {s.multisportCount ?? 0} Multisport
            </span>
            {s.guestCount > 0 && (
              <span className="flex items-center gap-1">
                <UserPlus size={13} className="text-violet" /> {s.guestCount} guests
              </span>
            )}
          </span>
          <span className="text-muted-foreground">{s.courtsCount} courts</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-soft">
          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} className={cn("h-full rounded-full", pct >= 100 ? "bg-amber" : "bg-primary")} />
        </div>
      </button>

      <form
        className="mt-5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) onCourts(courts.trim());
        }}
      >
        <label className="relative flex-1">
          <Layers3 size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan" />
          <input className="field h-11 pl-10 text-sm" value={courts} onChange={(e) => setCourts(e.target.value)} onBlur={() => dirty && onCourts(courts.trim())} placeholder="Court number(s), e.g. 3, 4" aria-label="Court numbers" maxLength={60} />
        </label>
        <Button type="submit" variant={dirty ? "neon" : "glass"} className="h-11 px-4" disabled={!dirty}>
          <Check size={16} />
        </Button>
      </form>
    </motion.article>
  );
}

function ReopenSheet({ session, onClose, onReopen }: { session: Session | null; onClose: () => void; onReopen: (minutes: number) => void }) {
  const [custom, setCustom] = useState("");
  useEffect(() => { if (!session) setCustom(""); }, [session]);
  const presets = [30, 60, 120, 240];
  const label = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)}h ${m % 60}m`);
  return (
    <Sheet open={!!session} onClose={onClose} title="Reopen voting" subtitle={session ? `${fmt(session.date, "EEEE, d MMMM")} · ${session.startTime}–${session.endTime}` : null}>
      <p className="pt-3 text-sm leading-relaxed text-muted-foreground">
        Pick how long players can join again. The poll auto-closes when the window ends.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 pb-2">
        {presets.map((m) => (
          <Button key={m} variant="glass" size="lg" onClick={() => onReopen(m)}>
            {label(m)}
          </Button>
        ))}
      </div>
      <form
        className="mt-3 flex items-center gap-2 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(custom);
          if (!Number.isInteger(n) || n < 1 || n > 24 * 60) return;
          onReopen(n);
        }}
      >
        <input
          className="field h-11 flex-1"
          type="number"
          min={1}
          max={24 * 60}
          placeholder="Custom (minutes, max 1440)"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <Button type="submit" variant="neon" className="h-11 px-4" disabled={!custom || Number(custom) < 1}>
          Reopen
        </Button>
      </form>
    </Sheet>
  );
}

function PollForm({ open, onClose, session, venues, onSaved }: { open: boolean; onClose: () => void; session?: Session | null; venues: string[]; onSaved: () => void }) {
  const editing = !!session;
  const today = isoDay(new Date());
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(today);
  const [startTime, setStart] = useState("19:00");
  const [endTime, setEnd] = useState("21:00");
  const [venue, setVenue] = useState("");
  const [capacity, setCapacity] = useState(12);
  const [courtsCount, setCourtsCount] = useState(2);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (session) {
      setDate(session.date);
      setStart(session.startTime);
      setEnd(session.endTime);
      setVenue(session.venue);
      setCapacity(session.capacity);
      setCourtsCount(session.courtsCount);
      setNotes(session.notes ?? "");
    } else {
      setDates(new Set());
      setVenue((v) => v || venues[0] || "");
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing && dates.size === 0) return toast.error("Pick at least one date on the calendar.");
    if (endTime <= startTime) return toast.error("End time must be after start time.");
    setBusy(true);
    try {
      const body = { startTime, endTime, venue: venue.trim(), capacity: Number(capacity), courtsCount: Number(courtsCount), notes: notes.trim() || null };
      if (editing && session) {
        await api(`/api/admin/sessions/${session.id}`, { method: "PATCH", body: { ...body, date } });
        toast.success("Poll updated.");
      } else {
        const res = await api<{ created: number }>("/api/admin/sessions", { body: { ...body, dates: [...dates] } });
        toast.success(`${res.created} poll${res.created > 1 ? "s" : ""} posted!`);
      }
      rememberVenue(venue.trim());
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...dates].sort();

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Edit poll" : "Post a poll"} subtitle={editing ? null : "Tap one or more dates — each becomes its own poll."} className="sm:max-w-2xl">
      <form onSubmit={submit} className="space-y-5 pb-4 pt-4">
        {editing ? (
          <Field label="Date">
            <input className="field" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        ) : (
          <div className="rounded-2xl border border-border bg-soft p-3 sm:p-4">
            <MonthCalendar
              compact
              today={today}
              picked={dates}
              onTogglePick={(iso) =>
                setDates((d) => {
                  const next = new Set(d);
                  if (next.has(iso)) next.delete(iso);
                  else next.add(iso);
                  return next;
                })
              }
            />
            {sorted.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {sorted.map((d) => (
                  <button key={d} type="button" onClick={() => setDates((s) => { const n = new Set(s); n.delete(d); return n; })} className="flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                    {fmt(d, "EEE d MMM")} <X size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Starts">
            <input className="field" type="time" value={startTime} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Ends">
            <input className="field" type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
        </div>
        <Field label="Venue">
          <input className="field" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Hamr Sport Braník" maxLength={120} required />
          {venues.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {venues.map((v) => (
                <button key={v} type="button" onClick={() => setVenue(v)} className={cn("rounded-full border px-3 py-1 text-xs transition", venue === v ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {v}
                </button>
              ))}
            </span>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max players" hint="Including guests">
            <input className="field" type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} required />
          </Field>
          <Field label="Courts">
            <input className="field" type="number" min={1} max={50} value={courtsCount} onChange={(e) => setCourtsCount(Number(e.target.value))} required />
          </Field>
        </div>
        <Field label="Note for players (optional)">
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bring your own shuttles" maxLength={500} />
        </Field>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} {editing ? "Save changes" : dates.size > 1 ? `Post ${dates.size} polls` : "Post poll"}
        </Button>
      </form>
    </Sheet>
  );
}

function PollDetail({ session, onClose, onChanged }: { session: Session | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const load = useCallback(async () => {
    if (!session) return;
    const res = await api<{ session: SessionDetail }>(`/api/admin/sessions/${session.id}`);
    setDetail(res.session);
  }, [session]);
  useEffect(() => {
    setDetail(null);
    load().catch(() => {});
  }, [load]);

  async function removePlayer(id: number, name: string) {
    const ok = await ask({
      title: `Remove ${name}?`,
      message: "Their guests will be removed too. This can't be undone.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    await api(`/api/admin/registrations/${id}`, { method: "DELETE" });
    toast.success(`${name} removed.`);
    load();
    onChanged();
  }

  return (
    <Sheet open={!!session} onClose={onClose} title="Players" subtitle={session ? `${fmt(session.date, "EEEE, d MMMM")} · ${session.startTime}–${session.endTime}` : null} className="sm:max-w-xl">
      <div className="space-y-2 pb-4 pt-4">
        {!detail && (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Spinner />
          </div>
        )}
        {detail?.registrations.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nobody has joined yet.</p>}
        {detail?.registrations.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-soft px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.multisport ? (
                    <>
                      Multisport · <span className="font-mono">{maskCard(r.cardNumber)}</span> · {r.holderName}
                    </>
                  ) : (
                    "Paying at venue"
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider", r.status === "paid" ? "bg-emerald/15 text-emerald" : "bg-amber/15 text-amber")}>{r.status}</span>
                <button onClick={() => removePlayer(r.id, r.name)} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive" aria-label={`Remove ${r.name}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            {r.guests.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserPlus size={12} className="text-violet" /> {r.guests.map((g) => g.name).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
      {confirmDialog}
    </Sheet>
  );
}

function AdminTeam() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const load = useCallback(async () => {
    const res = await api<{ admins: Admin[]; me: number }>("/api/admin/admins");
    setAdmins(res.admins);
    setMe(res.me);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function setApproved(a: Admin, approved: boolean) {
    try {
      await api(`/api/admin/admins/${a.id}`, { method: "PATCH", body: { approved } });
      toast.success(approved ? `${a.email} is now an admin.` : `${a.email}'s access removed.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update.");
    }
  }

  if (!admins) return null;
  const pending = admins.filter((a) => !a.approved);
  return (
    <section className="mt-14">
      <div className="mb-4 flex items-center gap-3">
        <ShieldCheck size={20} className="text-cyan" />
        <h2 className="font-display text-2xl font-bold">Admins</h2>
        {pending.length > 0 && <span className="rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-semibold text-amber">{pending.length} waiting</span>}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Other organisers can create an account at <span className="font-mono text-foreground">/admin/login</span>. Approve them here to give them access.
      </p>
      <div className="glass-panel divide-y divide-border rounded-2xl">
        {admins.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {a.email} {a.id === me && <span className="text-xs text-muted-foreground">(you)</span>}
              </p>
              <p className="text-xs text-muted-foreground">{a.approved ? "Admin" : "Waiting for approval"}</p>
            </div>
            {a.id !== me &&
              (a.approved ? (
                <Button variant="ghost" size="sm" onClick={() => setApproved(a, false)}>
                  Remove access
                </Button>
              ) : (
                <Button variant="neon" size="sm" onClick={() => setApproved(a, true)}>
                  <Check size={14} /> Approve
                </Button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
