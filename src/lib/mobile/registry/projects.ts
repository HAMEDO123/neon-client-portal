import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/admin-guard";
import { refreshProject, refreshProjectLists } from "@/lib/project-paths";
import { getDashboardStats, getProjectAnalytics, getProjects } from "@/lib/queries";
import { sellers } from "@/lib/sales-queries";
import {
  createProject,
  deleteProject,
  logClientNotification,
  regenerateProjectLink,
  setPublishState,
  updateProjectOverview,
  updateProjectSettings,
} from "@/lib/actions/project-actions";
import { addImage, createSpace, deleteImage, deleteSpace } from "@/lib/actions/gallery-actions";
import { createHotspot, deleteHotspot } from "@/lib/actions/hotspot-actions";
import { sendProjectWhatsApp } from "@/lib/actions/whatsapp-actions";
import {
  guarded,
  guardedAction,
  num,
  oneOf,
  param,
  str,
  type ActionRegistry,
  type ReadRegistry,
} from "@/lib/mobile/rpc";

// The "projects" area of the phone API. See lib/mobile/rpc.ts: keys are
// "projects/<name>"; every read is guarded(<the website page's guard>, …); an action
// calls the website's own server action, or is guardedAction(…) when it calls
// a lib function directly.
//
// Every read here is guarded with requireStaff — the manager or the team —
// the same guard every project write in src/lib/actions/project-actions.ts,
// gallery-actions.ts and hotspot-actions.ts carries, because the studio
// decided the team works a project exactly as the manager does. The two
// exceptions are creating and deleting a project, which stay `requireAdmin`
// inside those server actions themselves: this registry calls them unchanged,
// so an employee reaching for either gets the same "not available to you" the
// website would give.

const PUBLISH_STATES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const WHATSAPP_KINDS = ["sent_to_client", "sent_update"] as const;

const spaceSelect = {
  id: true,
  name: true,
  order: true,
  images: {
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      imageUrl: true,
      caption: true,
      isBeforeAfter: true,
      beforeImageUrl: true,
      order: true,
      hotspots: {
        orderBy: { order: "asc" as const },
        select: {
          id: true,
          xPercent: true,
          yPercent: true,
          label: true,
          description: true,
          category: true,
          linkLabel: true,
          order: true,
        },
      },
    },
  },
};

const detailSelect = {
  id: true,
  token: true,
  name: true,
  clientName: true,
  clientEmail: true,
  clientPhone: true,
  location: true,
  area: true,
  projectType: true,
  description: true,
  coverImageUrl: true,
  deliveryDate: true,
  publishState: true,
  pipelineStatus: true,
  currentStage: true,
  completionPercent: true,
  updatedAt: true,
  soldById: true,
  soldOn: true,
  showPricing: true,
  showDetailedPricing: true,
  showBoqQuantities: true,
  showBoqPrices: true,
  allowDownloads: true,
  watermarkEnabled: true,
  spaces: { orderBy: { order: "asc" as const }, select: spaceSelect },
  _count: { select: { approvals: true, comments: true } },
};

export const reads: ReadRegistry = {
  // The Projects tab's list: the same figures and rows the manager's old
  // dashboard read (getDashboardStats + getProjects), open to the team too —
  // there is no admin-only fact in a project's name, client or publish state.
  "projects/list": guarded(requireStaff, async () => {
    const [stats, projects] = await Promise.all([getDashboardStats(), getProjects()]);
    return {
      stats,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        location: p.location,
        publishState: p.publishState,
        pipelineStatus: p.pipelineStatus,
        currentStage: p.currentStage,
        coverImageUrl: p.coverImageUrl,
        updatedAt: p.updatedAt,
        approvalsCount: p._count.approvals,
        commentsCount: p._count.comments,
        // The manager's own figure for how far along it is — shown on the
        // app's project cards. Already on the row getProjects() returns.
        completionPercent: p.completionPercent,
      })),
    };
  }),

  // The overview + gallery fields — not drawings, documents, BOQ, pricing,
  // materials, furniture, approvals or comments, which are the projectfiles
  // area's own reads behind the sections this screen embeds.
  "projects/detail": guarded(requireStaff, async (params) => {
    const id = param(params, "id");
    const project = await prisma.project.findUnique({ where: { id }, select: detailSelect });
    if (!project) throw new Error("That project no longer exists.");
    return project;
  }),

  "projects/analytics": guarded(requireStaff, async (params) => {
    const id = param(params, "id");
    return getProjectAnalytics(id);
  }),

  // Who a project may be marked sold by — the Overview edit sheet's picker.
  "projects/sellers": guarded(requireStaff, async () => sellers()),
};

