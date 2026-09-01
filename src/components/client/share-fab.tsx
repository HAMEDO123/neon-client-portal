"use client";

import { useState } from "react";
import { Share2, Copy, Check, MessageCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useI18n } from "@/lib/client-i18n";

export function ShareFab({ projectName }: { projectName: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? window.location.href : "";
  const message = t("Reviewing our project “{name}” from NEON — take a look: {url}", { name: projectName, url });

  return (
    <div className="fixed bottom-5 right-5 z-40 hidden sm:block">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="glass-strong mb-3 flex flex-col gap-1 rounded-2xl p-2"
          >
            <button
              onClick={() => {
                navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t("Copied") : t("Copy Link")}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink/70 hover:bg-ink/5"
            >
              <MessageCircle size={15} />
              {t("WhatsApp")}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((v) => !v)}
        className="glass-strong flex h-12 w-12 items-center justify-center rounded-full text-ink shadow-lg transition-transform hover:scale-105"
        aria-label="Share project"
      >
        {open ? <X size={18} /> : <Share2 size={18} />}
      </button>
    </div>
  );
}
