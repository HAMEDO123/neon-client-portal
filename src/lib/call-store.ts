import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ChatViewer } from "@/lib/chat";
import {
  adminChatUrl,
  conversationFromKey,
  conversationSlug,
  employeeChatUrl,
  mayOpen,
  type Conversation,
} from "@/lib/chat-conversations";
import {
  RING_MS,
  STALE_MS,
  callSummary,
  memberKeyOf,
  sweepCall,
  type CallKind,
  type EndReason,
} from "@/lib/calls";
import { dispatchNotification } from "@/lib/notifications/engine";
import { MANAGER_MEMBER_KEY, notifiableEmployeeId } from "@/lib/manager-account";
import { avatarUrl } from "@/lib/avatar";

// Calls in the database: starting one and ringing the people in the
// conversation, answering, declining, leaving, noticing who has gone quiet,
// finishing a call and leaving its line in the chat, and passing the devices'
// connection messages between them. The rules are calls.ts; who is asking is
// checked by the route handlers under api/calls before anything here runs.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller.

/** A reason a person can read: shown on the call screen as it is. */
export class CallError extends Error {}

type Member = { key: string; name: string; color: string };

/** Everybody a call in this conversation is for, with how to draw them. */
export async function callMembers(conversation: Conversation): Promise<Member[]> {
  const manager: Member = { key: "admin", name: "Manager", color: "ink" };
  const select = { id: true, name: true, color: true } as const;

  if (conversation.kind === "team") {
    const team = await prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: { order: "asc" },
      select,
    });
    return [manager, ...team.map((person) => ({ key: person.id, name: person.name, color: person.color }))];
  }

  const ids = conversation.kind === "direct" ? [conversation.employeeId] : conversation.employeeIds;
  const people = await prisma.employee.findMany({
    where: { id: { in: ids }, active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select,
  });
  const members = people.map((person) => ({ key: person.id, name: person.name, color: person.color }));
  return conversation.kind === "direct" ? [manager, ...members] : members;
}

async function colourOf(viewer: ChatViewer) {
  if (viewer.type === "ADMIN") return "ink";
  const row = await prisma.employee.findUnique({ where: { id: viewer.id }, select: { color: true } });
  return row?.color ?? "ink";
}

/**
 * Starts a call, or joins the one already ringing or running in this
 * conversation — so two people calling each other at the same moment end up in
 * one call rather than two. Anybody starting a call leaves any other call they
 * were in first: one call at a time.
 */
export async function startCall(viewer: ChatViewer, conversation: Conversation, channelId: string, kind: CallKind) {
  const me = memberKeyOf(viewer);

  const ongoing = await prisma.call.findFirst({
    where: { channelId, status: { not: "ENDED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (ongoing) {
    await sweep(ongoing.id);
    const still = await prisma.call.findFirst({ where: { id: ongoing.id, status: { not: "ENDED" } }, select: { id: true } });
    if (still) {
      await joinCall(viewer, still.id);
      return { callId: still.id, joinedExisting: true };
    }
  }

  const members = await callMembers(conversation);
  if (!members.some((member) => member.key === me)) throw new CallError("You are not in this conversation.");
  const others = members.filter((member) => member.key !== me);
  if (others.length === 0) throw new CallError("There is nobody here to call.");

  await leaveOtherCalls(me, null);

  const at = new Date();
  const call = await prisma.call.create({
    data: {
      channelId,
      kind,
      startedByKey: me,
      startedByName: viewer.name,
      participants: {
        create: members.map((member) =>
          member.key === me
            ? { memberKey: member.key, name: member.name, color: member.color, state: "JOINED" as const, joinedAt: at, lastSeenAt: at }
            : { memberKey: member.key, name: member.name, color: member.color, state: "INVITED" as const }
        ),
      },
    },
    select: { id: true },
  });

  // A phone with the app closed hears about it the only way it can: a
  // notification. The manager used to be filtered out here, because there was
  // no employee row to address one to; there is now, so a call rings their
  // phone like anybody else's — and the link goes to the admin, since they
  // cannot sign in to the employee portal at all.
  void Promise.all(
    others.map(async (member) => {
      const forManager = member.key === MANAGER_MEMBER_KEY;
      const employeeId = await notifiableEmployeeId(member.key);
      // Nobody to tell — an installation with nobody paired as manager, say.
      // Every other phone still rings.
      if (!employeeId) return;

      await dispatchNotification({
        employeeId,
        type: "CHAT_MESSAGE",
        title: kind === "VIDEO" ? "Incoming video call" : "Incoming call",
        message:
          conversation.kind === "team" ? `${viewer.name} started a call in the team chat.` : `${viewer.name} is calling you.`,
        url: forManager ? adminChatUrl(conversation) : employeeChatUrl(conversation, member.key),
        icon: viewer.type === "ADMIN" ? avatarUrl("Manager", "ink") : undefined,
        dedupeKey: `CALL:${call.id}:${member.key}`,
      }).catch(() => undefined);
    })
  );

  return { callId: call.id, joinedExisting: false };
}

/** Answering, or coming back to a call after dropping out of it. */
export async function joinCall(viewer: ChatViewer, callId: string) {
  const me = memberKeyOf(viewer);
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      id: true,
      status: true,
      startedByKey: true,
      channel: { select: { key: true } },
      participants: { where: { memberKey: me }, select: { id: true } },
    },
  });
  if (!call) throw new CallError("That call no longer exists.");

  const conversation = conversationFromKey(call.channel.key);
  if (!conversation || !mayOpen(viewer, conversation)) throw new CallError("That call is not in a conversation you are in.");
  if (call.status === "ENDED") throw new CallError("This call has ended.");

  await leaveOtherCalls(me, callId);

  const at = new Date();
  if (call.participants[0]) {
    await prisma.callParticipant.update({
      where: { id: call.participants[0].id },
      data: { state: "JOINED", joinedAt: at, lastSeenAt: at, leftAt: null },
    });
  } else {
    // Somebody who joined the team after the call began.
    await prisma.callParticipant.create({
      data: { callId, memberKey: me, name: viewer.name, color: await colourOf(viewer), state: "JOINED", joinedAt: at, lastSeenAt: at },
    });
  }

  if (me !== call.startedByKey) {
    await prisma.call.updateMany({ where: { id: callId, status: "RINGING" }, data: { status: "ACTIVE", answeredAt: at } });
  }
}

