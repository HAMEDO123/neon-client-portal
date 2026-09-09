import { readFile } from "fs/promises";
import path from "path";
import { ASSISTANT_MODEL, describeAiError, getAiClient, isAiConfigured } from "@/lib/ai/client";

// Reading a receipt photo. The model extracts what the receipt says; the
// company's 2 JOD cap is applied afterwards in payroll.ts, so the original
// amount is always preserved and the rule stays in one place.

export type ReceiptReading = {
  vendor: string | null;
  date: string | null;
  amount: number | null;
  currency: string;
  summary: string | null;
  notes: string | null;
};

export type ReceiptResult =
  | { ok: true; reading: ReceiptReading }
  | { ok: false; error: string };

const PROMPT = `Read this receipt photo and return JSON only, with no prose and no code fence.

{
  "vendor": "shop or restaurant name, or null",
  "date": "YYYY-MM-DD from the receipt, or null",
  "amount": total paid as a number, or null,
  "currency": "JOD unless the receipt clearly shows another currency",
  "summary": "a few words on what was bought",
  "notes": "anything unclear, blurry or worth a human checking, or null"
}

Rules:
- The amount is the final total paid, after any tax or discount.
- Jordanian receipts often show fils: 1.750 means 1.750 JOD, not 1750.
- If the total is unreadable, set amount to null and say why in notes. Never guess a number.`;

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

async function loadImage(url: string) {
  const raw = url.startsWith("/")
    ? await readFile(path.join(process.cwd(), "public", url))
    : Buffer.from(await (await fetch(url)).arrayBuffer());

  const ext = (url.split(".").pop() ?? "jpg").toLowerCase().split("?")[0];
  return { base64: raw.toString("base64"), mediaType: MEDIA_TYPES[ext] ?? "image/jpeg" };
}

/** Pulls the JSON object out of a reply, tolerating a stray fence or preamble. */
function parseReading(text: string): ReceiptReading | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const amount = typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? parsed.amount : null;

    return {
      vendor: typeof parsed.vendor === "string" ? parsed.vendor.slice(0, 120) : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      amount: amount !== null && amount > 0 ? amount : null,
      currency: typeof parsed.currency === "string" ? parsed.currency.slice(0, 8).toUpperCase() : "JOD",
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : null,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : null,
    };
  } catch {
    return null;
  }
}

export async function readReceipt(imageUrl: string): Promise<ReceiptResult> {
  if (!isAiConfigured()) {
    return { ok: false, error: "Receipt reading needs ANTHROPIC_API_KEY on the server." };
  }

  const client = getAiClient();
  if (!client) return { ok: false, error: "Receipt reading is unavailable." };

  try {
    const image = await loadImage(imageUrl);

    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mediaType, data: image.base64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to read this image." };
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const reading = parseReading(text);
    if (!reading) return { ok: false, error: "Could not read a total from that photo." };

    return { ok: true, reading };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}
