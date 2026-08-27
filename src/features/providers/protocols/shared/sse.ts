export interface SseFrame {
  event?: string;
  data: string;
}

export async function* readSseFrames(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/gu, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(raw);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const frame = parseFrame(buffer.replace(/\r\n/gu, "\n"));
    if (frame) yield frame;
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ProviderTransportError("cancelled");
    }
    throw new ProviderTransportError("network");
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : undefined;
}

function abortError(): Error {
  const error = new Error("Provider 请求已取消。");
  error.name = "AbortError";
  return error;
}
import { ProviderTransportError } from "./provider-transport";
