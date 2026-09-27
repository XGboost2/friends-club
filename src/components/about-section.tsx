import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import site from "../../shared/site.json";

/** "How it works" + FAQ. The same text is served as crawlable HTML by the server (server/seo.js). */
export function AboutSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="about" aria-labelledby="how-title" className="scroll-mt-24 border-t border-border pb-20 pt-14 sm:pb-28 sm:pt-20">
      <Eyebrow>Badminton in Prague</Eyebrow>
      <h2 id="how-title" className="font-display text-3xl font-bold sm:text-4xl">
        How it works<span className="text-primary">.</span>
      </h2>
      <ol className="mt-8 grid gap-4 md:grid-cols-3">
        {site.steps.map((step, i) => (
          <motion.li key={step.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: i * 0.08 }} className="glass-panel rounded-2xl p-5 sm:p-6">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/12 font-display text-lg font-bold text-primary">{i + 1}</span>
            <h3 className="mt-4 font-display text-lg font-bold">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
          </motion.li>
        ))}
      </ol>

      <h2 className="mt-16 font-display text-3xl font-bold sm:text-4xl">
        Questions<span className="text-primary">?</span>
      </h2>
      <div className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-soft">
        {site.faq.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q}>
              <h3>
                <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium transition hover:bg-soft sm:px-6">
                  {item.q}
                  <ChevronDown size={18} className={cn("shrink-0 text-muted-foreground transition", isOpen && "rotate-180 text-primary")} />
                </button>
              </h3>
              {/* Answers stay in the DOM (just collapsed) so they remain readable to search engines. */}
              <div className={cn("grid transition-all duration-300", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <p className="overflow-hidden px-5 text-sm leading-relaxed text-muted-foreground sm:px-6">
                  <span className="block pb-5">{item.a}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
