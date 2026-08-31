"use client";

import { useTransition } from "react";
import { setPublishState } from "@/lib/actions/project-actions";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function PublishControls({ projectId, publishState }: { projectId: string; publishState: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {publishState !== "PUBLISHED" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => setPublishState(projectId, "PUBLISHED"))}
          className={buttonClasses("primary", "sm")}
        >
          Publish Project
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => setPublishState(projectId, "DRAFT"))}
          className={buttonClasses("outline", "sm")}
        >
          Unpublish
        </button>
      )}
      {publishState !== "ARCHIVED" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm("Archive this project? It will be hidden from the client link.")) {
              startTransition(() => setPublishState(projectId, "ARCHIVED"));
            }
          }}
          className={cn(buttonClasses("ghost", "sm"), "text-ink/40")}
        >
          Archive
        </button>
      )}
    </div>
  );
}
