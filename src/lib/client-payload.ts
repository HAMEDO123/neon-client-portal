import type { FullProject } from "@/lib/queries";

// The project as a client's app is allowed to see it.
//
// **The flags are enforced here, by leaving things out of the answer** — never
// by sending them with a note asking the app not to draw them. A client's app
// is on a phone the studio does not control, and an answer is one `curl` away
// from being read by anybody holding the code; "the app hides it" is not a
// visibility setting, it is a request.
//
// So `showPricing` off means there is no pricing in the payload at all, and
// `showBoqPrices` off means the quantities arrive without a rate or a total.
// That is the same decision the web page makes in its components, moved to
// where it cannot be forgotten.
//
// Pure, and tested, because the one thing this must never do is let a figure
// through that the manager switched off.

export type ClientPayload = ReturnType<typeof clientPayload>;

export function clientPayload(project: FullProject) {
  const money = project.showPricing;
  const boqPrices = money && project.showBoqPrices;

  return {
    project: {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      location: project.location,
      area: project.area,
      projectType: project.projectType,
      description: project.description,
      coverImageUrl: project.coverImageUrl,
      deliveryDate: project.deliveryDate?.toISOString() ?? null,
      stage: project.currentStage,
      status: project.pipelineStatus,
      completionPercent: project.completionPercent,
      // What the app may offer, so it does not draw a button that 404s: the
      // download routes refuse when this is off.
      allowDownloads: project.allowDownloads,
      watermarked: project.watermarkEnabled,
      // Said plainly so a screen can explain an empty section rather than
      // looking broken — "NEON has not shared pricing for this project".
      showsPricing: money,
      showsBoqQuantities: project.showBoqQuantities,
      showsBoqPrices: boqPrices,
    },

    spaces: project.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      images: space.images.map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        caption: image.caption,
        isBeforeAfter: image.isBeforeAfter,
        beforeImageUrl: image.beforeImageUrl,
        hotspots: image.hotspots.map((hotspot) => ({
          id: hotspot.id,
          xPercent: hotspot.xPercent,
          yPercent: hotspot.yPercent,
          label: hotspot.label,
          description: hotspot.description,
          category: hotspot.category,
          linkLabel: hotspot.linkLabel,
        })),
      })),
    })),

    drawings: project.drawings.map((drawing) => ({
      id: drawing.id,
      category: drawing.category,
      subCategory: drawing.subCategory,
      name: drawing.name,
      drawingNumber: drawing.drawingNumber,
      revision: drawing.revision,
      fileUrl: drawing.fileUrl,
      thumbnailUrl: drawing.thumbnailUrl,
      fileType: drawing.fileType,
      fileSize: drawing.fileSize,
      // Only how many there have been. Who changed what and when is the
      // studio's own record, not something a client is shown.
      revisionCount: drawing.revisions.length,
    })),

    documents: project.documents.map((document) => ({
      id: document.id,
      category: document.category,
      title: document.title,
      fileUrl: document.fileUrl,
      fileType: document.fileType,
      fileSize: document.fileSize,
      version: document.version,
    })),

    // The bill of quantities, as three separate switches decide it: the
    // section itself, its quantities, and its prices.
    boq: project.boqItems.map((item) => ({
      id: item.id,
      category: item.category,
      name: item.name,
      description: item.description,
      specification: item.specification,
      unit: item.unit,
      quantity: project.showBoqQuantities ? item.quantity : null,
      unitPrice: boqPrices ? item.unitPrice : null,
      total: boqPrices && item.unitPrice != null ? round(item.quantity * item.unitPrice) : null,
      imageUrl: item.imageUrl,
      relatedDrawing: item.relatedDrawing,
      relatedSpace: item.relatedSpace,
      notes: item.notes,
    })),

    // Absent, not emptied, when the manager has not shared pricing — and only
    // the line items are hidden by `showDetailedPricing`, never the total,
    // which is the point of showing pricing at all.
    pricing: money
      ? {
          total: round(project.pricingItems.reduce((sum, item) => sum + (item.isOptional ? 0 : item.amount), 0)),
          optionalTotal: round(project.pricingItems.reduce((sum, item) => sum + (item.isOptional ? item.amount : 0), 0)),
          items: project.showDetailedPricing
            ? project.pricingItems.map((item) => ({
                id: item.id,
                category: item.category,
                label: item.label,
                description: item.description,
                amount: item.amount,
                isOptional: item.isOptional,
              }))
            : [],
          itemsShown: project.showDetailedPricing,
        }
      : null,

    materials: project.materials.map((material) => ({
      id: material.id,
      category: material.category,
      name: material.name,
      brand: material.brand,
      model: material.model,
      color: material.color,
      finish: material.finish,
      specification: material.specification,
      supplier: material.supplier,
      reference: material.reference,
      imageUrl: material.imageUrl,
      estimatedQty: material.estimatedQty,
      // A material's own price is money like any other, so the same switch
      // decides it. Letting it through would hand over the costing a project
      // with pricing switched off is keeping back.
      price: money ? material.price : null,
      relatedSpaces: material.relatedSpaces,
    })),

    furniture: project.furniture.map((item) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      model: item.model,
      dimensions: item.dimensions,
      quantity: item.quantity,
      finish: item.finish,
      supplier: item.supplier,
      reference: item.reference,
      imageUrl: item.imageUrl,
      price: money ? item.price : null,
      space: item.space,
    })),

    approvals: project.approvals.map((approval) => ({
      id: approval.id,
      itemLabel: approval.itemLabel,
      status: approval.status,
      clientName: approval.clientName,
      note: approval.note,
      respondedAt: approval.respondedAt?.toISOString() ?? null,
    })),

    comments: project.comments.map((comment) => ({
      id: comment.id,
      authorName: comment.authorName,
      authorType: comment.authorType,
      message: comment.message,
      refLabel: comment.refLabel,
      status: comment.status,
      createdAt: comment.createdAt.toISOString(),
    })),
  };
}

/** Money to two places: 0.1 + 0.2 must not reach a client as 0.30000000000000004. */
function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}
