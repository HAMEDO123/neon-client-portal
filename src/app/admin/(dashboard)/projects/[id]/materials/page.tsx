import { notFound } from "next/navigation";
import Image from "next/image";
import { Palette } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createMaterial, deleteMaterial } from "@/lib/actions/material-actions";
import { TextInput, Select } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { MATERIAL_CATEGORIES, toOptions } from "@/lib/constants";

export default async function MaterialsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={createMaterial.bind(null, project.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
      >
        <Select label="Category" name="category" defaultValue="Marble" options={toOptions(MATERIAL_CATEGORIES)} />
        <TextInput label="Name" name="name" placeholder="Calacatta Gold Marble" defaultValue="" className="sm:col-span-2" />
        <TextInput label="Brand" name="brand" defaultValue="" required={false} />
        <TextInput label="Model" name="model" defaultValue="" required={false} />
        <TextInput label="Color" name="color" defaultValue="" required={false} />
        <TextInput label="Finish" name="finish" defaultValue="" required={false} />
        <TextInput label="Supplier" name="supplier" defaultValue="" required={false} />
        <TextInput label="Estimated Qty" name="estimatedQty" placeholder="42 m²" defaultValue="" required={false} />
        <TextInput label="Price (optional)" name="price" type="number" defaultValue="" required={false} />
        <TextInput label="Used In (spaces)" name="relatedSpaces" placeholder="Living Room, Kitchen" defaultValue="" required={false} />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-ink/50">Image</label>
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
        </div>
        <div>
          <SaveButton label="Add Material" />
        </div>
      </form>

      {project.materials.length === 0 ? (
        <EmptyState icon={Palette} title="No materials yet" description="Build the material and finish board above." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {project.materials.map((m) => (
            <div key={m.id} className="glass overflow-hidden rounded-2xl">
              <div className="relative aspect-square bg-ink/5">
                {m.imageUrl && <Image src={m.imageUrl} alt={m.name} fill className="object-cover" unoptimized />}
              </div>
              <div className="p-3">
                <Badge tone="pink" className="mb-1.5">
                  {m.category}
                </Badge>
                <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                <p className="truncate text-xs text-ink/40">{m.brand}</p>
                <form className="mt-2">
                  <DeleteButton formAction={deleteMaterial.bind(null, project.id, m.id)} />
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
