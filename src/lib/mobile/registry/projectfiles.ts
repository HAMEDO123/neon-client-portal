import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import {
  createDrawing,
  addDrawingRevision,
  deleteRevision,
  deleteDrawing,
} from "@/lib/actions/drawing-actions";
import { createDocument, deleteDocument } from "@/lib/actions/document-actions";
import { createBoqItem, deleteBoqItem } from "@/lib/actions/boq-actions";
import { createPricingItem, deletePricingItem } from "@/lib/actions/pricing-actions";
import { createMaterial, deleteMaterial } from "@/lib/actions/material-actions";
import { createFurnitureItem, deleteFurnitureItem } from "@/lib/actions/furniture-actions";
import { createApproval, deleteApproval } from "@/lib/actions/approval-actions";
import { resolveComment, deleteComment } from "@/lib/actions/comment-actions";
import { replyAsStudio } from "@/lib/mobile/projectfiles-comments";
import { guarded, guardedAction, oneOf, optStr, param, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";

// The "projectfiles" area of the phone API: the project file tabs — drawings,
// documents, BOQ, pricing, materials, furniture, approvals, comments — that
// the projects area embeds in a project's page, on both sides. See
// lib/mobile/rpc.ts: keys are "projectfiles/<name>"; every read is
// guarded(<the website page's guard>, …); an action calls the website's own
// server action.
//
// **The guard for every read here is `requireStaff`, not `requireAdmin`.**
// These tabs are the same module on both portals (see README's "Two
// audiences" note on drawing/document/… actions and the employee layout's own
// comment): the admin page's session is checked by its dashboard layout, the
// employee's by `requireEmployee` at its own layout, and every write these
// tabs offer already carries `requireStaff`. Mirroring that guard here is
// mirroring the page these reads stand in for, on whichever side opened it.

export const reads: ReadRegistry = {
  "projectfiles/drawings": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const drawings = await prisma.drawing.findMany({
      where: { projectId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
      include: { revisions: { orderBy: { createdAt: "desc" } } },
    });
    return {
      drawings: drawings.map((d) => ({
        id: d.id,
        category: d.category,
        subCategory: d.subCategory,
        name: d.name,
        drawingNumber: d.drawingNumber,
        revision: d.revision,
        fileUrl: d.fileUrl,
        fileType: d.fileType,
        fileSize: d.fileSize,
        createdAt: d.createdAt,
        revisions: d.revisions.map((r) => ({
          id: r.id,
          revision: r.revision,
          note: r.note,
          fileUrl: r.fileUrl,
          createdAt: r.createdAt,
        })),
      })),
    };
  }),

  "projectfiles/documents": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const documents = await prisma.document.findMany({
      where: { projectId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    return {
      documents: documents.map((d) => ({
        id: d.id,
        category: d.category,
        title: d.title,
        fileUrl: d.fileUrl,
        fileType: d.fileType,
        fileSize: d.fileSize,
        version: d.version,
        createdAt: d.createdAt,
      })),
    };
  }),

  "projectfiles/boq": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const items = await prisma.boqItem.findMany({
      where: { projectId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        category: b.category,
        name: b.name,
        description: b.description,
        specification: b.specification,
        unit: b.unit,
        quantity: b.quantity,
        unitPrice: b.unitPrice,
        imageUrl: b.imageUrl,
        relatedDrawing: b.relatedDrawing,
        relatedSpace: b.relatedSpace,
        notes: b.notes,
      })),
    };
  }),

  "projectfiles/pricing": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const [items, project] = await Promise.all([
      prisma.pricingItem.findMany({ where: { projectId }, orderBy: [{ category: "asc" }, { order: "asc" }] }),
      prisma.project.findUnique({ where: { id: projectId }, select: { showPricing: true } }),
    ]);
    const total = items.filter((p) => !p.isOptional).reduce((sum, p) => sum + p.amount, 0);
    return {
      showPricing: project?.showPricing ?? false,
      total,
      items: items.map((i) => ({
        id: i.id,
        category: i.category,
        label: i.label,
        description: i.description,
        amount: i.amount,
        isOptional: i.isOptional,
      })),
    };
  }),

  "projectfiles/materials": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const materials = await prisma.material.findMany({
      where: { projectId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    return {
      materials: materials.map((m) => ({
        id: m.id,
        category: m.category,
        name: m.name,
        brand: m.brand,
        model: m.model,
        color: m.color,
        finish: m.finish,
        specification: m.specification,
        supplier: m.supplier,
        reference: m.reference,
        imageUrl: m.imageUrl,
        estimatedQty: m.estimatedQty,
        price: m.price,
        relatedSpaces: m.relatedSpaces,
      })),
    };
  }),

  "projectfiles/furniture": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const furniture = await prisma.furnitureItem.findMany({ where: { projectId }, orderBy: { order: "asc" } });
    return {
      furniture: furniture.map((f) => ({
        id: f.id,
        name: f.name,
        brand: f.brand,
        model: f.model,
        dimensions: f.dimensions,
        quantity: f.quantity,
        finish: f.finish,
        supplier: f.supplier,
        reference: f.reference,
        imageUrl: f.imageUrl,
        price: f.price,
        space: f.space,
      })),
    };
  }),

  "projectfiles/approvals": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const approvals = await prisma.approval.findMany({ where: { projectId }, orderBy: { order: "asc" } });
    return {
      approvals: approvals.map((a) => ({
        id: a.id,
        itemLabel: a.itemLabel,
        status: a.status,
        clientName: a.clientName,
        note: a.note,
        respondedAt: a.respondedAt,
        createdAt: a.createdAt,
      })),
    };
  }),

  "projectfiles/comments": guarded(requireStaff, async (params) => {
    const projectId = param(params, "projectId");
    const comments = await prisma.comment.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
    return {
      comments: comments.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        authorType: c.authorType,
        message: c.message,
        refLabel: c.refLabel,
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
  }),
};

