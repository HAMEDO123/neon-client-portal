"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, FileText, Loader2, Paperclip, X } from "lucide-react";
import type { TaskPriority } from "@/generated/prisma/enums";
import type { TaskMember } from "@/lib/chat-task-store";
import { TASK_DESCRIPTION_MAX, TASK_PRIORITIES, TASK_TITLE_MAX, readDue } from "@/lib/chat-tasks";
import { shrinkPhoto } from "@/lib/client-image";
import { buttonClasses } from "@/components/ui/buttons";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// Handing out a task from a chat: what it is, who it is for, when it is due,
// how much it matters, and anything to look at.
//
// A native modal dialog, so focus stays inside it, Escape closes it and the
// page behind cannot be scrolled or clicked. A sheet from the bottom on a
// phone, a panel in the middle on a computer. It stays open, with the button
// busy, until the task is saved: a mistake the server finds — a time that has
// just passed — is shown here, next to the field, rather than on a card that
// then has to be taken back. A reason stays on screen only until something in
// the form changes, so it never describes a form that has since been fixed.

export type TaskSetup = {
  members: TaskMember[];
  defaultDue: { dayKey: string; time: string };
  today: string;
  timeZone: string;
};

const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/45";
const INPUT =
  "w-full rounded-xl border border-ink/12 bg-white px-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-cyan-strong focus-visible:ring-2 focus-visible:ring-cyan-strong/25";

