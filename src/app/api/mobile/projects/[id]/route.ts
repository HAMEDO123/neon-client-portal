import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { getProjectById } from "@/lib/queries";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PipelineStatus, ProjectStage, PublishState } from "@/generated/prisma/enums";

const PIPELINE_STATUSES: PipelineStatus[] = [
  "DRAFT", "INTERNAL_REVIEW", "SENT_TO_CLIENT", "CLIENT_REVIEWING",
  "CHANGES_REQUESTED", "APPROVED", "EXECUTION", "COMPLETED", "ARCHIVED",
];
const PUBLISH_STATES: PublishState[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const PROJECT_STAGES: ProjectStage[] = [
  "CONCEPT", "DESIGN", "VISUALIZATION", "TECHNICAL_DRAWINGS",
  "BOQ", "PRICING", "APPROVAL", "HANDOVER",
];

// Optional text columns: an empty string from the form clears the value.
const OPTIONAL_TEXT_FIELDS = [
  "clientEmail", "clientPhone", "location", "area", "projectType", "description",
] as const;

// Employee edits from the app — the full overview form, matching the web admin.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const data: Prisma.ProjectUpdateInput = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
    }
    data.name = name;
  }
  if (body.clientName !== undefined) {
    if (typeof body.clientName !== "string") {
      return NextResponse.json({ error: "Invalid clientName." }, { status: 400 });
    }
    data.clientName = body.clientName.trim();
  }
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (body[field] !== undefined) {
      if (body[field] !== null && typeof body[field] !== "string") {
        return NextResponse.json({ error: `Invalid ${field}.` }, { status: 400 });
      }
      data[field] = (body[field] ?? "").trim() || null;
    }
  }
  if (body.deliveryDate !== undefined) {
    if (body.deliveryDate === null || body.deliveryDate === "") {
      data.deliveryDate = null;
    } else {
      const parsed = new Date(String(body.deliveryDate));
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid deliveryDate." }, { status: 400 });
      }
      data.deliveryDate = parsed;
    }
  }
  if (body.currentStage !== undefined) {
    if (!PROJECT_STAGES.includes(body.currentStage)) {
      return NextResponse.json({ error: "Invalid currentStage." }, { status: 400 });
    }
    data.currentStage = body.currentStage;
  }
  // Set the cover from an already-uploaded gallery image — the URL must belong
  // to this project so the endpoint can't point the cover at arbitrary files.
  if (body.coverImageUrl !== undefined) {
    if (typeof body.coverImageUrl !== "string" || !body.coverImageUrl) {
      return NextResponse.json({ error: "Invalid coverImageUrl." }, { status: 400 });
    }
    const owned = await prisma.galleryImage.findFirst({
      where: { imageUrl: body.coverImageUrl, space: { projectId: id } },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "coverImageUrl is not one of this project's gallery images." }, { status: 400 });
    }
    data.coverImageUrl = body.coverImageUrl;
  }

  if (body.pipelineStatus !== undefined) {
    if (!PIPELINE_STATUSES.includes(body.pipelineStatus)) {
      return NextResponse.json({ error: "Invalid pipelineStatus." }, { status: 400 });
    }
    data.pipelineStatus = body.pipelineStatus;
  }
  if (body.completionPercent !== undefined) {
    const pct = Number(body.completionPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: "completionPercent must be 0-100." }, { status: 400 });
    }
    data.completionPercent = Math.round(pct);
  }
  if (body.publishState !== undefined) {
    if (!PUBLISH_STATES.includes(body.publishState)) {
      return NextResponse.json({ error: "Invalid publishState." }, { status: 400 });
    }
    data.publishState = body.publishState;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.project.update({ where: { id }, data });
  return NextResponse.json({
    name: updated.name,
    clientName: updated.clientName,
    pipelineStatus: updated.pipelineStatus,
    currentStage: updated.currentStage,
    completionPercent: updated.completionPercent,
    publishState: updated.publishState,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const p = await getProjectById(id);
  if (!p) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: p.id,
    token: p.token,
    name: p.name,
    clientName: p.clientName,
    clientEmail: p.clientEmail,
    clientPhone: p.clientPhone,
    location: p.location,
    area: p.area,
    projectType: p.projectType,
    description: p.description,
    coverImageUrl: p.coverImageUrl,
    deliveryDate: p.deliveryDate,
    publishState: p.publishState,
    pipelineStatus: p.pipelineStatus,
    currentStage: p.currentStage,
    completionPercent: p.completionPercent,
    updatedAt: p.updatedAt,
    spaces: p.spaces.map((s) => ({
      id: s.id,
      name: s.name,
      images: s.images.map((img) => ({
        id: img.id,
        imageUrl: img.imageUrl,
        caption: img.caption,
        isBeforeAfter: img.isBeforeAfter,
        beforeImageUrl: img.beforeImageUrl,
      })),
    })),
    drawings: p.drawings.map((d) => ({
      id: d.id,
      category: d.category,
      subCategory: d.subCategory,
      name: d.name,
      drawingNumber: d.drawingNumber,
      revision: d.revision,
      fileUrl: d.fileUrl,
      thumbnailUrl: d.thumbnailUrl,
      fileType: d.fileType,
    })),
    documents: p.documents.map((d) => ({
      id: d.id,
      category: d.category,
      title: d.title,
      fileUrl: d.fileUrl,
      fileType: d.fileType,
      version: d.version,
    })),
    boqItems: p.boqItems.map((b) => ({
      id: b.id,
      category: b.category,
      name: b.name,
      description: b.description,
      unit: b.unit,
      quantity: b.quantity,
      unitPrice: b.unitPrice,
    })),
    pricingItems: p.pricingItems.map((i) => ({
      id: i.id,
      category: i.category,
      label: i.label,
      description: i.description,
      amount: i.amount,
      isOptional: i.isOptional,
    })),
    materials: p.materials.map((m) => ({
      id: m.id,
      category: m.category,
      name: m.name,
      brand: m.brand,
      color: m.color,
      finish: m.finish,
      supplier: m.supplier,
      imageUrl: m.imageUrl,
      price: m.price,
    })),
    furniture: p.furniture.map((f) => ({
      id: f.id,
      name: f.name,
      brand: f.brand,
      dimensions: f.dimensions,
      quantity: f.quantity,
      supplier: f.supplier,
      imageUrl: f.imageUrl,
      price: f.price,
      space: f.space,
    })),
    approvals: p.approvals.map((a) => ({
      id: a.id,
      itemLabel: a.itemLabel,
      status: a.status,
      clientName: a.clientName,
      note: a.note,
      respondedAt: a.respondedAt,
    })),
    comments: p.comments.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      authorType: c.authorType,
      message: c.message,
      refLabel: c.refLabel,
      status: c.status,
      createdAt: c.createdAt,
    })),
  });
}
