import { GROUP_AVATAR } from "@/lib/chat-conversations";

// The small rules of the groups the manager makes, pure so tests can read
// them: what a name may be, how a list of people arrives, and a group's face.
// The database side is chat-group-store.ts; who may open a group is mayOpen.

export const GROUP_NAME_MAX = 80;

/** A group's picture: its uploaded photo, else the studio's mark. */
export function groupAvatar(photoUrl: string | null | undefined) {
  return photoUrl || GROUP_AVATAR;
}

/** A name as a group may carry it, or a sentence saying why not. */
export function cleanGroupName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Error("Give the group a name.");
  return name.slice(0, GROUP_NAME_MAX);
}

/**
 * Employee ids from a form or a list: repeated fields, or one field joined
 * with commas (what the phone's multipart upload sends), with the blanks and
 * the repeats taken out.
 */
export function readMemberIds(values: unknown[]): string[] {
  const ids = values.flatMap((value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : []
  );
  return [...new Set(ids)];
}
