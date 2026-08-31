"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

export interface BoqRow {
  id: string;
  category: string;
  name: string;
  description: string | null;
  specification: string | null;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  imageUrl: string | null;
  relatedDrawing: string | null;
  relatedSpace: string | null;
  notes: string | null;
}

export function BoqBrowser({ items, showQuantities, showPrices }: { items: BoqRow[]; showQuantities: boolean; showPrices: boolean }) {
  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const [active, setActive] = useState("All");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = items.filter(
    (i) => (active === "All" || i.category === active) && (query === "" || i.name.toLowerCase().includes(query.toLowerCase()))
  );

  const total = showPrices ? filtered.reduce((sum, i) => sum + (i.unitPrice ?? 0) * i.quantity, 0) : null;

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                active === c ? "border-ink bg-ink text-bg" : "border-ink/10 bg-white/50 text-ink/60 hover:border-cyan-strong hover:text-cyan-strong"
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className="w-full rounded-full border border-ink/10 bg-white/60 py-2 pl-8 pr-3 text-sm outline-none focus:border-cyan-strong"
          />
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-ink/8">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Category</th>
              {showQuantities && <th className="px-4 py-3">Quantity</th>}
              {showPrices && <th className="px-4 py-3">Est. Cost</th>}
              <th className="w-8 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const open = expanded === item.id;
              const hasDetail = item.description || item.specification || item.notes || item.relatedDrawing || item.relatedSpace || item.imageUrl;
              return (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => hasDetail && setExpanded(open ? null : item.id)}
                    className={cn("border-t border-ink/6", hasDetail && "cursor-pointer hover:bg-ink/[0.02]")}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{item.name}</td>
                    <td className="px-4 py-3 text-ink/55">{item.category}</td>
                    {showQuantities && (
                      <td className="px-4 py-3 text-ink/55">
                        {item.quantity} {item.unit}
                      </td>
                    )}
                    {showPrices && (
                      <td className="px-4 py-3 text-ink/55">{item.unitPrice != null ? formatCurrency(item.unitPrice * item.quantity) : "—"}</td>
                    )}
                    <td className="px-4 py-3">
                      {hasDetail && <ChevronDown size={15} className={cn("text-ink/30 transition-transform", open && "rotate-180")} />}
                    </td>
                  </tr>
                  {open && hasDetail && (
                    <tr className="border-t border-ink/6 bg-ink/[0.015]">
                      <td colSpan={5} className="px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row">
                          {item.imageUrl && (
                            <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-ink/5">
                              <Image src={item.imageUrl} alt={item.name} fill unoptimized className="object-cover" />
                            </div>
                          )}
                          <div className="flex-1 text-sm text-ink/60">
                            {item.specification && <p>{item.specification}</p>}
                            {item.description && <p className="mt-1">{item.description}</p>}
                            {item.notes && <p className="mt-1 italic text-ink/45">{item.notes}</p>}
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink/40">
                              {item.relatedSpace && <span>Used in: {item.relatedSpace}</span>}
                              {item.relatedDrawing && <span>Drawing: {item.relatedDrawing}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {total !== null && (
        <div className="glass-strong mt-4 flex items-center justify-between rounded-xl p-4">
          <p className="font-semibold text-ink">Estimated Total</p>
          <p className="text-lg font-semibold text-ink">{formatCurrency(total)}</p>
        </div>
      )}
    </div>
  );
}