export async function declineCall(viewer: ChatViewer, callId: string) {
  await prisma.callParticipant.updateMany({
    where: { callId, memberKey: memberKeyOf(viewer), state: "INVITED" },
    data: { state: "DECLINED", leftAt: new Date() },
  });
  await sweep(callId);
}

export async function leaveCall(viewer: ChatViewer, callId: string) {
  await prisma.callParticipant.updateMany({
    where: { callId, memberKey: memberKeyOf(viewer), state: "JOINED" },
    data: { state: "LEFT", leftAt: new Date() },
  });
  await sweep(callId);
}

/**
 * An open call saying it is still there. False when this person is no longer
 * in it — dropped for going quiet too long — so the screen can join again.
 */
export async function heartbeat(viewer: ChatViewer, callId: string) {
  const touched = await prisma.callParticipant.updateMany({
    where: { callId, memberKey: memberKeyOf(viewer), state: "JOINED", call: { status: { not: "ENDED" } } },
    data: { lastSeenAt: new Date() },
  });
  return touched.count > 0;
}

async function leaveOtherCalls(memberKey: string, except: string | null) {
  const elsewhere = await prisma.callParticipant.findMany({
    where: {
      memberKey,
      state: "JOINED",
      call: { status: { not: "ENDED" } },
      ...(except ? { NOT: { callId: except } } : {}),
    },
    select: { id: true, callId: true },
  });
  for (const part of elsewhere) {
    await prisma.callParticipant.update({ where: { id: part.id }, data: { state: "LEFT", leftAt: new Date() } });
    await sweep(part.callId);
  }
}

/** Looks at one call now: counts anybody gone quiet as gone, and finishes the call if it is over. */
export async function sweep(callId: string, now = Date.now()) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      answeredAt: true,
      startedByKey: true,
      startedByName: true,
      channelId: true,
      channel: { select: { key: true } },
      participants: { select: { memberKey: true, state: true, lastSeenAt: true } },
    },
  });
  if (!call || call.status === "ENDED") return;

  const conversation = conversationFromKey(call.channel.key);
  const decision = sweepCall(
    {
      status: call.status,
      createdAt: call.createdAt,
      startedByKey: call.startedByKey,
      group: conversation?.kind === "team",
      participants: call.participants,
    },
    now
  );

  if (decision.gone.length > 0) {
    await prisma.callParticipant.updateMany({
      where: { callId, memberKey: { in: decision.gone }, state: "JOINED" },
      data: { state: "LEFT", leftAt: new Date(now) },
    });
  }
  if (decision.end) await finish(call, decision.end, now, conversation);
}

