"use client";

import Image from "next/image";
import { ArrowDown } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { PIPELINE_STATUSES } from "@/lib/constants";
import { PresentationTrigger, type Slide } from "@/components/client/presentation-mode";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";
import { useI18n } from "@/lib/client-i18n";

const PIPELINE_LABEL = new Map<string, string>(PIPELINE_STATUSES.map((s) => [s.value, s.label]));

export function Hero({
  name,
  projectType,
  location,
  coverImageUrl,
  pipelineStatus,
  deliveryDate,
  watermark,
  slides,
}: {
  name: string;
  projectType: string | null;
  location: string | null;
  coverImageUrl: string | null;
  pipelineStatus: string;
  deliveryDate: Date | null;
  watermark: boolean;
  slides: Slide[];
}) {
  const { t } = useI18n();
  return (
    <section className="relative flex h-[92vh] min-h-[560px] w-full items-end overflow-hidden bg-ink text-bg">
      {coverImageUrl ? (
        <Image src={coverImageUrl} alt={name} fill priority unoptimized className="object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-strong/40 via-ink to-purple-strong/40" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-ink/10" />
      {watermark && <WatermarkOverlay />}

      <div className="container-neon relative z-10 flex w-full flex-col gap-6 pb-16 sm:pb-24">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-xs font-bold uppercase tracking-[0.3em] text-white/70"
        >
          NEON
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="max-w-3xl text-4xl font-semibold leading-[1.05] text-white sm:text-6xl"
        >
          {name}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="flex flex-wrap items-center gap-3 text-sm text-white/70"
        >
          {projectType && <span>{projectType}</span>}
          {location && (
            <>
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>{location}</span>
            </>
          )}
          {deliveryDate && (
            <>
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>{t("Delivery")} {formatDate(deliveryDate)}</span>
            </>
          )}
          <Badge tone="cyan" className="border-white/20 bg-white/10 text-white">
            {t(PIPELINE_LABEL.get(pipelineStatus) ?? pipelineStatus)}
          </Badge>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="mt-4 flex flex-wrap items-center gap-3"
        >
          <a
            href="#overview"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-ink transition-transform hover:scale-[1.03]"
          >
            {t("Explore Project")}
            <ArrowDown size={15} />
          </a>
          <PresentationTrigger slides={slides} />
        </motion.div>
      </div>
    </section>
  );
}
