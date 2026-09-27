import { createPortal } from "react-dom";
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, HelpCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "default";
};

type State = { options: ConfirmOptions; resolve: (value: boolean) => void };

export function useConfirm() {
  const [state, setState] = useState<State | null>(null);

  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );

  const done = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const tone = state?.options.tone ?? "default";
  const iconCls =
    tone === "danger"
      ? "bg-destructive/15 text-destructive"
      : tone === "warning"
        ? "bg-amber/15 text-amber"
        : "bg-primary/15 text-primary";
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : HelpCircle;
  const confirmVariant = tone === "danger" ? "destructive" : "neon";

  const dialog = createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          key="confirm-shell"
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => done(false)} />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ scale: 0.9, y: 22, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 12, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 260 }}
            className="glass-panel relative w-full max-w-sm rounded-3xl border border-border p-6 text-center sm:p-8"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", damping: 12, stiffness: 220, delay: 0.05 }}
              className={cn("mx-auto mb-4 grid size-14 place-items-center rounded-2xl", iconCls)}
            >
              <Icon size={26} />
            </motion.div>
            <h3 className="font-display text-xl font-bold sm:text-2xl">{state.options.title}</h3>
            {state.options.message && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{state.options.message}</p>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button variant="glass" size="lg" onClick={() => done(false)}>
                {state.options.cancelLabel ?? "Cancel"}
              </Button>
              <Button variant={confirmVariant} size="lg" onClick={() => done(true)}>
                {state.options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  return { ask, dialog };
}
