import { Link, NavLink, useLocation } from "react-router-dom";
import { CalendarDays, ChevronRight, ClipboardList, History, ScanLine, Ticket, House, LogOut, LogIn, Trophy, Users2 } from "lucide-react";

function InstagramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}
import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import site from "../../shared/site.json";
import { AmbientBackground, ShuttleLogo } from "./brand";
import { AuthSheet } from "./auth-sheet";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/lib/admin";
import { usePlayer } from "@/lib/player";

const playerLinks = [
  { to: "/", label: "Calendar", icon: CalendarDays, end: true },
  { to: "/my-sessions", label: "My sessions", icon: Ticket, end: false },
  { to: "/tournament", label: "Tournament", icon: Trophy, end: false },
];
const titles: Record<string, string> = {
  "/": site.title,
  "/my-sessions": "My sessions — Friends Club",
  "/tournament": "Tournament — Friends Club",
  "/admin/login": "Admin — Friends Club",
  "/admin/polls": "Polls — Friends Club admin",
  "/admin/checkin": "Check-in — Friends Club admin",
  "/admin/records": "Records — Friends Club admin",
  "/admin/players": "Players — Friends Club admin",
  "/admin/tournaments": "Tournaments — Friends Club admin",
};

const adminLinks = [
  { to: "/admin/polls", label: "Polls", icon: ClipboardList, end: false },
  { to: "/admin/checkin", label: "Check-in", icon: ScanLine, end: false },
  { to: "/admin/players", label: "Players", icon: Users2, end: false },
  { to: "/admin/tournaments", label: "Tournaments", icon: Trophy, end: false },
  { to: "/admin/records", label: "Records", icon: History, end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titles[pathname] ?? site.title;
  }, [pathname]);
  const admin = pathname.startsWith("/admin");
  const { admin: me, logout } = useAdmin();
  const { player, logout: playerLogout } = usePlayer();
  const [authOpen, setAuthOpen] = useState(false);
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
        {admin ? (
          signedIn ? (
            <button onClick={logout} className="flex items-center gap-2 rounded-full border border-border bg-soft px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
              <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <div className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:flex">
              <span className="size-2 rounded-full bg-primary lime-glow" /> Prague, CZ
            </div>
          )
        ) : player ? (
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-border bg-soft px-3 py-1.5 text-xs sm:flex">
              <span className="grid size-6 place-items-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">{player.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"}</span>
              <span className="max-w-[10rem] truncate font-semibold">{player.name}</span>
            </div>
            <button onClick={playerLogout} className="flex items-center gap-2 rounded-full border border-border bg-soft px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground" aria-label="Sign out">
              <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <button onClick={() => setAuthOpen(true)} className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20">
            <LogIn size={14} /> <span className="hidden sm:inline">Sign in</span>
          </button>
        )}
      </header>
      <motion.main key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className={cn("relative z-10 flex-1", links.length ? "pb-24 md:pb-0" : "")}>
        {children}
      </motion.main>
      <footer className={cn("relative z-10 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border px-4 py-8 text-xs text-muted-foreground sm:px-8 md:pb-8 lg:px-12", links.length ? "pb-32" : "pb-8")}>
        <span>© Friends Club · Made for the love of the game.</span>
        <div className="flex items-center gap-3">
          <a href={site.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="grid size-8 place-items-center rounded-full border border-border bg-soft text-muted-foreground transition hover:border-primary/40 hover:text-primary">
            <InstagramIcon size={14} />
          </a>
          <a href={site.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="grid size-8 place-items-center rounded-full border border-border bg-soft text-muted-foreground transition hover:border-primary/40 hover:text-primary">
            <FacebookIcon size={14} />
          </a>
          <Link to={admin ? "/" : "/admin/polls"} className="flex items-center gap-1.5 transition hover:text-foreground">
            {admin ? "Back to sessions" : "Admin"}
            <ChevronRight size={13} />
          </Link>
        </div>
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
      {!admin && <AuthSheet open={authOpen} onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
