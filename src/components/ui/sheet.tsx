import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LiquiGlass } from "@liqui-design/glass";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const MotionGlass = motion.create(LiquiGlass);

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, subtitle, children, className }: { open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button aria-label="Close" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <MotionGlass
            role="dialog"
            aria-modal="true"
            radius={28}
            refraction={120}
            bezel={28}
            frost={0.7}
            elevated
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className={cn("relative flex max-h-[92dvh] w-full flex-col text-foreground sm:max-w-lg", className)}
            contentClassName="flex min-h-0 flex-1 flex-col"
          >
            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-foreground/20 sm:hidden" />
            {(title || subtitle) && (
              <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-2 pt-4 sm:px-7 sm:pt-7">
                <div className="min-w-0">
                  {title && <h2 className="font-display text-2xl font-bold leading-tight">{title}</h2>}
                  {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
                </div>
                <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-soft text-muted-foreground transition hover:text-foreground" aria-label="Close">
                  <X size={17} />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-safe sm:px-7 sm:pb-7">{children}</div>
          </MotionGlass>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
