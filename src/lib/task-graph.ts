// Dependencies are a graph, and a graph can be drawn in circles.
//
// "The drawings wait on the design" is useful; "the drawings wait on the design
// and the design waits on the drawings" leaves both waiting for ever and
// nothing to start. So an edge is refused when the task being waited for
// already waits — directly, or through however many others — on the task that
// would now wait for it.
//
// Pure walk over the edges, so the manager's editor and anything that writes
// dependencies later answer the question the same way.

export type Edge = { entryId: string; dependsOnEntryId: string };

/** Everything `entryId` waits for, directly or at any remove. */
export function waitsForAll(edges: Edge[], entryId: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.entryId) ?? [];
    list.push(edge.dependsOnEntryId);
    outgoing.set(edge.entryId, list);
  }

  const reached = new Set<string>();
  const queue = [...(outgoing.get(entryId) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift()!;
    // A loop that already exists must not spin this walk for ever.
    if (reached.has(next)) continue;
    reached.add(next);
    queue.push(...(outgoing.get(next) ?? []));
  }

  return reached;
}

/** Whether making `entryId` wait for `dependsOnEntryId` would close a loop. */
export function wouldCycle(edges: Edge[], entryId: string, dependsOnEntryId: string) {
  // Nothing waits for itself.
  if (entryId === dependsOnEntryId) return true;
  return waitsForAll(edges, dependsOnEntryId).has(entryId);
}

/**
 * The edges to keep when a task's dependencies are set to `chosen`: the ones
 * that would close a loop are dropped, and the caller is told which, so the
 * manager hears "that one already waits on this" rather than silently losing
 * the choice.
 */
export function acceptableDependencies(
  edges: Edge[],
  entryId: string,
  chosen: string[]
): { accepted: string[]; refused: string[] } {
  // Judged against the graph without this task's own current edges: replacing
  // its list must not be refused because of the list being replaced.
  const others = edges.filter((edge) => edge.entryId !== entryId);
  const accepted: string[] = [];
  const refused: string[] = [];

  for (const candidate of chosen) {
    if (accepted.includes(candidate)) continue;
    if (wouldCycle([...others, ...accepted.map((id) => ({ entryId, dependsOnEntryId: id }))], entryId, candidate)) {
      refused.push(candidate);
    } else {
      accepted.push(candidate);
    }
  }

  return { accepted, refused };
}
