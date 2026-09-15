"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  FileText,
  ImageUp,
  Loader2,
  MessageSquare,
  MoreVertical,
  Play,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { TaskPriority, TaskState } from "@/generated/prisma/enums";
import type { ChatTaskView } from "@/lib/chat-task-store";
import { listTime, type ChatViewer } from "@/lib/chat-conversations";
import {
  CARD_STATE_LABEL,
  TASK_COMMENT_MAX,
  dueDistance,
  dueLabel,
  isImageAttachment,
  isOverdue,
  mayComment,
  overallState,
  progressOf,
} from "@/lib/chat-tasks";
import { addChatTaskComment, deleteChatTask } from "@/lib/actions/chat-task-actions";
import { setMyAssignedTaskStatus, submitAssignedTaskCompletion } from "@/lib/actions/my-assigned-actions";
import { approveSubmission, rejectSubmission } from "@/lib/actions/submission-actions";
import { setAssignedTaskState } from "@/lib/actions/assigned-task-actions";
import { shrinkPhoto } from "@/lib/client-image";
import { useMinuteNow } from "@/lib/use-minute-now";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// A task the manager handed out, as a card in the conversation.
//
// Everyone in the chat sees the same card: what it is, when it is due, and
// where each person's part stands. What they can do on it depends on who they
// are — the person it was given to starts it and sends their proof, the
// manager reviews the photo, moves a part or deletes the task, and the two of
// them talk underneath. Every move goes through the actions a job from the
// week board already uses, so the rules are theirs, not the card's.
//
// A move shows at once and is kept on screen until the server's own copy of
// that part changes; if the move is refused, it goes back and says why.

type Part = ChatTaskView["assignments"][number];
type Comment = ChatTaskView["comments"][number];
type Move = (partId: string, to: TaskState, action: () => Promise<unknown>) => Promise<void>;

const PRIORITY_STYLE: Record<TaskPriority, { label: string; pill: string; bar: string }> = {
  HIGH: { label: "High", pill: "bg-pink/12 text-pink-strong", bar: "bg-pink-strong" },
  MEDIUM: { label: "Medium", pill: "bg-orange/12 text-orange-strong", bar: "bg-orange-strong" },
  LOW: { label: "Low", pill: "bg-ink/[0.06] text-ink/55", bar: "bg-ink/20" },
};

const STATE_PILL: Record<TaskState, string> = {
  TODO: "bg-ink/[0.06] text-ink/60",
  TOMORROW: "bg-ink/[0.06] text-ink/60",
  IN_PROGRESS: "bg-cyan/15 text-cyan-strong",
  SUBMITTED: "bg-purple/15 text-purple-strong",
  DONE: "bg-emerald-500/15 text-emerald-700",
};

const MANAGER_MOVES: TaskState[] = ["TODO", "IN_PROGRESS", "DONE"];

const BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-[transform,background-color,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";
const TONE = {
  cyan: "bg-cyan-strong text-white hover:bg-cyan-strong/90 focus-visible:ring-cyan-strong",
  emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600",
  ghost: "bg-ink/[0.05] text-ink/70 hover:bg-ink/[0.09] focus-visible:ring-ink/30",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
} as const;

function failure(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * What the manager attached: a picture shown in the card, anything else as a
 * file to open. A picture that cannot be loaded becomes the link to it rather
 * than an empty box the size of a photo.
 */
function CardAttachment({ url, name, type }: { url: string; name: string | null; type: string | null }) {
  const [broken, setBroken] = useState(false);

  if (isImageAttachment(type) && !broken) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block overflow-hidden rounded-xl ring-1 ring-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name ?? "Attached photo"}
          loading="lazy"
          onError={() => setBroken(true)}
          className="aspect-[4/3] max-h-56 w-full bg-ink/[0.04] object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-2 rounded-xl bg-ink/[0.04] px-2.5 py-2 text-sm text-ink/75 hover:bg-ink/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/50"
    >
      <FileText size={17} strokeWidth={1.75} className="shrink-0 text-ink/45" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{name ?? "File"}</span>
    </a>
  );
}

