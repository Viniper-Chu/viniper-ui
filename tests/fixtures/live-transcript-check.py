"""Reading a running transcript must preserve the boundary before the next delta."""
import ast
from pathlib import Path
import copy

source = Path('resources/viniper-ui/server.py').read_text()
names = {'strip_goal_control_markers', 'is_leaked_goal_control_message', 'sanitize_goal_session_messages'}
module = ast.parse(source)
selected = ast.Module(body=[n for n in module.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
space = {'Any': object, 'GOAL_DONE_MARKER': '[VINIPER_GOAL_DONE]', 'GOAL_CONTINUE_MARKER': '[VINIPER_GOAL_CONTINUE]'}
exec(compile(selected, 'server.py', 'exec'), space)
for prefix, suffix in [
    ('| 组别 | 数量 |\n| --- | --- |\n', '| 甲组 | 12 |\n'),
    ('```python\nfor x in rows:\n    ', 'print(x)\n```'),
    ('English word ', 'boundary'),
]:
    session = {'messages': [{'role': 'assistant', 'pending': True, 'content': prefix, 'thinking': '思考\n', 'segments': [{'type': 'text', 'content': prefix}]}]}
    original = copy.deepcopy(session)
    space.update(safe_session=lambda _id: session, sessions={'test': session}, now_ts=lambda: 0, save_sessions_to_disk=lambda: None)
    space['sanitize_goal_session_messages']('test')
    assert session == original, 'Snapshot stripped live whitespace before a subsequent delta'
    assert session['messages'][-1]['content'] + suffix == prefix + suffix
assert space['strip_goal_control_markers']('正文\n[VINIPER_GOAL_DONE]\n') == '正文\n\n'
print('PASS: stream snapshots preserve table boundaries, code indentation and word spacing')

import importlib.util
import json
import os
import sys
profile_root = Path(sys.argv[1]).resolve()
profile = profile_root / 'server-profile.json'
profile.write_text(json.dumps({'endpoint': 'http://127.0.0.1:18080/v1', 'api_model': 'qwen-local'}))
os.environ['VINIPER_LOCAL_AGENT_PROFILE'] = str(profile)
spec = importlib.util.spec_from_file_location('local_contract', 'resources/viniper-ui/local_agent_contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
assert contract.local_model_notice('http://127.0.0.1:18080/v1', 'qwen-local') is None
pause = profile.with_name('暂停运行.json'); pause.write_text('{"reason":"memory_guard"}')
assert contract.local_model_notice('http://127.0.0.1:18080/v1', 'qwen-local')['label'] == '本地模型已暂停'
assert contract.local_model_notice('https://api.example.com/v1', 'qwen-local') is None
assert contract.local_model_notice('http://127.0.0.1:18080/v1', 'different-model') is None
assert pause.read_text() == '{"reason":"memory_guard"}'
pause.unlink()
assert contract.local_model_notice('http://127.0.0.1:18080/v1', 'qwen-local') is None
print('PASS: matching local protection status is visible and never cleared by the UI')

policy = {"normal_reasoning":"medium","reasoning_options":["auto","off","low","medium","high"]}
for text, expected in [
    ("你好！","off"), ("@主答 请心算 6×7，只回复阿拉伯数字。本轮不使用工具。","off"),
    ("只回复「收到」","off"), ("证明这个不等式","high"), ("你好，请帮我核对整个项目","medium"),
    ("41+1，再证明一个结论","high"), ("继续","medium"),
]:
    assert contract.choose_local_effort(text,policy)==expected, text
assert contract.choose_local_effort("你好",policy,attachments=True)=="medium"
assert contract.choose_local_effort("你好",policy,task_mode="plan")=="high"
