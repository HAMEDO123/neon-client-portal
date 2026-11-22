"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileText, ImageUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shrinkPhoto } from "@/lib/client-image";
import { isPictureFile, MAX_PROOF_FILES, PROOF_ACCEPT } from "@/lib/attachments";
import { tooBig } from "@/lib/upload-limits";

// What somebody is about to send as proof: several photos, or files, together.
//
// One photo was the whole of it until 2026-11-22, and work is often more than
// one photo of it — a room from two corners, a report of three pages. Both
// places that send proof (a task's own page, a task card in a chat) use this,
// so neither can end up with a different limit.

type Picked = { key: string; file: File; preview: string | null };

export type ProofFiles = {
  picked: Picked[];
  add: (files: Iterable<File> | null | undefined) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Why the last pick was turned away, or null. */
  problem: string | null;
  /** Puts them in the form as it is sent: pictures shrunk first, the rest as they are. Throws a sentence. */
  fill: (formData: FormData) => Promise<void>;
};

export function useProofFiles(): ProofFiles {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const counter = useRef(0);

  // The previews of whatever is still there when the form goes away.
  const latest = useRef(picked);
  useEffect(() => {
    latest.current = picked;
  }, [picked]);
  useEffect(
    () => () => {
      for (const item of latest.current) if (item.preview) URL.revokeObjectURL(item.preview);
    },
    []
  );

  function add(files: Iterable<File> | null | undefined) {
    const chosen = [...(files ?? [])];
    if (chosen.length === 0) return;
    const room = MAX_PROOF_FILES - picked.length;
    setProblem(chosen.length > room ? `Up to ${MAX_PROOF_FILES} files can be sent together.` : null);
    const next = chosen.slice(0, Math.max(0, room)).map((file) => ({
      key: `${(counter.current += 1)}`,
      file,
      // Only a picture gets an object URL. Pointing an <img> at a PDF draws a
      // broken icon, which reads as "it did not work" — the file gets its name
      // on a card instead.
      preview: isPictureFile(file) ? URL.createObjectURL(file) : null,
    }));
    if (next.length > 0) setPicked([...picked, ...next]);
  }

  function remove(key: string) {
    const gone = picked.find((item) => item.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setProblem(null);
    setPicked(picked.filter((item) => item.key !== key));
  }

  function clear() {
    for (const item of picked) if (item.preview) URL.revokeObjectURL(item.preview);
    setProblem(null);
    setPicked([]);
  }

  async function fill(formData: FormData) {
    // Shrunk on the phone first: uploading a 4MB photo was most of the wait. A
    // PDF goes up as it is — shrinkPhoto draws to a canvas, which would turn
    // any other kind of file into a blank image or throw.
    const files: File[] = [];
    for (const { file } of picked) files.push(isPictureFile(file) ? await shrinkPhoto(file) : file);
    const over = tooBig(files);
    if (over) throw new Error(over);
    formData.delete("photo");
    for (const file of files) formData.append("photo", file);
  }

  return { picked, add, remove, clear, problem, fill };
}

/** The two ways to add, and what has been added so far. */
export function ProofPicker({
  files,
  disabled = false,
  pasteHint = false,
}: {
  files: ProofFiles;
  disabled?: boolean;
  /** Says Ctrl+V works, where the form listens for it. */
  pasteHint?: boolean;
}) {
  // Two inputs, because a phone treats them differently: `capture` opens the
  // camera straight away, without it you get the photo library. The camera
  // takes one picture at a time; pressing it again adds another.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const some = files.picked.length > 0;
  const full = files.picked.length >= MAX_PROOF_FILES;

  function take(input: HTMLInputElement) {
    files.add(input.files ? [...input.files] : null);
    // Emptied, so choosing the same file again after removing it still counts.
    input.value = "";
  }

  return (
    <div className="mt-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => take(event.target)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept={PROOF_ACCEPT}
        multiple
        hidden
        onChange={(event) => take(event.target)}
      />

      {some && (
        <ul
          aria-label="What you are sending"
          className={cn("mb-2 grid gap-2", files.picked.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}
        >
          {files.picked.map((item) => (
            <li key={item.key} className="relative overflow-hidden rounded-xl border border-ink/10">
              {item.preview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.preview}
                  alt={item.file.name}
                  className={cn("w-full object-cover", files.picked.length === 1 ? "max-h-64" : "aspect-[4/3]")}
                />
              ) : (
                <div
                  className={cn(
                    "flex h-full items-center gap-2.5 bg-white/60 px-3 py-5",
                    files.picked.length > 1 && "aspect-[4/3] flex-col justify-center py-2 text-center"
                  )}
                >
                  <FileText size={22} strokeWidth={1.75} className="shrink-0 text-ink/45" aria-hidden />
                  <p className="w-full min-w-0 truncate text-xs font-medium text-ink/80">{item.file.name}</p>
                </div>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => files.remove(item.key)}
                aria-label={`Remove ${item.file.name}`}
                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white backdrop-blur"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="grid grid-cols-2 gap-2">
          <Source
            icon={some ? Plus : Camera}
            label={some ? "Another photo" : "Take photo"}
            small={some}
            disabled={disabled}
            onClick={() => cameraRef.current?.click()}
          />
          <Source
            icon={some ? Plus : ImageUp}
            label={some ? "Add files" : "Choose files"}
            small={some}
            disabled={disabled}
            onClick={() => libraryRef.current?.click()}
          />
          {/* Only where there is a keyboard and a mouse: a phone has no Ctrl+V. */}
          {pasteHint && (
            <p className="col-span-2 hidden text-center text-xs text-ink/40 pointer-fine:block">
              Or paste a screenshot with{" "}
              <kbd className="rounded border border-ink/15 bg-white/70 px-1 font-sans">Ctrl</kbd>+
              <kbd className="rounded border border-ink/15 bg-white/70 px-1 font-sans">V</kbd>
            </p>
          )}
        </div>
      )}

      {files.problem && (
        <p role="alert" className="mt-2 text-xs font-medium text-pink-strong">
          {files.problem}
        </p>
      )}
    </div>
  );
}

function Source({
  icon: Icon,
  label,
  small,
  disabled,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  small: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/15 bg-white/60 text-xs font-medium text-ink/55 active:bg-white disabled:opacity-50",
        small ? "min-h-11" : "min-h-20 flex-col"
      )}
    >
      <Icon size={small ? 15 : 20} strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}
