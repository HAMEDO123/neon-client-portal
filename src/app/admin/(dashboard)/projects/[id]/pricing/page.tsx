import { notFound } from "next/navigation";
import { FileText, Wallet } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { addPricingFile, createPricingItem, deletePricingFile, deletePricingItem } from "@/lib/actions/pricing-actions";
import { pricingFilesOf } from "@/lib/pricing-files";
import { UploadForm } from "@/components/admin/upload-form";
import { formatFileSize } from "@/lib/format";
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
  const files = pricingFilesOf(project.documents);

  return (
    <div className="flex flex-col gap-6">
      {!project.showPricing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pricing is currently hidden from the client. Enable “Show Execution Pricing” in the Overview tab when ready.
        </div>
      )}

      {/* The price as a file — the quotation itself — beside the line items
          below. A document filed under "Pricing" (lib/pricing-files.ts), so it
          is also on the Documents tab, and the client only gets it while
          pricing is shown. */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Pricing file</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            Already have the quotation as a PDF or an Excel sheet? Add the file itself. The client sees it in the
            pricing section of their page exactly as it is — and only while “Show Execution Pricing” is on.
          </p>
        </div>

        <UploadForm
          action={addPricingFile.bind(null, project.id)}
          className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
          resetOnSuccess={true}
        >
          <TextInput
            label="Title (optional)"
            name="title"
            placeholder="The file's own name is used if this is empty"
            defaultValue=""
            required={false}
            className="sm:col-span-2"
          />
          <TextInput label="Version (optional)" name="version" placeholder="v1" defaultValue="" required={false} />
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium text-ink/50">File — PDF, Excel, Word or an image</label>
            <input type="file" name="file" required className="text-xs" />
          </div>
          <div>
            <SaveButton label="Add pricing file" />
          </div>
        </UploadForm>

        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <div key={file.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink/40">
                  <FileText size={16} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-medium text-ink">
                    {file.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink/40">
                    {file.version ? `${file.version} · ` : ""}
                    {file.fileType.toUpperCase()} {file.fileSize ? `· ${formatFileSize(file.fileSize)}` : ""}
                  </p>
                </div>
                <a href={file.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-cyan-strong">
                  View
                </a>
                <form>
                  <DeleteButton formAction={deletePricingFile.bind(null, project.id, file.id)} />
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <h2 className="-mb-3 text-sm font-semibold text-ink">Pricing items</h2>

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
