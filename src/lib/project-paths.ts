import { revalidatePath } from "next/cache";

// Where a project's screens live, in both portals.
//
// Every project action used to carry its own one-line `refresh`, revalidating
// `/admin/projects/<id>/<tab>` and nothing else. That was right while the
// manager was the only person who could open those screens. It stopped being
// right the moment the team could: an employee deleting a photo would refresh
// the manager's copy of the page and not the one they were looking at, so the
// photo stayed on screen until a manual reload — which reads as "delete is
// broken" while the database is perfectly correct.
//
// So the rule lives once. Eleven files each holding their own copy of "which
// pages show this" is the arrangement that put twenty-five copies of the admin
// guard in this codebase: they do not drift because somebody is careless, they
// drift because there are eleven chances for one to be edited and the rest not.
//
// Not "use server": every export of one of those is callable over the network,
// and this is a helper, not an endpoint.

/** The two portals that render a project's own screens. */
const PORTALS = ["/admin/projects", "/employee/projects"] as const;

/**
 * Marks a project's screens stale in both portals.
 *
 * `tab` is the section — "gallery", "drawings" — or nothing for the project's
 * own page. `layout` widens it to everything nested underneath, which is what
 * a change to the project itself (its name, whether it is published) needs,
 * since that is drawn by the layout every tab sits inside.
 */
export function refreshProject(projectId: string, options: { tab?: string; layout?: boolean } = {}) {
  const suffix = options.tab ? `/${options.tab}` : "";

  for (const portal of PORTALS) {
    revalidatePath(`${portal}/${projectId}${suffix}`, options.layout ? "layout" : "page");
  }
}

/** The lists both portals show, for a project appearing or disappearing. */
export function refreshProjectLists() {
  revalidatePath("/admin");
  revalidatePath("/employee/projects");
}
