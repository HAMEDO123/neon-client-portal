"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircleQuestion, Send, UserRound, UsersRound } from "lucide-react";
import { askAboutTask } from "@/lib/actions/task-question-actions";
import { refusalOf } from "@/lib/ask";
import { QUESTION_MAX, type AboutKind, type AskWhere } from "@/lib/task-questions";
import { cn } from "@/lib/utils";

// A question about this task, sent into a chat.
//
// It goes to the manager privately or to the company's group — whoever is
// asking chooses, because "when is this due" is the manager's to answer and
// "who has the keys" is anybody's. The message carries the task's name, and
// sending it opens that chat: the answer comes back there, and so does the
// rest of the conversation.

const WHERE: { key: AskWhere; label: string; hint: string; icon: typeof UserRound; chat: string }[] = [
  { key: "manager", label: "The manager", hint: "Only the two of you", icon: UserRound, chat: "/employee/chat/manager" },
  { key: "team", label: "Team group", hint: "Everybody sees it", icon: UsersRound, chat: "/employee/chat/team" },
];

export function AskAboutTask({
  kind,
  id,
  asked,
}: {
  kind: AboutKind;
  id: string;
  /** What was already asked about it, newest first, with the time written out. */
  asked: { id: string; where: AskWhere; text: string; when: string }[];
}) {
  const router = useRouter();
  const [where, setWhere] = useState<AskWhere>("manager");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = WHERE.find((option) => option.key === where) ?? WHERE[0];

  // Not a form action: React empties a form whenever one finishes, and a
  // question that failed to send is exactly the text somebody wants back.
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (!text.trim()) {
      setError("Write your question first.");
      return;
    }

    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("id", id);
    formData.set("where", where);
    formData.set("body", text);

    setSending(true);
    setError(null);
    const refused = await refusalOf(
      () => askAboutTask(formData),
      "That could not be sent. Check the connection and try again."
    );
    if (refused) {
      setSending(false);
      setError(refused);
      return;
    }
    // Into the conversation it went to, where the answer will arrive.
    router.push(chosen.chat);
  }

  return (
    <section className="glass rounded-2xl p-4">
      <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
        <MessageCircleQuestion size={13} strokeWidth={2} />
        Ask about this task
      </h2>
      <p className="mt-1 text-xs text-ink/50">
        Your question goes into the chat with this task&apos;s name on it, and the answer comes back there.
      </p>

      <form onSubmit={send} className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who to ask">
          {WHERE.map((option) => {
            const Icon = option.icon;
            const on = option.key === where;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setWhere(option.key)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                  on ? "border-ink bg-ink text-bg" : "border-ink/12 bg-white/60 text-ink/65"
                )}
              >
                <Icon size={16} strokeWidth={2} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{option.label}</span>
                  <span className={cn("block truncate text-[11px]", on ? "text-bg/60" : "text-ink/40")}>
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <textarea
          dir="auto"
          rows={3}
          value={text}
          maxLength={QUESTION_MAX}
          onChange={(event) => {
            setText(event.target.value);
            // What was wrong a moment ago is being put right.
            setError(null);
          }}
          placeholder="What do you need to know?"
          aria-label="Your question"
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center justify-center gap-2 self-end rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg transition-opacity disabled:opacity-60"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} strokeWidth={2} />}
          {sending ? "Sending…" : where === "team" ? "Ask the group" : "Ask the manager"}
        </button>
      </form>

      {asked.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-ink/8 pt-3">
          {asked.map((question) => (
            <li key={question.id}>
              <Link
                href={question.where === "team" ? "/employee/chat/team" : "/employee/chat/manager"}
                className="block rounded-xl border border-ink/8 bg-white/50 px-3 py-2 transition-colors hover:bg-white/80"
              >
                <span className="block text-[11px] font-medium text-ink/40">
                  You asked {question.where === "team" ? "the group" : "the manager"} · {question.when}
                </span>
                <span dir="auto" className="mt-0.5 line-clamp-2 block text-sm text-ink/75">
                  {question.text}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
