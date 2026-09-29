// Stories: a photo or a short video anybody in the studio shares with
// everybody, for 24 hours. Pure — the database side is chat-story-store.ts —
// so what is shown, in what order, and what the author alone may see are
// pinned by tests/chat-stories.test.ts.

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const STORY_CAPTION_MAX = 500;

export type StoryMediaType = "image" | "video";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const VIDEO_TYPES = ["video/mp4"];

/** When a story posted at this moment stops being shown. */
export function storyExpiry(createdAt: Date) {
  return new Date(createdAt.getTime() + STORY_LIFETIME_MS);
}

/** Whether a story is still up. The moment it expires it is gone. */
export function isStoryLive(expiresAt: Date, now: Date) {
  return expiresAt.getTime() > now.getTime();
}

/** What kind of story a file makes, from its type — or null for a file a story cannot be. */
export function storyMediaType(mimeType: string | null | undefined): StoryMediaType | null {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES.includes(base)) return "image";
  if (VIDEO_TYPES.includes(base)) return "video";
  return null;
}

/** A caption as it is kept: trimmed, cut to length, and nothing at all when empty. */
export function cleanCaption(value: unknown) {
  if (typeof value !== "string") return null;
  const caption = value.trim().slice(0, STORY_CAPTION_MAX);
  return caption || null;
}

/** One story as the database side hands it over. */
export type StoryRow = {
  id: string;
  authorKey: string;
  authorName: string;
  authorAvatar: string;
  mediaUrl: string;
  mediaType: string;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Whether the viewer has seen it. */
  viewedByViewer: boolean;
  /** How many people have seen it, the author not counted. */
  viewCount: number;
};

export type StoryView = {
  id: string;
  mediaUrl: string;
  mediaType: StoryMediaType;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
  viewed: boolean;
  /** The author alone is told how many have seen it; everybody else gets null. */
  viewCount: number | null;
};

export type StoryRing = {
  authorKey: string;
  name: string;
  avatar: string;
  allViewed: boolean;
  stories: StoryView[];
};

/**
 * The stories as the story bar shows them: this viewer's own ring, and
 * everybody else's — the rings with something not yet seen first, then the
 * ones seen already, each part with the most recently posted on top. Inside a
 * ring the stories run oldest first, the order they are watched in. Expired
 * stories are never shown, whatever the database handed over.
 *
 * Your own stories count as seen by you, and only on your own ring is a view
 * count shown.
 */
export function storyRings(rows: StoryRow[], viewerKey: string, now: Date): { mine: StoryRing | null; others: StoryRing[] } {
  const byAuthor = new Map<string, StoryRow[]>();
  for (const row of rows) {
    if (!isStoryLive(row.expiresAt, now)) continue;
    const list = byAuthor.get(row.authorKey) ?? [];
    list.push(row);
    byAuthor.set(row.authorKey, list);
  }

  let mine: StoryRing | null = null;
  const others: { ring: StoryRing; newest: number }[] = [];

  for (const [authorKey, list] of byAuthor) {
    const own = authorKey === viewerKey;
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const latest = sorted[sorted.length - 1];
    const stories: StoryView[] = sorted.map((row) => ({
      id: row.id,
      mediaUrl: row.mediaUrl,
      mediaType: row.mediaType === "video" ? "video" : "image",
      caption: row.caption,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      viewed: own || row.viewedByViewer,
      viewCount: own ? row.viewCount : null,
    }));
    const ring: StoryRing = {
      authorKey,
      // The newest story carries the name and face as they are now.
      name: latest.authorName,
      avatar: latest.authorAvatar,
      allViewed: stories.every((story) => story.viewed),
      stories,
    };
    if (own) mine = ring;
    else others.push({ ring, newest: latest.createdAt.getTime() });
  }

  others.sort((a, b) => {
    if (a.ring.allViewed !== b.ring.allViewed) return a.ring.allViewed ? 1 : -1;
    return b.newest - a.newest;
  });

  return { mine, others: others.map(({ ring }) => ring) };
}
