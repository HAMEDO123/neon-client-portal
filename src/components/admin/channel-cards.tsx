"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Link2, Loader, MessageCircle, RefreshCw, Smartphone, Unlink, X } from "lucide-react";
import {
  readLinkStatus,
  startWhatsAppLinking,
  unlinkWhatsApp,
  type LinkState,
} from "@/lib/actions/whatsapp-actions";
import { cn } from "@/lib/utils";

// Linking the company's WhatsApp number by scanning a code, the way the phone
// links WhatsApp Web. The scan happens on the phone, so the portal shows the
// code and then watches the session until the worker reports it connected.

const POLL_MS = 2500;

export function WhatsAppChannelCard({
  workerConfigured,
  initial,
}: {
  workerConfigured: boolean;
  initial: LinkState | null;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LinkState | null>(initial);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const connected = state?.status === "connected";
  const linking = state?.status === "pending";

  // While a code is on screen it is only worth anything until it is scanned,
  // so the session is watched until it connects, then the watching stops.
  useEffect(() => {
    if (!open || !linking) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }

    timer.current = setInterval(async () => {
      const next = await readLinkStatus();
      setState(next);
      if (next.status === "connected") setOpen(false);
    }, POLL_MS);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [open, linking]);

  function beginLink() {
    setOpen(true);
    startTransition(async () => {
      const formData = new FormData();
      if (phone.trim()) formData.set("phone", phone.trim());
      setState(await startWhatsAppLinking(formData));
    });
  }

  function unlink() {
    if (!confirm("Unlink this number? Messages will stop going out until it is linked again.")) return;
    startTransition(async () => {
      await unlinkWhatsApp();
      setState(await readLinkStatus());
    });
  }

  return (
    <div className="glass relative flex flex-col rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <MessageCircle size={20} strokeWidth={2} />
        </span>
        {connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <Check size={11} strokeWidth={3} />
            Linked
          </span>
        )}
      </div>

      <h3 className="mt-4 text-base font-semibold text-ink">WhatsApp</h3>

      {connected ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ink/60">
          <Smartphone size={13} strokeWidth={1.75} />
          {state?.phoneNumber ? `+${state.phoneNumber}` : "This number is linked"}
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-ink/55">
          Open WhatsApp on your phone → Settings → Linked devices → Link a device, and scan the code here to
          send from your own number. Nothing to install.
        </p>
      )}

      {!workerConfigured && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          The session worker is not reachable yet, so there is nothing to link to. See the note under these cards.
        </p>
      )}

      <div className="mt-auto pt-4">
        {connected ? (
          <button
            type="button"
            onClick={unlink}
            disabled={pending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink/12 bg-white/70 text-sm font-medium text-ink/70 transition-colors hover:text-ink disabled:opacity-50"
          >
            <Unlink size={15} strokeWidth={1.75} />
            Unlink
          </button>
        ) : (
          <button
            type="button"
            onClick={beginLink}
            disabled={pending || !workerConfigured}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-purple-strong text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {pending ? <Loader size={15} className="animate-spin" /> : <Link2 size={15} strokeWidth={2} />}
            {pending ? "Starting…" : "Link"}
          </button>
        )}
      </div>

      {open && !connected && (
        <LinkPanel
          state={state}
          phone={phone}
          onPhone={setPhone}
          pending={pending}
          onRetry={beginLink}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function LinkPanel({
  state,
  phone,
  onPhone,
  pending,
  onRetry,
  onClose,
}: {
  state: LinkState | null;
  phone: string;
  onPhone: (value: string) => void;
  pending: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col rounded-2xl bg-white/97 p-5 backdrop-blur">
      <div className="flex items-start justify-between">
        <h4 className="text-sm font-semibold text-ink">Link your number</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-ink/35 hover:bg-ink/5 hover:text-ink"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 flex flex-1 flex-col items-center justify-center text-center">
        {pending && !state?.qrDataUrl && !state?.pairingCode && (
          <>
            <Loader size={22} className="animate-spin text-ink/30" />
            <p className="mt-3 text-xs text-ink/50">Starting the session — this takes a few seconds.</p>
          </>
        )}

        {state?.qrDataUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qrDataUrl} alt="WhatsApp linking QR code" className="h-44 w-44 rounded-lg" />
            <p className="mt-3 text-xs leading-relaxed text-ink/55">
              WhatsApp → Settings → Linked devices → Link a device, then scan this.
            </p>
          </>
        )}

        {state?.pairingCode && (
          <>
            <p className="text-xs text-ink/50">Enter this code on your phone</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em] text-ink">{state.pairingCode}</p>
          </>
        )}

        {state?.status === "error" && (
          <>
            <p className="text-xs text-red-600">{state.error ?? "Linking failed."}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/60 hover:text-ink"
            >
              <RefreshCw size={12} strokeWidth={2} />
              Try again
            </button>
          </>
        )}
      </div>

      {!state?.qrDataUrl && !state?.pairingCode && state?.status !== "error" && (
        <div className="mt-3">
          <label className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">
            Or link by code, with your number
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={phone}
              onChange={(event) => onPhone(event.target.value)}
              placeholder="962790000000"
              inputMode="tel"
              className="min-w-0 flex-1 rounded-lg border border-ink/12 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
            />
            <button
              type="button"
              onClick={onRetry}
              disabled={pending}
              className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"
            >
              Get code
            </button>
          </div>
        </div>
      )}

      <p className={cn("mt-3 text-center text-[11px]", state?.status === "pending" ? "text-cyan-strong" : "text-ink/35")}>
        {state?.status === "pending" ? "Waiting for the scan…" : "The code refreshes on its own."}
      </p>
    </div>
  );
}

/** The channels that are not wired up yet, shown so the set reads as a whole. */
export function ComingSoonChannelCard({
  name,
  description,
  icon,
  tint,
}: {
  name: string;
  description: string;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <div className="glass flex flex-col rounded-2xl p-5 opacity-70">
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", tint)}>{icon}</span>
      <h3 className="mt-4 text-base font-semibold text-ink">{name}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/55">{description}</p>
      <div className="mt-auto pt-4">
        <button
          type="button"
          disabled
          className="h-11 w-full rounded-xl border border-ink/10 bg-ink/[0.03] text-sm font-medium text-ink/35"
        >
          Not available yet
        </button>
      </div>
    </div>
  );
}