export const actions: ActionRegistry = {
  "projectfiles/createDrawing": (input) => createDrawing(str(input.args[0], "projectId"), input.form),
  "projectfiles/addDrawingRevision": (input) =>
    addDrawingRevision(str(input.args[0], "projectId"), str(input.args[1], "drawingId"), input.form),
  "projectfiles/deleteRevision": (input) => deleteRevision(str(input.args[0], "projectId"), str(input.args[1], "id")),
  "projectfiles/deleteDrawing": (input) => deleteDrawing(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createDocument": (input) => createDocument(str(input.args[0], "projectId"), input.form),
  "projectfiles/deleteDocument": (input) => deleteDocument(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createBoqItem": (input) => createBoqItem(str(input.args[0], "projectId"), input.form),
  "projectfiles/deleteBoqItem": (input) => deleteBoqItem(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createPricingItem": (input) => createPricingItem(str(input.args[0], "projectId"), input.form),
  "projectfiles/deletePricingItem": (input) =>
    deletePricingItem(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createMaterial": (input) => createMaterial(str(input.args[0], "projectId"), input.form),
  "projectfiles/deleteMaterial": (input) => deleteMaterial(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createFurnitureItem": (input) => createFurnitureItem(str(input.args[0], "projectId"), input.form),
  "projectfiles/deleteFurnitureItem": (input) =>
    deleteFurnitureItem(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/createApproval": (input) => createApproval(str(input.args[0], "projectId"), input.form),
  "projectfiles/deleteApproval": (input) => deleteApproval(str(input.args[0], "projectId"), str(input.args[1], "id")),

  "projectfiles/resolveComment": (input) =>
    resolveComment(
      str(input.args[0], "projectId"),
      str(input.args[1], "id"),
      oneOf(input.args[2], ["OPEN", "RESOLVED"] as const, "status")
    ),
  "projectfiles/deleteComment": (input) => deleteComment(str(input.args[0], "projectId"), str(input.args[1], "id")),
  // No server action answers a comment as the studio — see
  // lib/mobile/projectfiles-comments.ts for why this is the one entry here
  // that is guardedAction rather than a call into lib/actions.
  "projectfiles/replyToComment": guardedAction(requireStaff, (input) =>
    replyAsStudio(str(input.args[0], "projectId"), str(input.args[1], "message"), optStr(input.args[2]))
  ),
};
