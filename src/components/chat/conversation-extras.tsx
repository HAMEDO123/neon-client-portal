import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText } from "lucide-react";
import type { ChatMessageView } from "@/lib/chat";
import { progressOf } from "@/lib/chat-tasks";
import { cn } from "@/lib/utils";

// Two tiles beside an open conversation on a wide screen (design 2,
// 2026-11-19): the tasks given in it, and what was shared in it. Both read the
// messages the page already loaded — nothing is fetched for them.

export function ConversationExtras({
  messages,
  basePath,
  slug,
  timeZone,
}: {
  messages: ChatMessageView[];
  basePath: string;
  slug: string;
  timeZone: string;
}) {
  const tasks = messages
    .flatMap((message) => (message.task ? [message.task] : []))
    .reverse()
    .slice(0, 4);
  const shared = messages.filter((message) => message.attachmentUrl).reverse();
  const photos = shared
    .filter((message) => message.attachmentType?.startsWith("image/"))
    .slice(0, 6);
  const files = shared
    .filter((message) => !message.attachmentType?.startsWith("image/"))
    .slice(0, 3);
  const [newest, ...older] = tasks;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      {newest ? (
        <section
          aria-label="Tasks from this chat"
          className="lq-accent rounded-2xl p-5 text-white"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85">
            From this chat
          </p>
          <p dir="auto" className="mt-2 text-lg font-semibold leading-snug">
            {newest.title}
          </p>
          <p className="mt-1 text-xs text-white/85">
            {taskLine(newest, timeZone)}
          </p>
          <Link
            href={`${basePath}/${slug}?task=${newest.id}`}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-semibold text-clay-deep hover:opacity-90"
          >
            Show in the chat <ArrowRight size={13} strokeWidth={2.25} />
          </Link>
          {older.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-white/25 pt-3">
              {older.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`${basePath}/${slug}?task=${task.id}`}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <CheckCircle2
                      size={14}
                      strokeWidth={2}
                      className={cn(
                        "shrink-0",
                        progressOf(task.assignments).complete
                          ? "text-white"
                          : "text-white/60",
                      )}
                    />
                    <span dir="auto" className="truncate">
                      {task.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section
          aria-label="Tasks from this chat"
          className="glass rounded-2xl p-5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
            From this chat
          </p>
          <p className="mt-2 text-sm text-ink/60">
            No tasks were given in this chat yet.
          </p>
        </section>
      )}

      <section
        aria-label="Shared in this chat"
        className="glass rounded-2xl p-5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
          Shared
        </p>
        {photos.length === 0 && files.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">
            Photos and files sent here will collect here.
          </p>
        ) : (
          <>
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {photos.map((message) => (
                  <a
                    key={message.id}
                    href={message.attachmentUrl!}
                    target="_blank"
                    rel="noreferrer"
                    className="block aspect-square overflow-hidden rounded-xl bg-ink/5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- an upload of our own, cropped to a square */}
                    <img
                      src={message.attachmentUrl!}
                      alt={message.attachmentName ?? "Photo"}
                      className="h-full w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {files.map((message) => (
                  <li key={message.id}>
                    <a
                      href={message.attachmentUrl!}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 rounded-xl bg-ink/[0.04] px-3 py-2 text-sm text-ink hover:bg-ink/[0.07]"
                    >
                      <FileText
                        size={16}
                        strokeWidth={1.85}
                        className="shrink-0 text-clay-deep"
                      />
                      <span dir="auto" className="truncate">
                        {message.attachmentName ?? "File"}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function taskLine(
  task: NonNullable<ChatMessageView["task"]>,
  timeZone: string,
) {
  const { done, total, complete } = progressOf(task.assignments);
  if (complete) return "Done";
  const due = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(new Date(task.dueAt));
  return total > 1 ? `Due ${due} · ${done} of ${total} done` : `Due ${due}`;
}
