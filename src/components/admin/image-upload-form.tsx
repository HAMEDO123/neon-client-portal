"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addImage } from "@/lib/actions/gallery-actions";
import { TextInput, Checkbox } from "@/components/admin/fields";
import { buttonClasses } from "@/components/ui/buttons";

// Uploads run one file per request instead of one big multipart batch — a request
// with many high-res photos can blow past the server action body-size limit even
// after compression, since that limit applies to the raw upload, before compression.
export function ImageUploadForm({ projectId, spaceId }: { projectId: string; spaceId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return;

    const caption = formData.get("caption");
    const isBeforeAfter = formData.get("isBeforeAfter") === "on";
    const beforeImage = formData.get("beforeImage");
    const compress = formData.get("compress") === "on";

    setProgress({ done: 0, total: isBeforeAfter ? 1 : files.length });
    try {
      if (isBeforeAfter) {
        const single = new FormData();
        single.append("image", files[0]);
        if (caption) single.append("caption", caption);
        single.append("isBeforeAfter", "on");
        if (compress) single.append("compress", "on");
        if (beforeImage instanceof File && beforeImage.size > 0) single.append("beforeImage", beforeImage);
        await addImage(projectId, spaceId, single);
        setProgress({ done: 1, total: 1 });
      } else {
        for (let i = 0; i < files.length; i++) {
          const single = new FormData();
          single.append("image", files[i]);
          if (caption) single.append("caption", caption);
          if (compress) single.append("compress", "on");
          await addImage(projectId, spaceId, single);
          setProgress({ done: i + 1, total: files.length });
        }
      }
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-ink/12 p-4"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-ink/50">Images (select multiple to batch-upload)</label>
        <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" required multiple className="text-xs" />
        <p className="mt-1 text-[11px] text-ink/35">Uploaded one at a time — no batch size limit.</p>
      </div>
      <TextInput label="Caption (optional)" name="caption" defaultValue="" required={false} className="w-48" />
      <Checkbox
        label="Compress images"
        name="compress"
        defaultChecked
        description="Shrinks anything over 1MB for faster loading. Uncheck to keep full original quality."
        className="w-56"
      />
      <Checkbox label="Before / After pair" name="isBeforeAfter" className="w-56" />
      <div>
        <label className="mb-1 block text-xs font-medium text-ink/50">“Before” image (if checked, uses only the first image above)</label>
        <input type="file" name="beforeImage" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
      </div>
      <button type="submit" disabled={!!progress} className={buttonClasses("primary", "sm")}>
        {progress ? `Uploading ${progress.done}/${progress.total}…` : "Add Image(s)"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
