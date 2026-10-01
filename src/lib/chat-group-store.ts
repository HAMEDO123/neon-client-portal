import { prisma } from "@/lib/db";
import { avatarUrl } from "@/lib/avatar";
import { facesFor } from "@/lib/faces";
import { deleteFile, saveFile } from "@/lib/storage";
import { cleanGroupName, groupAvatar } from "@/lib/chat-groups";
import {
  groupChannelKey,
  groupIdFromSlug,
  groupSlug,
  mayOpen,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat-conversations";

// The groups the manager makes, in the database: making one, renaming it,
// changing its photo and its people, deleting it, and the question every door
// in the chat asks of a group — is this person in it?
//
// A group's messages live in an ordinary ChatChannel keyed "grp:<id>", so
// messages, reads, tasks, meetings, reactions and calls work in a group exactly
// as they do anywhere else. The rule itself (the manager is in every group; an
// employee only in the ones they are a member of) is mayOpen, which is pure;
// this reads the members it needs.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have resolved the viewer.

/** The ids of the people in a group, or null when there is no such group. */
export async function groupMemberIds(groupId: string): Promise<string[] | null> {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    select: { members: { select: { employeeId: true } } },
  });
  return group ? group.members.map((member) => member.employeeId) : null;
}

/** Each group's member ids, for a list that asks mayOpen about many cards at once. */
export async function groupMemberMap(groupIds: string[]) {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) return new Map<string, string[]>();
  const rows = await prisma.chatGroupMember.findMany({
    where: { groupId: { in: unique } },
    select: { groupId: true, employeeId: true },
  });
  const map = new Map<string, string[]>(unique.map((id) => [id, []]));
  for (const row of rows) map.get(row.groupId)?.push(row.employeeId);
  return map;
}

/**
 * mayOpen, with a group's members read for it. Everything that reaches a
 * conversation through something inside it — a message, a card, a call —
 * asks this rather than mayOpen alone, so a group is closed to an employee
 * the moment they are taken out of it.
 */
export async function mayOpenNow(viewer: ChatViewer, conversation: Conversation) {
  if (conversation.kind !== "group") return mayOpen(viewer, conversation);
  if (viewer.type === "ADMIN") return (await groupMemberIds(conversation.groupId)) !== null;
  return mayOpen(viewer, conversation, await groupMemberIds(conversation.groupId));
}

/**
 * A group's channel, for somebody mayOpen lets in — made alongside the group,
 * and made here too if it is somehow missing, so a group always opens.
 */
export async function getGroupChannel(viewer: ChatViewer, groupId: string) {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    select: { name: true, members: { select: { employeeId: true } } },
  });
  if (!group) return null;
  const conversation: Conversation = { kind: "group", groupId };
  if (!mayOpen(viewer, conversation, group.members.map((member) => member.employeeId))) return null;

  const key = groupChannelKey(groupId);
  const existing = await prisma.chatChannel.findUnique({ where: { key } });
  if (existing) return existing;
  try {
    return await prisma.chatChannel.create({ data: { key, name: group.name } });
  } catch {
    return prisma.chatChannel.findUnique({ where: { key } });
  }
}

/** The groups this viewer is in — every group, for the manager — for the conversation list. */
export async function groupsFor(viewer: ChatViewer) {
  const groups = await prisma.chatGroup.findMany({
    where: viewer.type === "ADMIN" ? {} : { members: { some: { employeeId: viewer.id } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      photoUrl: true,
      members: { where: { employee: { active: true } }, select: { employeeId: true } },
    },
  });
  // The manager is in every group without a row of their own, so they are counted here.
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    avatar: groupAvatar(group.photoUrl),
    memberCount: group.members.length + 1,
  }));
}

/** The names of the people in a group, in the team's order, for a conversation's header. */
export async function groupMemberNames(groupId: string) {
  const members = await prisma.chatGroupMember.findMany({
    where: { groupId, employee: { active: true } },
    orderBy: { employee: { order: "asc" } },
    select: { employee: { select: { name: true } } },
  });
  return members.map((member) => member.employee.name);
}

/** The people a group in this conversation holds, for tasks, meetings and calls: its active members. */
export async function groupEmployees(groupId: string) {
  const members = await prisma.chatGroupMember.findMany({
    where: { groupId, employee: { active: true, accessRole: "EMPLOYEE" } },
    orderBy: { employee: { order: "asc" } },
    select: { employee: { select: { id: true, name: true, color: true, photoUrl: true } } },
  });
  return members.map((member) => member.employee);
}

// --- Managing groups (the manager only; the callers check) ------------------
// The name and member-list rules are chat-groups.ts.

/** Checks that every id is somebody on the team, and says so plainly when one is not. */
async function requireTeamMembers(ids: string[]) {
  if (ids.length === 0) return [];
  const people = await prisma.employee.findMany({
    where: { id: { in: ids }, active: true, accessRole: "EMPLOYEE" },
    select: { id: true },
  });
  if (people.length !== ids.length) throw new Error("Some of those people are not on the team.");
  return ids;
}

async function savePhoto(photo: unknown) {
  if (!(photo instanceof File) || photo.size === 0) return null;
  const saved = await saveFile(photo, "chat/groups", "image");
  return saved.url;
}

