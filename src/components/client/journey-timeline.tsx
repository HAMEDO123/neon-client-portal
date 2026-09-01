"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROJECT_STAGES } from "@/lib/constants";
import { useI18n } from "@/lib/client-i18n";

export function JourneyTimeline({ currentStage, completionPercent }: { currentStage: string; completionPercent: number }) {
  const { t } = useI18n();
  const currentIndex = PROJECT_STAGES.findIndex((s) => s.value === currentStage);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-ink/40">{t("Project Journey")}</span>
        <span className="text-xs font-medium text-cyan-strong">{t("{n}% Complete", { n: completionPercent })}</span>
      </div>

      <div className="relative mt-6">
        <div className="absolute left-0 right-0 top-[7px] h-px bg-ink/10 sm:top-3.5" />
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${(currentIndex / (PROJECT_STAGES.length - 1)) * 100}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="absolute left-0 top-[7px] h-px bg-gradient-to-r from-cyan-strong to-purple-strong sm:top-3.5"
        />

        <div className="scrollbar-none relative flex gap-6 overflow-x-auto sm:grid sm:grid-cols-8 sm:gap-2">
          {PROJECT_STAGES.map((stage, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <div key={stage.value} className="flex shrink-0 flex-col items-center gap-2 sm:shrink">
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border-2 bg-background sm:h-7 sm:w-7",
                    done && "border-cyan-strong bg-cyan-strong text-white",
                    active && "border-cyan-strong ring-4 ring-cyan/20",
                    !done && !active && "border-ink/15"
                  )}
                >
                  {done && <Check size={12} strokeWidth={3} />}
                </span>
                <span className={cn("max-w-[80px] text-center text-[11px] leading-tight", active ? "font-medium text-ink" : "text-ink/45")}>
                  {t(stage.label)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
