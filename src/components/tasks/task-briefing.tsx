"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CircleAlert, Loader2, Mic, Send, Sparkles, Square, X } from "lucide-react";
import { assignDraftedTasks, draftAssignedTasks } from "@/lib/actions/assigned-task-actions";
import { dayWord, type DraftPriority, type TaskDraft, type Unplaced } from "@/lib/task-dictation";
import { shiftDayKey } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import { whileBusy } from "@/lib/busy";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// Handing the day out by saying it.
//
// The manager talks or types — "Wael today: call the supplier, visit the site…
// Sally tomorrow: …" — and gets back a list: who, what, which day. Nothing is
// sent from the words alone. The list is read first, and every row can be
// reworded, moved to another person or another day, or removed; then one press
// hands all of it out and tells each person once. Speech recognition mishears
// names, and the wrong job on the wrong phone is the one mistake this could
// make out loud — see lib/task-dictation.ts.
//
// The microphone is the browser's own speech recognition. Where a browser has
// none (the iPhone app's web view, Firefox), the button is simply not drawn
// and the box says to use the keyboard's microphone, which every phone has —
// a button that does nothing when pressed would read as a broken screen.

type Member = { id: string; name: string; color: string; role?: string | null };
type Row = TaskDraft & { key: number };
type Stage = "say" | "check" | "done";

// --- the browser's speech recognition, as much of it as is used -------------

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recogniser = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recogniserClass(): (new () => Recogniser) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recogniser;
    webkitSpeechRecognition?: new () => Recogniser;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const never = () => () => {};

const MIC_PROBLEMS: Record<string, string> = {
  "not-allowed": "The microphone is blocked for this site. Allow it in the browser's address bar, or type instead.",
  "service-not-allowed": "This browser will not let the page listen. Use the keyboard's microphone instead.",
  "audio-capture": "No microphone was found on this device.",
  network: "Listening needs an internet connection, and it dropped. Try again, or type instead.",
};

const PRIORITY_LABEL: Record<DraftPriority, string> = { LOW: "Low", MEDIUM: "Normal", HIGH: "Urgent" };

const EXAMPLE = "وائل اليوم: يتصل مع مورد الرخام، ويزور موقع شفا بدران الساعة ٣. سالي بكرة: تخلص المود بورد لفيلا دابوق…";

