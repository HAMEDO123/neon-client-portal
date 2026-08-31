"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, RefreshCw, MessageCircle } from "lucide-react";
import { regenerateProjectLink } from "@/lib/actions/project-actions";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function LinkActions({ projectId, token, clientName }: { projectId: string; token: string; clientName: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  // Starts relative (matches the server render) and upgrades to an absolute URL
  // post-mount — reading window.location during render causes a hydration mismatch.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with window.location, a browser-only external system; can't be known at render/SSR time.
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}/p/${token}`;
  const whatsappMessage = `Hi ${clientName}, your project from NEON is ready. You can review the designs, drawings, quantities, and more here: ${url}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-full border border-ink/10 bg-white/60 py-1 pl-4 pr-1.5 text-xs text-ink/50">
        <span className="max-w-[220px] truncate font-mono">{url}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
        className={buttonClasses("outline", "sm")}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy Link"}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className={buttonClasses("outline", "sm")}>
        <ExternalLink size={14} />
        Preview
      </a>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonClasses("outline", "sm"), "border-emerald-200 text-emerald-700 hover:bg-emerald-50")}
      >
        <MessageCircle size={14} />
        WhatsApp
      </a>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Regenerate this project's link? The old link will stop working immediately.")) return;
          startTransition(() => regenerateProjectLink(projectId));
        }}
        className={buttonClasses("ghost", "sm")}
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        Regenerate
      </button>
    </div>
  );
}
