import type { ActionRegistry, ReadRegistry } from "@/lib/mobile/rpc";
import * as home from "@/lib/mobile/registry/home";
import * as projects from "@/lib/mobile/registry/projects";
import * as projectfiles from "@/lib/mobile/registry/projectfiles";
import * as tasks from "@/lib/mobile/registry/tasks";
import * as team from "@/lib/mobile/registry/team";
import * as ops from "@/lib/mobile/registry/ops";
import * as chat from "@/lib/mobile/registry/chat";
import * as calls from "@/lib/mobile/registry/calls";
import * as whatsapp from "@/lib/mobile/registry/whatsapp";
import * as me from "@/lib/mobile/registry/me";
import * as cameras from "@/lib/mobile/registry/cameras";

// Everything the phone app may read or do, by area. Each area file is its
// own list so the areas can grow independently; a key that appeared in two
// areas would be a mistake, and `assertUnique` refuses it at startup.

const AREAS = [home, projects, projectfiles, tasks, team, ops, chat, calls, whatsapp, me, cameras];

function assertUnique<T>(lists: Record<string, T>[]): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const list of lists) {
    for (const [key, value] of Object.entries(list)) {
      if (key in merged) throw new Error(`Mobile registry: "${key}" is defined twice.`);
      merged[key] = value;
    }
  }
  return merged;
}

export const READS: ReadRegistry = assertUnique(AREAS.map((area) => area.reads));
export const ACTIONS: ActionRegistry = assertUnique(AREAS.map((area) => area.actions));