export const actions: ActionRegistry = {
  // requireAdmin, inside createProject itself — see the note above.
  "projects/create": async (input) => createProject(input.form),

  "projects/update": async (input) => {
    const id = str(input.args[0], "id");
    return updateProjectOverview(id, input.form);
  },

  "projects/updateSettings": async (input) => {
    const id = str(input.args[0], "id");
    return updateProjectSettings(id, input.form);
  },

  "projects/publish": async (input) => {
    const id = str(input.args[0], "id");
    const state = oneOf(input.args[1], PUBLISH_STATES, "state");
    return setPublishState(id, state);
  },

  "projects/regenerateLink": async (input) => regenerateProjectLink(str(input.args[0], "id")),

  "projects/notifyClient": async (input) => {
    const id = str(input.args[0], "id");
    const type = oneOf(input.args[1], WHATSAPP_KINDS, "type");
    return logClientNotification(id, type);
  },

  "projects/sendWhatsApp": async (input) => {
    const id = str(input.args[0], "id");
    const kind = oneOf(input.args[1], WHATSAPP_KINDS, "kind");
    return sendProjectWhatsApp(id, kind, input.form);
  },

  // requireAdmin, inside deleteProject itself — see the note above.
  "projects/delete": async (input) => deleteProject(str(input.args[0], "id")),

  // Gallery: rooms and their photos.
  "projects/createSpace": async (input) => {
    const id = str(input.args[0], "id");
    return createSpace(id, input.form);
  },
  "projects/deleteSpace": async (input) => deleteSpace(str(input.args[0], "id"), str(input.args[1], "spaceId")),
  // One photo per call — the request body limit applies to the raw upload,
  // before compression, so the app loops rather than batching (image-upload-form.tsx
  // and addProjectImage in employee-project-actions.ts both work this way).
  "projects/addImage": async (input) => {
    const id = str(input.args[0], "id");
    const spaceId = str(input.args[1], "spaceId");
    return addImage(id, spaceId, input.form);
  },
  "projects/deleteImage": async (input) => deleteImage(str(input.args[0], "id"), str(input.args[1], "imageId")),

  // No website action sets the cover from an image already on the project —
  // the admin form only uploads a new file or clears it (updateProjectOverview).
  // This is new logic, not an edit to a shared file, behind the same guard.
  "projects/setCover": guardedAction(requireStaff, async (input) => {
    const id = str(input.args[0], "id");
    const imageUrl = str(input.args[1], "imageUrl");
    const owned = await prisma.galleryImage.findFirst({
      where: { imageUrl, space: { projectId: id } },
      select: { id: true },
    });
    if (!owned) throw new Error("That photo is not one of this project's gallery images.");
    await prisma.project.update({ where: { id }, data: { coverImageUrl: imageUrl } });
    refreshProjectLists();
    refreshProject(id, { layout: true });
  }),

  // Hotspots on a gallery image.
  "projects/createHotspot": async (input) => {
    const id = str(input.args[0], "id");
    const imageId = str(input.args[1], "imageId");
    const xPercent = num(input.args[2], "xPercent");
    const yPercent = num(input.args[3], "yPercent");
    return createHotspot(id, imageId, xPercent, yPercent, input.form);
  },
  "projects/deleteHotspot": async (input) => deleteHotspot(str(input.args[0], "id"), str(input.args[1], "hotspotId")),
};