async function finish(
  call: {
    id: string;
    kind: CallKind;
    answeredAt: Date | null;
    startedByKey: string;
    startedByName: string;
    channelId: string;
    participants: { memberKey: string; state: string }[];
  },
  reason: EndReason,
  now: number,
  conversation: Conversation | null
) {
  const endedAt = new Date(now);
  // However many open screens look at once, only one of them finishes it.
  const claimed = await prisma.call.updateMany({
    where: { id: call.id, status: { not: "ENDED" } },
    data: { status: "ENDED", endedAt, endReason: reason },
  });
  if (claimed.count === 0) return;

  const seconds =
    reason === "completed" && call.answeredAt ? Math.round((now - call.answeredAt.getTime()) / 1000) : null;
  const byManager = call.startedByKey === "admin";

  const message = await prisma.chatMessage.create({
    data: {
      channelId: call.channelId,
      authorType: byManager ? "ADMIN" : "EMPLOYEE",
      authorId: byManager ? null : call.startedByKey,
      authorName: call.startedByName,
      kind: "CALL",
      body: callSummary(call.kind, reason, seconds),
      durationSeconds: seconds,
    },
    select: { id: true },
  });

  await prisma.call.update({ where: { id: call.id }, data: { messageId: message.id } });
  await prisma.callParticipant.updateMany({
    where: { callId: call.id, state: "JOINED" },
    data: { state: "LEFT", leftAt: endedAt },
  });
  await prisma.callSignal.deleteMany({ where: { callId: call.id } });

  if (reason === "completed" || !conversation) return;

  // Whoever it rang and never picked up hears that they missed it.
  const missed = call.participants.filter((part) => part.state === "INVITED" && part.memberKey !== "admin");
  await Promise.all(
    missed.map((part) =>
      dispatchNotification({
        employeeId: part.memberKey,
        type: "CHAT_MESSAGE",
        title: call.kind === "VIDEO" ? "Missed video call" : "Missed call",
        message: `From ${call.startedByName}.`,
        url: employeeChatUrl(conversation, part.memberKey),
        dedupeKey: `CALL_MISSED:${call.id}:${part.memberKey}`,
      }).catch(() => undefined)
    )
  );
}

/**
 * Every call that has rung out or has somebody in it gone quiet, looked at
 * again. Run by whichever screens are open, so nothing depends on the person
 * who went away coming back to tidy up.
 */
export async function sweepStale(now = Date.now()) {
  const due = await prisma.call.findMany({
    where: {
      status: { not: "ENDED" },
      OR: [
        { status: "RINGING", createdAt: { lt: new Date(now - RING_MS) } },
        { participants: { some: { state: "JOINED", lastSeenAt: { lt: new Date(now - STALE_MS) } } } },
      ],
    },
    select: { id: true },
    take: 20,
  });
  for (const call of due) await sweep(call.id, now);
}

/**
 * The calls one person should know about now: every call ringing or running
 * in a conversation they are in, with who is in it — to ring their phone, to
 * show a Join button, and to know whom to connect to.
 */
export async function callsFor(viewer: ChatViewer) {
  const me = memberKeyOf(viewer);
  const calls = await prisma.call.findMany({
    where: { status: { not: "ENDED" }, participants: { some: { memberKey: me } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      answeredAt: true,
      startedByKey: true,
      startedByName: true,
      channel: { select: { key: true, name: true } },
      participants: {
        orderBy: { name: "asc" },
        select: { memberKey: true, name: true, color: true, state: true, joinedAt: true },
      },
    },
  });

  return calls.flatMap(({ channel, ...call }) => {
    const conversation = conversationFromKey(channel.key);
    if (!conversation || !mayOpen(viewer, conversation)) return [];
    const others = call.participants.filter((part) => part.memberKey !== me).map((part) => part.name);
    return [
      {
        ...call,
        conversationSlug: conversationSlug(conversation, viewer),
        title: conversation.kind === "team" ? channel.name : others.join(", "),
        isGroup: conversation.kind === "team",
      },
    ];
  });
}

export type CallView = Awaited<ReturnType<typeof callsFor>>[number];

export type OutgoingSignal = { to: string; type: "description" | "candidates"; payload: unknown };

/** Connection messages from one device in a call to others in it — only ever to people in the same call. */
export async function sendSignals(viewer: ChatViewer, callId: string, signals: OutgoingSignal[]) {
  const me = memberKeyOf(viewer);
  const parts = await prisma.callParticipant.findMany({
    where: { callId, call: { status: { not: "ENDED" } } },
    select: { memberKey: true, state: true },
  });
  if (!parts.some((part) => part.memberKey === me && part.state === "JOINED")) {
    throw new CallError("You are not in this call.");
  }

  const inCall = new Set(parts.map((part) => part.memberKey));
  const valid = signals
    .filter((signal) => signal.to !== me && inCall.has(signal.to))
    .filter((signal) => signal.type === "description" || signal.type === "candidates")
    .slice(0, 50);
  if (valid.length === 0) return 0;

  await prisma.callSignal.createMany({
    data: valid.map((signal) => ({
      callId,
      fromKey: me,
      toKey: signal.to,
      type: signal.type,
      payload: signal.payload as Prisma.InputJsonValue,
    })),
  });
  return valid.length;
}

export function signalsFor(memberKey: string, afterId: number) {
  return prisma.callSignal.findMany({
    where: { toKey: memberKey, id: { gt: afterId } },
    orderBy: { id: "asc" },
    take: 100,
    select: { id: true, callId: true, fromKey: true, type: true, payload: true },
  });
}

/** Where a new connection starts reading: anything sent before it opened was for a screen that is gone. */
export async function latestSignalId() {
  const row = await prisma.callSignal.aggregate({ _max: { id: true } });
  return row._max.id ?? 0;
}
