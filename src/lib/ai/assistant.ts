import { conversationForAgent } from "@/lib/chat";
import { ASSISTANT_MODEL, describeAiError, getAiClient, isAiConfigured } from "@/lib/ai/client";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";

// The manager's assistant. It reads the team conversation and answers
// questions about it — "what did Sally say about the Villa renders", "who
// still owes me the BOQ".
//
// Two boundaries matter here and are enforced upstream, not by the prompt:
// only the manager can ask (the action checks the admin session), and the
// transcript it reads excludes the manager's own private exchanges with it,
// so the assistant never quotes itself back as if it were team chatter.

const SYSTEM_PROMPT = `You are the assistant inside NEON's internal team chat, an interior design and build studio in Amman, Jordan.

You are answering the manager. You have the team's chat history: messages from employees and from the manager, about client projects, site visits, drawings, materials and deliveries.

How to answer:
- Answer from the transcript. If the transcript does not contain the answer, say so plainly rather than guessing.
- Quote or paraphrase who said what, and when, so the manager can act on it.
- Be brief. The manager is usually on a phone.
- Voice messages and photos appear in the transcript as placeholders, because you cannot hear or see them. If the answer likely depends on one, say which message to open.
- Dates and times are already in the company's local timezone.`;

export type AssistantResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

function renderMessage(
  message: Awaited<ReturnType<typeof conversationForAgent>>[number],
  timezone: string
) {
  const when = `${formatDayIn(timezone, message.createdAt)} ${formatTimeIn(timezone, message.createdAt)}`;
  const who = message.authorType === "ADMIN" ? `${message.authorName} (manager)` : message.authorName;
  const about = message.project ? ` [project: ${message.project.name}]` : "";

  // Attachments cannot be read by the assistant, so they are described rather
  // than pretended away.
  let content = message.body ?? "";
  if (message.kind === "VOICE") content = `(voice message${content ? `: ${content}` : ""})`;
  if (message.kind === "IMAGE") content = `(photo${message.attachmentName ? `: ${message.attachmentName}` : ""}${content ? ` — ${content}` : ""})`;
  if (message.kind === "FILE") content = `(file: ${message.attachmentName ?? "attachment"}${content ? ` — ${content}` : ""})`;

  return `[${when}] ${who}${about}: ${content}`;
}

export async function askAssistant(question: string): Promise<AssistantResult> {
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Ask a question first." };

  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "The assistant is not configured yet — ANTHROPIC_API_KEY is not set on the server.",
    };
  }

  const client = getAiClient();
  if (!client) return { ok: false, error: "The assistant is unavailable." };

  const [messages, timezone] = await Promise.all([conversationForAgent(), getTimezone()]);

  const transcript = messages.length
    ? messages.map((message) => renderMessage(message, timezone)).join("\n")
    : "(The team chat is empty.)";

  try {
    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is the team chat, oldest first:\n\n<transcript>\n${transcript}\n</transcript>\n\nThe manager asks: ${trimmed}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The assistant declined to answer that." };
    }

    const answer = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return answer ? { ok: true, answer } : { ok: false, error: "The assistant returned nothing." };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}