export function TaskSheet({
  setup,
  initialTitle,
  onClose,
  onCreate,
}: {
  setup: TaskSetup;
  initialTitle: string;
  onClose: () => void;
  /** Saves the task; throws with a reason the form can show. */
  onCreate: (formData: FormData) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const single = setup.members.length === 1;
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<string[]>(single ? [setup.members[0].id] : []);
  const [dueDay, setDueDay] = useState(setup.defaultDue.dayKey);
  const [dueTime, setDueTime] = useState(setup.defaultDue.time);
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  // The reason, and the form as it stood when the reason was given.
  const [failure, setFailure] = useState<{ reason: string; form: string } | null>(null);

  const form = [title, description, assignees.join(","), dueDay, dueTime, priority, file?.name ?? ""].join("␟");
  const error = failure && failure.form === form ? failure.reason : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const everyone = setup.members.length > 1 && assignees.length === setup.members.length;

  function toggle(id: string) {
    setAssignees((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]));
  }

  function close() {
    if (!saving) onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const refuse = (reason: string) => setFailure({ reason, form });

    if (!title.trim()) return refuse("Give the task a title.");
    if (assignees.length === 0) return refuse("Choose who it is for.");
    const due = readDue(dueDay, dueTime, setup.timeZone, new Date());
    if (!due.ok) return refuse(due.reason);

    setFailure(null);
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("title", title.trim());
      if (description.trim()) formData.set("description", description.trim());
      for (const id of assignees) formData.append("assignee", id);
      formData.set("dueDay", dueDay);
      formData.set("dueTime", dueTime);
      formData.set("priority", priority);
      if (file) {
        // Photos are shrunk on the device first, like every photo sent in a chat,
        // and keep the name the shrinking gives them: a PNG re-encoded as JPEG is a .jpg.
        const upload = file.type.startsWith("image/") ? await shrinkPhoto(file) : file;
        formData.set("attachment", upload, upload.name);
      }
      await onCreate(formData);
    } catch (cause) {
      refuse(cause instanceof Error && cause.message ? cause.message : "Could not create the task. Try again.");
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A tap on the dimmed page around it, not inside it.
        if (event.target === event.currentTarget) close();
      }}
      className="task-sheet mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40 sm:my-auto sm:max-w-lg sm:rounded-3xl"
    >
      <form onSubmit={submit} noValidate className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center justify-between border-b border-ink/[0.07] px-5 py-3">
          <h2 id={`${ids}-heading`} className="text-base font-semibold">
            New task
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Close"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <div>
            <label htmlFor={`${ids}-title`} className={LABEL}>
              Title
            </label>
            <input
              id={`${ids}-title`}
              autoFocus
              value={title}
              maxLength={TASK_TITLE_MAX}
              dir="auto"
              placeholder="What needs doing?"
              aria-required
              onChange={(event) => setTitle(event.target.value)}
              className={cn(INPUT, "h-11")}
            />
          </div>

          <div>
            <label htmlFor={`${ids}-description`} className={LABEL}>
              Description <span className="font-normal normal-case tracking-normal text-ink/35">(optional)</span>
            </label>
            <textarea
              id={`${ids}-description`}
              rows={3}
              value={description}
              maxLength={TASK_DESCRIPTION_MAX}
              dir="auto"
              placeholder="Details, measurements, where to find things…"
              onChange={(event) => setDescription(event.target.value)}
              className={cn(INPUT, "resize-none py-2.5")}
            />
          </div>

          <fieldset>
            <legend className={LABEL}>{single ? "For" : "Assign to"}</legend>
            {single ? (
              <p className="flex items-center gap-2 rounded-xl bg-ink/[0.04] px-3 py-2 text-sm font-medium">
                <PersonAvatar name={setup.members[0].name} color={setup.members[0].color} size={26} />
                {setup.members[0].name}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={everyone}
                  onClick={() => setAssignees(everyone ? [] : setup.members.map((member) => member.id))}
                  className={chip(everyone)}
                >
                  Everyone
                  {everyone && <Check size={14} strokeWidth={2.75} aria-hidden />}
                </button>
                {setup.members.map((member) => {
                  const chosen = assignees.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => toggle(member.id)}
                      className={cn(chip(chosen), "pl-1")}
                    >
                      <PersonAvatar name={member.name} color={member.color} size={24} />
                      {member.name}
                      {chosen && <Check size={14} strokeWidth={2.75} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${ids}-day`} className={LABEL}>
                Due date
              </label>
              <input
                id={`${ids}-day`}
                type="date"
                value={dueDay}
                min={setup.today}
                aria-required
                onChange={(event) => setDueDay(event.target.value)}
                className={cn(INPUT, "h-11")}
              />
            </div>
            <div>
              <label htmlFor={`${ids}-time`} className={LABEL}>
                Time
              </label>
              <input
                id={`${ids}-time`}
                type="time"
                value={dueTime}
                step={300}
                aria-required
                onChange={(event) => setDueTime(event.target.value)}
                className={cn(INPUT, "h-11")}
              />
            </div>
          </div>

          <fieldset>
            <legend className={LABEL}>Priority</legend>
            <div role="radiogroup" aria-label="Priority" className="grid grid-cols-3 gap-1 rounded-xl bg-ink/[0.05] p-1">
              {TASK_PRIORITIES.map((level, index) => {
                const chosen = priority === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    tabIndex={chosen ? 0 : -1}
                    onClick={() => setPriority(level)}
                    onKeyDown={(event) => {
                      const step =
                        event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                      if (!step) return;
                      event.preventDefault();
                      const next = (index + step + TASK_PRIORITIES.length) % TASK_PRIORITIES.length;
                      setPriority(TASK_PRIORITIES[next]);
                      const group = event.currentTarget.parentElement;
                      (group?.children[next] as HTMLButtonElement | undefined)?.focus();
                    }}
                    className={cn(
                      "h-9 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40",
                      chosen ? "bg-white text-ink shadow-sm" : "text-ink/55 hover:text-ink/80"
                    )}
                  >
                    {PRIORITY_LABEL[level]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            {file ? (
              <p className="flex items-center gap-2 rounded-xl bg-ink/[0.04] py-1.5 pl-3 pr-1.5 text-sm">
                <FileText size={16} className="shrink-0 text-ink/45" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={saving}
                  aria-label={`Remove ${file.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink/45 hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
                >
                  <X size={15} />
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink/60 ring-1 ring-ink/12 transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40"
              >
                <Paperclip size={16} aria-hidden />
                Attach a photo or file
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="neon-rise rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-ink/[0.07] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={close} disabled={saving} className={buttonClasses("outline", "md", "flex-1")}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonClasses("primary", "md", "flex-1")}>
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {saving ? "Creating…" : "Create task"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function chip(chosen: boolean) {
  return cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/50",
    chosen ? "bg-ink text-bg ring-ink" : "bg-white text-ink/70 ring-ink/12 hover:bg-ink/[0.03]"
  );
}
