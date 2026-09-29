"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSiteVisitor } from "@/lib/admin-guard";
import { notifyAdmin } from "@/lib/admin-notifications";
import { needsReport } from "@/lib/site-visits";
import { sendWhatsApp } from "@/lib/whatsapp";
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

/**
 * Asks the client how the visit went, on WhatsApp.
 *
 * Sent when the person who went says it is finished, not when the manager
 * approves — the manager approves *on* the answer, so the answer has to exist
 * first. The reply arrives in the studio's WhatsApp tab like any other
 * message; there is no review page and nothing for the client to open.
 *
 * It never throws into the caller. A visit that happened must not fail to be
 * recorded because a number was wrong — so what happened to the message is
 * written on the visit instead, and a review nobody asked for never looks the
 * same as one nobody answered.
 */
async function askForReview(visit: {
  id: string;
  title: string;
  clientName: string | null;
  clientPhone: string | null;
  project: { clientName: string; clientPhone: string | null } | null;
}): Promise<{ sentAt: Date | null; note: string }> {
  // The visit's own answer wins; a linked project fills in what it does not
  // have. A first visit often predates the project, which is the whole reason
  // the visit carries its own.
  const name = visit.clientName?.trim() || visit.project?.clientName?.trim() || null;
  const phone = visit.clientPhone?.trim() || visit.project?.clientPhone?.trim() || null;

  if (!phone) return { sentAt: null, note: "No client number on this visit — nobody was asked." };

  // Arabic, because the client is: the studio works in Amman and this is the
  // one message here that a client reads rather than the studio. Everything
  // the team reads — the note below, the screens — stays English, the same
  // split the client portal already makes.
  const greeting = name ? `مرحباً ${name}،` : "مرحباً،";
  const text = [
    greeting,
    "شكراً لاستقبالكم لنا في الموقع اليوم.",
    "كيف كانت الزيارة؟ وهل هناك ما كان بإمكاننا تحسينه؟",
    "يسعدنا أن تشاركنا رأيك بالرد على هذه الرسالة — تصل مباشرة إلى فريق NEON.",
  ].join("\n");

  const result = await sendWhatsApp(phone, text).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : "The message could not be sent.",
  }));

  return result.ok
    ? { sentAt: new Date(), note: `Asked ${name ?? "the client"} on ${phone}.` }
    : { sentAt: null, note: `Could not ask ${name ?? "the client"} on ${phone}: ${result.error}` };
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
    clientName: String(formData.get("clientName") ?? "").trim().slice(0, 200) || null,
    clientPhone: String(formData.get("clientPhone") ?? "").trim().slice(0, 40) || null,
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

  if (state === "PLANNED" || state === "VISITED") {
    // VISITED is the manager's word, reached by approving — never written
    // here, the same way DONE is never written by whoever did the work.
    throw new Error("That is not something to answer a visit with.");
  }
  if (visit.state !== "PLANNED") throw new Error("That visit has already been answered for.");

  const report = String(formData.get("report") ?? "").trim().slice(0, 4000) || null;
  if (needsReport(state) && !report) {
    throw new Error(
      state === "REPORTED" ? "Write what came of the visit." : "Say why the visit did not happen."
    );
  }

  // Finished means finished *according to whoever went*. The client is asked
  // now, so the manager has their answer to approve on.
  let review: { sentAt: Date | null; note: string } | null = null;
  if (state === "REPORTED") {
    const full = await prisma.siteVisit.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        title: true,
        clientName: true,
        clientPhone: true,
        project: { select: { clientName: true, clientPhone: true } },
      },
    });
    review = await askForReview(full);
  }

  await prisma.siteVisit.update({
    where: { id },
    data: {
      state,
      report,
      reportedAt: new Date(),
      ...(review ? { reviewSentAt: review.sentAt, reviewNote: review.note } : {}),
    },
  });

  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title:
      state === "REPORTED"
        ? `${actor.name} finished the visit to ${visit.title} — waiting for you`
        : state === "MISSED"
          ? `${actor.name} did not make the visit to ${visit.title}`
          : `${actor.name} called off the visit to ${visit.title}`,
    message: [report ?? "No note.", review?.note].filter(Boolean).join(" · "),
    url: "/admin/site-visits",
    // Keyed on what it became, so the scheduling alert and this one are two
    // tellings and re-saving the same answer is one.
    dedupeKey: `SITE_VISIT_REPORT:${id}:${state}`,
    employeeId: actor.id,
  }).catch(() => null);

  refresh();
}

/**
 * The manager agreeing a visit is finished.
 *
 * `requireAdmin`, not the visitor's guard: this is the one step that is not
 * theirs, and the whole reason the REPORTED state exists. Nobody approves
 * their own visit, in the same way nobody approves their own finished work.
 */
export async function approveSiteVisit(id: string) {
  await requireAdmin();

  const visit = await prisma.siteVisit.findUnique({ where: { id }, select: { state: true } });
  if (!visit) throw new Error("That visit no longer exists.");
  if (visit.state !== "REPORTED") throw new Error("Only a visit waiting for you can be approved.");

  await prisma.siteVisit.update({
    where: { id },
    data: { state: "VISITED", approvedAt: new Date() },
  });

  refresh();
}

/**
 * Sending it back: the manager is not satisfied, and the visit is open again.
 *
 * It returns to PLANNED rather than to a state of its own, because what it
 * needs is exactly what a planned visit needs — somebody to go, or to say
 * what really happened. The account they wrote is kept: sending work back has
 * never meant deleting what somebody said about it.
 */
export async function reopenSiteVisit(id: string) {
  await requireAdmin();

  const visit = await prisma.siteVisit.findUnique({ where: { id }, select: { state: true } });
  if (!visit) throw new Error("That visit no longer exists.");
  if (visit.state !== "REPORTED") throw new Error("Only a visit waiting for you can be sent back.");

  await prisma.siteVisit.update({
    where: { id },
    data: { state: "PLANNED", reportedAt: null },
  });

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
