"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { addProjectImage } from "@/lib/actions/employee-project-actions";
import { compressInBrowser } from "@/lib/client-image-compress";
import { cn } from "@/lib/utils";

// Photos from a phone, onto a project.
//
// One file per request, and compressed here before it is sent. Both of those
// matter and neither is obvious: the request body limit applies to the raw
// upload, so sending a handful of camera photos together is refused whatever
// they compress down to. Sending them one at a time also means a failure on the
// fourth photo does not lose the first three.

export function ProjectPhotoUpload({ projectId, spaceId }: { projectId: string; spaceId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(chosen: FileList | null) {
    if (!chosen || chosen.length === 0) return;
    setError(null);
    setFiles(Array.from(chosen));
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Choose a photo first.");
      return;
    }

    const caption = new FormData(event.currentTarget).get("caption");
    setError(null);
    setProgress({ done: 0, total: files.length });

    try {
      for (const [index, file] of files.entries()) {
        const one = new FormData();
        one.append("image", await compressInBrowser(file));
        if (caption) one.append("caption", caption);

        await addProjectImage(projectId, spaceId, one);
        setProgress({ done: index + 1, total: files.length });
      }

      setFiles([]);
      formRef.current?.reset();
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
      router.refresh();
    } catch (cause) {
      // Says how far it got: the ones already sent are on the project.
      setError(cause instanceof Error ? cause.message : "That did not upload.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <form ref={formRef} onSubmit={send} className="mt-3 rounded-xl border border-dashed border-ink/15 bg-white/40 p-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => pick(event.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => pick(event.target.files)}
      />

      {files.length === 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <Picker icon={Camera} label="Take photo" onClick={() => cameraRef.current?.click()} />
          <Picker icon={ImageUp} label="Choose photos" onClick={() => libraryRef.current?.click()} />
        </div>
      ) : (
        <p className="text-sm text-ink/70">
          {files.length} {files.length === 1 ? "photo" : "photos"} ready
          <button
            type="button"
            onClick={() => setFiles([])}
            className="ml-2 text-xs font-medium text-ink/45 underline"
          >
            clear
          </button>
        </p>
      )}

      <input
        name="caption"
        placeholder="Caption (optional)"
        className="mt-2 w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
      />

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

      <button
        type="submit"
        disabled={progress !== null || files.length === 0}
        className={cn(
          "mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
          files.length > 0 ? "bg-ink text-bg" : "bg-ink/8 text-ink/35"
        )}
      >
        {progress ? <Loader2 size={15} className="animate-spin" strokeWidth={2.5} /> : null}
        {progress ? `Sending ${progress.done}/${progress.total}…` : "Add to the project"}
      </button>
    </form>
  );
}

function Picker({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/15 bg-white/60 text-xs font-medium text-ink/55 active:bg-white"
    >
      <Icon size={18} strokeWidth={1.75} />
      {label}
    </button>
  );
}
