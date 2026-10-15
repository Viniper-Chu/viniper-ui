import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

test("desktop HTTP rejects cross-site calls and DNS rebinding before any route executes", () => {
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", `
import asyncio, sys
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "resources/viniper-ui"))})
from local_request_guard import LocalRequestGuard
async def verify():
    calls=[]
    async def endpoint(scope,receive,send):
        calls.append(scope['path'])
        await send({'type':'http.response.start','status':200})
    app=LocalRequestGuard(endpoint, 17947)
    for method in ('GET','POST','PUT','DELETE','OPTIONS'):
        for headers, expected in (
            ({'host':'127.0.0.1:17947'},200),
            ({'host':'localhost:17947','origin':'http://localhost:17947'},200),
            ({'host':'127.0.0.1:17947','origin':'http://127.0.0.1:17947'},200),
            ({'host':'evil.example:17947'},403),
            ({'host':'127.0.0.1:17947','origin':'https://evil.example'},403),
            ({'host':'127.0.0.1:17947','origin':'null'},403),
            ({'host':'127.0.0.1:17947','origin':'http://localhost:17948'},403),
            ({'host':'127.0.0.1:17947','sec-fetch-site':'cross-site'},403),
        ):
            messages=[]
            async def send(message): messages.append(message)
            before=len(calls)
            await app({'type':'http','method':method,'path':'/api/sessions',
                'headers':[(k.encode(),v.encode()) for k,v in headers.items()]},None,send)
            assert messages[0]['status']==expected, (headers,messages)
            assert len(calls)-before == (1 if expected==200 else 0)
    for headers, allowed in (
        ({'host':'127.0.0.1:17947','origin':'http://127.0.0.1:17947'},True),
        ({'host':'127.0.0.1:17947'},False),
        ({'host':'127.0.0.1:17947','origin':'null'},False),
        ({'host':'127.0.0.1:17947','origin':'https://evil.example'},False),
        ({'host':'evil.example:17947','origin':'http://127.0.0.1:17947'},False),
        ({'host':'127.0.0.1:17947','origin':'http://127.0.0.1:17947','sec-fetch-site':'cross-site'},False),
    ):
        messages=[]
        async def send(message): messages.append(message)
        before=len(calls)
        await app({'type':'websocket','path':'/api/claude-terminal/fixture/stream',
            'headers':[(k.encode(),v.encode()) for k,v in headers.items()]},None,send)
        assert len(calls)-before == int(allowed), (headers,messages)
        if not allowed: assert messages[0]['type']=='websocket.close' and messages[0]['code']==1008
asyncio.run(verify())
`,
  ], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
