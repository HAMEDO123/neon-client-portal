"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useI18n } from "@/lib/client-i18n";

export function WelcomeOverlay({ projectName }: { projectName: string }) {
  const { t } = useI18n();
  // False on both the server render and the first client render (sessionStorage is
  // browser-only), then flipped on right after mount — this avoids a hydration mismatch.
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = `neon-welcomed-${projectName}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with sessionStorage, a browser-only external system; can't be known at render/SSR time.
    setShow(true);
    const timer = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(timer);
  }, [projectName]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          onClick={() => setShow(false)}
          className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center bg-ink text-bg"
        >
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-xs font-medium uppercase tracking-[0.3em] text-white/50"
          >
            {t("Welcome to your project")}
          </motion.span>
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="text-gradient-neon mt-3 text-2xl font-bold"
          >
            {t("Designed by NEON")}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
