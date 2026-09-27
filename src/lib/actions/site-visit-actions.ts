"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSiteVisitor } from "@/lib/admin-guard";
import { notifyAdmin } from "@/lib/admin-notifications";
import { needsReport } from "@/lib/site-visits";
import type { SiteVisitState } from "@/generated/prisma/enums";

// The site-visit diary: writing a visit down, and answering for it after.
//
// Two rules run through all of it.
//
// **A visit is answered by the person who made it.** `requireSiteVisitor`
// says who is acting, and every write re-reads the row and checks the owner —
// an id in a form is not evidence of anything. The manager reads the diary and
// answers for nobody: saying somebody went is not the manager's to say.
//
// **Going and coming back with nothing written is the failure this exists to
// prevent.** "I went" on its own tells the manager less than the plan already
// did, so a report is required with the answer, and not going needs a reason
// for the same reason.

function refresh() {
  revalidatePath("/employee/tasks");
  revalidatePath("/admin/site-visits");
}

function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Say what the visit is for.");

  const when = String(formData.get("scheduledAt") ?? "").trim();
  // datetime-local gives "YYYY-MM-DDTHH:mm", which Date reads in the browser's
  // own zone — here, on the server, that is the container's. The studio runs
  // in one country and the server is set to it, so this stays the plain
  // reading rather than pretending to a precision it does not have.
  const scheduledAt = new Date(when);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error("Pick the day and time.");

  const projectId = String(formData.get("projectId") ?? "").trim() || null;

  return {
    title,
    scheduledAt,
    projectId,
    location: String(formData.get("location") ?? "").trim().slice(0, 300) || null,
    purpose: String(formData.get("purpose") ?? "").trim().slice(0, 2000) || null,
  };
}

/** Writes a visit down before it happens. */
export async function scheduleSiteVisit(formData: FormData) {
  const actor = await requireSiteVisitor();
  if (actor.type !== "EMPLOYEE") throw new Error("Visits are scheduled by whoever is going.");

  const input = readForm(formData);
  const visit = await prisma.siteVisit.create({
    data: { ...input, employeeId: actor.id },
    select: { id: true, title: true, scheduledAt: true },
  });

  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title: `${actor.name} scheduled a site visit`,
    message: `${visit.title} — ${visit.scheduledAt.toLocaleString("en-GB")}`,
    url: "/admin/site-visits",
    dedupeKey: `SITE_VISIT:${visit.id}`,
    employeeId: actor.id,
  }).catch(() => null);

  refresh();
}

/** Changes a visit that has not been answered for yet. */
export async function updateSiteVisit(id: string, formData: FormData) {
  const actor = await requireSiteVisitor();
  if (actor.type !== "EMPLOYEE") throw new Error("A visit is changed by whoever is going.");
  const visit = await mine(actor.id, id);

  if (visit.state !== "PLANNED") {
    throw new Error("That visit has already been answered for.");
  }

  await prisma.siteVisit.update({ where: { id }, data: readForm(formData) });
  refresh();
}

/**
 * Says what happened: went, did not go, or called off.
 *
 * The report is the point. A visit marked as made with nothing written is a
 * tick where an account should be, so it is refused — the one thing this
 * screen exists to collect is the only thing it insists on.
 */
export async function reportSiteVisit(id: string, state: SiteVisitState, formData: FormData) {
  const actor = await requireSiteVisitor();
  if (actor.type !== "EMPLOYEE") throw new Error("A visit is answered for by whoever went.");
  const visit = await mine(actor.id, id);

  if (state === "PLANNED") throw new Error("A visit cannot go back to being planned.");
  if (visit.state !== "PLANNED") throw new Error("That visit has already been answered for.");

  const report = String(formData.get("report") ?? "").trim().slice(0, 4000) || null;
  if (needsReport(state) && !report) {
    throw new Error(
      state === "VISITED" ? "Write what came of the visit." : "Say why the visit did not happen."
    );
  }

  await prisma.siteVisit.update({
    where: { id },
    data: { state, report, reportedAt: new Date() },
  });

  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title:
      state === "VISITED"
        ? `${actor.name} visited ${visit.title}`
        : state === "MISSED"
          ? `${actor.name} did not make the visit to ${visit.title}`
          : `${actor.name} called off the visit to ${visit.title}`,
    message: report ?? "No note.",
    url: "/admin/site-visits",
    // Keyed on what it became, so the scheduling alert and this one are two
    // tellings and re-saving the same answer is one.
    dedupeKey: `SITE_VISIT_REPORT:${id}:${state}`,
    employeeId: actor.id,
  }).catch(() => null);

  refresh();
}

/** Removes a visit written down by mistake. Only before it is answered for. */
export async function deleteSiteVisit(id: string) {
  const actor = await requireSiteVisitor();
  if (actor.type !== "EMPLOYEE") throw new Error("A visit is removed by whoever wrote it down.");
  const visit = await mine(actor.id, id);

  if (visit.state !== "PLANNED") {
    throw new Error("A visit that has been answered for is part of the record.");
  }

  await prisma.siteVisit.delete({ where: { id } });
  refresh();
}

/**
 * The visit, if it is this person's to change.
 *
 * The manager can read every visit and change none of them: an account of a
 * visit is worth exactly as much as the fact that the person who went wrote
 * it. Scoped in the `where` rather than checked afterwards, so somebody else's
 * id is not found rather than refused — nothing here can be used to discover
 * what other visits exist.
 */
async function mine(employeeId: string, id: string) {
  const visit = await prisma.siteVisit.findFirst({
    where: { id, employeeId },
    select: { id: true, state: true, title: true },
  });
  if (!visit) throw new Error("That visit no longer exists.");
  return visit;
}
