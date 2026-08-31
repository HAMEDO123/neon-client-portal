import { notFound } from "next/navigation";
import Image from "next/image";
import { getProjectById } from "@/lib/queries";
import { createSpace, deleteSpace, addImage, deleteImage } from "@/lib/actions/gallery-actions";
import { TextInput, Checkbox } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Images } from "lucide-react";
import { HotspotEditor } from "@/components/admin/hotspot-editor";

export default async function GalleryAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-8">
      <form action={createSpace.bind(null, project.id)} className="glass flex items-end gap-3 rounded-2xl p-5">
        <TextInput label="Add a space" name="name" placeholder="Living Room" defaultValue="" className="flex-1" />
        <SaveButton label="Add Space" />
      </form>

      {project.spaces.length === 0 && (
        <EmptyState icon={Images} title="No spaces yet" description="Add a space like “Living Room” or “Kitchen” to start uploading renders." />
      )}

      {project.spaces.map((space) => (
        <section key={space.id} className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">{space.name}</h3>
            <form>
              <DeleteButton
                formAction={deleteSpace.bind(null, project.id, space.id)}
                label="Remove Space"
                confirmMessage={`Remove "${space.name}" and all of its images?`}
              />
            </form>
          </div>

          {space.images.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {space.images.map((img) => (
                <div key={img.id} className="group relative overflow-hidden rounded-xl border border-ink/8">
                  <div className="relative aspect-[4/3]">
                    <Image src={img.imageUrl} alt={img.caption ?? space.name} fill className="object-cover" unoptimized />
                  </div>
                  {img.isBeforeAfter && (
                    <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-bg">
                      Before/After
                    </span>
                  )}
                  <form className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      formAction={deleteImage.bind(null, project.id, img.id)}
                      className="rounded-full bg-red-600/90 px-2 py-1 text-[10px] font-medium text-white"
                    >
                      Delete
                    </button>
                  </form>
                  <HotspotEditor projectId={project.id} imageId={img.id} imageUrl={img.imageUrl} hotspots={img.hotspots} />
                </div>
              ))}
            </div>
          )}

          <form
            action={addImage.bind(null, project.id, space.id)}
            className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-ink/12 p-4"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/50">Images (select multiple to batch-upload)</label>
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" required multiple className="text-xs" />
              <p className="mt-1 text-[11px] text-ink/35">Anything over 1MB is compressed automatically. Keep each batch under ~100MB total.</p>
            </div>
            <TextInput label="Caption (optional)" name="caption" defaultValue="" required={false} className="w-48" />
            <Checkbox label="Before / After pair" name="isBeforeAfter" className="w-56" />
            <div>
              <label className="mb-1 block text-xs font-medium text-ink/50">“Before” image (if checked, uses only the first image above)</label>
              <input type="file" name="beforeImage" accept="image/jpeg,image/png,image/webp,image/avif" className="text-xs" />
            </div>
            <SaveButton label="Add Image(s)" />
          </form>
        </section>
      ))}
    </div>
  );
}
