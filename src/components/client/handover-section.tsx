"use client";

import { Check, PackageCheck } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/client-i18n";
import { GalleryPdfButton } from "@/components/client/gallery-pdf-button";

export function HandoverSection({
  token,
  isCompleted,
  allowDownloads,
  checklist,
}: {
  token: string;
  isCompleted: boolean;
  allowDownloads: boolean;
  checklist: { label: string; done: boolean }[];
}) {
  const { t } = useI18n();
  return (
    <SectionShell id="handover" dark>
      <div className="mx-auto max-w-xl text-center">
        <PackageCheck size={28} strokeWidth={1.5} className="mx-auto text-cyan" />
        <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">{isCompleted ? t("Project Completed") : t("Download Center")}</h2>
        <p className="mt-3 text-white/60">
          {isCompleted ? t("Your project is ready. Everything NEON delivered is available below.") : t("Everything delivered so far, in one place.")}
        </p>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <div key={item.label} className={cn("flex items-center gap-2.5 rounded-xl border border-white/10 px-4 py-3 text-start text-sm", !item.done && "opacity-40")}>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", item.done ? "bg-cyan text-ink" : "border border-white/20")}>
                {item.done && <Check size={12} strokeWidth={3} />}
              </span>
              {t(item.label)}
            </div>
          ))}
        </div>

        {allowDownloads && (
          <div className="mt-10 flex flex-col items-center gap-4">
            {/* Everything in one PDF to read and forward (lib/project-book-pdf.ts),
                and the zip beside it for the files themselves. */}
            <GalleryPdfButton href={`/p/${token}/project.pdf`} label="Download the full project as PDF" tone="dark" />
            <p className="-mt-1 text-xs text-white/50">{t("Renders, drawings and documents in one file.")}</p>
            <a
              href={`/p/${token}/handover.zip`}
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t("Download Complete Project Package")}
            </a>
            <p className="-mt-2 text-xs text-white/50">{t("Every original file, as a ZIP.")}</p>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
