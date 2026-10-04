import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AtSign, Check, LogOut, Mail, Phone, ShieldCheck, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { api, type Player, type PlayerLevel } from "@/lib/api";
import { usePlayer } from "@/lib/player";

const LEVELS: { value: PlayerLevel; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "New to badminton or just picking it up" },
  { value: "intermediate", label: "Intermediate", hint: "Comfortable rallies, working on placement" },
  { value: "advanced", label: "Advanced", hint: "Confident play, competitive drives and smashes" },
];

export default function ProfilePage() {
  const { player, loading, setPlayer, logout } = usePlayer();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState<PlayerLevel>("intermediate");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (player) {
      setName(player.name);
      setPhone(player.phone ?? "");
      setLevel(player.level ?? "intermediate");
    }
  }, [player?.id]);

  if (loading) {
    return (
      <div className="mx-auto grid min-h-[60vh] max-w-lg place-items-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  if (!player) return <Navigate to="/" replace />;

  const dirty = name.trim() !== player.name || phone.trim() !== (player.phone ?? "") || level !== (player.level ?? "intermediate");
  const incomplete = !player.phone || !player.level;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return toast.error("Name and phone are required.");
    const wasIncomplete = incomplete;
    setBusy(true);
    try {
      const res = await api<{ player: Player }>("/api/me", { method: "PATCH", body: { name: name.trim(), phone: phone.trim(), level } });
      setPlayer(res.player);
      toast.success("Profile updated.");
      setSavedAt(Date.now());
      if (wasIncomplete) navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-8 sm:pt-12 lg:pt-16">
      <div className="mb-8">
        <Eyebrow>Your account</Eyebrow>
        <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-5xl">
          Profile<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          These details show up on registrations and let admins reach you if a session changes.
        </p>
        {incomplete && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
            <Sparkles size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Finish setting up your account</p>
              <p className="mt-1 text-xs leading-relaxed text-primary/80">Add your phone number and playing level so admins can match you with the right sessions.</p>
            </div>
          </div>
        )}
      </div>

      <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={save} className="glass-panel space-y-5 rounded-3xl p-5 sm:p-7">
        <Field label="Email" hint="Managed by your account provider. Change it in account settings.">
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="field pl-10 opacity-70" type="email" value={player.email} readOnly disabled />
          </div>
        </Field>

        <Field label="Full name">
          <div className="relative">
            <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="field pl-10" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
        </Field>

        <Field label="Phone">
          <div className="relative">
            <Phone size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="field pl-10" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} required />
          </div>
        </Field>

        <Field label="Playing level">
          <div className="grid gap-2">
            {LEVELS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${level === opt.value ? "border-primary/50 bg-primary/[.07]" : "border-border bg-soft hover:border-primary/25"}`}
              >
                <input
                  type="radio"
                  name="level"
                  value={opt.value}
                  checked={level === opt.value}
                  onChange={() => setLevel(opt.value)}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="ghost" size="sm" onClick={logout}>
            <LogOut size={14} /> Sign out
          </Button>
          <Button type="submit" variant="neon" size="lg" disabled={busy || !dirty}>
            {busy ? <Spinner /> : savedAt && !dirty ? <Check size={16} /> : null} {savedAt && !dirty ? "Saved" : "Save changes"}
          </Button>
        </div>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-cyan" />
          Your data stays with Friends Club and is only used for sessions and tournaments. If you delete an account,
          past registrations follow it out.
        </p>
      </motion.form>

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <AtSign size={13} /> Signed in as <span className="font-mono">{player.email}</span>
      </p>
    </div>
  );
}
