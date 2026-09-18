/* Transport and render scheduling have no knowledge of modes, DOM, or credentials. */
(function (root) {
  "use strict";

  async function readJsonEvents(body, onEvent, onReader = () => {}) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let line = "", fields = [], size = 0, afterCR = false, ended = false;
    const dispatch = () => {
      if (fields.length) {
        const data = fields.join("\n");
        fields = [];
        size = 0;
        if (data !== "[DONE]") onEvent(JSON.parse(data));
      }
    };
    const consumeLine = () => {
      if (!line) dispatch();
      else if (line === "data" || line.startsWith("data:")) {
        const value = line.slice(5).replace(/^ /, "");
        fields.push(value);
        size += value.length;
      }
      line = "";
    };
    const consume = (text) => {
      for (const character of text) {
        if (afterCR && character === "\n") { afterCR = false; continue; }
        afterCR = character === "\r";
        if (character === "\n" || afterCR) consumeLine();
        else line += character;
        if (line.length + size > 8 * 1024 * 1024) throw new Error("Agent event exceeds the transport limit");
      }
    };
    try {
      onReader(reader);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      if (line) consumeLine();
      dispatch();
      ended = true;
    } finally {
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async function confirmRunState(fetcher, sessionId, runId) {
    const response = await fetcher(`/api/runs/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Agent state unavailable: ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error("Agent state unavailable");
    if (!data.run || data.run.run_id !== runId) return { kind: "replaced" };
    if (data.run.terminal === true && data.run.active === false) return { kind: "terminal", run: data.run };
    if (data.run.active === true) return { kind: "active", run: data.run };
    throw new Error("Agent state is indeterminate");
  }

  function createRenderScheduler(schedule = (callback) => setTimeout(callback, 32), cancel = clearTimeout) {
    const pending = new Map();
    function flush(key) {
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      cancel(entry.timer);
      entry.render();
    }
    return {
      schedule(key, render) {
        if (pending.has(key)) { pending.get(key).render = render; return; }
        const entry = { render, timer: null };
        pending.set(key, entry);
        entry.timer = schedule(() => flush(key));
      },
      flush,
      cancel(key) {
        const entry = pending.get(key);
        if (entry) cancel(entry.timer);
        pending.delete(key);
      },
    };
  }

  const api = Object.freeze({ readJsonEvents, confirmRunState, createRenderScheduler });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AgentStream = api;
})(globalThis);
