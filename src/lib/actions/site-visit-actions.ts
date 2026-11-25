"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSiteVisitor } from "@/lib/admin-guard";
import { notifyAdmin } from "@/lib/admin-notifications";
import { dispatchNotification } from "@/lib/notifications/engine";
import { answering, Refusal, type Answer } from "@/lib/refusal";
import { needsReport, readVisitWhen } from "@/lib/site-visits";
import { syncVisitTaskQuietly } from "@/lib/site-visit-task-store";
import { writeVisitReport } from "@/lib/site-visit-report";
import { getTimezone } from "@/lib/settings";
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
//
// **Every action here answers with its refusal instead of throwing it**
// (lib/refusal.ts). They threw, and in production a thrown sentence never
// reaches the page: somebody ending a visit was shown "Minified React error
// #441" where "Write what came of the visit." was meant. So each export wraps
// its work in `answering`, each sentence for a person is a `Refusal`, and
// anything else that goes wrong is still a fault and still thrown. The phone
// API turns the answer back into the `{ error }` it always sent (`heard`, in
// lib/mobile/rpc.ts), so the app notices no change.

function refresh() {
  revalidatePath("/employee/tasks");
  revalidatePath("/admin/site-visits");
  // A visit with a day is also a job on that day (lib/site-visit-task-store.ts),
  // so the person's own day and the manager's week board have changed too.
  revalidatePath("/employee");
  revalidatePath("/admin/tasks");
}

async function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new Refusal("Say what the visit is for.");

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
  if (!when.ok) throw new Refusal("That day and time could not be read.");
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
export async function scheduleSiteVisit(formData: FormData): Promise<Answer> {
  return answering(async () => {
    const actor = await requireSiteVisitor();
    if (actor.type !== "EMPLOYEE") throw new Refusal("Visits are scheduled by whoever is going.");

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
  });
}

/** Changes a visit that has not been answered for yet. */
export async function updateSiteVisit(id: string, formData: FormData): Promise<Answer> {
  return answering(async () => {
    const actor = await requireSiteVisitor();
    if (actor.type !== "EMPLOYEE") throw new Refusal("A visit is changed by whoever is going.");
    const visit = await mine(actor.id, id);

    if (visit.state !== "PLANNED") {
      throw new Refusal("That visit has already been answered for.");
    }

    await prisma.siteVisit.update({ where: { id }, data: await readForm(formData) });
    // A new day moves its job to that day, and a cleared one takes it off the week.
    await syncVisitTaskQuietly(id);
    refresh();
  });
}

/**
 * Says what happened: went, did not go, or called off.
 *
 * The report is the point. A visit marked as made with nothing written is a
 * tick where an account should be, so it is refused — the one thing this
 * screen exists to collect is the only thing it insists on.
 */
export async function reportSiteVisit(id: string, state: SiteVisitState, formData: FormData): Promise<Answer> {
  return answering(async () => {
    const actor = await requireSiteVisitor();
    if (actor.type !== "EMPLOYEE") throw new Refusal("A visit is answered for by whoever went.");
    const visit = await mine(actor.id, id);

    if (state === "PLANNED" || state === "VISITED") {
      // VISITED is the manager's word, reached by approving — never written
      // here, the same way DONE is never written by whoever did the work.
      throw new Refusal("That is not something to answer a visit with.");
    }
    if (visit.state !== "PLANNED") throw new Refusal("That visit has already been answered for.");

    const report = String(formData.get("report") ?? "").trim().slice(0, 4000) || null;
    if (needsReport(state) && !report) {
      throw new Refusal(
        state === "REPORTED" ? "Write what came of the visit." : "Say why the visit did not happen."
      );
    }

    await writeVisitReport(actor, visit, state as "REPORTED" | "MISSED" | "CANCELLED", report);

    refresh();
  });
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
export async function assignSiteVisit(formData: FormData): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

    const employeeId = String(formData.get("employeeId") ?? "").trim();
    const owner = employeeId
      ? await prisma.employee.findFirst({
          where: { id: employeeId, active: true, canLogSiteVisits: true },
          select: { id: true, name: true },
        })
      : null;
    if (!owner) throw new Refusal("Choose somebody who keeps the site-visit diary.");

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
  });
}

/**
 * The manager agreeing a visit is finished.
 *
 * `requireAdmin`, not the visitor's guard: this is the one step that is not
 * theirs, and the whole reason the REPORTED state exists. Nobody approves
 * their own visit, in the same way nobody approves their own finished work.
 */
export async function approveSiteVisit(id: string): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

    const visit = await prisma.siteVisit.findUnique({ where: { id }, select: { state: true } });
    if (!visit) throw new Refusal("That visit no longer exists.");
    if (visit.state !== "REPORTED") throw new Refusal("Only a visit waiting for you can be approved.");

    await prisma.siteVisit.update({
      where: { id },
      data: { state: "VISITED", approvedAt: new Date() },
    });
    await syncVisitTaskQuietly(id);

    refresh();
  });
}

/**
 * Sending it back: the manager is not satisfied, and the visit is open again.
 *
 * It returns to PLANNED rather than to a state of its own, because what it
 * needs is exactly what a planned visit needs — somebody to go, or to say
 * what really happened. The account they wrote is kept: sending work back has
 * never meant deleting what somebody said about it.
 */
export async function reopenSiteVisit(id: string): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

    const visit = await prisma.siteVisit.findUnique({ where: { id }, select: { state: true } });
    if (!visit) throw new Refusal("That visit no longer exists.");
    if (visit.state !== "REPORTED") throw new Refusal("Only a visit waiting for you can be sent back.");

    await prisma.siteVisit.update({
      where: { id },
      data: { state: "PLANNED", reportedAt: null },
    });
    await syncVisitTaskQuietly(id);

    refresh();
  });
}

/** Removes a visit written down by mistake. Only before it is answered for. */
export async function deleteSiteVisit(id: string): Promise<Answer> {
  return answering(async () => {
    const actor = await requireSiteVisitor();
    if (actor.type !== "EMPLOYEE") throw new Refusal("A visit is removed by whoever wrote it down.");
    const visit = await mine(actor.id, id);

    if (visit.state !== "PLANNED") {
      throw new Refusal("A visit that has been answered for is part of the record.");
    }

    await prisma.siteVisit.delete({ where: { id } });
    refresh();
  });
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
  if (!visit) throw new Refusal("That visit no longer exists.");
  return visit;
}
