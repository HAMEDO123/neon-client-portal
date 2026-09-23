import { isConversationPath } from "@/lib/chat-conversations";

// Which pages own the window instead of sitting inside a scrolling page.
//
// Two kinds so far, and they want the same two things from the shells around
// them: fill the frame and scroll inside yourself, and do not take a
// `router.refresh()` every couple of seconds because you keep your own
// connection.
//
//   - an open chat conversation, which streams,
//   - the WhatsApp tab, which polls the studio's own number.
//
// One predicate rather than two lists, because the admin shell and LiveSync
// both have to agree about a page — and the failure when they disagree is
// quiet: a page that fills the window but is refreshed underneath, or one that
// is left alone but scrolls as a page.

export function fillsWindow(pathname: string): boolean {
  if (isConversationPath(pathname)) return true;
  return /^\/(admin|employee)\/whatsapp\/?$/.test(pathname);
}
