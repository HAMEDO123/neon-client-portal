import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ringPhones, stopRinging } from "@/lib/notifications/call-push";
import type { ChatViewer } from "@/lib/chat";
import {
  adminChatUrl,
  conversationFromKey,
  conversationSlug,
  employeeChatUrl,
  isGroupConversation,
  type Conversation,
} from "@/lib/chat-conversations";
import { groupEmployees, mayOpenNow } from "@/lib/chat-group-store";
import {
  RING_MS,
  AWAY_GRACE_MS,
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

  // A group the manager made: the manager, who is in every group, and its members.
  if (conversation.kind === "group") {
    const members = await groupEmployees(conversation.groupId);
    return [manager, ...members.map((person) => ({ key: person.id, name: person.name, color: person.color }))];
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

/**
 * People who could be asked into this call: everybody on the team who is not
 * already in it, and the manager.
 *
 * Deliberately the whole team rather than the chat the call began in — the
 * point of adding somebody is that they were not in that chat.
 */
export async function addableToCall(viewer: ChatViewer, callId: string): Promise<Member[]> {
  const inCall = await presentIn(viewer, callId);
  if (!inCall) return [];

  const already = new Set(inCall.participants.map((part) => part.memberKey));
  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });

  const everyone: Member[] = [
    { key: "admin", name: "Manager", color: "ink" },
    ...team.map((person) => ({ key: person.id, name: person.name, color: person.color })),
  ];

  return everyone.filter((member) => !already.has(member.key));
}

/**
 * Asks more people into a call that is already running.
 *
 * Only somebody in the call may do it, which is the whole of the rule: a
 * participant row is a granted fact, never something anybody writes for
 * themselves, and `joinCall` trusts it precisely because of that.
 *
 * Their phones ring the ordinary way — an INVITED row is what the calls
 * stream turns into an incoming call — so nothing new had to be taught to the
 * screen that answers.
 */
export async function inviteToCall(viewer: ChatViewer, callId: string, memberKeys: string[]) {
  const inCall = await presentIn(viewer, callId);
  if (!inCall) throw new CallError("Only somebody in the call can add to it.");

  const already = new Set(inCall.participants.map((part) => part.memberKey));
  const wanted = [...new Set(memberKeys.map((key) => key.trim()).filter(Boolean))].filter((key) => !already.has(key));
  if (wanted.length === 0) return { invited: 0 };

  const team = await prisma.employee.findMany({
    where: { id: { in: wanted.filter((key) => key !== "admin") }, active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true, color: true },
  });

  const rows = [
    ...(wanted.includes("admin") ? [{ key: "admin", name: "Manager", color: "ink" }] : []),
    ...team.map((person) => ({ key: person.id, name: person.name, color: person.color })),
  ];

  for (const row of rows) {
    await prisma.callParticipant.create({
      data: { callId, memberKey: row.key, name: row.name, color: row.color, state: "INVITED" },
    });
  }

  return { invited: rows.length };
}

