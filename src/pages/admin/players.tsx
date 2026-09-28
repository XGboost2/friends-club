import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, CircleCheck, Mail, Pencil, Phone, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useConfirm } from "@/components/confirm-dialog";
import { api, type AdminPlayer, type PlayerLevel } from "@/lib/api";
import { fmt } from "@/lib/utils";

const LEVELS: PlayerLevel[] = ["beginner", "intermediate", "advanced"];
const levelClass: Record<PlayerLevel, string> = {
  beginner: "bg-cyan/15 text-cyan",
  intermediate: "bg-primary/15 text-primary",
  advanced: "bg-violet/20 text-violet",
};

type Editing = { mode: "create" } | { mode: "edit"; player: AdminPlayer } | null;

export default function AdminPlayers() {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [q, setQ] = useState("");
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await api<{ players: AdminPlayer[] }>("/api/admin/players");
      setPlayers(res.players);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load players.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!players) return [];
    const query = q.trim().toLowerCase();
    if (!query) return players;
    return players.filter((p) => p.name.toLowerCase().includes(query) || p.email.toLowerCase().includes(query) || p.phone.toLowerCase().includes(query));
  }, [players, q]);

  async function toggleBlocked(p: AdminPlayer) {
    const ok = await ask({
      title: p.blocked ? `Unblock ${p.name}?` : `Block ${p.name}?`,
      message: p.blocked
        ? "They'll be able to sign in and join sessions again."
        : "They'll be signed out immediately and can't join any sessions until unblocked.",
      confirmLabel: p.blocked ? "Unblock" : "Block",
      tone: p.blocked ? "default" : "warning",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/players/${p.id}`, { method: "PATCH", body: { blocked: !p.blocked } });
      toast.success(p.blocked ? "Player unblocked." : "Player blocked.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update player.");
    }
  }

  async function remove(p: AdminPlayer) {
    const ok = await ask({
      title: `Delete ${p.name}?`,
      message: "Their account and every booking they've made will be removed. This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/players/${p.id}`, { method: "DELETE" });
      toast.success("Player deleted.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete player.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <Eyebrow>The clubhouse / Players</Eyebrow>
          <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
            Your verified crew<span className="text-primary">.</span>
          </h1>
          <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
            Everyone who's completed email verification. Add players manually, block spammers, or remove accounts that no longer play.
          </p>
        </div>
        <Button variant="neon" size="lg" onClick={() => setEditing({ mode: "create" })}>
          <UserPlus size={16} /> Add player
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck size={17} className="text-primary" /> Registered
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{players?.length ?? "…"}</span>
        </span>
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="field pl-10 h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone" />
        </div>
      </div>

      {!players && (
        <div className="grid min-h-60 place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      )}

      {players && filtered.length === 0 && (
        <div className="glass-panel mx-auto max-w-lg rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <UserPlus size={24} />
          </div>
          <h2 className="font-display text-2xl font-bold">{q ? "No matches" : "No players yet"}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {q ? "Try a different search term." : "Players will show up here as soon as they register via email."}
          </p>
        </div>
      )}

      <div className="grid gap-3">
        <AnimatePresence initial={false}>
          {filtered.map((p, i) => (
            <motion.article
              key={p.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ delay: Math.min(i * 0.02, 0.15), duration: 0.25 }}
              className={`glass-panel rounded-2xl p-4 sm:p-5 ${p.blocked ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-sm font-bold text-primary">
                    {p.name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-display text-lg font-bold">{p.name}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${levelClass[p.level]}`}>{p.level}</span>
                      {p.blocked && (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">Blocked</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><Mail size={13} /> {p.email}</span>
                      <span className="flex items-center gap-1.5"><Phone size={13} /> {p.phone}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{p.lastActive ? `Last joined ${fmt(p.lastActive, "d MMM")}` : "Never joined"}</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", player: p })}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button variant="glass" size="sm" onClick={() => toggleBlocked(p)}>
                  {p.blocked ? <><CircleCheck size={14} /> Unblock</> : <><Ban size={14} /> Block</>}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => remove(p)}>
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>

      <PlayerEditor
        state={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
      {dialog}
    </div>
  );
}

function PlayerEditor({ state, onClose, onSaved }: { state: Editing; onClose: () => void; onSaved: () => void }) {
  const open = !!state;
  const isEdit = state?.mode === "edit";
  const existing = isEdit ? state.player : null;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState<PlayerLevel>("intermediate");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail(existing?.email ?? "");
    setName(existing?.name ?? "");
    setPhone(existing?.phone ?? "");
    setLevel(existing?.level ?? "intermediate");
    setBusy(false);
  }, [open, existing?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !name.trim() || !phone.trim()) return toast.error("Fill every field.");
    setBusy(true);
    try {
      if (isEdit) {
        await api(`/api/admin/players/${existing!.id}`, { method: "PATCH", body: { email: email.trim().toLowerCase(), name: name.trim(), phone: phone.trim(), level } });
        toast.success("Player updated.");
      } else {
        await api("/api/admin/players", { body: { email: email.trim().toLowerCase(), name: name.trim(), phone: phone.trim(), level } });
        toast.success("Player added.");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit player" : "Add a player"}
      subtitle={isEdit ? "Update contact details or playing level." : "Manually create an account without email verification."}
    >
      <form onSubmit={submit} className="space-y-4 pb-4 pt-3">
        <Field label="Full name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="Email">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Phone">
          <input className="field" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} required />
        </Field>
        <Field label="Playing level">
          <div className="grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold capitalize transition ${level === l ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} {isEdit ? "Save changes" : "Add player"}
        </Button>
      </form>
    </Sheet>
  );
}
