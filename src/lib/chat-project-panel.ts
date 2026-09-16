import { prisma } from "@/lib/db";

// What the chat's right-hand panel is about: the project the conversation has
// been discussing, the files on it, and where its work stands.
//
// Which project? The newest message in this conversation that named one —
// every message can carry a project (the composer's picker writes it) — and,
// where nothing has ever been named, the studio's most recently updated
// project, because that is what the team is on. Never a guess dressed up as a
// fact: the panel says which project it is showing, and a chat that has named
// one keeps it.
//
// Read sequentially like the other multi-query pages here: several queries
// fired at once are what the local development database falls over on.

export type PanelFile = {
  id: string;
  name: string;
  /** What it is, in the studio's words: a drawing sheet or a document. */
  kind: "drawing" | "document";
  url: string;
  fileType: string;
  fileSize: number | null;
  createdAt: Date;
};

export type PanelTask = {
  id: string;
  name: string;
  state: "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";
  dueAt: Date | null;
  scheduledFor: Date | null;
  assignee: string | null;
};

export type ProjectPanel = {
  project: {
    id: string;
    name: string;
    clientName: string | null;
    location: string | null;
    coverImageUrl: string | null;
    pipelineStatus: string;
    currentStage: string | null;
    completionPercent: number | null;
  };
  /** Whether the conversation named this project, or it is simply the latest one. */
  fromConversation: boolean;
  files: PanelFile[];
  fileCount: number;
  tasks: PanelTask[];
  taskCount: number;
  doneCount: number;
};

const FILES_SHOWN = 4;
const TASKS_SHOWN = 5;

export async function projectPanelFor(channelId: string): Promise<ProjectPanel | null> {
  const mentioned = await prisma.chatMessage.findFirst({
    where: { channelId, projectId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { projectId: true },
  });

  const project = mentioned?.projectId
    ? await prisma.project.findUnique({
        where: { id: mentioned.projectId },
        select: projectSelect,
      })
    : await prisma.project.findFirst({
        where: { publishState: { not: "ARCHIVED" } },
        orderBy: { updatedAt: "desc" },
        select: projectSelect,
      });
  if (!project) return null;

  const documents = await prisma.document.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: FILES_SHOWN,
    select: { id: true, title: true, fileUrl: true, fileType: true, fileSize: true, createdAt: true },
  });
  const drawings = await prisma.drawing.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: FILES_SHOWN,
    select: { id: true, name: true, fileUrl: true, fileType: true, fileSize: true, createdAt: true },
  });
  const documentCount = await prisma.document.count({ where: { projectId: project.id } });
  const drawingCount = await prisma.drawing.count({ where: { projectId: project.id } });

  const files: PanelFile[] = [
    ...documents.map((row) => ({
      id: row.id,
      name: row.title,
      kind: "document" as const,
      url: row.fileUrl,
      fileType: row.fileType,
      fileSize: row.fileSize,
      createdAt: row.createdAt,
    })),
    ...drawings.map((row) => ({
      id: row.id,
      name: row.name,
      kind: "drawing" as const,
      url: row.fileUrl,
      fileType: row.fileType,
      fileSize: row.fileSize,
      createdAt: row.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, FILES_SHOWN);

  // The project's own steps: what is still to do first, soonest due on top,
  // and what was finished last after them.
  const entries = await prisma.projectTaskEntry.findMany({
    where: { projectId: project.id },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 40,
    select: {
      id: true,
      state: true,
      dueAt: true,
      scheduledFor: true,
      task: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });

  const open = entries.filter((entry) => entry.state !== "DONE");
  const done = entries.filter((entry) => entry.state === "DONE");
  const tasks: PanelTask[] = [...open, ...done].slice(0, TASKS_SHOWN).map((entry) => ({
    id: entry.id,
    name: entry.task.name,
    state: entry.state,
    dueAt: entry.dueAt,
    scheduledFor: entry.scheduledFor,
    assignee: entry.assignee?.name ?? null,
  }));

  const taskCount = await prisma.projectTaskEntry.count({ where: { projectId: project.id } });
  const doneCount = await prisma.projectTaskEntry.count({ where: { projectId: project.id, state: "DONE" } });

  return {
    project,
    fromConversation: Boolean(mentioned?.projectId),
    files,
    fileCount: documentCount + drawingCount,
    tasks,
    taskCount,
    doneCount,
  };
}

const projectSelect = {
  id: true,
  name: true,
  clientName: true,
  location: true,
  coverImageUrl: true,
  pipelineStatus: true,
  currentStage: true,
  completionPercent: true,
} as const;
