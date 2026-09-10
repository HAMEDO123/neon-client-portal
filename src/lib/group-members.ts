// The line under a group's name, the way WhatsApp writes it: everybody by
// name, in the order given, with you at the end as "You".
//
// Pure, so the chat header and its tests read the same rule.

export function memberLine(names: string[], viewerName?: string | null) {
  const seen = new Set<string>();
  const others: string[] = [];
  let includesViewer = false;

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (viewerName && name === viewerName) {
      includesViewer = true;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    others.push(name);
  }

  return (includesViewer ? [...others, "You"] : others).join(", ");
}
