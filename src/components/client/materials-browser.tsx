"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";

export interface MaterialRow {
  id: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  finish: string | null;
  specification: string | null;
  supplier: string | null;
  reference: string | null;
  imageUrl: string | null;
  estimatedQty: string | null;
  price: number | null;
  relatedSpaces: string | null;
}

export function MaterialsBrowser({ materials, showPrice }: { materials: MaterialRow[]; showPrice: boolean }) {
  const categories = useMemo(() => ["All", ...Array.from(new Set(materials.map((m) => m.category)))], [materials]);
  const [active, setActive] = useState("All");
  const [selected, setSelected] = useState<MaterialRow | null>(null);

  const filtered = active === "All" ? materials : materials.filter((m) => m.category === active);

  return (
    <>
      <div className="scrollbar-none mt-8 flex gap-2 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              active === c ? "border-ink bg-ink text-bg" : "border-ink/10 bg-white/50 text-ink/60 hover:border-cyan-strong hover:text-cyan-strong"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((m) => (
          <button key={m.id} onClick={() => setSelected(m)} className="group text-left">
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-ink/5">
              {m.imageUrl && (
                <Image src={m.imageUrl} alt={m.name} fill unoptimized className="object-cover transition-transform duration-500 group-hover:scale-105" />
              )}
            </div>
            <p className="mt-2 truncate text-sm font-medium text-ink">{m.name}</p>
            <p className="truncate text-xs text-ink/40">{m.category}</p>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/60 backdrop-blur-sm sm:items-center"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl sm:flex-row sm:rounded-3xl"
            >
              <div className="relative aspect-square shrink-0 bg-ink/5 sm:w-64">
                {selected.imageUrl && <Image src={selected.imageUrl} alt={selected.name} fill unoptimized className="object-cover" />}
                <button
                  onClick={() => setSelected(null)}
                  className="absolute right-3 top-3 rounded-full bg-ink/60 p-1.5 text-white sm:hidden"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge tone="pink">{selected.category}</Badge>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{selected.name}</h3>
                  </div>
                  <button onClick={() => setSelected(null)} className="hidden rounded-full p-1.5 text-ink/40 hover:bg-ink/5 sm:block">
                    <X size={18} />
                  </button>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  {selected.brand && <Field label="Brand" value={selected.brand} />}
                  {selected.model && <Field label="Model" value={selected.model} />}
                  {selected.color && <Field label="Color" value={selected.color} />}
                  {selected.finish && <Field label="Finish" value={selected.finish} />}
                  {selected.supplier && <Field label="Supplier" value={selected.supplier} />}
                  {selected.estimatedQty && <Field label="Est. Quantity" value={selected.estimatedQty} />}
                  {selected.reference && <Field label="Reference" value={selected.reference} />}
                  {showPrice && selected.price != null && <Field label="Price" value={formatCurrency(selected.price)} />}
                </dl>

                {selected.specification && <p className="mt-4 text-sm leading-relaxed text-ink/60">{selected.specification}</p>}
                {selected.relatedSpaces && (
                  <p className="mt-4 text-xs text-ink/40">Used in: {selected.relatedSpaces}</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink/40">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
