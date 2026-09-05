import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Windows long host-channel paths preserve atomic interaction, response and acknowledgement writes", () => {
  const script = String.raw`
import concurrent.futures, json, os, sys, tempfile, threading, uuid
from pathlib import Path

root = Path(sys.argv[1])
task = root.parents[1] / 'codex' / '工作输出' / 'viniper-agent-usability-r28-20260905'
task.mkdir(parents=True, exist_ok=True)
data_root = Path(tempfile.mkdtemp(prefix='host-long-', dir=task))
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'resources' / 'viniper-ui'))
import agent_host_bridge as bridge

opens = []
def audit(event, args):
    if event == 'open' and isinstance(args[0], str) and args[0].startswith(str(data_root)):
        flags = args[2]
        if isinstance(flags, int) and flags & os.O_CREAT:
            opens.append((args[0], flags))
sys.addaudithook(audit)

receipts = []
# The longest final ACK name is 70 characters below the host root. At 189
# the final path is 259; a 190-character root exceeds legacy Windows MAX_PATH.
for length in (177, 189):
    padding = length - len(str(data_root)) - 1
    assert padding > 0, str(data_root)
    host_root = data_root / ('x' * padding)
    assert len(str(host_root)) == length
    channel = bridge.HostInteractionChannel(host_root, session_id='fixture-session', run_id='fixture-run')
    channel.bind_process_identity('fixture-process')
    bridge_id = uuid.uuid4().hex
    request_id = 'fixture-permission'
    channel.record_interaction(bridge_id, request_id, 'permission', 'Bash')
    interaction_path = host_root / 'interaction-meta' / (bridge_id + '.json')
    interaction_before = interaction_path.read_bytes()
    try:
        channel.record_interaction(bridge_id, 'overwrite-must-fail', 'question', 'Read')
    except FileExistsError:
        pass
    else:
        raise AssertionError('create_only must reject a second interaction record')
    assert interaction_path.read_bytes() == interaction_before

    decision = {'behavior': 'allow', 'updatedInput': {'command': 'fixture-only'}}
    channel.respond(bridge_id, decision, action='allow')
    response_path = channel.responses / (bridge_id + '.json')
    response_before = response_path.read_bytes()
    channel.respond(bridge_id, decision, action='allow')
    try:
        channel.respond(bridge_id, {'behavior': 'deny'}, action='deny')
    except FileExistsError:
        pass
    else:
        raise AssertionError('a different response must not overwrite the first decision')
    assert response_path.read_bytes() == response_before
    for stage in ('response_read', 'stdout_written_and_flushed', 'hook_exit'):
        assert bridge._record_ack_stage(host_root, bridge_id, stage, exit_code=0)
        assert not bridge._record_ack_stage(host_root, bridge_id, stage, exit_code=99)
    assert channel.record_cli_tool_result(bridge_id, request_id, success=True)
    assert not channel.record_cli_tool_result(bridge_id, request_id, success=False)
    ack = channel.acknowledgement(bridge_id)
    assert ack['stage'] == 'cli_tool_result' and ack['cli_tool_result_success'] is True
    assert ack['request_id'] == request_id and ack['hook_exit_code'] == 0
    assert ack['stages'] == ['response_committed', 'response_read', 'stdout_written_and_flushed', 'hook_exit', 'cli_tool_result']

    # At the commit boundary, the previous target is still intact and the
    # temporary file already contains the complete new JSON document.
    target = host_root / 'atomic.json'
    bridge._atomic_json(target, {'generation': 'before'})
    original_replace = bridge.os.replace
    replacements = []
    def observed_replace(source, destination):
        assert Path(destination) == target
        assert json.loads(target.read_text(encoding='utf-8')) == {'generation': 'before'}
        assert json.loads(Path(source).read_text(encoding='utf-8')) == {'generation': 'after'}
        replacements.append(str(source))
        return original_replace(source, destination)
    bridge.os.replace = observed_replace
    try:
        bridge._atomic_json(target, {'generation': 'after'})
    finally:
        bridge.os.replace = original_replace
    assert len(replacements) == 1
    assert json.loads(target.read_text(encoding='utf-8')) == {'generation': 'after'}

    # Competing create-only writers must expose exactly one complete winner.
    contested = host_root / 'one-winner.json'
    barrier = threading.Barrier(8)
    def compete(number):
        payload = {'writer': number, 'body': 'fixture-' + str(number) * 500}
        barrier.wait(timeout=10)
        try:
            bridge._atomic_json(contested, payload, create_only=True)
            return payload
        except FileExistsError:
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(compete, range(8)))
    winners = [payload for payload in outcomes if payload is not None]
    assert len(winners) == 1
    assert json.loads(contested.read_text(encoding='utf-8')) == winners[0]
    assert not list(host_root.rglob('*.tmp')), 'temporary files must be removed after success or collision'
    summary = json.loads(channel.finalize('completed').read_text(encoding='utf-8'))
    assert summary['terminal'] == 'completed'
    assert summary['requests'][bridge_id]['cli_tool_result_success'] is True
    receipts.append({'hostRootLength': length, 'interactionPathLength': len(str(interaction_path)), 'winnerCount': len(winners)})

assert opens and all(flags & os.O_EXCL for path, flags in opens), 'temporary JSON creation must be exclusive'
temporary_names = [path for path, flags in opens]
assert len(temporary_names) == len(set(temporary_names)), 'each write must own a different temporary file'
assert not list(data_root.rglob('*.tmp'))
print(json.dumps({'platform': sys.platform, 'cases': receipts, 'providerCalls': 0, 'formalDataWrites': 0}))
`;
  const args = process.platform === "win32" ? ["-3", "-E", "-c", script, process.cwd()] : ["-c", script, process.cwd()];
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", args, {
    cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.platform, process.platform);
  assert.deepEqual(receipt.cases.map((item: { hostRootLength: number; winnerCount: number }) => ({
    hostRootLength: item.hostRootLength, winnerCount: item.winnerCount,
  })), [
    { hostRootLength: 177, winnerCount: 1 },
    { hostRootLength: 189, winnerCount: 1 },
  ]);
  assert.equal(receipt.providerCalls, 0);
  assert.equal(receipt.formalDataWrites, 0);
});