export async function createGroup(input: { name: unknown; memberIds: string[]; photo: unknown }) {
  const name = cleanGroupName(input.name);
  const memberIds = await requireTeamMembers(input.memberIds);
  if (memberIds.length === 0) throw new Error("Choose at least one person for the group.");
  const photoUrl = await savePhoto(input.photo);

  const group = await prisma.$transaction(async (tx) => {
    const made = await tx.chatGroup.create({
      data: { name, photoUrl, members: { create: memberIds.map((employeeId) => ({ employeeId })) } },
      select: { id: true },
    });
    await tx.chatChannel.create({ data: { key: groupChannelKey(made.id), name } });
    return made;
  });

  return { slug: groupSlug(group.id), groupId: group.id };
}

async function requireGroup(groupId: string) {
  const group = await prisma.chatGroup.findUnique({ where: { id: groupId }, select: { id: true, photoUrl: true } });
  if (!group) throw new Error("That group no longer exists.");
  return group;
}

/** Renames a group and changes its photo — either, both, or neither. */
export async function updateGroup(groupId: string, input: { name?: unknown; photo?: unknown }) {
  const group = await requireGroup(groupId);
  const name = input.name === undefined || input.name === null || input.name === "" ? null : cleanGroupName(input.name);
  const photoUrl = await savePhoto(input.photo);

  await prisma.$transaction(async (tx) => {
    await tx.chatGroup.update({
      where: { id: groupId },
      data: { ...(name ? { name } : {}), ...(photoUrl ? { photoUrl } : {}) },
    });
    // The channel carries the name too: the Tasks and Meetings lists and the
    // call screen read it from there.
    if (name) await tx.chatChannel.updateMany({ where: { key: groupChannelKey(groupId) }, data: { name } });
  });

  if (photoUrl && group.photoUrl) await deleteFile(group.photoUrl);
  return { ok: true as const };
}

/** Adds and takes people out of a group. Somebody both added and removed is removed. */
export async function changeGroupMembers(groupId: string, input: { add: string[]; remove: string[] }) {
  await requireGroup(groupId);
  const remove = new Set(input.remove);
  const add = await requireTeamMembers(input.add.filter((id) => !remove.has(id)));

  await prisma.$transaction(async (tx) => {
    if (remove.size > 0) {
      await tx.chatGroupMember.deleteMany({ where: { groupId, employeeId: { in: [...remove] } } });
    }
    if (add.length > 0) {
      await tx.chatGroupMember.createMany({
        data: add.map((employeeId) => ({ groupId, employeeId })),
        skipDuplicates: true,
      });
    }
  });
  return { ok: true as const };
}

/** Deletes a group with its conversation: every message, card and call in it. */
export async function deleteGroup(groupId: string) {
  const group = await requireGroup(groupId);
  await prisma.$transaction(async (tx) => {
    await tx.chatChannel.deleteMany({ where: { key: groupChannelKey(groupId) } });
    await tx.chatGroup.delete({ where: { id: groupId } });
  });
  if (group.photoUrl) await deleteFile(group.photoUrl);
  return { ok: true as const };
}

/** One group as its info screen shows it, for somebody in it; null for anybody else. */
export async function groupDetail(viewer: ChatViewer, slug: string) {
  const groupId = groupIdFromSlug(slug);
  if (!groupId) return null;

  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      photoUrl: true,
      createdAt: true,
      members: {
        orderBy: { employee: { order: "asc" } },
        select: { employee: { select: { id: true, name: true, color: true, active: true, photoUrl: true } } },
      },
    },
  });
  if (!group) return null;
  const memberIds = group.members.map((member) => member.employee.id);
  if (!mayOpen(viewer, { kind: "group", groupId }, memberIds)) return null;

  return {
    id: group.id,
    name: group.name,
    avatar: groupAvatar(group.photoUrl),
    createdAt: group.createdAt,
    members: group.members
      .filter((member) => member.employee.active)
      .map(({ employee }) => ({
        id: employee.id,
        name: employee.name,
        color: employee.color,
        avatar: employee.photoUrl ?? avatarUrl(employee.name, employee.color),
      })),
    canManage: viewer.type === "ADMIN",
  };
}

/**
 * Who a group can include, or whom a new private chat can be with. For the
 * manager, everybody on the team; for an employee, their colleagues and the
 * manager (named "manager", the way a URL names that chat).
 */
export async function chatPeople(viewer: ChatViewer) {
  const people = await prisma.employee.findMany({
    where: {
      active: true,
      accessRole: "EMPLOYEE",
      ...(viewer.type === "EMPLOYEE" ? { NOT: { id: viewer.id } } : {}),
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true, role: true, color: true, photoUrl: true },
  });
  const team = people.map((person) => ({
    ...person,
    avatar: person.photoUrl ?? avatarUrl(person.name, person.color),
  }));
  if (viewer.type === "ADMIN") return team;

  const faces = await facesFor(["admin"]);
  return [
    {
      id: "manager",
      name: "Manager",
      role: null,
      color: "ink",
      photoUrl: faces.admin ?? null,
      avatar: faces.admin ?? avatarUrl("Manager", "ink"),
    },
    ...team,
  ];
}
