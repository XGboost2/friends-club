import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CameraOff, CheckCircle2, Clock, CreditCard, Expand, Keyboard, RefreshCcw, ScanLine, ShieldAlert, SwitchCamera, Trash2, UserPlus, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow, Spinner } from "@/components/ui/field";
import { api, type Session, type SessionDetail } from "@/lib/api";
import { useConfirm } from "@/components/confirm-dialog";
import { cn, fmt, maskCard } from "@/lib/utils";

type ScanResult = { result: "paid" | "already" | "unknown"; name?: string; code?: string; at: number };

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.25 : 0.45));
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.25 : 0.45));
  } catch {
    /* audio not available */
  }
}

export default function AdminCheckin() {
  const [today, setToday] = useState("");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState("");
  const [tab, setTab] = useState<"pending" | "paid" | "other">("pending");
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const busy = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    api<{ today: string; sessions: Session[] }>("/api/admin/checkin/sessions")
      .then((r) => {
        setToday(r.today);
        setSessions(r.sessions);
        const todays = r.sessions.filter((s) => s.date === r.today);
        setSessionId((todays[0] ?? r.sessions.find((s) => s.date > r.today) ?? r.sessions[0])?.id ?? null);
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const loadDetail = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api<{ session: SessionDetail }>(`/api/admin/sessions/${sessionId}`);
      setDetail(r.session);
    } catch {
      /* keep last known */
    }
  }, [sessionId]);

  useEffect(() => {
    setDetail(null);
    loadDetail();
    const t = setInterval(loadDetail, 5000);
    return () => clearInterval(t);
  }, [loadDetail]);

  const submitCode = useCallback(
    async (code: string) => {
      if (!sessionId || busy.current) return;
      const now = Date.now();
      if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < 4000) return;
      lastCode.current = { code, at: now };
      busy.current = true;
      try {
        const r = await api<{ result: ScanResult["result"]; name?: string; code?: string }>("/api/admin/checkin/scan", { body: { sessionId, code } });
        setLast({ ...r, at: Date.now() });
        beep(r.result !== "unknown");
        if (navigator.vibrate) navigator.vibrate(r.result === "unknown" ? [80, 60, 80] : 60);
        loadDetail();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Scan failed.");
      } finally {
        busy.current = false;
      }
    },
    [sessionId, loadDetail],
  );

  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 3800);
    return () => clearTimeout(t);
  }, [last]);

  async function mark(kind: "registrations" | "guests", id: number, status: "paid" | "pending") {
    if (status === "pending") {
      const ok = await ask({
        title: "Undo check-in?",
        message: "This will move the row back to pending. You can mark it paid again anytime.",
        confirmLabel: "Move to pending",
        tone: "warning",
      });
      if (!ok) return;
    }
    try {
      await api(`/api/admin/${kind}/${id}`, { method: "PATCH", body: { status } });
      loadDetail();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update.");
    }
  }

  async function remove(kind: "registrations" | "guests", id: number, name: string) {
    const label = kind === "guests" ? `${name} (guest)` : name;
    const ok = await ask({
      title: `Remove ${label}?`,
      message: "They'll be dropped from this session. This can't be undone.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/admin/${kind}/${id}`, { method: "DELETE" });
      toast.success(`Removed ${label}.`);
      loadDetail();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove.");
    }
  }

  const regs = detail?.registrations ?? [];
  const pending = regs.filter((r) => r.multisport && r.status === "pending");
  const paid = regs.filter((r) => r.multisport && r.status === "paid");
  const others = [
    ...regs.filter((r) => !r.multisport).map((r) => ({ kind: "registrations" as const, id: r.id, name: r.name, status: r.status, sub: "Player · paying at venue" })),
    ...regs.flatMap((r) => r.guests.map((g) => ({ kind: "guests" as const, id: g.id, name: g.name, status: g.status, sub: `Guest of ${r.name}` }))),
  ];
  const othersPaid = others.filter((o) => o.status === "paid").length;
  const selected = sessions?.find((s) => s.id === sessionId);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>The clubhouse / Check-in</Eyebrow>
          <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
            Ready at the door<span className="text-primary">.</span>
          </h1>
        </div>
        {sessions && sessions.length > 0 && (
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {sessions.map((s) => (
              <button key={s.id} onClick={() => setSessionId(s.id)} className={cn("shrink-0 rounded-xl border px-3.5 py-2 text-left text-xs transition", s.id === sessionId ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-soft text-muted-foreground hover:text-foreground")}>
                <span className="block font-semibold">{s.date === today ? "Today" : fmt(s.date, "EEE d MMM")}</span>
                {s.startTime}–{s.endTime}
              </button>
            ))}
          </div>
        )}
      </div>

      {sessions && sessions.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ScanLine size={26} />
          </div>
          <h2 className="font-display text-2xl font-bold">No session today</h2>
          <p className="mt-2 text-sm text-muted-foreground">Check-in opens for sessions from yesterday to tomorrow.</p>
        </div>
      )}
      {!sessions && (
        <div className="grid min-h-60 place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      )}

      {selected && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div ref={stageRef} className="glass-panel relative overflow-hidden rounded-3xl p-4 sm:p-6 [&:fullscreen]:rounded-none [&:fullscreen]:bg-background [&:fullscreen]:p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold">Scan your Multisport card</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.venue} · {selected.startTime}–{selected.endTime}
                </p>
              </div>
              <Button
                variant="glass"
                size="icon"
                className="size-9 shrink-0"
                aria-label="Kiosk full screen"
                onClick={() => {
                  if (document.fullscreenElement) document.exitFullscreen();
                  else stageRef.current?.requestFullscreen?.().catch(() => {});
                }}
              >
                <Expand size={16} />
              </Button>
            </div>
            <Scanner onCode={submitCode} />
            <AnimatePresence>{last && <ResultFlash key={last.at} result={last} />}</AnimatePresence>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (manual.trim()) {
                  lastCode.current = null;
                  submitCode(manual.trim());
                  setManual("");
                }
              }}
            >
              <label className="relative flex-1">
                <Keyboard size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className="field h-11 pl-10 font-mono text-sm" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or type the card number" autoComplete="off" />
              </label>
              <Button type="submit" variant="glass" className="h-11">
                Check
              </Button>
            </form>
          </div>

          <div>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat label="Paid" value={paid.length} tone="emerald" icon={<CheckCircle2 size={16} />} />
              <Stat label="Pending" value={pending.length} tone="amber" icon={<Clock size={16} />} />
              <Stat label="Others" value={`${othersPaid}/${others.length}`} tone="cyan" icon={<Wallet size={16} />} />
            </div>
            <div className="glass-panel rounded-2xl p-2">
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-soft p-1">
                {([
                  ["pending", `Pending (${pending.length})`],
                  ["paid", `Paid (${paid.length})`],
                  ["other", `Others (${others.length})`],
                ] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)} className={cn("rounded-lg py-2 text-xs font-semibold transition sm:text-sm", tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="max-h-[55vh] min-h-48 space-y-1.5 overflow-y-auto p-2">
                {!detail && (
                  <div className="grid place-items-center py-10 text-muted-foreground">
                    <Spinner />
                  </div>
                )}
                {detail && tab === "pending" && (pending.length ? pending.map((r) => <Row key={r.id} name={r.name} sub={`${r.holderName ?? ""} · ${maskCard(r.cardNumber)}`} status="pending" icon={<CreditCard size={15} />} onToggle={() => mark("registrations", r.id, "paid")} onRemove={() => remove("registrations", r.id, r.name)} />) : <Empty text="Everyone with Multisport has scanned in. 🎉" />)}
                {detail && tab === "paid" && (paid.length ? paid.map((r) => <Row key={r.id} name={r.name} sub={`${r.paidMethod === "scan" ? "Scanned" : "Marked"} ${r.paidAt ? new Date(r.paidAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`} status="paid" icon={<CreditCard size={15} />} onToggle={() => mark("registrations", r.id, "pending")} onRemove={() => remove("registrations", r.id, r.name)} />) : <Empty text="No one has checked in yet." />)}
                {detail && tab === "other" && (others.length ? others.map((o) => <Row key={`${o.kind}-${o.id}`} name={o.name} sub={o.sub} status={o.status} icon={o.kind === "guests" ? <UserPlus size={15} /> : <Wallet size={15} />} onToggle={() => mark(o.kind, o.id, o.status === "paid" ? "pending" : "paid")} onRemove={() => remove(o.kind, o.id, o.name)} />) : <Empty text="No guests or non-Multisport players." />)}
              </div>
              <p className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] text-muted-foreground">
                <span>Tap a row to mark paid / unpaid by hand.</span>
                <button onClick={loadDetail} className="flex items-center gap-1 hover:text-foreground">
                  <RefreshCcw size={11} /> Refresh
                </button>
              </p>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number | string; tone: "emerald" | "amber" | "cyan"; icon: React.ReactNode }) {
  const tones = { emerald: "text-emerald bg-emerald/10 border-emerald/25", amber: "text-amber bg-amber/10 border-amber/25", cyan: "text-cyan bg-cyan/10 border-cyan/25" };
  return (
    <div className={cn("rounded-2xl border p-2.5 sm:p-4", tones[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-90 sm:text-[11px]">
        {icon} <span className="truncate">{label}</span>
      </div>
      <motion.p key={String(value)} initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 font-display text-2xl font-bold text-foreground sm:text-3xl">
        {value}
      </motion.p>
    </div>
  );
}

function Row({ name, sub, status, icon, onToggle, onRemove }: { name: string; sub: string; status: "paid" | "pending"; icon: React.ReactNode; onToggle: () => void; onRemove?: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex w-full items-center gap-2 rounded-xl border border-border bg-soft pr-1.5 transition hover:border-primary/30">
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="flex min-w-0 items-center gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", status === "paid" ? "bg-emerald/15 text-emerald" : "bg-amber/15 text-amber")}>{icon}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{sub}</span>
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", status === "paid" ? "bg-emerald/15 text-emerald" : "bg-amber/15 text-amber")}>{status}</span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
          <Trash2 size={15} />
        </button>
      )}
    </motion.div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

function ResultFlash({ result }: { result: ScanResult }) {
  const cfg = {
    paid: { icon: <CheckCircle2 size={56} />, title: `Welcome, ${result.name}!`, sub: "Checked in · marked as paid", cls: "bg-emerald/90 text-background" },
    already: { icon: <CheckCircle2 size={56} />, title: `${result.name} is already in`, sub: "This card was scanned earlier", cls: "bg-amber/90 text-background" },
    unknown: { icon: <XCircle size={56} />, title: "Card not on the list", sub: "Ask an organiser — you may need to join the poll first", cls: "bg-destructive/90 text-white" },
  }[result.result];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className={cn("absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center backdrop-blur-sm", cfg.cls)}>
      <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 10 }}>
        {cfg.icon}
      </motion.div>
      <p className="font-display text-3xl font-bold sm:text-4xl">{cfg.title}</p>
      <p className="text-sm font-medium opacity-80">{cfg.sub}</p>
      {result.result === "unknown" && result.code && <p className="mt-1 rounded-lg bg-black/20 px-2 py-1 font-mono text-xs">{result.code.slice(0, 40)}</p>}
    </motion.div>
  );
}

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const [state, setState] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camIndex, setCamIndex] = useState(0);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      /* already stopped */
    }
    controlsRef.current = null;
    const v = videoRef.current;
    if (v?.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    setState("idle");
  }, []);

  const start = useCallback(
    async (index = camIndex) => {
      setState("starting");
      setError("");
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        stop();
        let list = cameras;
        if (!list.length) {
          list = await BrowserMultiFormatReader.listVideoInputDevices();
          setCameras(list);
        }
        const back = list.findIndex((c) => /back|rear|environment/i.test(c.label));
        const chosen = list[index] ?? list[back >= 0 ? back : 0] ?? list[0];
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.EAN_13,
          BarcodeFormat.PDF_417,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 40 });
        if (!videoRef.current) throw new Error("Video element not mounted.");
        const controls = await reader.decodeFromVideoDevice(chosen?.deviceId, videoRef.current, (result) => {
          if (result) onCodeRef.current(result.getText());
        });
        controlsRef.current = controls;
        setState("running");
      } catch (e) {
        setState("error");
        const msg = e instanceof Error ? e.message : String(e);
        setError(/permission|notallowed/i.test(msg) ? "Camera access was blocked. Allow the camera in your browser settings and try again." : /secure|https/i.test(msg) ? "The camera only works over HTTPS." : "Couldn't start the camera. Is another app using it?");
      }
    },
    [cameras, camIndex, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return (
    <div className="scan-frame relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-black/50">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
      {state === "running" && (
        <>
          <div className="scan-line" />
          <span className="scan-corner left-4 top-4 rounded-tl-xl border-l-4 border-t-4" />
          <span className="scan-corner right-4 top-4 rounded-tr-xl border-r-4 border-t-4" />
          <span className="scan-corner bottom-4 left-4 rounded-bl-xl border-b-4 border-l-4" />
          <span className="scan-corner bottom-4 right-4 rounded-br-xl border-b-4 border-r-4" />
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-2">
            {cameras.length > 1 && (
              <Button
                variant="glass"
                size="sm"
                onClick={() => {
                  const next = (camIndex + 1) % cameras.length;
                  setCamIndex(next);
                  start(next);
                }}
              >
                <SwitchCamera size={15} /> Switch
              </Button>
            )}
            <Button variant="glass" size="sm" onClick={stop}>
              <CameraOff size={15} /> Stop
            </Button>
          </div>
        </>
      )}
      {state !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.2 }} className={cn("grid size-16 place-items-center rounded-2xl", state === "error" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary")}>
            {state === "error" ? <ShieldAlert size={28} /> : <ScanLine size={28} />}
          </motion.div>
          <p className="max-w-xs text-sm text-muted-foreground">{state === "error" ? error : "Players hold their Multisport QR or barcode up to the camera. Their name turns green once they're checked in."}</p>
          <Button variant="neon" size="lg" onClick={() => start()} disabled={state === "starting"}>
            {state === "starting" ? <Spinner /> : <Camera size={18} />} {state === "error" ? "Try again" : "Start camera"}
          </Button>
        </div>
      )}
    </div>
  );
}
