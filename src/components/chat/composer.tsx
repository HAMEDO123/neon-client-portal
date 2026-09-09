"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImagePlus, Mic, Paperclip, Send, Square, Trash2 } from "lucide-react";
import { sendChatMessage } from "@/lib/actions/chat-actions";
import { cn } from "@/lib/utils";

type Recording = { blob: Blob; url: string; seconds: number };

export function ChatComposer({ projects }: { projects: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A recording holds a live microphone and an object URL; both have to be
  // released when this unmounts or the browser keeps the mic light on.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      if (recording) URL.revokeObjectURL(recording.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecording({ blob, url: URL.createObjectURL(blob), seconds });
        setIsRecording(false);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      // Denied permission, no microphone, or an insecure origin.
      setError("Could not start recording — check microphone permission.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }

  function discardRecording() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setSeconds(0);
  }

  function send(extra?: (formData: FormData) => void) {
    const formData = new FormData();
    formData.set("body", text);
    if (projectId) formData.set("projectId", projectId);
    extra?.(formData);

    startTransition(async () => {
      try {
        await sendChatMessage(formData);
        setText("");
        discardRecording();
        if (photoRef.current) photoRef.current.value = "";
        if (fileRef.current) fileRef.current.value = "";
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Could not send that.");
      }
    });
  }

  return (
    <div className="border-t border-ink/8 bg-bg/95 p-3 backdrop-blur-lg">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {recording && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-cyan/25 bg-cyan/[0.06] p-2.5">
          <audio src={recording.url} controls className="h-9 min-w-0 flex-1" />
          <span className="shrink-0 text-xs font-medium text-ink/50">{recording.seconds}s</span>
          <button
            type="button"
            onClick={discardRecording}
            aria-label="Discard recording"
            className="rounded-lg p-2 text-ink/40 hover:bg-ink/5 hover:text-red-600"
          >
            <Trash2 size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              send((formData) => {
                formData.set("voice", recording.blob, `voice-${Date.now()}.webm`);
                formData.set("durationSeconds", String(recording.seconds));
              })
            }
            className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-medium text-bg disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send voice"}
          </button>
        </div>
      )}

      {projects.length > 0 && (
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="mb-2 w-full rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-xs text-ink/70 outline-none focus:border-cyan-strong sm:w-auto"
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              About: {project.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) send((formData) => formData.set("photo", file));
          }}
        />
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) send((formData) => formData.set("document", file));
          }}
        />

        <IconButton label="Send a photo" onClick={() => photoRef.current?.click()} disabled={pending}>
          <ImagePlus size={19} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Attach a file" onClick={() => fileRef.current?.click()} disabled={pending}>
          <Paperclip size={19} strokeWidth={1.75} />
        </IconButton>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (text.trim()) send();
            }
          }}
          rows={1}
          placeholder="Write a message…"
          className="max-h-32 min-h-11 flex-1 resize-y rounded-2xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-cyan-strong"
        />

        {isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-medium text-white"
          >
            <Square size={14} strokeWidth={2.5} fill="currentColor" />
            {seconds}s
          </button>
        ) : (
          <IconButton label="Record a voice message" onClick={startRecording} disabled={pending}>
            <Mic size={19} strokeWidth={1.75} />
          </IconButton>
        )}

        <button
          type="button"
          onClick={() => text.trim() && send()}
          disabled={pending || !text.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-bg transition-opacity disabled:opacity-30"
        >
          <Send size={17} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-white/70 text-ink/55",
        "transition-colors hover:text-ink disabled:opacity-40"
      )}
    >
      {children}
    </button>
  );
}
