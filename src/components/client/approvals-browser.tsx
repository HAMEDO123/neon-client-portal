"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Clock, X } from "lucide-react";
import { respondToApproval } from "@/lib/actions/approval-actions";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/buttons";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/client-i18n";

export interface ApprovalRow {
  id: string;
  itemLabel: string;
  status: "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
  clientName: string | null;
  note: string | null;
  respondedAt: Date | null;
}

const STATUS_META = {
  PENDING: { label: "Pending Review", icon: Clock, tone: "text-amber-600 bg-amber-500/10" },
  APPROVED: { label: "Approved", icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-500/10" },
  CHANGES_REQUESTED: { label: "Changes Requested", icon: AlertCircle, tone: "text-orange-700 bg-orange-500/10" },
} as const;

export function ApprovalsBrowser({ token, approvals }: { token: string; approvals: ApprovalRow[] }) {
  const { t } = useI18n();
  const [modal, setModal] = useState<{ approval: ApprovalRow; mode: "APPROVED" | "CHANGES_REQUESTED" } | null>(null);

  return (
    <div className="mt-8 flex flex-col gap-3">
      {approvals.map((a) => {
        const meta = STATUS_META[a.status];
        return (
          <div key={a.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl p-5">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{a.itemLabel}</p>
              {a.note && <p className="mt-1 text-sm text-ink/55">“{a.note}”</p>}
              {a.respondedAt && (
                <p className="mt-1 text-xs text-ink/35">
                  {a.clientName ? `${a.clientName} · ` : ""}
                  {formatDate(a.respondedAt)}
                </p>
              )}
            </div>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium", meta.tone)}>
              <meta.icon size={13} />
              {t(meta.label)}
            </span>
            {a.status === "PENDING" && (
              <div className="flex gap-2">
                <button onClick={() => setModal({ approval: a, mode: "CHANGES_REQUESTED" })} className={buttonClasses("outline", "sm")}>
                  {t("Request Changes")}
                </button>
                <button onClick={() => setModal({ approval: a, mode: "APPROVED" })} className={buttonClasses("primary", "sm")}>
                  {t("Approve")}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <ResponseModal token={token} state={modal} onClose={() => setModal(null)} />
    </div>
  );
}

function ResponseModal({
  token,
  state,
  onClose,
}: {
  token: string;
  state: { approval: ApprovalRow; mode: "APPROVED" | "CHANGES_REQUESTED" } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        >
          <motion.form
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            action={(formData: FormData) => {
              startTransition(async () => {
                await respondToApproval(token, state.approval.id, state.mode, formData);
                onClose();
              });
            }}
            className="glass-strong w-full max-w-sm rounded-3xl p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-ink/40">
                  {state.mode === "APPROVED" ? t("Approve Design") : t("Request Changes")}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">{state.approval.itemLabel}</h3>
              </div>
              <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink/40 hover:bg-ink/5">
                <X size={16} />
              </button>
            </div>

            <p className="mt-3 text-sm text-ink/55">
              {state.mode === "APPROVED"
                ? t("Are you sure you want to approve this design? This will be recorded with your name and today’s date.")
                : t("Let NEON know what you’d like changed.")}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink/50">{t("Your Name")}</label>
                <input
                  name="clientName"
                  required
                  className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
                />
              </div>
              {state.mode === "CHANGES_REQUESTED" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/50">{t("What would you like changed?")}</label>
                  <textarea
                    name="note"
                    required
                    rows={3}
                    className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
                  />
                </div>
              )}
            </div>

            <button type="submit" disabled={pending} className={buttonClasses("primary", "md", "mt-5 w-full")}>
              {pending ? t("Submitting…") : state.mode === "APPROVED" ? t("Confirm Approval") : t("Send to NEON")}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
