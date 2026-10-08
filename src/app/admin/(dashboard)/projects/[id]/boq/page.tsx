import { notFound } from "next/navigation";
import { ClipboardList, FileSpreadsheet } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { addBoqFile, createBoqItem, deleteBoqFile, deleteBoqItem } from "@/lib/actions/boq-actions";
import { boqFilesOf } from "@/lib/boq-files";
import { TextInput, TextArea, Select } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { BOQ_CATEGORIES, toOptions } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";
import { UploadForm } from "@/components/admin/upload-form";

// The BOQ tab: the bill of quantities as a file, as items, or both.
//
// **Two ways in, because a BOQ arrives two ways.** One being worked out here
// is typed item by item, and the client's page can then search it and hide its
// prices. One that already exists — the spreadsheet a quantity surveyor sent,
// last week's PDF — is added as it is. This tab had only the first, so a
// finished BOQ had to be retyped row by row or left off the project.
//
// The file comes first on the screen: when there is one, it is usually the
// whole answer, and the form below it is for the projects that have none.
//
// A BOQ file is a document filed under "BOQ" (lib/boq-files.ts), so it also
// appears on the Documents tab, and removing it in either place removes it.

export default async function BoqAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  const files = boqFilesOf(project.documents);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">BOQ file</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            Already have the BOQ as an Excel sheet or a PDF? Add the file itself. The client sees it in the BOQ section
            of their page exactly as it is — the switches that hide quantities and prices apply to the items below, not
            to what is written inside a file.
          </p>
        </div>

        <UploadForm
          action={addBoqFile.bind(null, project.id)}
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
            <label className="mb-1 block text-xs font-medium text-ink/50">File — Excel, PDF, Word or an image</label>
            <input type="file" name="file" required className="text-xs" />
          </div>
          <div>
            <SaveButton label="Add BOQ file" />
          </div>
        </UploadForm>

        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <div key={file.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink/40">
                  <FileSpreadsheet size={16} strokeWidth={1.75} />
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
                  <DeleteButton formAction={deleteBoqFile.bind(null, project.id, file.id)} />
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">BOQ items</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            Or build it here, one item at a time. The client can search these, and their quantities and prices follow
            the switches on the project&apos;s overview.
          </p>
        </div>

        <UploadForm
          action={createBoqItem.bind(null, project.id)}
          className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-4"
          resetOnSuccess={true}
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
        </UploadForm>

        {project.boqItems.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No BOQ items yet"
            description={
              files.length > 0
                ? "The BOQ is on this project as a file. Items are only needed if you also want it searchable on the client's page."
                : "Add the BOQ as a file above, or add quantities and specifications here."
            }
          />
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
      </section>
    </div>
  );
}