export function TaskCard({
  task,
  viewer,
  timeZone,
  initialNow,
  onDeleted,
}: {
  task: ChatTaskView;
  viewer: ChatViewer;
  timeZone: string;
  /** The server's clock when the page was drawn, until the device's own takes over. */
  initialNow: number;
  onDeleted: () => void;
}) {
  const now = useMinuteNow() ?? initialNow;
  const titleId = useId();

  // A move shown ahead of the server, keyed to the version of the part it was made on.
  const [ahead, setAhead] = useState<Record<string, { version: number; to: TaskState }>>({});
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDeleting] = useTransition();

  const parts: Part[] = task.assignments.map((part) => {
    const shown = ahead[part.id];
    return shown && shown.version === new Date(part.updatedAt).getTime() ? { ...part, state: shown.to } : part;
  });

  const move: Move = async (partId, to, action) => {
    const original = task.assignments.find((part) => part.id === partId);
    if (!original) return;
    const version = new Date(original.updatedAt).getTime();

    setError(null);
    setAhead((current) => ({ ...current, [partId]: { version, to } }));
    try {
      await action();
    } catch (cause) {
      setAhead((current) => {
        const next = { ...current };
        delete next[partId];
        return next;
      });
      setError(failure(cause, "That did not save. Try again."));
    }
  };

  const overall = overallState(parts);
  const progress = progressOf(parts);
  const late = isOverdue(task.dueAt, parts, now);
  const distance = dueDistance(task.dueAt, now);
  const priority = PRIORITY_STYLE[task.priority];
  const isManager = viewer.type === "ADMIN";
  const description = task.description ?? "";
  const longDescription = description.length > 160 || description.split("\n").length > 3;

  function remove() {
    startDeleting(async () => {
      try {
        await deleteChatTask(task.id);
        onDeleted();
      } catch (cause) {
        setConfirming(false);
        setError(failure(cause, "Could not delete the task. Try again."));
      }
    });
  }

  return (
    <article
      id={`task-${task.id}`}
      aria-labelledby={titleId}
      className={cn(
        "relative w-[min(22rem,calc(100vw-4.5rem))] rounded-2xl bg-white text-left shadow-sm ring-1 transition-opacity",
        late ? "ring-red-500/45" : "ring-ink/10",
        deleting && "opacity-60"
      )}
    >
      <div aria-hidden className={cn("h-1 rounded-t-2xl", late ? "bg-red-500" : priority.bar)} />

      <div className="px-3 pb-2.5 pt-2.5">
        <header className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/55">
            <ClipboardList size={11} strokeWidth={2.5} aria-hidden />
            Task
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", priority.pill)}>
            <span className="sr-only">Priority: </span>
            {priority.label}
          </span>
          <span className={cn("truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_PILL[overall])}>
            {CARD_STATE_LABEL[overall]}
          </span>
          {isManager && <CardMenu disabled={deleting} onDelete={() => setConfirming(true)} />}
        </header>

        <h3 id={titleId} dir="auto" className="mt-2 break-words text-[15px] font-semibold leading-snug text-ink">
          {task.title}
        </h3>

        {description && (
          <div className="mt-1">
            <p
              dir="auto"
              className={cn("whitespace-pre-wrap break-words text-sm text-ink/65", !expanded && longDescription && "line-clamp-3")}
            >
              {description}
            </p>
            {longDescription && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="mt-0.5 rounded text-xs font-semibold text-cyan-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {task.attachmentUrl && (
          <CardAttachment url={task.attachmentUrl} name={task.attachmentName} type={task.attachmentType} />
        )}

        <p className={cn("mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[13px]", late ? "font-medium text-red-600" : "text-ink/60")}>
          {late ? (
            <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
          ) : (
            <CalendarClock size={14} strokeWidth={2} aria-hidden />
          )}
          <span className="sr-only">{late ? "Overdue. It was due" : "Due"}</span>
          <span>{dueLabel(task.dueAt, now, timeZone)}</span>
          {!progress.complete && <span className={late ? "text-red-600" : "text-ink/40"}>· {distance.text}</span>}
        </p>

        {parts.length > 1 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label="People finished"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]"
            >
              <div
                className="h-full origin-left rounded-full bg-emerald-500 transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }}
              />
            </div>
            <span className="text-xs tabular-nums text-ink/50">
              {progress.done} of {progress.total} done
            </span>
          </div>
        )}

        {parts.length === 0 ? (
          <p className="mt-2 text-xs text-ink/45">Nobody is on this task any more.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col divide-y divide-ink/[0.06]">
            {parts.map((part) => (
              <PartRow key={part.id} part={part} viewer={viewer} late={late} move={move} />
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="neon-rise mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            <CircleAlert size={13} strokeWidth={2.25} className="mt-px shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {confirming && (
          <div role="alertdialog" aria-labelledby={`${titleId}-delete`} className="neon-rise mt-2.5 rounded-xl bg-red-50 p-2.5">
            <p id={`${titleId}-delete`} className="text-xs text-red-800">
              Delete this task for everyone? Each person&apos;s progress, photos and comments go with it.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className={cn(BUTTON, TONE.ghost)}
              >
                Keep
              </button>
              <button type="button" disabled={deleting} onClick={remove} className={cn(BUTTON, TONE.danger)}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>

      <Thread task={task} viewer={viewer} timeZone={timeZone} now={now} />
    </article>
  );
}

function CardMenu({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div
      className="relative ml-auto"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-label="Task options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="neon-rise absolute right-0 top-full z-20 mt-1 min-w-40 rounded-xl bg-white p-1 shadow-lg ring-1 ring-ink/10"
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none"
          >
            <Trash2 size={15} aria-hidden />
            Delete task
          </button>
        </div>
      )}
    </div>
  );
}

function PartRow({ part, viewer, late, move }: { part: Part; viewer: ChatViewer; late: boolean; move: Move }) {
  const own = viewer.type === "EMPLOYEE" && viewer.id === part.employeeId;
  const [busy, start] = useTransition();
  const [proofOpen, setProofOpen] = useState(false);
  const submission = part.submissions[0];

  const run = (to: TaskState, action: () => Promise<unknown>) => start(() => move(part.id, to, action));

  return (
    <li className="py-2">
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={part.employee.name} color={part.employee.color} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{own ? "You" : part.employee.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className={cn("rounded-full px-1.5 py-px font-semibold transition-colors", STATE_PILL[part.state])}>
              {CARD_STATE_LABEL[part.state]}
            </span>
            {late && part.state !== "DONE" && <span className="font-semibold text-red-600">Late</span>}
          </p>
        </div>
        {busy && <Loader2 size={15} className="animate-spin text-ink/40" aria-label="Saving" />}
        {viewer.type === "ADMIN" && part.state !== "SUBMITTED" && (
          <StatusMenu current={part.state} disabled={busy} onPick={(to) => run(to, () => setAssignedTaskState(part.id, to as "TODO" | "IN_PROGRESS" | "DONE"))} />
        )}
      </div>

      {own && !proofOpen && (
        <OwnActions
          state={part.state}
          busy={busy}
          onStart={() => run("IN_PROGRESS", () => setMyAssignedTaskStatus(part.id, "IN_PROGRESS"))}
          onUnstart={() => run("TODO", () => setMyAssignedTaskStatus(part.id, "TODO"))}
          onProof={() => setProofOpen(true)}
        />
      )}

      {own && proofOpen && (
        <ProofForm
          onCancel={() => setProofOpen(false)}
          onSend={async (formData) => {
            await submitAssignedTaskCompletion(part.id, formData);
            setProofOpen(false);
            // Sent: shown as with the manager until the server's copy catches up.
            await move(part.id, "SUBMITTED", async () => undefined);
          }}
        />
      )}

      {viewer.type === "ADMIN" &&
        part.state === "SUBMITTED" &&
        (submission ? (
          <Review
            key={submission.id}
            imageUrl={submission.imageUrl}
            note={submission.note}
            busy={busy}
            onApprove={() => run("DONE", () => approveSubmission(submission.id))}
            onReject={(reason) =>
              run("IN_PROGRESS", () => {
                const formData = new FormData();
                if (reason) formData.set("reviewNote", reason);
                return rejectSubmission(submission.id, formData);
              })
            }
          />
        ) : (
          <p className="mt-1 pl-[38px] text-xs text-ink/45">The photo is on its way.</p>
        ))}
    </li>
  );
}

function OwnActions({
  state,
  busy,
  onStart,
  onUnstart,
  onProof,
}: {
  state: TaskState;
  busy: boolean;
  onStart: () => void;
  onUnstart: () => void;
  onProof: () => void;
}) {
  if (state === "SUBMITTED") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 pl-[38px] text-xs text-purple-strong">
        <Camera size={13} strokeWidth={2.25} aria-hidden />
        Your photo is with the manager for review.
      </p>
    );
  }
  if (state === "DONE") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 pl-[38px] text-xs font-medium text-emerald-700">
        <Check size={13} strokeWidth={2.75} aria-hidden />
        Approved by the manager.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2 pl-[38px]">
      {state === "IN_PROGRESS" ? (
        <button type="button" disabled={busy} onClick={onUnstart} className={cn(BUTTON, TONE.ghost)}>
          <Undo2 size={14} aria-hidden />
          Not started
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={onStart} className={cn(BUTTON, TONE.cyan)}>
          <Play size={13} strokeWidth={2.5} aria-hidden />
          Start
        </button>
      )}
      <button type="button" disabled={busy} onClick={onProof} className={cn(BUTTON, TONE.emerald)}>
        <Camera size={14} aria-hidden />
        Send proof
      </button>
    </div>
  );
}

function StatusMenu({
  current,
  disabled,
  onPick,
}: {
  current: TaskState;
  disabled: boolean;
  onPick: (state: TaskState) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-ink/55 transition-colors hover:bg-ink/5 hover:text-ink/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        Set status
        <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="neon-rise absolute right-0 top-full z-20 mt-1 min-w-36 rounded-xl bg-white p-1 shadow-lg ring-1 ring-ink/10"
        >
          {MANAGER_MOVES.map((state, index) => (
            <button
              key={state}
              type="button"
              role="menuitemradio"
              aria-checked={state === current}
              autoFocus={index === 0}
              disabled={state === current}
              onClick={() => {
                setOpen(false);
                onPick(state);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink/80 hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none disabled:text-ink/35"
            >
              {CARD_STATE_LABEL[state]}
              {state === current && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProofForm({ onSend, onCancel }: { onSend: (formData: FormData) => Promise<void>; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, start] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  function send() {
    if (!file) {
      setError("Take a photo or choose one first.");
      return;
    }
    start(async () => {
      try {
        const formData = new FormData();
        // Shrunk on the phone first: uploading the full photo was most of the wait.
        formData.set("photo", await shrinkPhoto(file));
        if (note.trim()) formData.set("note", note.trim());
        await onSend(formData);
      } catch (cause) {
        setError(failure(cause, "Could not send it. Try again."));
      }
    });
  }

  return (
    <div className="neon-rise mt-2 rounded-xl bg-ink/[0.03] p-2.5 ring-1 ring-ink/[0.06]">
      <p className="text-xs font-medium text-ink/60">A photo of the finished work, for the manager to review.</p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => pick(event.target.files?.[0])} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(event) => pick(event.target.files?.[0])} />

      {preview ? (
        <div className="relative mt-2 overflow-hidden rounded-lg ring-1 ring-ink/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="The photo you are sending" className="aspect-[4/3] max-h-56 w-full object-cover" />
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setFile(null);
              setPreview(null);
            }}
            aria-label="Remove photo"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink/15 bg-white text-xs font-medium text-ink/60 transition-colors hover:bg-ink/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/50"
          >
            <Camera size={18} strokeWidth={1.75} aria-hidden />
            Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink/15 bg-white text-xs font-medium text-ink/60 transition-colors hover:bg-ink/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/50"
          >
            <ImageUp size={18} strokeWidth={1.75} aria-hidden />
            Choose photo
          </button>
        </div>
      )}

      <label className="sr-only" htmlFor={`${cameraRef}-note`}>
        Note for the manager
      </label>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={1000}
        dir="auto"
        placeholder="Anything the manager should know (optional)"
        className="mt-2 h-9 w-full rounded-lg border border-ink/12 bg-white px-2.5 text-sm outline-none focus:border-cyan-strong"
      />

      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" disabled={sending} onClick={onCancel} className={cn(BUTTON, TONE.ghost)}>
          Cancel
        </button>
        <button type="button" disabled={sending || !file} onClick={send} className={cn(BUTTON, TONE.emerald)}>
          {sending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
          {sending ? "Sending…" : "Send for review"}
        </button>
      </div>
    </div>
  );
}

function Review({
  imageUrl,
  note,
  busy,
  onApprove,
  onReject,
}: {
  imageUrl: string;
  note: string | null;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="mt-2 pl-[38px]">
      <a
        href={imageUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-xl ring-1 ring-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Photo sent for review" loading="lazy" className="aspect-[4/3] w-full bg-ink/[0.04] object-cover" />
      </a>
      {note && (
        <p dir="auto" className="mt-1.5 text-xs text-ink/60">
          “{note}”
        </p>
      )}

      {rejecting ? (
        <div className="neon-rise mt-2 flex flex-col gap-2">
          <input
            value={reason}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onReject(reason.trim());
              }
            }}
            maxLength={500}
            dir="auto"
            placeholder="What needs changing? (optional)"
            aria-label="What needs changing"
            className="h-9 w-full rounded-lg border border-ink/12 bg-white px-2.5 text-sm outline-none focus:border-cyan-strong"
          />
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={cn(BUTTON, TONE.ghost)}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => onReject(reason.trim())} className={cn(BUTTON, TONE.danger)}>
              <Undo2 size={14} aria-hidden />
              Send back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onApprove} className={cn(BUTTON, TONE.emerald)}>
            <Check size={14} strokeWidth={2.75} aria-hidden />
            Approve
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={cn(BUTTON, TONE.ghost)}>
            <Undo2 size={14} aria-hidden />
            Send back
          </button>
        </div>
      )}
    </div>
  );
}

type PendingComment = { key: string; body: string; status: "sending" | "failed"; savedId?: string };

function Thread({
  task,
  viewer,
  timeZone,
  now,
}: {
  task: ChatTaskView;
  viewer: ChatViewer;
  timeZone: string;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingComment[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const panelId = useId();

  const canWrite = mayComment(
    viewer,
    task.assignments.map((part) => part.employeeId)
  );
  // Newest first from the server, so a long thread keeps what was said last; oldest first to read.
  const saved = useMemo(() => [...task.comments].reverse(), [task.comments]);
  const savedIds = new Set(saved.map((comment) => comment.id));
  // A comment of ours stays drawn from here until the server's copy of it arrives.
  const waiting = pending.filter((item) => !(item.savedId && savedIds.has(item.savedId)));
  const count = task._count.comments + waiting.filter((item) => item.status !== "failed").length;

  const colourOf = (comment: Comment) =>
    task.assignments.find((part) => part.employeeId === comment.authorId)?.employee.color ?? "ink";
  const isMine = (comment: Comment) =>
    viewer.type === "ADMIN" ? comment.authorType === "ADMIN" : comment.authorType === "EMPLOYEE" && comment.authorId === viewer.id;

  useEffect(() => {
    const list = listRef.current;
    if (open && list) list.scrollTop = list.scrollHeight;
  }, [open, saved.length, waiting.length]);

  async function post(body: string, key: string) {
    const formData = new FormData();
    formData.set("taskId", task.id);
    formData.set("body", body);
    formData.set("as", viewer.type);
    try {
      const comment = await addChatTaskComment(formData);
      setPending((current) =>
        current.map((item) => (item.key === key ? { ...item, savedId: comment?.id, status: "sending" } : item))
      );
    } catch {
      setPending((current) => current.map((item) => (item.key === key ? { ...item, status: "failed" } : item)));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    const key = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDraft("");
    setPending((current) => [...current, { key, body, status: "sending" }]);
    void post(body, key);
  }

  const label =
    count === 0 ? (canWrite ? "Add a comment" : "No comments") : `${count} ${count === 1 ? "comment" : "comments"}`;

  return (
    <div className="border-t border-ink/[0.07]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-1.5 rounded-b-2xl px-3 py-2 text-[13px] font-medium text-ink/55 transition-colors hover:text-ink/80 focus-visible:bg-ink/[0.04] focus-visible:outline-none"
      >
        <MessageSquare size={14} strokeWidth={2} aria-hidden />
        {label}
        <ChevronDown size={14} className={cn("ml-auto transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      <div id={panelId} hidden={!open} className="px-3 pb-3">
        {(saved.length > 0 || waiting.length > 0) && (
          <ol ref={listRef} aria-label="Comments" className="flex max-h-64 flex-col gap-2 overflow-y-auto overscroll-contain">
            {task._count.comments > saved.length && (
              <li className="text-center text-[11px] text-ink/40">Showing the latest {saved.length}.</li>
            )}
            {saved.map((comment) => (
              <CommentItem
                key={comment.id}
                name={isMine(comment) ? "You" : comment.authorName}
                avatarName={comment.authorType === "ADMIN" ? "Manager" : comment.authorName}
                color={comment.authorType === "ADMIN" ? "ink" : colourOf(comment)}
                body={comment.body}
                time={listTime(new Date(comment.createdAt), new Date(now), timeZone)}
              />
            ))}
            {waiting.map((item) => (
              <CommentItem
                key={item.key}
                name="You"
                avatarName={viewer.type === "ADMIN" ? "Manager" : viewer.name}
                color={
                  viewer.type === "ADMIN"
                    ? "ink"
                    : task.assignments.find((part) => part.employeeId === viewer.id)?.employee.color
                }
                body={item.body}
                time={null}
                status={item.savedId ? undefined : item.status}
                onRetry={() => {
                  setPending((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: "sending" } : entry)));
                  void post(item.body, item.key);
                }}
                onDiscard={() => setPending((current) => current.filter((entry) => entry.key !== item.key))}
              />
            ))}
          </ol>
        )}

        {canWrite ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="mt-2 flex items-end gap-2"
          >
            <label className="sr-only" htmlFor={`${panelId}-input`}>
              Comment
            </label>
            <textarea
              id={`${panelId}-input`}
              rows={1}
              value={draft}
              maxLength={TASK_COMMENT_MAX}
              dir="auto"
              placeholder="Write a comment"
              onChange={(event) => {
                setDraft(event.target.value);
                const el = event.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="min-h-9 flex-1 resize-none rounded-2xl bg-ink/[0.05] px-3 py-2 text-sm outline-none transition-colors focus:bg-ink/[0.07] focus-visible:ring-2 focus-visible:ring-cyan-strong/40"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send comment"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition-[transform,opacity] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
            >
              <Send size={15} aria-hidden />
            </button>
          </form>
        ) : (
          <p className="mt-2 text-xs text-ink/40">Only the manager and the people on this task can comment.</p>
        )}
      </div>
    </div>
  );
}

function CommentItem({
  name,
  avatarName,
  color,
  body,
  time,
  status,
  onRetry,
  onDiscard,
}: {
  name: string;
  avatarName: string;
  color?: string | null;
  body: string;
  time: string | null;
  status?: "sending" | "failed";
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <li className={cn("neon-rise flex gap-2 transition-opacity", status === "sending" && "opacity-60")}>
      <PersonAvatar name={avatarName} color={color} size={22} className="mt-0.5" />
      <div className="min-w-0 flex-1 rounded-xl bg-ink/[0.04] px-2.5 py-1.5">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-semibold text-ink/80">{name}</span>
          {time && <span className="shrink-0 text-[11px] text-ink/40">{time}</span>}
        </p>
        <p dir="auto" className="whitespace-pre-wrap break-words text-[13px] text-ink/75">
          {body}
        </p>
        {status === "failed" && (
          <p className="mt-1 flex gap-3 text-[11px] font-medium text-red-600">
            <span>Not sent</span>
            <button type="button" onClick={onRetry} className="underline underline-offset-2">
              Retry
            </button>
            <button type="button" onClick={onDiscard} className="underline underline-offset-2">
              Remove
            </button>
          </p>
        )}
      </div>
    </li>
  );
}
