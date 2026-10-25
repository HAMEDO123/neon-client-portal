import { playableVoice } from "@/lib/voice-transcode";

// The recording made playable on an iPhone and measured in whole seconds —
// apart from walkie-store.ts so the tests can read that file without ffmpeg.
export async function voiceFor(file: File): Promise<{ file: File; seconds: number | null }> {
  const prepared = await playableVoice(file);
  return { file: prepared.file, seconds: prepared.seconds != null ? Math.round(prepared.seconds) : null };
}
