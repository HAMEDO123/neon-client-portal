"use client";

import { motion } from "framer-motion";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { formatCurrency } from "@/lib/format";

export interface PricingRow {
  id: string;
  category: string;
  label: string;
  description: string | null;
  amount: number;
  isOptional: boolean;
}

const BAR_COLORS = ["bg-cyan-strong", "bg-purple-strong", "bg-pink-strong", "bg-orange-strong"];

export function PricingSection({ items, showDetailed }: { items: PricingRow[]; showDetailed: boolean }) {
  const required = items.filter((i) => !i.isOptional);
  const optional = items.filter((i) => i.isOptional);
  const total = required.reduce((sum, i) => sum + i.amount, 0);
  const max = Math.max(...required.map((i) => i.amount), 1);

  return (
    <SectionShell id="pricing">
      <SectionHeader eyebrow="Approve" title="Execution Proposal" description="A transparent breakdown of the investment required to bring this project to life." />

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {showDetailed ? (
            <div className="flex flex-col gap-4">
              {required.map((item, i) => (
                <div key={item.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{item.label}</span>
                    <span className="font-medium text-ink">{formatCurrency(item.amount)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/6">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${(item.amount / max) * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.9, ease: "easeOut" }}
                      className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    />
                  </div>
                  {item.description && <p className="mt-1.5 text-xs text-ink/45">{item.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/50">A detailed cost breakdown is available on request.</p>
          )}

          {optional.length > 0 && (
            <div className="mt-8 border-t border-ink/8 pt-6">
              <p className="text-xs font-medium uppercase tracking-wider text-ink/40">Optional Items</p>
              <div className="mt-3 flex flex-col gap-2">
                {optional.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink/70">{item.label}</span>
                    <span className="font-medium text-ink/70">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="glass-strong sticky top-24 rounded-3xl p-8 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-ink/40">Total Project Cost</p>
            <p className="text-gradient-neon mt-3 text-4xl font-bold">{formatCurrency(total)}</p>
            <p className="mt-3 text-xs text-ink/40">Execution scope, materials, labor &amp; installation</p>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
