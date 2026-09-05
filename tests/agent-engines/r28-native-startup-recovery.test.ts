import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native startup recovers a missing resumed transcript once without replaying or losing the accepted turn", () => {
  const script = String.raw`
import ast, asyncio, contextlib, copy, io, json, os, re, sys, tempfile, time, uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

root = Path(sys.argv[1])
task = root.parents[1] / 'codex' / '工作输出' / 'viniper-agent-usability-r28-20260905'
task.mkdir(parents=True, exist_ok=True)
data_root = Path(tempfile.mkdtemp(prefix='native-startup-test-', dir=task))
os.environ['VINIPER_UI_DATA_DIR'] = str(data_root)
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'resources' / 'viniper-ui'))
from native_stream_protocol import initialize_native_stream, NativeStartupError, native_failure_message

# Execute the complete production generator, including recursive recovery and
# both finally blocks. Avoid server module startup, providers and user settings.
source_file = root / 'resources' / 'viniper-ui' / 'server.py'
source = ast.parse(source_file.read_text(encoding='utf-8-sig'), filename=str(source_file))
names = {
    'stream_claude_impl', 'new_claude_session_id', 'is_missing_claude_session_error',
    'is_claude_session_in_use_error', 'ChunkedLineReader', 'read_stderr', 'sse',
    'finalize_transcript_segments',
    'native_local_file_failure',
}
nodes = [node for node in source.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in names]
assert {node.name for node in nodes} == names
production = compile(ast.Module(body=nodes, type_ignores=[]), str(source_file), 'exec')

MISSING = 'No conversation found with session ID: 56669f4b-a61c-47cf-a8d2-ea58fcfaeea1'
ORIGINAL_UUID = '56669f4b-a61c-47cf-a8d2-ea58fcfaeea1'
PROMPT = 'fixture prompt; never sent to a provider'
ANSWER = 'fixture assistant completion'

def noop(*args, **kwargs):
    return None

class Input:
    def __init__(self): self.closed = False
    def close(self): self.closed = True
    def can_write_eof(self): return True
    def write_eof(self): self.closed = True

class Process:
    def __init__(self, number, failure):
        self.pid = 9000 + number
        self.process_identity = 'fixture-process-' + str(number)
        self.session_key = self.process_identity
        self.stdin = Input()
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stderr.feed_eof()
        self.returncode = None
        self.failure = failure
        self.inputs = []
        self.initialized = False
    def emit(self, event):
        self.stdout.feed_data((json.dumps(event) + '\n').encode('utf-8'))
    async def wait(self):
        if self.returncode is None: self.returncode = 1 if self.failure else 0
        return self.returncode

class WslRuntime:
    def __init__(self, failures):
        self.failures = failures
        self.specs = []
        self.processes = []
        self.cancelled = []
        self.finished = []
    def probe(self): return SimpleNamespace(ready=True)
    def capabilities(self): return SimpleNamespace(auto_compact=False)
    async def cleanup_stale(self, spec): pass
    async def spawn_session(self, spec):
        assert len(self.processes) < len(self.failures), 'unexpected extra native spawn'
        self.specs.append(spec)
        proc = Process(len(self.processes), self.failures[len(self.processes)])
        self.processes.append(proc)
        return proc
    def inspect_session_identity(self, key): return {'runtime_pid': 42, 'runtime_pgid': 42}
    async def cancel(self, session_id):
        proc = self.processes[-1]
        self.cancelled.append(proc.process_identity)
        proc.returncode = -15
    def mark_finished(self, session_id, proc):
        self.finished.append(proc.process_identity)

class Channel:
    def __init__(self, number, file_error=False):
        self.root = data_root / ('channel-' + str(number))
        self.terminals = []
        self.cleaned = False
        self.file_error = file_error
    def pending(self):
        if self.file_error:
            raise FileNotFoundError(2, 'fixture-hidden-body-do-not-log', str(data_root / 'fixture-private-directory' / 'failure.json'))
        return []
    def cancel_all(self, reason): raise AssertionError('no fixture interaction is unsettled')
    def finalize(self, status, **kwargs): self.terminals.append(status)
    def cleanup(self): self.cleaned = True

async def scenario(name, failures, *, accepted=False, initialized=True, host_file_error=False):
    runtime = WslRuntime(failures)
    sid = 'fixture-' + name
    accepted_id = str(uuid.uuid4()) if accepted else ''
    prior = [{'role': 'user', 'content': 'prior user'}, {'role': 'assistant', 'content': 'prior assistant'}]
    history = copy.deepcopy(prior)
    if accepted:
        history.extend([
            {'role': 'user', 'content': PROMPT, 'turn_id': accepted_id},
            {'role': 'assistant', 'content': '', 'pending': True, 'turn_id': accepted_id},
        ])
    session = {'id': sid, 'mode': 'claude', 'name': name, 'workdir': str(data_root),
               'claude_initialized': initialized, 'claude_session_id': ORIGINAL_UUID, 'messages': history}
    original_assistant = history[-1] if accepted else None
    channels, saved, journal_finishes, invocations = [], [], [], []

    def host_channel(*args, **kwargs):
        channel = Channel(len(channels), file_error=host_file_error)
        channels.append(channel)
        return channel, data_root / 'fixture-settings.json', None

    async def write(session_id, run, envelope, *, process_identity):
        proc = run['runtime_process']
        assert proc.process_identity == process_identity
        proc.inputs.append(copy.deepcopy(envelope))
        if envelope['type'] == 'control_request':
            assert envelope['request']['subtype'] == 'initialize'
            if proc.failure:
                proc.emit({'type': 'result', 'subtype': 'error_during_execution', 'is_error': True, 'errors': [proc.failure]})
                proc.stdout.feed_eof()
            else:
                proc.initialized = True
                proc.emit({'type': 'control_response', 'response': {
                    'subtype': 'success', 'request_id': envelope['request_id'],
                    'response': {'commands': [{'name': 'help', 'description': 'fixture'}]},
                }})
        elif envelope['type'] == 'user':
            assert proc.initialized and not proc.failure, 'user input preceded native initialization'
            proc.emit({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': ANSWER}]}})
            proc.emit({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': ANSWER})
            proc.stdout.feed_eof()
        else:
            raise AssertionError('unexpected native input')

    journal = SimpleNamespace(begin=noop, finish=lambda *args, **kwargs: journal_finishes.append(kwargs['status']))
    broker = SimpleNamespace(ack_status_for=noop, unsettled_for=lambda *args: False, invalidate=noop)
    ns = {
        'Any': Any, 'asyncio': asyncio, 'copy': copy, 'json': json, 'os': os, 'sys': sys,
        'time': time, 'uuid': uuid, 'Path': Path, 'STREAM_READ_CHUNK_SIZE': 65536,
        're': re,
        'initialize_native_stream': initialize_native_stream, 'NativeStartupError': NativeStartupError,
        'native_failure_message': native_failure_message, 'MODE_CLAUDE': 'claude',
        'WslAgentRuntime': WslRuntime, 'agent_runtime': lambda: runtime,
        'load_app_settings': lambda: {}, 'is_custom_shell': lambda value: False,
        'deepseek_config': lambda *args: {'api_key': 'fixture-only', 'label': 'Fixture', 'model': 'fixture-model'},
        'safe_session': lambda session_id: session, 'sessions': {sid: session}, '_active_runs': {},
        'context_limit_for_model': lambda *args, **kwargs: 8192,
        'claude_permission_mode': lambda value: 'default', 'now_ts': time.time,
        'save_sessions_to_disk': lambda: saved.append(copy.deepcopy(session)),
        'append_attachment_prompt': lambda prompt, attachments: prompt,
        'provider_model_id': lambda model: model, 'claude_fallback_model': lambda *args: '',
        'claude_native_model_id': lambda model, *args, **kwargs: model,
        'prepare_agent_system_prompt': lambda session: data_root / 'fixture-system.txt',
        'prepare_agent_host_channel': host_channel, 'existing_workdir': lambda value: data_root,
        'AgentRunSpec': lambda **kwargs: SimpleNamespace(**kwargs),
        'env_value': lambda name, default='': default, 'stable_session_name': lambda *args: 'fixture',
        'agent_add_dirs': lambda *args: [], 'build_claude_env': lambda *args, **kwargs: {},
        'runtime_bridge_keys': lambda *args: (), 'file_change_watch_roots': lambda cwd: [],
        'snapshot_watch_files': lambda roots: {}, 'snapshot_watch_text': lambda roots: {},
        'is_action_task_prompt': lambda prompt: False, 'clean_payload_value': lambda payload: payload,
        'clean_stream_text': lambda text: text, 'coordinated_run_snapshot': lambda sid: None,
        'agent_run_journal': lambda: journal, 'active_agent_input_channel': SimpleNamespace(write=write),
        'build_stream_json_user_envelope': lambda prompt, native_id: {
            'type': 'user', 'session_id': native_id, 'message': {'role': 'user', 'content': prompt}},
        'agent_interaction_broker': broker, 'RUN_TIMEOUT_SECONDS': 5,
        'daily_usage_ledger': lambda: SimpleNamespace(record_event=noop),
        'merge_turn_usage': lambda current, data: current,
        'context_usage_ledger': lambda: SimpleNamespace(update_from_event=noop),
        '_native_peer_messaging': SimpleNamespace(observe_event=lambda *args: []),
        'file_change_records': lambda *args: [], 'cleanup_agent_system_prompt': noop,
    }
    exec(production, ns)
    real_stream = ns['stream_claude_impl']

    async def traced_stream(*args, **kwargs):
        invocations.append(copy.deepcopy(kwargs))
        async for event in real_stream(*args, **kwargs): yield event

    ns['stream_claude_impl'] = traced_stream
    events = []
    logs = io.StringIO()
    with contextlib.redirect_stderr(logs):
        async for chunk in traced_stream(sid, PROMPT, accepted_turn_id=accepted_id):
            events.append(json.loads(chunk.removeprefix('data: ').strip()))

    assert session['messages'][:2] == prior, name
    assert len(session['messages']) == 4, (name, session['messages'])
    assert sum(item['role'] == 'user' and item['content'] == PROMPT for item in session['messages']) == 1
    answer = session['messages'][-1]
    assert answer['role'] == 'assistant' and 'pending' not in answer, (name, answer)
    assert sum(event['type'] == 'done' for event in events) == 1, (name, events)
    assert not ns['_active_runs'], name
    assert all(proc.stdin.closed and proc.returncode is not None for proc in runtime.processes), name
    assert all(channel.cleaned for channel in channels), name
    if accepted:
        assert answer is original_assistant and answer['turn_id'] == accepted_id, name
        assert session['messages'][-2]['turn_id'] == accepted_id, name

    recovered = initialized and failures[0] == MISSING
    expected_spawns = 2 if recovered else 1
    assert len(runtime.processes) == len(invocations) == expected_spawns, name
    if recovered:
        assert runtime.specs[0].resume is True and runtime.specs[0].claude_session_id == ORIGINAL_UUID
        assert runtime.specs[1].resume is False
        assert runtime.specs[1].claude_session_id != ORIGINAL_UUID
        assert str(uuid.UUID(runtime.specs[1].claude_session_id)) == runtime.specs[1].claude_session_id
        assert invocations[1]['retry_missing_session'] is True
        assert invocations[1]['suppress_user_message'] is True
        assert invocations[1]['accepted_turn_id'] == answer['turn_id']
        assert runtime.processes[0].inputs[0]['type'] == 'control_request'
        assert len(runtime.processes[0].inputs) == 1, 'failed initialization must not send a user message'
        assert session['claude_session_id'] == runtime.specs[1].claude_session_id

    succeeded = failures[-1] is None and not host_file_error
    user_inputs = [event for proc in runtime.processes for event in proc.inputs if event['type'] == 'user']
    if succeeded:
        assert len(user_inputs) == 1 and user_inputs[0]['message']['content'] == PROMPT, name
        assert user_inputs[0]['session_id'] == runtime.specs[-1].claude_session_id
        assert answer['content'] == ANSWER and answer['segments'] == [{'type': 'text', 'content': ANSWER}], (name, answer)
        assert session['last_run_status'] == 'completed' and session['claude_initialized'] is True, name
        assert saved[-1]['messages'][-1]['content'] == ANSWER and 'pending' not in saved[-1]['messages'][-1]
        assert not [event for event in events if event['type'] == 'error'], (name, events)
        assert journal_finishes == ['completed'] * expected_spawns, (name, journal_finishes)
        assert all(channel.terminals == ['completed'] for channel in channels), name
        assert runtime.processes[-1].process_identity not in runtime.cancelled, name
    else:
        assert len(user_inputs) == (1 if host_file_error else 0), name
        assert session['last_run_status'] == 'failed' and answer['content'].startswith('错误：'), (name, answer)
        assert len([event for event in events if event['type'] == 'error']) == 1, (name, events)
        assert journal_finishes == ['failed'] * expected_spawns, (name, journal_finishes)
        if host_file_error:
            assert '找不到 claude 命令' not in answer['content'], answer
            assert '本地' in answer['content'] and '文件' in answer['content'], answer
            assert runtime.processes[0].process_identity in runtime.cancelled
            assert 'fixture-hidden-body-do-not-log' not in logs.getvalue()
            assert 'fixture-private-directory' not in logs.getvalue()
            assert str(data_root) not in logs.getvalue()
            file_log = next(json.loads(line) for line in logs.getvalue().splitlines()
                            if json.loads(line).get('event') == 'native_local_file_error')
            assert file_log['process_started'] is True and file_log['errno'] == 2
            assert file_log['files'] == [{'basename': '[redacted].json', 'path_length': len(str(data_root / 'fixture-private-directory' / 'failure.json'))}]
            assert file_log['code_line'] > 0

    return {'name': name, 'spawns': expected_spawns, 'userEvents': len(user_inputs), 'status': session['last_run_status']}

async def main():
    receipts = [
        await scenario('missing-accepted-success', [MISSING, None], accepted=True),
        await scenario('missing-ordinary-success', [MISSING, None]),
        await scenario('401-no-retry', ['401 authentication_error'], accepted=True),
        await scenario('in-use-no-retry', ['Session ID fixture is already in use'], accepted=True),
        await scenario('missing-repeated-bounded', [MISSING, MISSING], accepted=True),
        await scenario('fresh-missing-no-retry', [MISSING], accepted=True, initialized=False),
        await scenario('spawned-local-file-error', [None], accepted=True, host_file_error=True),
    ]
    print(json.dumps({'cases': receipts, 'providerCalls': 0, 'realProcesses': 0, 'realUserDataReads': 0}))

asyncio.run(main())
`;
  const args = process.platform === "win32" ? ["-3", "-E", "-c", script, process.cwd()] : ["-c", script, process.cwd()];
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", args, {
    cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.trim());
  assert.deepEqual(receipt.cases, [
    { name: "missing-accepted-success", spawns: 2, userEvents: 1, status: "completed" },
    { name: "missing-ordinary-success", spawns: 2, userEvents: 1, status: "completed" },
    { name: "401-no-retry", spawns: 1, userEvents: 0, status: "failed" },
    { name: "in-use-no-retry", spawns: 1, userEvents: 0, status: "failed" },
    { name: "missing-repeated-bounded", spawns: 2, userEvents: 0, status: "failed" },
    { name: "fresh-missing-no-retry", spawns: 1, userEvents: 0, status: "failed" },
    { name: "spawned-local-file-error", spawns: 1, userEvents: 1, status: "failed" },
  ]);
  assert.equal(receipt.providerCalls, 0);
  assert.equal(receipt.realProcesses, 0);
  assert.equal(receipt.realUserDataReads, 0);
});
