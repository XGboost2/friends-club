import { useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Hourglass, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Field, Spinner } from "@/components/ui/field";
import { api, type Admin } from "@/lib/api";
import { useAdmin } from "@/lib/admin";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { admin, loading } = useAdmin();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  if (!admin.approved) return <PendingApproval email={admin.email} />;
  return <>{children}</>;
}

function PendingApproval({ email }: { email: string }) {
  const { logout, refresh } = useAdmin();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 text-center">
      <div className="mb-6 grid size-16 place-items-center rounded-2xl bg-amber/15 text-amber">
        <Hourglass size={28} />
      </div>
      <h1 className="font-display text-3xl font-bold">Waiting for approval</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        You're signed in as <strong className="text-foreground">{email}</strong>. An existing admin needs to approve your access from the Polls page.
      </p>
      <div className="mt-8 flex gap-3">
        <Button variant="glass" onClick={refresh}>
          Check again
        </Button>
        <Button variant="ghost" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default function AdminLogin() {
  const { admin, setAdmin } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from || "/admin/polls";

  if (admin?.approved) return <Navigate to={from} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ admin: Admin }>(mode === "signin" ? "/api/admin/login" : "/api/admin/signup", { body: { email, password } });
      setAdmin(res.admin);
      if (res.admin.approved) {
        toast.success(mode === "signup" ? "Welcome aboard — you're the club admin!" : "Welcome back!");
        navigate(from, { replace: true });
      } else {
        navigate("/admin/polls", { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[72vh] max-w-7xl items-center gap-10 px-4 pb-16 pt-4 sm:px-8 lg:grid-cols-2 lg:px-12">
      <div>
        <Eyebrow>Club operations</Eyebrow>
        <h1 className="font-display text-5xl font-bold leading-[1.02] sm:text-7xl">
          Behind the
          <br />
          <span className="text-glow text-primary">baseline.</span>
        </h1>
        <p className="mt-5 max-w-sm leading-relaxed text-muted-foreground">Post polls, assign courts, and check players in at the door.</p>
      </div>
      <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="glass-panel w-full max-w-md justify-self-center rounded-3xl p-6 sm:p-8 lg:justify-self-end">
        <div className="mb-6 flex rounded-xl border border-border bg-soft p-1">
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <Field label="Email">
            <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <input className="field" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : undefined} required />
          </Field>
        </div>
        <Button type="submit" variant="neon" size="lg" className="mt-6 w-full" disabled={busy}>
          {busy && <Spinner />} {mode === "signin" ? "Sign in" : "Create admin account"}
        </Button>
        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole size={14} className="mt-0.5 shrink-0 text-cyan" />
          {mode === "signup" ? "The very first account becomes the club admin. Later accounts need approval from an existing admin." : "Only club admins can sign in here. Players don't need an account."}
        </p>
      </motion.form>
    </div>
  );
}
