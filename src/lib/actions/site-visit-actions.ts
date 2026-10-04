"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSiteVisitor } from "@/lib/admin-guard";
import { notifyAdmin } from "@/lib/admin-notifications";
import { dispatchNotification } from "@/lib/notifications/engine";
import { needsReport, readVisitWhen } from "@/lib/site-visits";
import { syncVisitTaskQuietly } from "@/lib/site-visit-task-store";
import { getTimezone } from "@/lib/settings";
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
  // A visit with a day is also a job on that day (lib/site-visit-task-store.ts),
  // so the person's own day and the manager's week board have changed too.
  revalidatePath("/employee");
  revalidatePath("/admin/tasks");
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

async function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Say what the visit is for.");

  // The website's date box sends a wall clock with no zone, and that is a time
  // in the studio — not on the server, which runs in UTC. This comment used to
  // say the server was set to the studio's zone; it never was, so every visit
  // written on the website was stored three hours late and moved three hours
  // further on each edit. `readVisitWhen` reads it in the studio's zone, and
  // takes the phone app's instants as they are.
  //
  // Empty is allowed and means nobody has picked a day yet: the manager can
  // write a visit down and leave the when to whoever is going. A date that
  // was typed and cannot be read is still refused — that is a mistake, not a
  // decision to leave it open.
  const when = readVisitWhen(String(formData.get("scheduledAt") ?? ""), await getTimezone());
  if (!when.ok) throw new Error("That day and time could not be read.");
  const scheduledAt = when.at;

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

  const input = await readForm(formData);
  const visit = await prisma.siteVisit.create({
    data: { ...input, employeeId: actor.id },
    select: { id: true, title: true, scheduledAt: true },
  });
  await syncVisitTaskQuietly(visit.id);

  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title: `${actor.name} scheduled a site visit`,
    message: visit.scheduledAt
      ? `${visit.title} — ${visit.scheduledAt.toLocaleString("en-GB")}`
      : `${visit.title} — no date set yet`,
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

  await prisma.siteVisit.update({ where: { id }, data: await readForm(formData) });
  // A new day moves its job to that day, and a cleared one takes it off the week.
  await syncVisitTaskQuietly(id);
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
  // Written up: its job is with the manager now. Not made, or called off: it is
  // no longer work to do, and the diary keeps the record.
  await syncVisitTaskQuietly(id);

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
 * The manager writing a visit down for somebody else.
 *
 * The other half of how visits begin: the studio decides a client needs
 * seeing, and whoever is going picks the day — they know their own week and
 * the site. The date is optional here for exactly that reason, and the
 * manager can still set it when they already know it.
 *
 * `requireAdmin`, and the person it is for must actually keep the diary:
 * a visit handed to somebody with no Site visits view is a visit nobody will
 * ever see.
 */
export async function assignSiteVisit(formData: FormData) {
  await requireAdmin();

  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const owner = employeeId
    ? await prisma.employee.findFirst({
        where: { id: employeeId, active: true, canLogSiteVisits: true },
        select: { id: true, name: true },
      })
    : null;
  if (!owner) throw new Error("Choose somebody who keeps the site-visit diary.");

  const input = await readForm(formData);
  const visit = await prisma.siteVisit.create({
    data: { ...input, employeeId: owner.id },
    select: { id: true, title: true, scheduledAt: true },
  });
  await syncVisitTaskQuietly(visit.id);

  await dispatchNotification({
    employeeId: owner.id,
    // Its own type, so it has its own sound — see lib/notifications/types.ts.
    type: "SITE_VISIT",
    title: "A site visit for you",
    message: visit.scheduledAt
      ? `${visit.title} — ${visit.scheduledAt.toLocaleString("en-GB")}`
      : `${visit.title} — set a day for it when you know.`,
    url: "/employee/tasks?view=visits",
    dedupeKey: `SITE_VISIT_ASSIGNED:${visit.id}`,
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
  await syncVisitTaskQuietly(id);

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
  await syncVisitTaskQuietly(id);

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
