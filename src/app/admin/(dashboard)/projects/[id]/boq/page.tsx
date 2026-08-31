import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createBoqItem, deleteBoqItem } from "@/lib/actions/boq-actions";
import { TextInput, TextArea, Select } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { BOQ_CATEGORIES, toOptions } from "@/lib/constants";

export default async function BoqAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={createBoqItem.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
      >
        <Select label="Category" name="category" defaultValue="Flooring" options={toOptions(BOQ_CATEGORIES)} />
        <TextInput label="Item Name" name="name" placeholder="Porcelain Flooring" defaultValue="" className="sm:col-span-2" />
        <TextInput label="Unit" name="unit" placeholder="m²" defaultValue="" />
        <TextInput label="Quantity" name="quantity" type="number" defaultValue="" />
        <TextInput label="Unit Price (optional)" name="unitPrice" type="number" defaultValue="" required={false} />
        <TextInput label="Related Drawing" name="relatedDrawing" placeholder="A-102" defaultValue="" required={false} />
        <TextInput label="Related Space" name="relatedSpace" placeholder="Living Room" defaultValue="" required={false} />
        <TextArea label="Specification" name="specification" defaultValue="" className="sm:col-span-4" />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-ink/50">Reference image (optional)</label>
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
        </div>
        <div>
          <SaveButton label="Add Item" />
        </div>
      </form>

      {project.boqItems.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No BOQ items yet" description="Add quantities and specifications above." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink/8">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Unit Price</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {project.boqItems.map((item) => (
                <tr key={item.id} className="border-t border-ink/6">
                  <td className="px-4 py-3 text-ink/60">{item.category}</td>
                  <td className="px-4 py-3 font-medium text-ink">{item.name}</td>
                  <td className="px-4 py-3 text-ink/60">{item.unit}</td>
                  <td className="px-4 py-3 text-ink/60">{item.quantity}</td>
                  <td className="px-4 py-3 text-ink/60">{item.unitPrice ?? "—"}</td>
                  <td className="px-4 py-3">
                    <form>
                      <DeleteButton formAction={deleteBoqItem.bind(null, project.id, item.id)} />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
