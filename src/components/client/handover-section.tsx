import { Check, PackageCheck } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

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
  return (
    <SectionShell id="handover" dark>
      <div className="mx-auto max-w-xl text-center">
        <PackageCheck size={28} strokeWidth={1.5} className="mx-auto text-cyan" />
        <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">{isCompleted ? "Project Completed" : "Download Center"}</h2>
        <p className="mt-3 text-white/60">
          {isCompleted ? "Your project is ready. Everything NEON delivered is available below." : "Everything delivered so far, in one place."}
        </p>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <div key={item.label} className={cn("flex items-center gap-2.5 rounded-xl border border-white/10 px-4 py-3 text-left text-sm", !item.done && "opacity-40")}>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", item.done ? "bg-cyan text-ink" : "border border-white/20")}>
                {item.done && <Check size={12} strokeWidth={3} />}
              </span>
              {item.label}
            </div>
          ))}
        </div>

        {allowDownloads && (
          <a href={`/p/${token}/handover.zip`} className={cn(buttonClasses("primary", "lg"), "mt-10 bg-white text-ink hover:bg-white/90")}>
            Download Complete Project Package
          </a>
        )}
      </div>
    </SectionShell>
  );
}
