import { useEffect, useState } from "react";
import { CreditCard, UserPlus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Avatar, Spinner } from "@/components/ui/field";
import { api, type Session } from "@/lib/api";
import { fmt } from "@/lib/utils";

type AttendeeGuest = { name: string; multisport: boolean };
type Attendee = { name: string; multisport: boolean; guests: AttendeeGuest[] };

export function AttendeesSheet({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  useEffect(() => {
    if (!session) return;
    setAttendees(null);
    api<{ attendees: Attendee[] }>(`/api/sessions/${session.id}/attendees`)
      .then((r) => setAttendees(r.attendees))
      .catch(() => setAttendees([]));
  }, [session]);

  return (
    <Sheet open={!!session} onClose={onClose} title="Who's coming" subtitle={session ? `${fmt(session.date, "EEEE, d MMMM")} · ${session.total}/${session.capacity} spots taken` : null}>
      <div className="space-y-2 pb-4 pt-4">
        {!attendees && (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Spinner />
          </div>
        )}
        {attendees?.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No one yet — be the first to join!</p>}
        {attendees?.map((a, i) => (
          <div key={i} className="rounded-xl border border-border bg-soft px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={a.name} index={i} className="size-9 border-0" />
                <p className="min-w-0 truncate font-medium">{a.name}</p>
              </div>
              {a.multisport && <MultisportPill />}
            </div>
            {a.guests.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border pt-2">
                {a.guests.map((g, gi) => (
                  <li key={gi} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 truncate text-muted-foreground">
                      <UserPlus size={12} className="shrink-0" /> {g.name}
                    </span>
                    {g.multisport && <MultisportPill compact />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function MultisportPill({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-full bg-primary/10 font-bold uppercase tracking-wider text-primary ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"}`}>
      <CreditCard size={compact ? 9 : 11} /> Multisport
    </span>
  );
}