/** The call, if this person is actually in it right now. */
async function presentIn(viewer: ChatViewer, callId: string) {
  const me = memberKeyOf(viewer);
  const call = await prisma.call.findFirst({
    where: {
      id: callId,
      status: { not: "ENDED" },
      participants: { some: { memberKey: me, state: "JOINED" } },
    },
    select: { id: true, participants: { select: { memberKey: true } } },
  });
  return call;
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
          conversation.kind === "team"
            ? `${viewer.name} started a call in the team chat.`
            : conversation.kind === "group"
              ? `${viewer.name} started a call in the group.`
              : `${viewer.name} is calling you.`,
        url: forManager ? adminChatUrl(conversation) : employeeChatUrl(conversation, member.key),
        icon: viewer.type === "ADMIN" ? avatarUrl("Manager", "ink") : undefined,
        dedupeKey: `CALL:${call.id}:${member.key}`,
      }).catch(() => undefined);
    })
  );

  // And the phones ring. Not awaited: a call that is already ringing on every
  // open screen must not wait on Apple, and a push that fails must not undo
  // it. The banner goes out above through the engine; this is what makes a
  // locked phone behave like a telephone.
  void ringPhones({
    callId: call.id,
    kind,
    from: viewer.name,
    fromKey: memberKeyOf(viewer),
    memberKeys: members.map((member) => member.key),
  }).catch(() => undefined);

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
  // Being in the call is itself the right to be in it. Until people could be
  // added mid-call, the only way to be a participant was to be in the chat, so
  // the two questions had one answer; now somebody can be asked into a call
  // from a chat they are not in, and their own row is what says they were
  // asked. Nobody can write that row for themselves — see inviteToCall.
  const invited = call.participants.length > 0;
  if (!invited && (!conversation || !(await mayOpenNow(viewer, conversation)))) {
    throw new CallError("That call is not in a conversation you are in.");
  }
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
 * A page going away — reloaded, or closed — keeping its place for a moment.
 *
 * Not `leaveCall`: a browser cannot tell a reload from a closed tab, and
 * treating both as leaving ended the call every time somebody refreshed. This
 * backdates the last-seen instead, so the ordinary sweep counts them gone
 * `AWAY_GRACE_MS` from now unless they come back and beat — which a reload
 * does, in a second or two.
 *
 * Deliberately never touches the call itself and never sweeps: the whole point
 * is that nothing is decided yet.
 */
export async function markAway(viewer: ChatViewer, callId: string, now = Date.now()) {
  await prisma.callParticipant.updateMany({
    where: { callId, memberKey: memberKeyOf(viewer), state: "JOINED", call: { status: { not: "ENDED" } } },
    data: { lastSeenAt: new Date(now - (STALE_MS - AWAY_GRACE_MS)) },
  });
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
      group: conversation ? isGroupConversation(conversation) : false,
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

  // Every phone that was rung has to be told, and not out of politeness: iOS
  // kills an app that takes a VoIP push and reports no call, so a phone woken
  // for a call that is already over must still be allowed to close it. It is
  // also what stops a pocket ringing for the rest of the ring window after
  // somebody has hung up.
  void stopRinging(
    {
      callId: call.id,
      kind: call.kind,
      from: call.startedByName,
      fromKey: call.startedByKey,
      memberKeys: call.participants.map((part) => part.memberKey),
    },
    reason
  ).catch(() => undefined);

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

  // Whoever it rang and never picked up hears that they missed it — the manager
  // included, now that there is a row to address one to. A missed call is the
  // one notification that matters most to somebody whose app was closed: it is
  // the only trace left of a call they never saw.
  const missed = call.participants.filter((part) => part.state === "INVITED");
  await Promise.all(
    missed.map(async (part) => {
      const forManager = part.memberKey === MANAGER_MEMBER_KEY;
      const employeeId = await notifiableEmployeeId(part.memberKey);
      if (!employeeId) return;

      await dispatchNotification({
        employeeId,
        type: "CHAT_MESSAGE",
        title: call.kind === "VIDEO" ? "Missed video call" : "Missed call",
        message: `From ${call.startedByName}.`,
        url: forManager ? adminChatUrl(conversation) : employeeChatUrl(conversation, part.memberKey),
        // Keyed on the member key, not the row it resolves to: the key is what
        // the call was rung on, and it does not move.
        dedupeKey: `CALL_MISSED:${call.id}:${part.memberKey}`,
      }).catch(() => undefined);
    })
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
    // Already filtered to calls this person is a participant of, and being
    // asked into a call is what puts the row there — so a call reaches them
    // even when it began in a chat they cannot open. Without this, somebody
    // added to a call from a private chat would never hear it ring.
    if (!conversation) return [];
    const others = call.participants.filter((part) => part.memberKey !== me).map((part) => part.name);
    return [
      {
        ...call,
        conversationSlug: conversationSlug(conversation, viewer),
        title: isGroupConversation(conversation) ? channel.name : others.join(", "),
        isGroup: isGroupConversation(conversation),
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
