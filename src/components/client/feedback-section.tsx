"use client";

import { useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/buttons";
import { createComment } from "@/lib/actions/comment-actions";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/client-i18n";

export interface CommentRow {
  id: string;
  authorName: string;
  authorType: "CLIENT" | "ADMIN";
  message: string;
  refLabel: string | null;
  status: "OPEN" | "RESOLVED";
  createdAt: Date;
}

export function FeedbackSection({ token, comments }: { token: string; comments: CommentRow[] }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <SectionShell id="feedback">
      <SectionHeader eyebrow={t("Communicate")} title={t("Review & Feedback")} description={t("Have a note or a change request? Send it directly to NEON.")} />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-5">
        <form
          action={(formData: FormData) => startTransition(() => createComment(token, formData))}
          className="glass flex flex-col gap-3 rounded-2xl p-6 lg:col-span-2 lg:sticky lg:top-24 lg:self-start"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/50">{t("Your Name")}</label>
            <input name="authorName" required className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/50">{t("Referring to (optional)")}</label>
            <input
              name="refLabel"
              placeholder={t("e.g. Kitchen Render")}
              className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink/50">{t("Message")}</label>
            <textarea
              name="message"
              required
              rows={4}
              placeholder={t("Change this sofa to a darker color…")}
              className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
            />
          </div>
          <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
            {pending ? t("Sending…") : t("Send to NEON")}
          </button>
        </form>

        <div className="flex flex-col gap-3 lg:col-span-3">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-8 py-14 text-center">
              <MessageSquare size={22} strokeWidth={1.5} className="text-ink/30" />
              <p className="mt-3 text-sm text-ink/50">{t("No messages yet — your feedback will appear here.")}</p>
            </div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="glass rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{c.authorType === "ADMIN" ? t("NEON Team") : c.authorName}</p>
                    {c.refLabel && <Badge tone="cyan">{c.refLabel}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === "OPEN" ? "warning" : "success"}>{c.status === "OPEN" ? t("Open") : t("Resolved")}</Badge>
                    <span className="text-xs text-ink/35">{formatDate(c.createdAt)}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-ink/65">{c.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </SectionShell>
  );
}
