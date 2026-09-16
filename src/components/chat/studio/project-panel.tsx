"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, FileText, Image as ImageIcon, PenLine } from "lucide-react";
import type { ProjectPanel } from "@/lib/chat-project-panel";
import { formatFileSize } from "@/lib/format";
import { dayKeyIn, shiftDayKey } from "@/lib/time";
import { useMinuteNow } from "@/lib/use-minute-now";
import { cn } from "@/lib/utils";

// The work beside the talk: the project this conversation is about, its newest
// files and where its steps stand — so a question about a drawing is answered
// without leaving the chat.
//
// Everything here is the project's own record; nothing is invented for the
// panel. When no message in the conversation has named a project, the studio's
// most recently updated one is shown and says so.

type Tab = "overview" | "files" | "tasks";

export function ProjectPanelCard({
  panel,
  timeZone,
  initialNow,
}: {
  panel: ProjectPanel | null;
  timeZone: string;
  initialNow: number;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const base = useId();
  const now = useMinuteNow() ?? initialNow;

  if (!panel) {
    return (
      <div className="rounded-3xl border border-warm-line bg-card p-5 text-sm text-bark/55">
        No project yet. The first project the studio adds will show here.
      </div>
    );
  }

  const { project } = panel;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "files", label: "Files", count: panel.fileCount },
    { key: "tasks", label: "Tasks", count: panel.taskCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-3xl border border-warm-line bg-card shadow-[0_18px_40px_-28px_rgba(44,39,34,0.45)]">
        <div className="relative aspect-[16/9] w-full bg-clay-soft">
          {project.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.coverImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-3xl text-clay">
              {project.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <Link
          href={`/admin/projects/${project.id}`}
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-clay-soft/40 focus-visible:bg-clay-soft/50 focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-bark/40">
              {panel.fromConversation ? "This chat's project" : "Current project"}
            </span>
            <span className="mt-0.5 block truncate font-display text-lg font-semibold text-bark">{project.name}</span>
            <span className="block truncate text-sm text-bark/50">
              {[project.location, project.clientName].filter(Boolean).join(" · ") || "No location yet"}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-bark/35" aria-hidden />
        </Link>

        <div role="tablist" aria-label="About this project" className="flex gap-1 border-t border-warm-line px-2 py-2">
          {tabs.map((item) => {
            const selected = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`${base}-${item.key}-tab`}
                aria-selected={selected}
                aria-controls={`${base}-${item.key}`}
                onClick={() => setTab(item.key)}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/40",
                  selected ? "bg-bark text-paper" : "text-bark/55 hover:bg-clay-soft/60"
                )}
              >
                {item.label}
                {item.count ? (
                  <span className={cn("tabular-nums", selected ? "text-paper/70" : "text-bark/35")}>{item.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`${base}-overview`} aria-labelledby={`${base}-overview-tab`} hidden={tab !== "overview"}>
          <dl className="grid grid-cols-2 gap-px bg-warm-line">
            <Fact label="Stage" value={sentence(project.currentStage) ?? "Not set"} />
            <Fact label="Pipeline" value={sentence(project.pipelineStatus) ?? "Not set"} />
            <Fact label="Client" value={project.clientName ?? "Not set"} />
            <Fact label="Steps done" value={`${panel.doneCount} of ${panel.taskCount}`} />
          </dl>
          {typeof project.completionPercent === "number" && (
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between text-xs text-bark/50">
                <span>Progress</span>
                <span className="tabular-nums">{project.completionPercent}%</span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-clay-soft"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={project.completionPercent}
                aria-label="Project progress"
              >
                <div
                  className="h-full origin-left rounded-full bg-clay transition-transform duration-500"
                  style={{ transform: `scaleX(${Math.min(100, Math.max(0, project.completionPercent)) / 100})` }}
                />
              </div>
            </div>
          )}
        </div>

        <div role="tabpanel" id={`${base}-files`} aria-labelledby={`${base}-files-tab`} hidden={tab !== "files"}>
          {panel.files.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-bark/45">Nothing uploaded to this project yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-warm-line">
              {panel.files.map((file) => (
                <li key={`${file.kind}-${file.id}`}>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-clay-soft/40 focus-visible:bg-clay-soft/50 focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        file.kind === "drawing" ? "bg-clay/15 text-clay-deep" : "bg-bark/[0.06] text-bark/60"
                      )}
                    >
                      {file.kind === "drawing" ? <PenLine size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-bark">{file.name}</span>
                      <span className="block text-xs text-bark/45">
                        {[file.kind === "drawing" ? "Drawing" : "Document", formatFileSize(file.fileSize)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/admin/projects/${project.id}`}
            className="block border-t border-warm-line px-4 py-2.5 text-center text-xs font-semibold text-clay-deep transition-colors hover:bg-clay-soft/50"
          >
            View all files
          </Link>
        </div>

        <div role="tabpanel" id={`${base}-tasks`} aria-labelledby={`${base}-tasks-tab`} hidden={tab !== "tasks"}>
          {panel.tasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-bark/45">No steps on this project yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-warm-line">
              {panel.tasks.map((task) => {
                const when = whenLabel(task.dueAt ?? task.scheduledFor, timeZone, now);
                const done = task.state === "DONE";
                return (
                  <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        done ? "border-clay bg-clay text-white" : "border-bark/20"
                      )}
                    >
                      {done && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", done ? "text-bark/40 line-through" : "text-bark")}>
                        {task.name}
                      </span>
                      {task.assignee && <span className="block truncate text-xs text-bark/40">{task.assignee}</span>}
                    </span>
                    {when && (
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          when === "Overdue" ? "font-semibold text-red-600" : "text-bark/45"
                        )}
                      >
                        {when}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href="/admin/tasks"
            className="block border-t border-warm-line px-4 py-2.5 text-center text-xs font-semibold text-clay-deep transition-colors hover:bg-clay-soft/50"
          >
            View the board
          </Link>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl border border-warm-line bg-clay-soft/70 px-5 py-6">
        <p className="font-display text-lg leading-snug text-bark">Great spaces create great ideas.</p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-bark/40">NEON Interior Design</p>
        <ImageIcon aria-hidden className="pointer-events-none absolute -bottom-3 -right-2 h-20 w-20 text-clay/20" />
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-bark/40">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-bark">{value}</dd>
    </div>
  );
}

/** "CONCEPT" as the studio writes it. */
function sentence(value: string | null) {
  if (!value) return null;
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A step's day in the company's calendar: today, tomorrow, late, or the date. */
function whenLabel(date: Date | string | null, timeZone: string, now: number) {
  if (!date) return null;
  const when = new Date(date);
  const day = dayKeyIn(timeZone, when);
  const today = dayKeyIn(timeZone, new Date(now));

  if (day === today) return "Today";
  if (day === shiftDayKey(today, 1)) return "Tomorrow";
  if (day < today) return "Overdue";
  return new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric", month: "short" }).format(when);
}
