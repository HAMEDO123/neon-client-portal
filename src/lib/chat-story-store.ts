import { prisma } from "@/lib/db";
import { avatarUrl } from "@/lib/avatar";
import { facesFor } from "@/lib/faces";
import { deleteFile, saveFile } from "@/lib/storage";
import { memberKeyFor } from "@/lib/presence-store";
import type { ChatViewer } from "@/lib/chat-conversations";
import { cleanCaption, storyExpiry, storyMediaType, storyRings, type StoryRow } from "@/lib/chat-stories";

// Stories in the database: posting one, who has seen it, taking it down, and
// the story bar's read. The rules — what is shown, in what order, for how long
// — are chat-stories.ts.
//
// Everybody signed in (the manager, or somebody on the team) may post, and
// everybody sees everybody's stories while they last. Keyed like ChatPresence:
// "admin" for the manager, the employee id otherwise.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have resolved the viewer.

const MANAGER_AVATAR = avatarUrl("Manager", "ink");

/**
 * Somebody's face, from their key: their photo where they have one, else the
 * manager's mark or an employee's initials on their colour.
 *
 * The photos come from `lib/faces.ts`, which is the one place that knows
 * "admin" means the manager's own row; the names and colours still need this
 * read of their own, because a story bar prints them.
 */
async function storyFaces(keys: string[]) {
  const ids = [...new Set(keys.filter((key) => key !== "admin"))];
  const people = ids.length
    ? await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true } })
    : [];
  const photos = await facesFor(keys);
  const map = new Map(
    people.map((person) => [
      person.id,
      { name: person.name, avatar: photos[person.id] ?? avatarUrl(person.name, person.color) },
    ])
  );
  return (key: string, fallbackName: string) =>
    key === "admin"
      ? { name: "Manager", avatar: photos.admin ?? MANAGER_AVATAR }
      : (map.get(key) ?? { name: fallbackName, avatar: avatarUrl(fallbackName) });
}

/** The story bar: this viewer's ring and everybody else's, as storyRings orders them. */
export async function storiesFor(viewer: ChatViewer, now = new Date()) {
  const me = memberKeyFor(viewer);
  const rows = await prisma.chatStory.findMany({
    where: {
      expiresAt: { gt: now },
      // Somebody who has left the studio takes their stories with them.
      OR: [{ authorKey: "admin" }, { author: { active: true } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorKey: true,
      authorName: true,
      mediaUrl: true,
      mediaType: true,
      caption: true,
      createdAt: true,
      expiresAt: true,
      views: { where: { viewerKey: me }, select: { id: true } },
      _count: { select: { views: true } },
    },
  });

  const face = await storyFaces(rows.map((row) => row.authorKey));
  const prepared: StoryRow[] = rows.map((row) => {
    const who = face(row.authorKey, row.authorName);
    return {
      id: row.id,
      authorKey: row.authorKey,
      authorName: who.name,
      authorAvatar: who.avatar,
      mediaUrl: row.mediaUrl,
      mediaType: row.mediaType,
      caption: row.caption,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      viewedByViewer: row.views.length > 0,
      viewCount: row._count.views,
    };
  });

  return storyRings(prepared, me, now);
}

/** Posts a story from a file. Refuses, with a sentence, anything that is not a photo or an MP4. */
export async function postStory(viewer: ChatViewer, media: unknown, caption: unknown) {
  if (!(media instanceof File) || media.size === 0) throw new Error("Choose a photo or a video for the story.");
  const mediaType = storyMediaType(media.type);
  if (!mediaType) throw new Error("A story can be a photo (JPEG, PNG, WebP, GIF, AVIF) or an MP4 video.");

  // A video goes through the document rule, which is the one that takes MP4 (up to 50MB).
  const saved = await saveFile(media, "chat/stories", mediaType === "image" ? "image" : "document");

  const createdAt = new Date();
  const story = await prisma.chatStory.create({
    data: {
      authorKey: memberKeyFor(viewer),
      authorName: viewer.name,
      authorId: viewer.type === "EMPLOYEE" ? viewer.id : null,
      mediaUrl: saved.url,
      mediaType,
      caption: cleanCaption(caption),
      createdAt,
      expiresAt: storyExpiry(createdAt),
    },
    select: { id: true },
  });

  // Tidying runs on its own: expired stories are never shown anyway, and a
  // failure here must not cost the one just posted.
  void purgeExpiredStories(createdAt).catch(() => undefined);

  return { id: story.id };
}

/** Removes stories that have expired, with their files. Nothing reads them once they have. */
export async function purgeExpiredStories(now = new Date()) {
  const expired = await prisma.chatStory.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, mediaUrl: true },
    take: 100,
  });
  if (expired.length === 0) return 0;
  await prisma.chatStory.deleteMany({ where: { id: { in: expired.map((story) => story.id) } } });
  for (const story of expired) await deleteFile(story.mediaUrl);
  return expired.length;
}

/** A live story's author, or null when there is no such story or it has expired. */
export async function liveStoryAuthor(storyId: string, now = new Date()) {
  const story = await prisma.chatStory.findFirst({
    where: { id: storyId, expiresAt: { gt: now } },
    select: { authorKey: true },
  });
  return story?.authorKey ?? null;
}

/** Records that this viewer has seen a story. Seeing it twice is seeing it once; the author's own look is not a view. */
export async function markStoryViewed(viewer: ChatViewer, storyId: string) {
  const me = memberKeyFor(viewer);
  await prisma.chatStoryView.upsert({
    where: { storyId_viewerKey: { storyId, viewerKey: me } },
    create: { storyId, viewerKey: me, viewerName: viewer.name },
    update: {},
  });
}

/** Takes a story down, with its file. The caller has checked it is the author's. */
export async function removeStory(storyId: string) {
  const story = await prisma.chatStory.findUnique({ where: { id: storyId }, select: { mediaUrl: true } });
  if (!story) return;
  await prisma.chatStory.delete({ where: { id: storyId } });
  await deleteFile(story.mediaUrl);
}

/** Who has seen a story, the most recent first. The caller has checked it is the author asking. */
export async function storyViewers(storyId: string) {
  const views = await prisma.chatStoryView.findMany({
    where: { storyId },
    orderBy: { viewedAt: "desc" },
    select: { viewerKey: true, viewerName: true, viewedAt: true },
  });
  const face = await storyFaces(views.map((view) => view.viewerKey));
  return views.map((view) => {
    const who = face(view.viewerKey, view.viewerName);
    return { key: view.viewerKey, name: who.name, avatar: who.avatar, viewedAt: view.viewedAt };
  });
}

/** Any story's author, live or not — for refusing somebody else's delete with the right answer. */
export async function storyAuthor(storyId: string) {
  const story = await prisma.chatStory.findUnique({ where: { id: storyId }, select: { authorKey: true } });
  return story?.authorKey ?? null;
}
