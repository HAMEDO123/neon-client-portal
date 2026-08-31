import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createPricingItem, deletePricingItem } from "@/lib/actions/pricing-actions";
import { TextInput, TextArea, Select, Checkbox } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { PRICING_CATEGORIES, toOptions } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";

export default async function PricingAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  const total = project.pricingItems.filter((p) => !p.isOptional).reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      {!project.showPricing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pricing is currently hidden from the client. Enable “Show Execution Pricing” in the Overview tab when ready.
        </div>
      )}

      <form
        action={createPricingItem.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
      >
        <Select label="Category" name="category" defaultValue="Interior Works" options={toOptions(PRICING_CATEGORIES)} />
        <TextInput label="Label" name="label" placeholder="Interior Works" defaultValue="" className="sm:col-span-2" />
        <TextInput label="Amount (JOD)" name="amount" type="number" defaultValue="" />
        <TextArea label="Description (optional)" name="description" defaultValue="" className="sm:col-span-3" />
        <Checkbox label="Optional item" name="isOptional" description="Shown separately, not in the total." />
        <div className="sm:col-span-4">
          <SaveButton label="Add Line Item" />
        </div>
      </form>

      {project.pricingItems.length === 0 ? (
        <EmptyState icon={Wallet} title="No pricing yet" description="Add cost breakdown line items above." />
      ) : (
        <div className="flex flex-col gap-2">
          {project.pricingItems.map((item) => (
            <div key={item.id} className="glass flex items-center gap-3 rounded-xl p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {item.label} {item.isOptional && <span className="text-xs text-ink/40">(optional)</span>}
                </p>
                <p className="mt-0.5 text-xs text-ink/40">{item.category}</p>
              </div>
              <p className="font-medium text-ink">{formatCurrency(item.amount)}</p>
              <form>
                <DeleteButton formAction={deletePricingItem.bind(null, project.id, item.id)} />
              </form>
            </div>
          ))}
          <div className="glass-strong flex items-center justify-between rounded-xl p-4">
            <p className="font-semibold text-ink">Total Project Cost</p>
            <p className="text-lg font-semibold text-ink">{formatCurrency(total)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
