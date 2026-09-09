"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { sendTestWhatsApp, type SendOutcome } from "@/lib/actions/whatsapp-actions";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function WhatsAppTest({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          setOutcome(await sendTestWhatsApp(formData));
        })
      }
      className="mt-4 flex flex-wrap items-end gap-3"
    >
      <label className="min-w-44 flex-1">
        <span className="mb-1 block text-xs font-medium text-ink/50">Send a test to</span>
        <input
          name="phone"
          placeholder="962790000000"
          inputMode="tel"
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
      </label>
      <label className="min-w-56 flex-[2]">
        <span className="mb-1 block text-xs font-medium text-ink/50">Message</span>
        <input
          name="text"
          defaultValue="Test message from the NEON portal."
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
      </label>

      <button type="submit" disabled={pending || disabled} className={buttonClasses("primary", "sm")}>
        <Send size={14} strokeWidth={2} />
        {pending ? "Sending…" : "Send test"}
      </button>

      {outcome && (
        <p
          className={cn(
            "w-full text-xs",
            outcome.ok ? "text-emerald-700" : "text-red-600"
          )}
        >
          {outcome.message}
        </p>
      )}
    </form>
  );
}
