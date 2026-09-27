import { Link, NavLink, useLocation } from "react-router-dom";
import { CalendarDays, ChevronRight, ClipboardList, History, ScanLine, Ticket, House, LogOut } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { AmbientBackground, ShuttleLogo } from "./brand";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/lib/admin";

const playerLinks = [
  { to: "/", label: "Calendar", icon: CalendarDays, end: true },
  { to: "/my-sessions", label: "My sessions", icon: Ticket, end: false },
];
const adminLinks = [
  { to: "/admin/polls", label: "Polls", icon: ClipboardList, end: false },
  { to: "/admin/checkin", label: "Check-in", icon: ScanLine, end: false },
  { to: "/admin/records", label: "Records", icon: History, end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const admin = pathname.startsWith("/admin");
  const { admin: me, logout } = useAdmin();
  const signedIn = admin && me?.approved;
  const links = admin ? (signedIn ? [{ to: "/", label: "Sessions", icon: House, end: true }, ...adminLinks] : []) : playerLinks;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <AmbientBackground />
      <header className="relative z-20 mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-8 lg:h-24 lg:px-12">
        <ShuttleLogo />
        {links.length > 0 && (
          <nav className="hidden items-center gap-1 rounded-full border border-border bg-soft p-1.5 backdrop-blur-xl md:flex" aria-label="Main navigation">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex items-center gap-2 rounded-full px-4 py-2.5 text-sm transition lg:px-5", isActive ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </nav>
        )}
        {signedIn ? (
          <button onClick={logout} className="flex items-center gap-2 rounded-full border border-border bg-soft px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
            <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        ) : (
          <div className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:flex">
            <span className="size-2 rounded-full bg-primary lime-glow" /> Prague, CZ
          </div>
        )}
      </header>
      <motion.main key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative z-10 flex-1">
        {children}
      </motion.main>
      <footer className={cn("relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between border-t border-border px-4 py-8 text-xs text-muted-foreground sm:px-8 md:pb-8 lg:px-12", links.length ? "pb-32" : "pb-8")}>
        <span>© Friends Club · Made for the love of the game.</span>
        <Link to={admin ? "/" : "/admin/polls"} className="flex items-center gap-1.5 transition hover:text-foreground">
          {admin ? "Back to sessions" : "Admin"}
          <ChevronRight size={13} />
        </Link>
      </footer>
      {links.length > 0 && (
        <nav className="nav-glass fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[min(94vw,460px)] -translate-x-1/2 items-center justify-around rounded-2xl p-1.5 md:hidden" aria-label="Mobile navigation">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex min-w-16 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition", isActive ? "bg-primary/12 text-primary" : "text-muted-foreground")}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
