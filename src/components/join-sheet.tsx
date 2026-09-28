import { useEffect, useState } from "react";
import { CreditCard, Minus, Plus, UserPlus, Users } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Spinner, Toggle } from "@/components/ui/field";
import { api, type Session } from "@/lib/api";
import { loadCardPrefs, saveCardPrefs, usePlayer } from "@/lib/player";
import { fmt } from "@/lib/utils";

export function JoinSheet({ session, onClose, onJoined }: { session: Session | null; onClose: () => void; onJoined: (session: Session, guests: string[], multisport: boolean) => void }) {
  const { player } = usePlayer();
  const [multisport, setMultisport] = useState(true);
  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    const prefs = loadCardPrefs();
    setMultisport(prefs.usesMultisport);
    setCardNumber(prefs.cardNumber);
    setHolderName(prefs.holderName || player?.name || "");
    setGuests([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!session || !player) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const spotsLeft = Math.max(0, session.capacity - session.total);
  const maxGuests = Math.min(10, Math.max(0, spotsLeft - 1));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !player) return;
    if (multisport && cardNumber.replace(/[^a-z0-9]/gi, "").length < 6) return toast.error("Enter your full Multisport card number.");
    if (multisport && !holderName.trim()) return toast.error("Enter the name on the Multisport card.");
    const guestNames = guests.map((g, i) => g.trim() || `${player.name.trim()}'s guest ${i + 1}`);
    setBusy(true);
    try {
      const res = await api<{ session: Session }>(`/api/sessions/${session.id}/join`, {
        body: { usesMultisport: multisport, cardNumber: multisport ? cardNumber : null, holderName: multisport ? holderName.trim() : null, guests: guestNames },
      });
      saveCardPrefs({ usesMultisport: multisport, cardNumber: multisport ? cardNumber.trim() : loadCardPrefs().cardNumber, holderName: multisport ? holderName.trim() : loadCardPrefs().holderName });
      onJoined(res.session, guestNames, multisport);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't join. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!session}
      onClose={onClose}
      title="Join this session"
      subtitle={
        <>
          {fmt(session.date, "EEEE, d MMMM")} · {session.startTime}–{session.endTime} · {session.venue}
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6 pb-4 pt-4">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-soft px-4 py-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-sm font-bold text-primary">{player.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{player.name}</p>
            <p className="truncate text-xs text-muted-foreground">Signed in as {player.email}</p>
          </div>
        </div>

        <div className={`rounded-2xl border p-4 transition-colors ${multisport ? "border-primary/35 bg-primary/[.06]" : "border-border bg-soft"}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`grid size-10 place-items-center rounded-xl ${multisport ? "bg-primary text-primary-foreground" : "bg-soft text-muted-foreground"}`}>
                <CreditCard size={19} />
              </span>
              <div>
                <p className="font-semibold">I have Multisport</p>
                <p className="text-xs text-muted-foreground">{multisport ? "Scan your card at the entrance" : "You'll pay at the venue"}</p>
              </div>
            </div>
            <Toggle checked={multisport} onChange={setMultisport} label="I have Multisport" />
          </div>
          <AnimatePresence initial={false}>
            {multisport && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="grid gap-4 pt-5 sm:grid-cols-2">
                  <Field label="Card number" className="sm:col-span-2">
                    <input className="field font-mono tracking-wider" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="Number on your card" inputMode="text" autoComplete="off" maxLength={40} />
                  </Field>
                  <Field label="Name on card" className="sm:col-span-2">
                    <input className="field" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="As printed on the card" maxLength={80} />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-cyan/15 text-cyan">
                <UserPlus size={19} />
              </span>
              <div>
                <p className="font-semibold">Bringing guests?</p>
                <p className="text-xs text-muted-foreground">{maxGuests === 0 ? "No extra spots left for guests" : `Up to ${maxGuests} more`}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-soft p-1">
              <button type="button" aria-label="Remove guest" disabled={!guests.length} onClick={() => setGuests((g) => g.slice(0, -1))} className="grid size-9 place-items-center rounded-lg transition hover:bg-secondary disabled:opacity-30">
                <Minus size={16} />
              </button>
              <motion.span key={guests.length} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-7 text-center font-display text-lg font-bold">
                {guests.length}
              </motion.span>
              <button type="button" aria-label="Add guest" disabled={guests.length >= maxGuests} onClick={() => setGuests((g) => [...g, ""])} className="grid size-9 place-items-center rounded-lg transition hover:bg-secondary disabled:opacity-30">
                <Plus size={16} />
              </button>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {guests.map((guest, i) => (
              <motion.div key={i} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <input className="field mt-3" value={guest} onChange={(e) => setGuests((g) => g.map((v, j) => (j === i ? e.target.value : v)))} placeholder={`Guest ${i + 1} name`} maxLength={60} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-soft px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Users size={16} className="text-primary" /> You{guests.length ? ` + ${guests.length} guest${guests.length > 1 ? "s" : ""}` : ""}
          </span>
          <span>
            <strong className="font-display text-base">{1 + guests.length}</strong> <span className="text-muted-foreground">of {spotsLeft} spots</span>
          </span>
        </div>

        <Button type="submit" variant="neon" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Confirm my spot
        </Button>
      </form>
    </Sheet>
  );
}
