"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, KeyRound, RefreshCw, Send, BellRing } from "lucide-react";
import { regenerateProjectCode, regenerateProjectLink, logClientNotification } from "@/lib/actions/project-actions";
import { formatCode } from "@/lib/client-codes";
import { sendProjectWhatsApp } from "@/lib/actions/whatsapp-actions";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function LinkActions({
  projectId,
  token,
  accessCode,
  clientName,
  clientPhone,
  // True when the WhatsApp worker is wired up on this deployment. With it,
  // the buttons send the message themselves; without it they keep opening
  // WhatsApp with the text prepared, exactly as before.
  canSendDirect = false,
}: {
  projectId: string;
  token: string;
  /** The code the client types into the app. Null only while one is being made. */
  accessCode?: string | null;
  clientName: string;
  clientPhone?: string | null;
  canSendDirect?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
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
  const shown = accessCode ? formatCode(accessCode) : null;
  // Both ways in, in one message. A client given a link and no code cannot use
  // the app, and a client given a code and no link cannot open it on a laptop —
  // either way it becomes a phone call to the studio.
  const codeLine = shown ? `

Or open it in the NEON app with this code: ${shown}` : "";
  const sendMessage = `Hi ${clientName}, your project from NEON is ready. You can review the designs, drawings, quantities, and more here: ${url}${codeLine}`;
  const updateMessage = `Hi ${clientName}, there's an update on your NEON project. View the latest here: ${url}${codeLine}`;

  const [sendResult, setSendResult] = useState<string | null>(null);

  function notify(type: "sent_to_client" | "sent_update") {
    logClientNotification(projectId, type).catch(() => {});
  }

  // Sending through the worker logs the same activity the manual path does,
  // so the client timeline reads the same either way.
  function sendDirect(kind: "sent_to_client" | "sent_update") {
    setSendResult(null);
    startTransition(async () => {
      const result = await sendProjectWhatsApp(projectId, kind);
      setSendResult(result.message);
    });
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

      {shown && (
        <div className="flex items-center gap-2 rounded-full border border-cyan/25 bg-cyan/[0.07] py-1 pl-3 pr-1.5 text-xs">
          <KeyRound size={12} className="shrink-0 text-cyan-strong" />
          <span className="font-mono text-sm font-semibold tracking-wider tabular-nums text-ink">{shown}</span>
          <button
            type="button"
            title="Copy the app code"
            onClick={() => {
              // Copied without the dash: it is grouped to be read aloud, and
              // pasted into a box that takes it either way.
              navigator.clipboard.writeText(accessCode ?? "").then(() => {
                setCodeCopied(true);
                setTimeout(() => setCodeCopied(false), 1800);
              });
            }}
            className="rounded-full p-1.5 text-ink/40 hover:bg-white/70 hover:text-ink"
          >
            {codeCopied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            title="New code — the old one stops working"
            disabled={pending}
            onClick={() => {
              if (!confirm("Give this project a new app code? The code the client has will stop working immediately.")) return;
              startTransition(async () => {
                await regenerateProjectCode(projectId);
              });
            }}
            className="rounded-full p-1.5 text-ink/40 hover:bg-white/70 hover:text-ink"
          >
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
          </button>
        </div>
      )}
      {canSendDirect && clientPhone ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => sendDirect("sent_to_client")}
            className={cn(buttonClasses("outline", "sm"), "border-emerald-200 text-emerald-700 hover:bg-emerald-50")}
          >
            <Send size={14} />
            Send to Client
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => sendDirect("sent_update")}
            className={cn(buttonClasses("outline", "sm"), "border-cyan-200 text-cyan-700 hover:bg-cyan-50")}
          >
            <BellRing size={14} />
            Send Update
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
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

      {sendResult && <p className="w-full text-xs text-ink/60">{sendResult}</p>}
    </div>
  );
}
