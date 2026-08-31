"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Send, BellRing } from "lucide-react";
import { regenerateProjectLink, logClientNotification } from "@/lib/actions/project-actions";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function LinkActions({
  projectId,
  token,
  clientName,
  clientPhone,
}: {
  projectId: string;
  token: string;
  clientName: string;
  clientPhone?: string | null;
}) {
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
  // wa.me needs digits only (country code, no "+" or spaces). With no number it
  // still opens WhatsApp with the message ready — the sender just picks the
  // contact themselves, so this degrades gracefully when clientPhone is unset.
  const waNumber = clientPhone ? clientPhone.replace(/\D/g, "") : "";
  const sendMessage = `Hi ${clientName}, your project from NEON is ready. You can review the designs, drawings, quantities, and more here: ${url}`;
  const updateMessage = `Hi ${clientName}, there's an update on your NEON project. View the latest here: ${url}`;

  function notify(type: "sent_to_client" | "sent_update") {
    logClientNotification(projectId, type).catch(() => {});
  }

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
        href={`https://wa.me/${waNumber}?text=${encodeURIComponent(sendMessage)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => notify("sent_to_client")}
        className={cn(buttonClasses("outline", "sm"), "border-emerald-200 text-emerald-700 hover:bg-emerald-50")}
      >
        <Send size={14} />
        Send to Client
      </a>
      <a
        href={`https://wa.me/${waNumber}?text=${encodeURIComponent(updateMessage)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => notify("sent_update")}
        className={cn(buttonClasses("outline", "sm"), "border-cyan-200 text-cyan-700 hover:bg-cyan-50")}
      >
        <BellRing size={14} />
        Send Update
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
