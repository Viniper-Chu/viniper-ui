import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { localSseCapture } from "../../src/features/local-models/local-sse-capture";

test("acceptance capture is opt-in, local and prompt scoped and preserves output frames only", async () => {
 const root=await mkdtemp(join(process.cwd(),"codex/运行残留/sse-capture-"));
 const beforeDir=process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY, beforePrefix=process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX;
 try {
  delete process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY;delete process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX;
  assert.equal(localSseCapture(true,"fixture: test"),undefined);
  process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY=root;process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX="fixture:";
  assert.equal(localSseCapture(false,"fixture: test"),undefined);assert.equal(localSseCapture(true,"normal user request"),undefined);
  const capture=localSseCapture(true,"fixture: test")!;
  const frame='{"choices":[{"delta":{"content":"真实输出"},"finish_reason":"stop"}]}';capture.frame(frame);capture.frame('[DONE]');
  await capture.finish('stop');
  const files=await readdir(root);assert.equal(files.length,1);
  const data=JSON.parse(await readFile(join(root,files[0]),'utf8'));
  assert.deepEqual(data.frames.map((f:any)=>f.data),[frame,'[DONE]']);assert.equal(data.finishReason,'stop');assert.equal(data.truncated,false);
  assert.ok(data.completedAt>=data.startedAt);assert.equal('request' in data,false);assert.equal('headers' in data,false);
 } finally {
  if(beforeDir===undefined)delete process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY;else process.env.VINIPER_LOCAL_SSE_CAPTURE_DIRECTORY=beforeDir;
  if(beforePrefix===undefined)delete process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX;else process.env.VINIPER_LOCAL_SSE_CAPTURE_PREFIX=beforePrefix;
  await rm(root,{recursive:true,force:true});
 }
});
