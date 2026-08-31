import { notFound } from "next/navigation";
import Image from "next/image";
import { Sofa } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createFurnitureItem, deleteFurnitureItem } from "@/lib/actions/furniture-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";

export default async function FurnitureAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={createFurnitureItem.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
      >
        <TextInput label="Name" name="name" placeholder="Sofa" defaultValue="" className="sm:col-span-2" />
        <TextInput label="Space" name="space" placeholder="Living Room" defaultValue="" required={false} />
        <TextInput label="Quantity" name="quantity" type="number" defaultValue="1" />
        <TextInput label="Brand" name="brand" defaultValue="" required={false} />
        <TextInput label="Model" name="model" defaultValue="" required={false} />
        <TextInput label="Dimensions" name="dimensions" placeholder="320 × 100 cm" defaultValue="" required={false} />
        <TextInput label="Finish" name="finish" defaultValue="" required={false} />
        <TextInput label="Supplier" name="supplier" defaultValue="" required={false} />
        <TextInput label="Price (optional)" name="price" type="number" defaultValue="" required={false} />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-ink/50">Image</label>
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
        </div>
        <div>
          <SaveButton label="Add Item" />
        </div>
      </form>

      {project.furniture.length === 0 ? (
        <EmptyState icon={Sofa} title="No furniture yet" description="Build the furniture and product schedule above." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {project.furniture.map((f) => (
            <div key={f.id} className="glass overflow-hidden rounded-2xl">
              <div className="relative aspect-square bg-ink/5">
                {f.imageUrl && <Image src={f.imageUrl} alt={f.name} fill className="object-cover" unoptimized />}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium text-ink">{f.name}</p>
                <p className="truncate text-xs text-ink/40">
                  {f.space ?? "—"} · Qty {f.quantity}
                </p>
                <form className="mt-2">
                  <DeleteButton formAction={deleteFurnitureItem.bind(null, project.id, f.id)} />
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
