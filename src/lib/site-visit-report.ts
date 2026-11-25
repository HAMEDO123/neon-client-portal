import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/admin-notifications";
import { saveFile } from "@/lib/storage";
import { syncVisitTaskQuietly } from "@/lib/site-visit-task-store";
import { sendWhatsApp } from "@/lib/whatsapp";
import { MAX_PROOF_FILES } from "@/lib/attachments";

// Writing a site visit up — the one way a visit is finished by whoever went,
// from wherever they finish it.
//
// Two doors lead here. The Site visits screen (`reportSiteVisit`), with a
// report typed into a box; and, from 2026-11-25, **photos sent from the visit's
// own job** (`submitProof` → `proofAsVisitReport`). The phone app offers its
// camera on every job, a visit's included, and the server used to turn those
// photos away with "This is a site visit … not here" — so Wael sent proof of
// three visits in a morning and every one came back as an error. Now the photos
// are the write-up: the visit is finished according to him, the client is
// asked, the manager is told, and the photos stay on the visit for the manager
// to see. Still one record of the visit, which is why the refusal existed.
//
// Not "use server": nothing here checks who is asking. Both callers have.

/**
 * Ask the client how the visit went, on WhatsApp, as the report goes in.
 * Returns what came of the asking, in words for the manager.
 */
export async function askForReview(visit: {
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

/**
 * The visit answered for: finished (REPORTED, waiting for the manager), not
 * made (MISSED), or called off (CANCELLED). The caller has checked who is
 * asking, that the visit is theirs and still PLANNED, and that there are words
 * where words are needed.
 */
export async function writeVisitReport(
  actor: { id: string; name: string },
  visit: { id: string; title: string },
  state: "REPORTED" | "MISSED" | "CANCELLED",
  report: string | null,
  photoUrls: string[] = []
) {
  // Finished means finished *according to whoever went*. The client is asked
  // now, so the manager has their answer to approve on.
  let review: { sentAt: Date | null; note: string } | null = null;
  if (state === "REPORTED") {
    const full = await prisma.siteVisit.findUniqueOrThrow({
      where: { id: visit.id },
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
    where: { id: visit.id },
    data: {
      state,
      report,
      reportedAt: new Date(),
      ...(photoUrls.length > 0 ? { photoUrls } : {}),
      ...(review ? { reviewSentAt: review.sentAt, reviewNote: review.note } : {}),
    },
  });
  // Written up: its job is with the manager now. Not made, or called off: it is
  // no longer work to do, and the diary keeps the record.
  await syncVisitTaskQuietly(visit.id);

  const photos = photoUrls.length > 0 ? `${photoUrls.length} photo${photoUrls.length === 1 ? "" : "s"}` : null;
  await notifyAdmin({
    type: "TASK_STATUS_CHANGED",
    title:
      state === "REPORTED"
        ? `${actor.name} finished the visit to ${visit.title} — waiting for you`
        : state === "MISSED"
          ? `${actor.name} did not make the visit to ${visit.title}`
          : `${actor.name} called off the visit to ${visit.title}`,
    message: [report ?? "No note.", photos, review?.note].filter(Boolean).join(" · "),
    url: "/admin/site-visits",
    // Keyed on what it became, so the scheduling alert and this one are two
    // tellings and re-saving the same answer is one.
    dedupeKey: `SITE_VISIT_REPORT:${visit.id}:${state}`,
    employeeId: actor.id,
  }).catch(() => null);
}

/** What the report says when the photos came with no words. */
export function photoReport(note: string | null, photoCount: number) {
  const words = note?.trim().slice(0, 4000);
  if (words) return words;
  return `Sent ${photoCount} photo${photoCount === 1 ? "" : "s"} from the visit.`;
}

/**
 * Photos sent from a visit's job, taken as the visit's write-up. Answers the
 * way `submitProof` does — a sentence, never a throw — because the phone shows
 * whatever comes back.
 */
export async function proofAsVisitReport(
  employee: { id: string; name: string },
  visitId: string,
  photos: File[],
  note: string | null
): Promise<{ ok: true; submissionId: string } | { ok: false; error: string }> {
  const visit = await prisma.siteVisit.findUnique({
    where: { id: visitId },
    select: { id: true, title: true, employeeId: true, state: true },
  });
  if (!visit || visit.employeeId !== employee.id) return { ok: false, error: "That visit is not yours to write up." };
  if (visit.state !== "PLANNED") return { ok: false, error: "This visit has already been written up." };
  if (photos.length === 0 && !note?.trim()) {
    return { ok: false, error: "Add a photo from the visit, or write what came of it." };
  }
  if (photos.length > MAX_PROOF_FILES) {
    return { ok: false, error: `Up to ${MAX_PROOF_FILES} files can be sent together.` };
  }

  const urls: string[] = [];
  try {
    for (const photo of photos) {
      const kind = photo.type.startsWith("image/") ? "image" : "document";
      urls.push((await saveFile(photo, `site-visits/${visit.id}`, kind)).url);
    }
  } catch (cause) {
    console.error("[site-visit] photos could not be stored", visit.id, cause);
    return { ok: false, error: "The photos could not be uploaded. Try again." };
  }

  await writeVisitReport(employee, visit, "REPORTED", photoReport(note, urls.length), urls);
  return { ok: true, submissionId: visit.id };
}
