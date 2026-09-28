import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronDown, Clock, CreditCard, History, MapPin, Search, UserPlus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Eyebrow, Spinner } from "@/components/ui/field";
import { api, type SessionDetail } from "@/lib/api";
import { cn, courtsLabel, fmt, maskCard } from "@/lib/utils";

type Filter = "all" | "paid" | "pending";

export default function AdminRecords() {
  const [sessions, setSessions] = useState<SessionDetail[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api<{ sessions: SessionDetail[] }>("/api/admin/records")
      .then((r) => {
        setSessions(r.sessions);
        setOpen(r.sessions[0]?.id ?? null);
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const totals = useMemo(() => {
    const regs = sessions?.flatMap((s) => s.registrations) ?? [];
    const guests = regs.flatMap((r) => r.guests);
    return {
      sessions: sessions?.length ?? 0,
      players: regs.length + guests.length,
      paid: regs.filter((r) => r.status === "paid").length + guests.filter((g) => g.status === "paid").length,
      pendingMs:
        regs.filter((r) => r.multisport && r.status === "pending").length +
        guests.filter((g) => g.multisport && g.status === "pending").length,
    };
  }, [sessions]);

  const q = search.trim().toLowerCase();

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-8 sm:pt-10 lg:px-12">
      <div className="mb-8">
        <Eyebrow>The clubhouse / Records</Eyebrow>
        <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
          The last two weeks<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Every session from the past fortnight, who came and who paid. Older records — including card numbers — are deleted automatically.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Sessions", value: totals.sessions, icon: <History size={16} />, cls: "text-primary" },
          { label: "Players + guests", value: totals.players, icon: <UserPlus size={16} />, cls: "text-cyan" },
          { label: "Paid", value: totals.paid, icon: <CheckCircle2 size={16} />, cls: "text-emerald" },
          { label: "Multisport not scanned", value: totals.pendingMs, icon: <Clock size={16} />, cls: "text-amber" },
        ].map((s) => (
          <div key={s.label} className="glass-panel rounded-2xl p-4">
            <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", s.cls)}>
              {s.icon} {s.label}
            </p>
            <p className="mt-1 font-display text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="field h-11 pl-10 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a player or guest" />
        </label>
        <div className="flex rounded-xl border border-border bg-soft p-1">
          {(["all", "paid", "pending"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded-lg px-4 py-2 text-xs font-semibold capitalize transition", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {!sessions && (
        <div className="grid min-h-60 place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      )}
      {sessions?.length === 0 && <div className="glass-panel rounded-2xl p-10 text-center text-muted-foreground">No sessions in the last two weeks.</div>}

      <div className="space-y-3">
        {sessions?.map((s) => {
          const rows = s.registrations
            .flatMap((r) => [
              { key: `r${r.id}`, name: r.name, kind: r.multisport ? "Multisport" : "Pays at venue", detail: r.multisport ? `${r.holderName ?? ""} · ${maskCard(r.cardNumber)}` : "", status: r.status, how: r.paidMethod, guest: false, multisport: r.multisport },
              ...r.guests.map((g) => ({
                key: `g${g.id}`,
                name: g.name,
                kind: g.multisport ? `Guest of ${r.name} · Multisport` : `Guest of ${r.name}`,
                detail: g.multisport ? `${g.holderName ?? ""} · ${maskCard(g.cardNumber)}` : "",
                status: g.status,
                how: g.paidMethod as string | null,
                guest: true,
                multisport: g.multisport,
              })),
            ])
            .filter((row) => (filter === "all" || row.status === filter) && (!q || row.name.toLowerCase().includes(q) || row.kind.toLowerCase().includes(q)));
          const paid = s.registrations.filter((r) => r.status === "paid").length + s.registrations.flatMap((r) => r.guests).filter((g) => g.status === "paid").length;
          const isOpen = open === s.id || !!q;
          return (
            <motion.div key={s.id} layout className="glass-panel overflow-hidden rounded-2xl">
              <button onClick={() => setOpen(isOpen && !q ? null : s.id)} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-soft leading-none">
                    <span className="font-display text-xl font-bold">{fmt(s.date, "dd")}</span>
                    <span className="mt-0.5 text-[9px] font-bold uppercase text-muted-foreground">{fmt(s.date, "MMM")}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-bold">
                      {fmt(s.date, "EEEE")} · {s.startTime}–{s.endTime}
                    </p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin size={12} /> {s.venue}
                      {courtsLabel(s.courtNumbers) && ` · ${courtsLabel(s.courtNumbers)}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-right text-xs text-muted-foreground sm:block">
                    <strong className="text-emerald">{paid}</strong> paid of <strong className="text-foreground">{s.total}</strong>
                  </span>
                  <ChevronDown size={18} className={cn("text-muted-foreground transition", isOpen && "rotate-180")} />
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border px-2 pb-2 sm:px-3">
                  {rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nothing matches.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {rows.map((row) => (
                        <div key={row.key} className="flex items-center justify-between gap-3 px-2 py-2.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", row.guest ? (row.multisport ? "bg-violet/25 text-violet" : "bg-violet/15 text-violet") : row.multisport ? "bg-primary/10 text-primary" : "bg-cyan/10 text-cyan")}>
                              {row.guest ? <UserPlus size={14} /> : row.multisport ? <CreditCard size={14} /> : <Wallet size={14} />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{row.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {row.kind}
                                {row.detail && <span className="font-mono"> · {row.detail}</span>}
                              </p>
                            </div>
                          </div>
                          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", row.status === "paid" ? "bg-emerald/15 text-emerald" : "bg-amber/15 text-amber")}>
                            {row.status}
                            {row.how === "scan" && " · scan"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