export function TaskBriefing({ team, todayKey, className }: { team: Member[]; todayKey: string; className?: string }) {
  const router = useRouter();
  const canListen = useSyncExternalStore(never, () => recogniserClass() !== null, () => false);

  const [stage, setStage] = useState<Stage>("say");
  const [words, setWords] = useState("");
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState<"ar-JO" | "en-US">("ar-JO");
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState<null | "reading" | "sending">(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [unplaced, setUnplaced] = useState<Unplaced[]>([]);
  // The server's "today" for the list being checked: the page may have been
  // open since yesterday, and the day a draft says is measured from this.
  const [listDay, setListDay] = useState(todayKey);
  const [sent, setSent] = useState<{ created: number; people: number; skipped: number } | null>(null);

  const recogniser = useRef<Recogniser | null>(null);
  // Whether the person still wants it listening. The browser stops by itself
  // after a silence; this is what tells a pause from a press of Stop.
  const wanted = useRef(false);
  const nextKey = useRef(1);

  function stopListening() {
    wanted.current = false;
    recogniser.current?.stop();
    setListening(false);
    setInterim("");
  }

  // Leaving the page with the microphone open would leave it open.
  useEffect(() => () => {
    wanted.current = false;
    recogniser.current?.stop();
  }, []);

  function startListening() {
    const Recognition = recogniserClass();
    if (!Recognition) return;
    setError(null);

    const session = new Recognition();
    session.lang = language;
    session.continuous = true;
    session.interimResults = true;

    session.onresult = (event) => {
      let heard = "";
      let passing = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) heard += result[0].transcript;
        else passing += result[0].transcript;
      }
      if (heard.trim()) setWords((before) => (before.trim() ? `${before.trimEnd()} ${heard.trim()}` : heard.trim()));
      setInterim(passing);
    };

    session.onerror = (event) => {
      // Silence is not a fault: the browser reports it and carries on.
      if (event.error === "no-speech" || event.error === "aborted") return;
      wanted.current = false;
      setError(MIC_PROBLEMS[event.error] ?? "Listening stopped unexpectedly. Try again, or type instead.");
    };

    session.onend = () => {
      // The browser ends a session after a pause in speech. Somebody thinking
      // between two people's lists has not finished, so it is opened again
      // until they press Stop.
      if (wanted.current) {
        try {
          session.start();
          return;
        } catch {
          // Already restarting, or refused: fall through and show it stopped.
        }
      }
      setListening(false);
      setInterim("");
    };

    recogniser.current = session;
    wanted.current = true;
    try {
      session.start();
      setListening(true);
    } catch {
      wanted.current = false;
      setError("Listening could not start. Try again, or type instead.");
    }
  }

  async function prepare() {
    if (working) return;
    stopListening();
    const said = [words, interim].join(" ").trim();
    if (!said) {
      setError("Say or type who does what first.");
      return;
    }

    setError(null);
    setWorking("reading");
    try {
      // Held against the live refresh: it cancels a server action in flight,
      // and this one takes several seconds — see lib/busy.ts.
      const result = await whileBusy(() => draftAssignedTasks(said));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWords(said);
      setRows(result.drafts.map((draft) => ({ ...draft, key: nextKey.current++ })));
      setUnplaced(result.unplaced);
      setListDay(result.todayKey);
      setStage("check");
    } catch {
      setError("The assistant could not be reached. Check the connection and try again.");
    } finally {
      setWorking(null);
    }
  }

  async function assign() {
    if (working || rows.length === 0) return;
    setError(null);
    setWorking("sending");
    try {
      const result = await whileBusy(() =>
        assignDraftedTasks(rows.map((row) => ({ ...row, key: undefined, title: row.title.trim() })))
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent(result);
      setStage("done");
      setWords("");
      setRows([]);
      setUnplaced([]);
      router.refresh();
    } catch {
      setError("Those could not be sent. Check the connection and try again — nothing was assigned twice.");
    } finally {
      setWorking(null);
    }
  }

  const change = (key: number, patch: Partial<TaskDraft>) =>
    setRows((before) => before.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  /** Moving the day keeps the length: a two-day job moved to Sunday runs Sunday and Monday. */
  const moveDay = (row: Row, startKey: string) =>
    change(row.key, { startKey, endKey: shiftDayKey(startKey, daysBetween(row.startKey, row.endKey)) });

  // The days on offer: a fortnight from the list's own today, plus whatever
  // day a draft already has if it is further out than that.
  const dayOptions = useMemo(() => {
    const keys = Array.from({ length: 14 }, (_, offset) => shiftDayKey(listDay, offset));
    for (const row of rows) if (!keys.includes(row.startKey)) keys.push(row.startKey);
    return keys.sort();
  }, [listDay, rows]);

  const people = team.filter((member) => rows.some((row) => row.employeeId === member.id));
  const blank = rows.some((row) => !row.title.trim());

  return (
    <section className={cn("rounded-2xl border border-ink/8 bg-white/70 p-4 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple/10 text-purple-strong">
          <Sparkles size={17} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Hand out work by saying it</h2>
          <p className="mt-0.5 text-sm text-ink/50">
            Say or type who does what, today or tomorrow. You check the list before anything is sent.
          </p>
        </div>
      </div>

      {stage === "say" && (
        <div className="mt-4">
          <div
            className={cn(
              "rounded-xl border bg-white/80 transition-colors",
              listening ? "border-pink-strong/50 ring-2 ring-pink-strong/15" : "border-ink/12 focus-within:border-purple-strong"
            )}
          >
            <textarea
              value={words}
              onChange={(event) => setWords(event.target.value)}
              dir="auto"
              rows={4}
              disabled={working !== null}
              placeholder={EXAMPLE}
              className="block w-full resize-y bg-transparent px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink/30"
            />
            {/* What is being heard this second, before the browser settles on
                it — so somebody speaking can see it is listening. */}
            {interim && (
              <p dir="auto" className="px-3.5 pb-2 text-sm italic text-ink/40">
                {interim}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-ink/8 px-2.5 py-2">
              {canListen ? (
                <>
                  <button
                    type="button"
                    onClick={listening ? stopListening : startListening}
                    disabled={working !== null}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-50",
                      listening ? "bg-pink-strong text-white" : "bg-ink/[0.06] text-ink hover:bg-ink/10"
                    )}
                  >
                    {listening ? <Square size={14} strokeWidth={2.5} fill="currentColor" /> : <Mic size={16} strokeWidth={2} />}
                    {listening ? "Stop" : "Speak"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage((now) => (now === "ar-JO" ? "en-US" : "ar-JO"))}
                    disabled={listening || working !== null}
                    title="The language it listens for"
                    className="h-10 rounded-full px-3 text-xs font-semibold text-ink/50 hover:bg-ink/[0.06] disabled:opacity-40"
                  >
                    {language === "ar-JO" ? "عربي" : "English"}
                  </button>
                  {listening && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-pink-strong">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-pink-strong" />
                      Listening
                    </span>
                  )}
                </>
              ) : (
                <span className="px-1.5 text-xs text-ink/45">
                  Tap the box and use the microphone on your keyboard to speak.
                </span>
              )}

              <button
                type="button"
                onClick={prepare}
                disabled={working !== null || !(words.trim() || interim.trim())}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-purple to-purple-strong px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {working === "reading" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={15} strokeWidth={2.25} />}
                {working === "reading" ? "Reading…" : "Prepare tasks"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "check" && (
        <div className="mt-4 flex flex-col gap-4">
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink/12 px-3 py-6 text-center text-sm text-ink/45">
              Nothing in that could be turned into a task.
            </p>
          ) : (
            people.map((member) => {
              const theirs = rows.filter((row) => row.employeeId === member.id);
              return (
                <div key={member.id} className="rounded-xl border border-ink/8 bg-white/80">
                  <div className="flex items-center gap-2.5 border-b border-ink/8 px-3.5 py-2.5">
                    <PersonAvatar name={member.name} color={member.color} personKey={member.id} size={28} />
                    <span className="text-sm font-semibold text-ink">{member.name}</span>
                    <span className="text-xs text-ink/40">
                      {theirs.length} {theirs.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>

                  <ul className="divide-y divide-ink/[0.06]">
                    {theirs.map((row, index) => (
                      <li key={row.key} className="px-3.5 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-2 w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-ink/30">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <input
                              value={row.title}
                              onChange={(event) => change(row.key, { title: event.target.value })}
                              dir="auto"
                              maxLength={200}
                              aria-label="Task"
                              className={cn(
                                "w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[15px] font-medium text-ink outline-none focus:border-purple-strong focus:bg-white",
                                row.title.trim() ? "border-transparent hover:border-ink/12" : "border-red-300"
                              )}
                            />

                            {row.note && (
                              <p dir="auto" className="mt-1 whitespace-pre-wrap px-2.5 text-sm text-ink/55">
                                {row.note}
                              </p>
                            )}
                            {row.acceptance && (
                              <p dir="auto" className="mt-1 px-2.5 text-xs text-ink/45">
                                <span className="font-semibold text-ink/55">Done when: </span>
                                {row.acceptance}
                              </p>
                            )}

                            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                              <select
                                value={row.startKey}
                                onChange={(event) => moveDay(row, event.target.value)}
                                aria-label="Day"
                                className="h-8 rounded-full border border-ink/10 bg-white px-2.5 text-xs font-medium capitalize text-ink/70 outline-none focus:border-purple-strong"
                              >
                                {dayOptions.map((key) => (
                                  <option key={key} value={key}>
                                    {dayWord(key, listDay)}
                                  </option>
                                ))}
                              </select>
                              {row.endKey !== row.startKey && (
                                <span className="text-xs text-ink/45">
                                  to {dayWord(row.endKey, listDay)} · {daysBetween(row.startKey, row.endKey) + 1} days
                                </span>
                              )}

                              <select
                                value={row.employeeId}
                                onChange={(event) => change(row.key, { employeeId: event.target.value })}
                                aria-label="Who it is for"
                                className="h-8 rounded-full border border-ink/10 bg-white px-2.5 text-xs font-medium text-ink/70 outline-none focus:border-purple-strong"
                              >
                                {team.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={row.priority}
                                onChange={(event) => change(row.key, { priority: event.target.value as DraftPriority })}
                                aria-label="Priority"
                                className={cn(
                                  "h-8 rounded-full border bg-white px-2.5 text-xs font-medium outline-none focus:border-purple-strong",
                                  row.priority === "HIGH" ? "border-pink-strong/30 text-pink-strong" : "border-ink/10 text-ink/70"
                                )}
                              >
                                {(Object.keys(PRIORITY_LABEL) as DraftPriority[]).map((priority) => (
                                  <option key={priority} value={priority}>
                                    {PRIORITY_LABEL[priority]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setRows((before) => before.filter((other) => other.key !== row.key))}
                            aria-label={`Remove: ${row.title}`}
                            className="mt-1 shrink-0 rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-red-600"
                          >
                            <X size={15} strokeWidth={2} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}

          {/* Said, and not turned into a job — shown so nothing asked for goes
              missing without a word. Never guessed at. */}
          {unplaced.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                <CircleAlert size={15} strokeWidth={2.25} />
                Not turned into a task
              </p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {unplaced.map((item, index) => (
                  <li key={`${index}-${item.said}`} dir="auto" className="text-sm text-amber-900/80">
                    “{item.said}”
                    <span className="block text-xs text-amber-900/55">{item.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStage("say");
                setError(null);
              }}
              disabled={working !== null}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-ink/60 hover:bg-ink/[0.06] disabled:opacity-40"
            >
              <ArrowLeft size={15} strokeWidth={2} />
              Back to the words
            </button>

            <button
              type="button"
              onClick={assign}
              disabled={working !== null || rows.length === 0 || blank}
              className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {working === "sending" ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} strokeWidth={2.25} />}
              {working === "sending"
                ? "Assigning…"
                : `Assign ${rows.length} ${rows.length === 1 ? "task" : "tasks"} to ${people.length} ${people.length === 1 ? "person" : "people"}`}
            </button>
          </div>
        </div>
      )}

      {stage === "done" && sent && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
            <Check size={16} strokeWidth={2.5} />
          </span>
          <p className="min-w-0 flex-1 text-sm text-emerald-900">
            <span className="font-semibold">
              {sent.created} {sent.created === 1 ? "task" : "tasks"} assigned to {sent.people}{" "}
              {sent.people === 1 ? "person" : "people"}.
            </span>{" "}
            Each has been told once.
            {sent.skipped > 0 && ` ${sent.skipped} could not be given to anybody and were left out.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setStage("say");
              setSent(null);
            }}
            className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-ink shadow-sm hover:bg-white/80"
          >
            Hand out more
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
