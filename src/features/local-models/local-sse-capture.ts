import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Explicit, process-scoped acceptance capture. No headers, keys or request
 * bodies are collected; only a named synthetic prompt on a local deployment. */
export function localSseCapture(local: boolean, prompt: string | undefined) {
  const directory = process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY;
  const prefix = process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX;
  if (!local || !directory || !isAbsolute(directory) || !prefix || !prompt?.startsWith(prefix)) return undefined;
  const startedAt = Date.now();
  const frames: Array<{ receivedAt: number; data: string }> = [];
  let bytes = 0, truncated = false;
  return {
    frame(data: string) {
      bytes += Buffer.byteLength(data);
      if (bytes <= 8 * 1024 * 1024) frames.push({ receivedAt: Date.now(), data });
      else truncated = true;
    },
    async finish(finishReason: string) {
      await writeFile(join(directory, `response-${startedAt}-${process.hrtime.bigint()}.json`), JSON.stringify({
        startedAt, completedAt: Date.now(), finishReason, truncated,
        settingsScope: "synthetic local acceptance; output frames only", frames,
      }), { mode: 0o600 });
    },
  };
}
