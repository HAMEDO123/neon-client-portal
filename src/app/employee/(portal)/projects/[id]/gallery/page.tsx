import { notFound } from "next/navigation";
import Image from "next/image";
import { Images } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { requireEmployee } from "@/lib/employee-session";
import { createSpace, deleteSpace, deleteImage } from "@/lib/actions/gallery-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { HotspotEditor } from "@/components/admin/hotspot-editor";
import { ProjectPhotoUpload } from "@/components/employee/project-photo-upload";

// The gallery, and the one tab that is not simply the manager's screen.
//
// Everything here matches the admin's — the same spaces, the same deletes, the
// same hotspots — except what uploads a photo, and that difference is not
// cosmetic.
//
// **The admin's uploader posts several files in one request; this one posts one
// per request.** The body limit applies to the *raw* upload, before any
// compression, so a handful of camera photos sent together is refused however
// small they end up. That is a documented failure that already shipped once,
// and it lands on exactly the person this screen is for: somebody standing on a
// site with eight photos on their phone. So the employee portal keeps its own
// uploader, which loops.
export default async function EmployeeProjectGalleryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEmployee();

  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-8">
      <form action={createSpace.bind(null, project.id)} className="glass flex items-end gap-3 rounded-2xl p-5">
        <TextInput label="Add a room" name="name" placeholder="Living Room" defaultValue="" className="flex-1" />
        <SaveButton label="Add" />
      </form>

      {project.spaces.length === 0 && (
        <EmptyState
          icon={Images}
          title="No rooms yet"
          description="Photos go in a room — add one like “Living Room” or “Kitchen”, then you can add photos to it."
        />
      )}

      {project.spaces.map((space) => (
        <section key={space.id} className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">{space.name}</h3>
            <form>
              <DeleteButton
                formAction={deleteSpace.bind(null, project.id, space.id)}
                label="Remove room"
                confirmMessage={`Remove "${space.name}" and all of its photos? This takes them off the client's page for good.`}
              />
            </form>
          </div>

          {space.images.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                  {/* Always visible rather than on hover: a phone has no hover,
                      and a control that only appears to a mouse does not exist
                      to the people this screen is for. */}
                  <form className="absolute right-2 top-2">
                    <DeleteButton
                      formAction={deleteImage.bind(null, project.id, img.id)}
                      label="Delete"
                      confirmMessage="Remove this photo? It leaves the client's page and storage for good."
                    />
                  </form>
                  <HotspotEditor projectId={project.id} imageId={img.id} imageUrl={img.imageUrl} hotspots={img.hotspots} />
                </div>
              ))}
            </div>
          )}

          <ProjectPhotoUpload projectId={project.id} spaceId={space.id} />
        </section>
      ))}
    </div>
  );
}
