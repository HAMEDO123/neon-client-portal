import { NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/db";
import { generateProjectToken } from "@/lib/tokens";

function optionalString(value: unknown): string | null {
  const str = typeof value === "string" ? value.trim() : "";
  return str || null;
}

// Employee creates a project from the app — same fields as the web admin form.
export async function POST(request: Request) {
  if (!requireMobileAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }

  let deliveryDate: Date | null = null;
  if (typeof body.deliveryDate === "string" && body.deliveryDate) {
    const parsed = new Date(body.deliveryDate);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid deliveryDate." }, { status: 400 });
    }
    deliveryDate = parsed;
  }

  const project = await prisma.project.create({
    data: {
      name,
      token: generateProjectToken(name),
      clientName: typeof body.clientName === "string" ? body.clientName.trim() : "",
      clientEmail: optionalString(body.clientEmail),
      clientPhone: optionalString(body.clientPhone),
      location: optionalString(body.location),
      area: optionalString(body.area),
      projectType: optionalString(body.projectType),
      description: optionalString(body.description),
      deliveryDate,
    },
  });

  return NextResponse.json({
    id: project.id,
    name: project.name,
    token: project.token,
    clientName: project.clientName,
    location: project.location,
    publishState: project.publishState,
    pipelineStatus: project.pipelineStatus,
    coverImageUrl: project.coverImageUrl,
    updatedAt: project.updatedAt,
    approvalsCount: 0,
    commentsCount: 0,
  });
}
