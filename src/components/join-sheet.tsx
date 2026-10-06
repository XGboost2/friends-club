import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, Minus, Plus, UserPlus, Users } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Spinner, Toggle } from "@/components/ui/field";
import { api, type Session } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import { fmt } from "@/lib/utils";

type GuestForm = {
  name: string;
  usesMultisport: boolean;
  cardNumber: string;
  holderName: string;
};

function defaultGuestName(playerName: string, index: number) {
  const first = playerName.trim().split(/\s+/)[0] || "Player";
  return `${first}'s guest ${index + 1}`;
}

export function JoinSheet({ session, onClose, onJoined }: { session: Session | null; onClose: () => void; onJoined: (session: Session, guests: string[], multisport: boolean) => void }) {
  const { player } = usePlayer();
  const hasSavedCard = !!player?.multisportCardNumber && !!player?.multisportHolderName;
  const [multisport, setMultisport] = useState(false);
  const [guests, setGuests] = useState<GuestForm[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    setMultisport(hasSavedCard);
    setGuests([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!session || !player) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const spotsLeft = Math.max(0, session.capacity - session.total);
  const maxGuests = Math.min(10, Math.max(0, spotsLeft - 1));

  function updateGuest(index: number, patch: Partial<GuestForm>) {
    setGuests((list) => list.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function addGuest() {
    setGuests((list) => [
      ...list,
      { name: defaultGuestName(player!.name, list.length), usesMultisport: false, cardNumber: "", holderName: "" },
    ]);
  }

  function removeGuest() {
    setGuests((list) => list.slice(0, -1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !player) return;
    if (multisport && !hasSavedCard) return toast.error("Add your Multisport card in your profile first.");
    const cleanGuests = guests.map((g, i) => ({
      name: g.name.trim() || defaultGuestName(player.name, i),
      usesMultisport: g.usesMultisport,
      cardNumber: g.usesMultisport ? g.cardNumber.trim() : null,
      holderName: g.usesMultisport ? (g.holderName.trim() || g.name.trim() || defaultGuestName(player.name, i)) : null,
    }));
    for (const g of cleanGuests) {
      if (g.usesMultisport && (!g.cardNumber || g.cardNumber.replace(/[^a-z0-9]/gi, "").length < 6)) {
        return toast.error(`Enter a full Multisport card number for ${g.name}.`);
      }
    }
    setBusy(true);
    try {
      const res = await api<{ session: Session }>(`/api/sessions/${session.id}/join`, {
        body: {
          usesMultisport: multisport,
          guests: cleanGuests,
        },
      });
      onJoined(res.session, cleanGuests.map((g) => g.name), multisport);
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
                <p className="text-xs text-muted-foreground">
                  {!hasSavedCard
                    ? <>Add your card in <Link to="/profile" className="underline underline-offset-2 hover:text-foreground">your profile</Link> to use it.</>
                    : multisport ? "Scan your card at the entrance" : "You'll pay at the venue"}
                </p>
              </div>
            </div>
            <Toggle checked={multisport} onChange={setMultisport} label="I have Multisport" disabled={!hasSavedCard} />
          </div>
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
              <button type="button" aria-label="Remove guest" disabled={!guests.length} onClick={removeGuest} className="grid size-9 place-items-center rounded-lg transition hover:bg-secondary disabled:opacity-30">
                <Minus size={16} />
              </button>
              <motion.span key={guests.length} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-7 text-center font-display text-lg font-bold">
                {guests.length}
              </motion.span>
              <button type="button" aria-label="Add guest" disabled={guests.length >= maxGuests} onClick={addGuest} className="grid size-9 place-items-center rounded-lg transition hover:bg-secondary disabled:opacity-30">
                <Plus size={16} />
              </button>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {guests.map((guest, i) => (
              <motion.div key={i} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className={`mt-3 rounded-2xl border p-3 transition-colors ${guest.usesMultisport ? "border-primary/35 bg-primary/[.05]" : "border-border bg-soft"}`}>
                  <input
                    className="field"
                    value={guest.name}
                    onChange={(e) => updateGuest(i, { name: e.target.value })}
                    placeholder={defaultGuestName(player.name, i)}
                    maxLength={60}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <CreditCard size={14} className={guest.usesMultisport ? "text-primary" : "text-muted-foreground"} />
                      <span className={guest.usesMultisport ? "font-semibold text-foreground" : "text-muted-foreground"}>
                        {guest.usesMultisport ? "Multisport" : "Pays at venue"}
                      </span>
                    </div>
                    <Toggle checked={guest.usesMultisport} onChange={(v) => updateGuest(i, { usesMultisport: v, holderName: guest.holderName || guest.name })} label={`Guest ${i + 1} Multisport`} />
                  </div>
                  <AnimatePresence initial={false}>
                    {guest.usesMultisport && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="grid gap-3 pt-3 sm:grid-cols-2">
                          <input
                            className="field font-mono tracking-wider sm:col-span-2"
                            value={guest.cardNumber}
                            onChange={(e) => updateGuest(i, { cardNumber: e.target.value })}
                            placeholder="Guest's card number"
                            maxLength={40}
                          />
                          <input
                            className="field sm:col-span-2"
                            value={guest.holderName}
                            onChange={(e) => updateGuest(i, { holderName: e.target.value })}
                            placeholder="Name on guest's card"
                            maxLength={80}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
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
