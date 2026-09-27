import { useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, isoDay, toDate } from "@/lib/utils";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  today: string;
  initialMonth?: string;
  /** View mode: dates with a posted poll. `voted` = the current player is in. */
  marked?: Map<string, { voted: boolean; count: number }>;
  selected?: string | null;
  onSelect?: (iso: string) => void;
  /** Pick mode: admins pick one or many dates. */
  picked?: Set<string>;
  onTogglePick?: (iso: string) => void;
  compact?: boolean;
};

export function MonthCalendar({ today, initialMonth, marked, selected, onSelect, picked, onTogglePick, compact }: Props) {
  const pickMode = !!onTogglePick;
  const [month, setMonth] = useState(() => startOfMonth(toDate(initialMonth ?? today)));
  const [direction, setDirection] = useState(1);
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const monthKey = format(month, "yyyy-MM");
  const monthCount = marked ? [...marked.keys()].filter((d) => d.startsWith(monthKey)).length : picked ? [...picked].filter((d) => d.startsWith(monthKey)).length : 0;
  const canGoBack = format(month, "yyyy-MM") > today.slice(0, 7);

  function change(delta: number) {
    setDirection(delta);
    setMonth((m) => addMonths(m, delta));
  }

  return (
    <div>
      <div className={cn("flex items-center justify-between gap-3", compact ? "mb-4" : "mb-6")}>
        <div>
          <p className={cn("font-display font-bold", compact ? "text-lg" : "text-xl")}>{format(month, "MMMM yyyy")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pickMode ? `${monthCount} date${monthCount === 1 ? "" : "s"} picked` : `${monthCount} poll${monthCount === 1 ? "" : "s"} posted this month`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="glass" size="icon" className="size-9" aria-label="Previous month" disabled={!canGoBack} onClick={() => change(-1)}>
            <ChevronLeft size={17} />
          </Button>
          <Button type="button" variant="glass" size="icon" className="size-9" aria-label="Next month" onClick={() => change(1)}>
            <ChevronRight size={17} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center sm:gap-2">
        {weekdays.map((d) => (
          <span key={d} className="pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {d}
          </span>
        ))}
      </div>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div key={monthKey} initial={{ opacity: 0, x: direction * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: direction * -28 }} transition={{ duration: 0.22 }} className="grid grid-cols-7 gap-1 sm:gap-2">
            {days.map((day) => {
              const iso = isoDay(day);
              const inMonth = isSameMonth(day, month);
              const past = iso < today;
              const isToday = iso === today;
              const mark = marked?.get(iso);
              const isPicked = picked?.has(iso) ?? false;
              const interactive = pickMode ? !past && inMonth : !!mark && inMonth;
              if (!inMonth) return <span key={iso} className={compact ? "h-10" : "h-11 sm:h-14"} />;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!interactive}
                  onClick={() => (pickMode ? onTogglePick?.(iso) : onSelect?.(iso))}
                  data-poll={!pickMode && !!mark}
                  data-selected={!pickMode && selected === iso}
                  data-picked={isPicked}
                  data-pickable={pickMode && interactive}
                  aria-pressed={pickMode ? isPicked : selected === iso}
                  aria-label={`${format(day, "EEEE, MMMM d")}${mark ? (mark.voted ? ", you're in" : ", poll open") : ""}`}
                  className={cn(
                    "calendar-day relative mx-auto flex w-full flex-col items-center justify-center gap-0.5 rounded-xl font-display text-sm font-semibold",
                    compact ? "h-10" : "h-11 sm:h-14 sm:max-w-16",
                    !interactive && "cursor-default text-muted-foreground/45",
                    past && "opacity-40",
                    isToday && !isPicked && selected !== iso && "ring-1 ring-primary/60",
                  )}
                >
                  <span>{format(day, "d")}</span>
                  {mark && (
                    <span className={cn("flex h-2 items-center")}>
                      {mark.voted ? (
                        <Check size={11} strokeWidth={3.5} className={selected === iso ? "text-primary-foreground" : "text-primary"} />
                      ) : (
                        <span className={cn("size-1.5 rounded-full", selected === iso ? "bg-primary-foreground" : "bg-primary lime-glow")} />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
