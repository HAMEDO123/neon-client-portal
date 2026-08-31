"use client";

import { useState } from "react";
import { History, ChevronDown } from "lucide-react";
import { addDrawingRevision, deleteDrawing, deleteRevision } from "@/lib/actions/drawing-actions";
import { Badge } from "@/components/ui/badge";
import { DeleteButton, SaveButton } from "@/components/admin/form-buttons";
import { TextInput } from "@/components/admin/fields";
import { formatDate, formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DrawingRowData {
  id: string;
  category: string;
  subCategory: string | null;
  name: string;
  drawingNumber: string | null;
  revision: string;
  fileUrl: string;
  fileType: string;
  fileSize: number | null;
  revisions: { id: string; revision: string; note: string | null; fileUrl: string; createdAt: Date }[];
}

export function DrawingRow({ projectId, drawing }: { projectId: string; drawing: DrawingRowData }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="cyan">{drawing.category}</Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {drawing.name} {drawing.drawingNumber && <span className="text-ink/40">· {drawing.drawingNumber}</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink/40">
            {drawing.subCategory ? `${drawing.subCategory} · ` : ""}
            {drawing.revision} · {drawing.fileType.toUpperCase()} {drawing.fileSize ? `· ${formatFileSize(drawing.fileSize)}` : ""}
          </p>
        </div>
        <a href={drawing.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-cyan-strong">
          View
        </a>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink"
        >
          <History size={13} />
          Revisions {drawing.revisions.length > 0 && `(${drawing.revisions.length})`}
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>
        <form>
          <DeleteButton
            formAction={deleteDrawing.bind(null, projectId, drawing.id)}
            confirmMessage={`Delete "${drawing.name}" and all of its revision history?`}
          />
        </form>
      </div>

      {open && (
        <div className="mt-4 border-t border-ink/8 pt-4">
          {drawing.revisions.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              {drawing.revisions.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs">
                  <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 font-semibold text-ink/60">{r.revision}</span>
                  <span className="flex-1 text-ink/60">{r.note ?? "—"}</span>
                  <span className="shrink-0 text-ink/35">{formatDate(r.createdAt)}</span>
                  <a href={r.fileUrl} target="_blank" rel="noreferrer" className="shrink-0 text-cyan-strong">
                    View
                  </a>
                  <form>
                    <button
                      formAction={deleteRevision.bind(null, projectId, r.id)}
                      className="shrink-0 text-red-500 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          <form
            action={addDrawingRevision.bind(null, projectId, drawing.id)}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-ink/12 p-3"
          >
            <TextInput label="New revision label" name="revision" placeholder="R03" defaultValue="" className="w-28" />
            <TextInput label="Note (what changed)" name="note" defaultValue="" required={false} className="flex-1 min-w-[160px]" />
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/50">New file</label>
              <input type="file" name="file" required className="text-xs" />
            </div>
            <SaveButton label="Upload Revision" />
          </form>
        </div>
      )}
    </div>
  );
}
