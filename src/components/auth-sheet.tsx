import { useEffect, useState } from "react";
import { Mail, Phone, ShieldCheck, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/field";
import { api, type Player, type PlayerLevel } from "@/lib/api";
import { usePlayer } from "@/lib/player";

type Mode = "signin" | "signup";
type Step = "details" | "code";

const LEVELS: { value: PlayerLevel; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "New to badminton or just picking it up" },
  { value: "intermediate", label: "Intermediate", hint: "Comfortable rallies, working on placement" },
  { value: "advanced", label: "Advanced", hint: "Confident play, competitive drives and smashes" },
];

export function AuthSheet({ open, onClose, initialMode = "signup", onSignedIn }: { open: boolean; onClose: () => void; initialMode?: Mode; onSignedIn?: (player: Player) => void }) {
  const { setPlayer } = usePlayer();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState<PlayerLevel>("intermediate");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep("details");
    setCode("");
    setBusy(false);
    setResendIn(0);
  }, [open, initialMode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const purpose = mode === "signup" ? "register" : "login";

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return toast.error("Enter your email first.");
    if (mode === "signup") {
      if (!name.trim()) return toast.error("Enter your name.");
      if (!phone.trim() || phone.trim().length < 6) return toast.error("Enter a valid phone number.");
    }
    setBusy(true);
    try {
      await api("/api/auth/request-otp", { body: { email: trimmedEmail, purpose } });
      toast.success(`If that email matches an account, we've sent a code to ${trimmedEmail}.`);
      setStep("code");
      setResendIn(30);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6) return toast.error("Enter the 6-digit code from your email.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = { email: email.trim().toLowerCase(), purpose, code: code.trim() };
      if (mode === "signup") {
        body.name = name.trim();
        body.phone = phone.trim();
        body.level = level;
      }
      const res = await api<{ player: Player }>("/api/auth/verify-otp", { body });
      setPlayer(res.player);
      toast.success(mode === "signup" ? `Welcome, ${res.player.name.split(" ")[0]}!` : `Welcome back, ${res.player.name.split(" ")[0]}!`);
      onSignedIn?.(res.player);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't verify code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "signup" ? "Create your player account" : "Sign in to Friends Club"}
      subtitle={step === "code" ? `Enter the code we sent to ${email}` : "One account per person. Verify with an email code — no passwords."}
    >
      <div className="pb-4 pt-2">
        {step === "details" && (
          <div className="mb-5 flex rounded-xl border border-border bg-soft p-1">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "signup" ? "Register" : "Sign in"}
              </button>
            ))}
          </div>
        )}

        {step === "details" ? (
          <form onSubmit={requestCode} className="space-y-4">
            <Field label="Email">
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="field pl-10"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            </Field>

            {mode === "signup" && (
              <>
                <Field label="Full name">
                  <div className="relative">
                    <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className="field pl-10"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Jane Novak"
                      maxLength={60}
                      required
                    />
                  </div>
                </Field>
                <Field label="Phone number" hint="Used only if an admin needs to reach you about a session.">
                  <div className="relative">
                    <Phone size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className="field pl-10"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+420 …"
                      maxLength={30}
                      required
                    />
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
              </>
            )}

            <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : <Sparkles size={16} />} Send verification code
            </Button>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-cyan" />
              We email you a 6-digit code — no passwords to remember. Your session stays signed in for 90 days on this device.
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-5">
            <Field label="6-digit code">
              <input
                className="field text-center font-mono text-2xl tracking-[.6em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
            <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? <Spinner /> : null} {mode === "signup" ? "Finish registration" : "Sign in"}
            </Button>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button type="button" onClick={() => setStep("details")} className="underline underline-offset-4 hover:text-foreground">
                Change email
              </button>
              <button
                type="button"
                onClick={() => requestCode()}
                disabled={busy || resendIn > 0}
                className="disabled:opacity-40 hover:text-foreground"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
