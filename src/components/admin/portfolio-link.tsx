"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { savePortfolioContact, type PortfolioResult } from "@/lib/actions/portfolio-actions";
import { cn } from "@/lib/utils";

// The portfolio's link, to copy or send, and the studio number its
// "talk to us" button opens.

export function PortfolioLink({ url, whatsapp }: { url: string; whatsapp: string }) {
  const [copied, setCopied] = useState(false);
  const [state, save, saving] = useActionState<PortfolioResult, FormData>(savePortfolioContact, null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy the link:", url);
    }
  }

  const share = `https://wa.me/?text=${encodeURIComponent(`NEON — our work:\n${url}`)}`;

  return (
    <section className="glass flex flex-col gap-5 rounded-2xl p-6">
      <div>
        <h3 className="text-base font-semibold text-ink">The link to send</h3>
        <p className="mt-0.5 text-sm text-ink/55">One link for everybody. It shows the projects below, in this order.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink">
          {url}
        </code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={share} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink">
          <MessageCircle size={14} /> WhatsApp
        </a>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink">
          <ExternalLink size={14} /> Open
        </a>
      </div>

      <form action={save} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Studio WhatsApp for the &ldquo;Talk to us&rdquo; button</span>
          <input
            name="whatsapp"
            defaultValue={whatsapp}
            dir="ltr"
            placeholder="0791234567"
            className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink"
          />
        </label>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
        {state && <span className={cn("w-full text-sm", state.ok ? "text-emerald-700" : "text-red-700")}>{state.message}</span>}
      </form>
    </section>
  );
}
