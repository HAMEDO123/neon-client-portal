import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// A voice note every phone can play.
//
// The iPhone app plays a voice message with AVAudioPlayer, which reads
// AAC/M4A, MP3 and WAV — not Ogg or WebM. So a WhatsApp voice note shared into
// a chat (an Ogg Opus ".opus" file) and a recording from Chrome or Android
// (WebM/Ogg Opus) arrived and could not be played on an iPhone at all. Such a
// file is turned into AAC in an .m4a here, which plays everywhere, and its
// length is read so the player can show it — a shared file arrives with no
// duration of its own.
//
// It needs `ffmpeg` (in the Dockerfile). Where there is none — a laptop
// without it — the file is kept exactly as it came, so a voice note is never
// lost to the conversion: at worst it stays as unplayable on an iPhone as it
// always was.

const PLAYS_EVERYWHERE = new Set(["audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]);

/** "audio/ogg; codecs=opus" → whether it has to be converted for an iPhone. */
export function needsTranscode(type: string): boolean {
  const base = type.split(";")[0].trim().toLowerCase();
  return !PLAYS_EVERYWHERE.has(base);
}

/** ffprobe's "12.345000" → 12, or null for anything that is not a length. */
export function readSeconds(output: string): number | null {
  const seconds = Number(output.trim().split(/\s+/)[0]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds)) : null;
}

function run(command: string, args: string[], timeoutMs = 60_000): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

async function probeSeconds(file: string): Promise<number | null> {
  try {
    const { code, stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], 20_000);
    return code === 0 ? readSeconds(stdout) : null;
  } catch {
    return null;
  }
}

/**
 * The voice note to keep, and how long it is. Converted to AAC when an iPhone
 * could not play it; otherwise the same file, with its length read if it can be.
 */
export async function playableVoice(file: File): Promise<{ file: File; seconds: number | null }> {
  const folder = await mkdtemp(path.join(tmpdir(), "neon-voice-"));
  try {
    const input = path.join(folder, `in${path.extname(file.name) || ".audio"}`);
    await writeFile(input, Buffer.from(await file.arrayBuffer()));

    if (!needsTranscode(file.type)) {
      return { file, seconds: await probeSeconds(input) };
    }

    const output = path.join(folder, "voice.m4a");
    let converted: { code: number | null };
    try {
      converted = await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", input,
        "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        output,
      ]);
    } catch {
      // No ffmpeg here: keep the original rather than lose the message.
      return { file, seconds: null };
    }
    if (converted.code !== 0) return { file, seconds: null };

    const base = (file.name || "voice").replace(/\.[^.]+$/, "");
    const playable = new File([new Uint8Array(await readFile(output))], `${base}.m4a`, { type: "audio/mp4" });
    return { file: playable, seconds: await probeSeconds(output) };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}
