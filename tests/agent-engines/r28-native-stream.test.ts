import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("native startup correlates ACK before user input and terminates cancellation, EOF and timeout", () => {
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", `
import sys, asyncio, json
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "resources/viniper-ui"))})
from native_stream_protocol import initialize_native_stream, native_control_success, native_failure_message
class Reader:
    def __init__(self, rows): self.rows = rows
    async def readline(self, timeout):
        if self.rows: return self.rows.pop(0)
        await asyncio.sleep(timeout)
        raise asyncio.TimeoutError()
async def main():
    written = []
    async def write(envelope): written.append(envelope)
    event = b'{"type":"system","subtype":"init"}\\n'
    ack = json.dumps({"type":"control_response", "response":{"request_id":"r28:init", "subtype":"success", "response":{"commands":[{"name":"help"}], "account":{"secret":"never"}}}}).encode()+b'\\n'
    metadata, events = await initialize_native_stream(Reader([event, ack]), write, "r28:init")
    assert events == [event] and metadata['commands'][0]['name'] == 'help'
    assert 'account' not in metadata and len(written) == 1
    assert written[0]['request']['subtype'] == 'initialize'
    assert written[0]['request'].get('forwardSubagentText') is True, 'Child output is projected into its own parent tool lane'
    for reader, kwargs, expected in ((Reader([b'']), {}, '退出'), (Reader([]), {'timeout':0.01}, '超时'), (Reader([]), {'cancelled':lambda:True}, '取消')):
        try: await initialize_native_stream(reader, write, 'r28:init', **kwargs)
        except RuntimeError as e: assert expected in str(e)
        else: raise AssertionError(expected)
    wire = native_control_success('permission:1', {'behavior':'allow', 'updatedInput':{'x':1}})
    assert wire['response']['request_id'] == 'permission:1'
    assert wire['response']['subtype'] == 'success'
    assert wire['response']['response']['updatedInput'] == {'x':1}
    assert '认证失败（401）' in native_failure_message('API Error: 401 sk-fixture-secret')
    assert 'sk-fixture' not in native_failure_message('API Error: 401 sk-fixture-secret')
    assert 'sk-fixture' not in native_failure_message('unknown sk-fixture-secret')
    assert '\\0' not in native_failure_message('w\\0s\\0l\\0: broken')
asyncio.run(main())
`], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
