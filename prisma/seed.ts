import { config } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

config();
config({ path: ".env.local", override: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SAMPLE_PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

function pic(seed: string) {
  return `/seed-images/${seed}.jpg`;
}

async function main() {
  await prisma.project.deleteMany({ where: { token: "villa-al-fulan-2026-demo" } });

  const project = await prisma.project.create({
    data: {
      token: "villa-al-fulan-2026-demo",
      name: "Villa Al-Fulan",
      clientName: "Ahmad Al-Fulan",
      clientEmail: "ahmad.alfulan@example.com",
      clientPhone: "+962 7 9012 3456",
      location: "Abdoun, Amman, Jordan",
      area: "420 m²",
      projectType: "Interior Design & Execution Package",
      description:
        "A full interior design and execution package for a contemporary family villa in Abdoun, blending warm minimalism with bespoke joinery and natural materials throughout.",
      coverImageUrl: pic("villa-cover"),
      deliveryDate: new Date("2026-11-15"),
      publishState: "PUBLISHED",
      pipelineStatus: "EXECUTION",
      currentStage: "PRICING",
      completionPercent: 78,
      showPricing: true,
      showDetailedPricing: true,
      showBoqQuantities: true,
      showBoqPrices: false,
      allowDownloads: true,
      watermarkEnabled: false,
    },
  });

  // ---------- Gallery ----------

  const spaces: { name: string; images: { seed: string; caption: string; before?: string }[] }[] = [
    {
      name: "Living Room",
      images: [
        { seed: "living-1", caption: "Living room — window wall & feature fireplace", before: "living-before-1" },
        { seed: "living-2", caption: "Living room — seating arrangement" },
      ],
    },
    {
      name: "Kitchen",
      images: [
        { seed: "kitchen-1", caption: "Kitchen — island & lacquer cabinetry" },
        { seed: "kitchen-2", caption: "Kitchen — breakfast counter" },
      ],
    },
    {
      name: "Master Bedroom",
      images: [
        { seed: "bedroom-1", caption: "Master bedroom — headboard wall" },
        { seed: "bedroom-2", caption: "Master bedroom — dressing area" },
      ],
    },
    { name: "Dining Room", images: [{ seed: "dining-1", caption: "Dining room — pendant cluster over table" }] },
    { name: "Bathroom", images: [{ seed: "bathroom-1", caption: "Master bathroom — freestanding tub" }] },
    { name: "Entrance", images: [{ seed: "entrance-1", caption: "Entrance foyer" }] },
    { name: "Outdoor Terrace", images: [{ seed: "terrace-1", caption: "Outdoor terrace & landscape lighting" }] },
  ];

  for (const [i, space] of spaces.entries()) {
    const created = await prisma.gallerySpace.create({ data: { projectId: project.id, name: space.name, order: i } });
    for (const [j, img] of space.images.entries()) {
      const createdImage = await prisma.galleryImage.create({
        data: {
          spaceId: created.id,
          imageUrl: pic(img.seed),
          caption: img.caption,
          isBeforeAfter: !!img.before,
          beforeImageUrl: img.before ? pic(img.before) : null,
          order: j,
        },
      });

      if (img.seed === "living-2") {
        await prisma.imageHotspot.createMany({
          data: [
            { imageId: createdImage.id, xPercent: 32, yPercent: 68, label: "Modular Sofa", category: "Furniture", linkLabel: "B&B Italia — Tufty-Time", description: "Boucle ivory upholstery, 320 × 100 cm.", order: 0 },
            { imageId: createdImage.id, xPercent: 68, yPercent: 82, label: "European Oak Flooring", category: "Material", linkLabel: "Kährs", description: "Engineered oak, brushed & oiled finish.", order: 1 },
            { imageId: createdImage.id, xPercent: 50, yPercent: 22, label: "Brass Pendant Cluster", category: "Lighting", linkLabel: "Tom Dixon", description: "Polished brass, dimmable.", order: 2 },
          ],
        });
      }
    }
  }

  // ---------- Drawings ----------

  const drawings = [
    { category: "Architectural", subCategory: "Floor Plans", name: "Ground Floor Plan", drawingNumber: "A-101", revision: "R02" },
    { category: "Architectural", subCategory: "Elevations", name: "Front Elevation", drawingNumber: "A-201", revision: "R01" },
    { category: "Ceiling", subCategory: "RCP", name: "Reflected Ceiling Plan — Living Areas", drawingNumber: "C-101", revision: "R01" },
    { category: "Electrical", subCategory: "Power Layout", name: "Power & Lighting Layout — Ground Floor", drawingNumber: "E-101", revision: "R00" },
    { category: "Joinery", subCategory: "Kitchen", name: "Kitchen Joinery Details", drawingNumber: "J-101", revision: "R01" },
  ];
  for (const [i, d] of drawings.entries()) {
    const createdDrawing = await prisma.drawing.create({
      data: { projectId: project.id, ...d, fileUrl: SAMPLE_PDF, fileType: "pdf", fileSize: 240_000 + i * 15_000, order: i },
    });

    if (d.drawingNumber === "A-101") {
      await prisma.drawingRevision.createMany({
        data: [
          { drawingId: createdDrawing.id, revision: "R00", note: "Initial design", fileUrl: SAMPLE_PDF },
          { drawingId: createdDrawing.id, revision: "R01", note: "Client requested wall move in kitchen", fileUrl: SAMPLE_PDF },
        ],
      });
    }
  }

  // ---------- Documents ----------

  const documents = [
    { category: "Contracts", title: "Design & Execution Agreement", version: "v1" },
    { category: "Specifications", title: "Material Specification Booklet", version: "v2" },
    { category: "Reports", title: "Progress Report — August 2026", version: null },
  ];
  for (const [i, d] of documents.entries()) {
    await prisma.document.create({
      data: { projectId: project.id, ...d, fileUrl: SAMPLE_PDF, fileType: "pdf", fileSize: 180_000 + i * 20_000, order: i },
    });
  }

  // ---------- BOQ ----------

  const boq = [
    { category: "Flooring", name: "Porcelain Flooring", specification: "120×60 Porcelain, matte finish", unit: "m²", quantity: 185, unitPrice: 18, relatedSpace: "Living Room, Dining Room, Hallway", relatedDrawing: "A-102" },
    { category: "Paint", name: "Interior Wall Paint", specification: "Premium interior paint, washable matte", unit: "m²", quantity: 420, unitPrice: 3.5 },
    { category: "Gypsum", name: "Gypsum Ceiling", specification: "Moisture-resistant board, recessed lighting cutouts", unit: "m²", quantity: 130, unitPrice: 9, relatedDrawing: "C-101" },
    { category: "Joinery", name: "Wardrobes", specification: "Built-in MDF, lacquer finish", unit: "lm", quantity: 24, unitPrice: 210, relatedSpace: "Master Bedroom" },
    { category: "Doors", name: "Interior Doors", specification: "Solid core, veneer finish", unit: "pcs", quantity: 14, unitPrice: 165 },
    { category: "Windows", name: "Aluminum Windows", specification: "Double glazed, thermal break", unit: "m²", quantity: 62, unitPrice: 145 },
    { category: "Sanitary", name: "Sanitary Ware Set", specification: "Premium fixtures — basin, WC, mixer", unit: "set", quantity: 4, unitPrice: 680, relatedSpace: "Bathroom" },
    { category: "Lighting", name: "Lighting Fixtures", specification: "Recessed LED downlights + pendants", unit: "pcs", quantity: 48, unitPrice: 35, relatedDrawing: "E-101" },
    { category: "Electrical", name: "Electrical Points", specification: "Sockets, switches & data points", unit: "pcs", quantity: 96, unitPrice: 12 },
    { category: "Joinery", name: "Kitchen Cabinetry", specification: "Lacquer finish base & wall units", unit: "lm", quantity: 9.5, unitPrice: 620, relatedSpace: "Kitchen", relatedDrawing: "J-101" },
  ];
  for (const [i, b] of boq.entries()) {
    await prisma.boqItem.create({ data: { projectId: project.id, ...b, order: i } });
  }

  // ---------- Materials ----------

  const materials = [
    { category: "Marble", name: "Calacatta Gold Marble", brand: "Levantine Stone Co.", finish: "Polished", color: "White & Gold Veining", specification: "Feature wall cladding, book-matched panels", estimatedQty: "18 m²", relatedSpaces: "Living Room" },
    { category: "Wood", name: "European Oak Flooring", brand: "Kährs", finish: "Brushed & Oiled", color: "Natural", specification: "Engineered oak plank flooring", estimatedQty: "64 m²", relatedSpaces: "Master Bedroom, Dining Room" },
    { category: "Fabric", name: "Boucle Upholstery", brand: "Kvadrat", finish: "Textured Weave", color: "Warm Ivory", specification: "Sofa & armchair upholstery", relatedSpaces: "Living Room" },
    { category: "Paint", name: "Interior Matte Paint", brand: "Jotun", finish: "Matte", color: "Off-White (Warm)", specification: "Washable interior emulsion" },
    { category: "Metal", name: "Brushed Brass Hardware", brand: "Buster + Punch", finish: "Brushed Brass", specification: "Door handles, cabinet pulls" },
    { category: "Lighting", name: "Brass Pendant Cluster", brand: "Tom Dixon", finish: "Polished Brass", specification: "Dining pendant fixture", relatedSpaces: "Dining Room" },
    { category: "Tiles", name: "Large Format Porcelain", brand: "Ceramiche Refin", finish: "Matte", color: "Warm Grey", specification: "Bathroom wall & floor tiling", relatedSpaces: "Bathroom" },
  ];
  for (const [i, m] of materials.entries()) {
    await prisma.material.create({ data: { projectId: project.id, imageUrl: pic(`material-${i}`), ...m, order: i } });
  }

  // ---------- Furniture ----------

  const furniture = [
    { name: "Modular Sofa", brand: "B&B Italia", model: "Tufty-Time", dimensions: "320 × 100 cm", quantity: 1, finish: "Boucle Ivory", space: "Living Room" },
    { name: "Dining Table", brand: "Minotti", model: "Sten", dimensions: "260 × 110 cm", quantity: 1, finish: "Oak & Brass", space: "Dining Room" },
    { name: "Coffee Table", brand: "Gubi", model: "TS", dimensions: "120 × 60 cm", quantity: 1, finish: "Travertine", space: "Living Room" },
    { name: "Bed Frame", brand: "Poliform", model: "Dune", dimensions: "200 × 220 cm", quantity: 1, finish: "Fabric Upholstered", space: "Master Bedroom" },
    { name: "Counter Stools", brand: "Fritz Hansen", model: "Series 7", dimensions: "45 × 45 × 75 cm", quantity: 3, finish: "Walnut & Steel", space: "Kitchen" },
    { name: "TV Console", brand: "Custom Joinery", dimensions: "280 × 45 × 40 cm", quantity: 1, finish: "Lacquer & Oak", space: "Living Room" },
  ];
  for (const [i, f] of furniture.entries()) {
    await prisma.furnitureItem.create({ data: { projectId: project.id, imageUrl: pic(`furniture-${i}`), ...f, order: i } });
  }

  // ---------- Pricing ----------

  const pricing = [
    { category: "Interior Works", label: "Interior Works", description: "Flooring, walls, ceiling, and finishes across all spaces.", amount: 48500 },
    { category: "Joinery", label: "Joinery", description: "Kitchen, wardrobes, TV units, and custom furniture.", amount: 26400 },
    { category: "Electrical", label: "Electrical", description: "Power, lighting, low current & data points.", amount: 11200 },
    { category: "HVAC", label: "HVAC", description: "AC layout, diffusers, and equipment.", amount: 8600 },
    { category: "Furniture", label: "Furniture & Styling", description: "Loose furniture, styling, and accessories.", amount: 19800 },
    { category: "Other", label: "Landscape Lighting Package", description: "Optional terrace & garden lighting upgrade.", amount: 4200, isOptional: true },
  ];
  for (const [i, p] of pricing.entries()) {
    await prisma.pricingItem.create({ data: { projectId: project.id, ...p, order: i } });
  }

  // ---------- Approvals ----------

  await prisma.approval.create({
    data: {
      projectId: project.id,
      itemLabel: "Living Room Design",
      status: "APPROVED",
      clientName: "Ahmad Al-Fulan",
      note: "Looks great — approved as is.",
      respondedAt: new Date("2026-08-10"),
      order: 0,
    },
  });
  await prisma.approval.create({
    data: {
      projectId: project.id,
      itemLabel: "Kitchen Design",
      status: "CHANGES_REQUESTED",
      clientName: "Ahmad Al-Fulan",
      note: "Please make the countertop a warmer, lighter tone.",
      respondedAt: new Date("2026-08-14"),
      order: 1,
    },
  });
  await prisma.approval.create({
    data: { projectId: project.id, itemLabel: "Master Bedroom Design", status: "PENDING", order: 2 },
  });

  // ---------- Comments ----------

  await prisma.comment.create({
    data: {
      projectId: project.id,
      authorName: "Ahmad Al-Fulan",
      authorType: "CLIENT",
      message: "Can we change the kitchen island color to a warmer tone?",
      refLabel: "Kitchen Render",
      status: "OPEN",
    },
  });
  await prisma.comment.create({
    data: {
      projectId: project.id,
      authorName: "NEON Team",
      authorType: "ADMIN",
      message: "Noted — we'll share two warmer lacquer options by Thursday.",
      refLabel: "Kitchen Render",
      status: "RESOLVED",
    },
  });

  // ---------- Sample activity history ----------

  const day = 24 * 60 * 60 * 1000;
  const activities: { type: string; detail?: string; daysAgo: number }[] = [
    { type: "viewed_project", daysAgo: 6 },
    { type: "viewed_render", detail: "Living room — window wall & feature fireplace", daysAgo: 6 },
    { type: "viewed_render", detail: "Kitchen — island & lacquer cabinetry", daysAgo: 6 },
    { type: "viewed_project", daysAgo: 4 },
    { type: "downloaded_drawing", detail: "Ground Floor Plan", daysAgo: 4 },
    { type: "viewed_boq", daysAgo: 4 },
    { type: "approved", detail: "Living Room Design", daysAgo: 3 },
    { type: "commented", detail: "Kitchen Render", daysAgo: 2 },
    { type: "requested_changes", detail: "Kitchen Design", daysAgo: 2 },
    { type: "viewed_project", daysAgo: 1 },
    { type: "viewed_pricing", daysAgo: 1 },
    { type: "downloaded_document", detail: "Material Specification Booklet", daysAgo: 1 },
  ];
  for (const a of activities) {
    await prisma.projectActivity.create({
      data: { projectId: project.id, type: a.type, detail: a.detail, createdAt: new Date(Date.now() - a.daysAgo * day) },
    });
  }

  console.log(`Seed complete. Client link: /p/${project.token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
