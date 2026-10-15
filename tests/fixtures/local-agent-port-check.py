"""CPU-only check of Python Application Port -> Node Runtime -> native tools."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import sys
from threading import Thread
from zipfile import ZipFile

root = Path(sys.argv[1]).resolve()
repository = Path(__file__).resolve().parents[2]
assert root.is_relative_to(repository / 'codex')
root.mkdir(parents=True, exist_ok=True)
docx, database = root / '中文 文档.docx', root / '中文 库.sqlite'
with ZipFile(docx, 'w') as archive:
    archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>旧文字</w:t></w:r></w:p></w:body></w:document>')
    archive.writestr('customXml/item1.xml', 'KEEP')
with sqlite3.connect(database) as con:
    con.executescript('CREATE TABLE notes(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO notes VALUES(1,"旧内容");')
requests, failures = [], []
scenario, step = 'no-tools', 0
literal = "O'Brien $HOME `literal` 中文"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_POST(self):
        global step
        try:
            value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path in ('/apply-template', '/tokenize'):
                result = {'prompt': json.dumps(value, ensure_ascii=False)} if self.path == '/apply-template' else {'tokens': list(range(len(value['content']))) }
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps(result).encode()); return
            requests.append({'scenario': scenario, 'reasoning': value.get('reasoning_budget_tokens'),
                             'tools': [t['function']['name'] for t in value.get('tools', [])]})
            assert self.path == '/v1/chat/completions', self.path
            assert value['max_tokens'] == 4096
            delta = {'content': '完成'}
            call = None
            if scenario == 'no-tools':
                assert not value.get('tools') and value['tool_choice'] == 'none'
                assert value['reasoning_budget_tokens'] == 0
                assert value['response_format']['type'] == 'json_schema'
                delta = {'content': '{"proof":"CPU fixture","value":1}'}
            elif scenario == 'docx':
                assert value['reasoning_budget_tokens'] == 1024
                assert set(requests[-1]['tools']) == {'file.docx.inspect', 'file.docx.edit'}
                if step == 0: call = ('file.docx.inspect', {'path': str(docx)})
                elif step == 1:
                    receipt = json.loads(value['messages'][-1]['content'])
                    assert receipt['paragraphs'][0]['text'] == '旧文字'
                    call = ('file.docx.edit', {'path': str(docx), 'paragraph': 0, 'expect': '旧文字', 'runs': {'0': literal}})
                else:
                    receipt = json.loads(value['messages'][-1]['content'])
                    assert receipt['verified'] and receipt['text'] == literal
            elif scenario == 'sqlite':
                assert value['reasoning_budget_tokens'] == 512
                if step == 0: call = ('file.sqlite.inspect', {'path': str(database)})
                elif step == 1:
                    assert json.loads(value['messages'][-1]['content'])['schema'][0]['name'] == 'notes'
                    call = ('file.sqlite.apply', {'path': str(database), 'transactions': [{'statements': [{'sql': 'UPDATE notes SET body=? WHERE id=?', 'params': [literal, 1], 'expect_rows': 1}]}], 'queries': [{'sql': 'SELECT body FROM notes WHERE id=?', 'params': [1]}]})
                else:
                    receipt = json.loads(value['messages'][-1]['content'])
                    assert receipt['transactions'][0]['status'] == 'committed' and receipt['readback'][0]['rows'] == [[literal]]
            elif scenario == 'readonly':
                assert requests[-1]['tools'] == ['file.read']
                if step == 0: call = ('file.read', {'path': str(root/'核对.md')})
            if call:
                delta = {'tool_calls': [{'index': 0, 'id': f'{scenario}-{step}', 'function': {'name': call[0], 'arguments': json.dumps(call[1], ensure_ascii=False)}}]}
            step += 1
            payload = 'data: ' + json.dumps({'choices': [{'delta': delta}], 'usage': {'prompt_tokens': 100, 'completion_tokens': 10, 'prompt_tokens_details': {'cached_tokens': 40}}}, ensure_ascii=False) + '\n\ndata: [DONE]\n\n'
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            self.wfile.write(payload.encode())
        except Exception as error:
            failures.append(repr(error)); self.send_response(500); self.end_headers()


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
endpoint = f'http://127.0.0.1:{server.server_port}/v1'
profile = root/'server-profile.json'
profile.write_text(json.dumps({'endpoint': endpoint, 'api_model': 'qwen-local', 'context_tokens': 16384,
    'compaction_trigger_tokens': 12288, 'output_limit': 4096, 'max_iterations': 96,
    'structured_tools_json': True, 'proof_first_json': True,
    'authentication': {'kind': 'local-placeholder', 'value': 'cpu-fixture-only'}}))
os.environ.update({'VINIPER_LOCAL_AGENT_PROFILE': str(profile), 'VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK': '0',
                   'VINIPER_UI_DEFAULT_WORKSPACE_ROOT': str(root), 'NO_PROXY': '127.0.0.1,localhost'})
sys.path.insert(0, str(repository/'resources/viniper-ui'))
from harness_application_port import HarnessApplicationPort
from context_usage import ContextUsageLedger
import ast

# Exercise the real server projection with the real persisted context ledger.
# Loading only this function avoids starting a second application/server.
server_source = ast.parse((repository/'resources/viniper-ui/server.py').read_text())
from local_agent_contract import local_agent_contract, local_placeholder_auth

# Stored cloud credentials must not be decrypted by local runs or status
# projection; changing the host/model/auth kind must retain the vault boundary.
provider = {'id': 'custom', 'base_url': endpoint, 'model': 'qwen-local'}
secret_reads = []
def read_secret(mode):
    secret_reads.append(mode)
    return 'dummy-remote-secret'
def secret_metadata(mode, action):
    assert action == 'status', 'public status cannot read credentials'
    return {'configured': True, 'access': 'not-checked'}
config_scope = {
    'Any': object, 'json': json, 'MODE_VINIPER': 'viniper', 'MODE_CLAUDE': 'claude',
    'MODE_SECRET_REFS': {'viniper': 'provider.deepseek', 'claude': 'provider.anthropic.api-key'},
    'normalize_provider_mode': lambda mode: mode,
    'load_app_settings': lambda: {}, 'provider_for_mode': lambda settings, mode: provider,
    'provider_env_names': lambda value: {'api_key': 'API_KEY', 'base_url': 'BASE_URL', 'model': 'MODEL'},
    'merged_env': lambda **kwargs: {}, 'allowed_model': lambda value, mode: value or provider['model'],
    'read_host_secret': read_secret, 'host_secret_configured': lambda mode: True,
    'provider_env_fallback': lambda value, mode: '', 'local_placeholder_auth': local_placeholder_auth,
    '_host_secret_request': secret_metadata,
}
config_nodes = [node for node in server_source.body if isinstance(node, ast.FunctionDef)
                and node.name in {'provider_config', 'public_provider'}]
exec(compile(ast.Module(body=config_nodes, type_ignores=[]), '<server credential projection>', 'exec'), config_scope)
assert config_scope['provider_config']()['api_key'] == 'cpu-fixture-only'
assert config_scope['provider_config'](resolve_secret=False)['api_key'] == ''
public = config_scope['public_provider'](provider, 'viniper')
assert public['api_key_configured'] and public['api_key_access'] == 'local-placeholder'
assert 'cpu-fixture-only' not in json.dumps(public)
assert 'cpu-fixture-only' not in json.dumps(local_agent_contract(endpoint))
assert not secret_reads
assert not local_placeholder_auth('https://example.test/v1', 'qwen-local')
assert not local_placeholder_auth(endpoint, 'different-model')
assert not local_placeholder_auth(endpoint, '')
assert not local_placeholder_auth(endpoint.replace('/v1', '/other'), 'qwen-local')
assert not local_placeholder_auth(endpoint+'?target=other', 'qwen-local')
provider['base_url'] = 'https://example.test/v1'
assert config_scope['provider_config'](resolve_secret=False)['api_key'] == ''
assert config_scope['public_provider'](provider, 'viniper')['api_key_access'] == 'not-checked'
assert not secret_reads
assert config_scope['provider_config']()['api_key'] == 'dummy-remote-secret'
assert secret_reads == ['viniper']
profile_data = json.loads(profile.read_text())
profile.write_text(json.dumps({**profile_data, 'authentication': {'kind': 'secret', 'value': 'not-a-placeholder'}}))
assert not local_placeholder_auth(endpoint, 'qwen-local')
profile.write_text(json.dumps(profile_data))

projection = next(node for node in server_source.body if isinstance(node, ast.FunctionDef) and node.name == 'record_local_context_budget')
ledger = ContextUsageLedger(root/'context-usage.json')
scope = {'Any': object, 'context_usage_ledger': lambda: ledger,
         'context_usage_payload': lambda sid, model: ledger.get(sid, model=model, context_limit=16384).as_dict()}
exec(compile(ast.Module(body=[projection], type_ignores=[]), '<server context projection>', 'exec'), scope)
usage = scope['record_local_context_budget']('local-window', {'input_tokens': 1082, 'context_tokens': 16384}, 'qwen-local')
assert usage['source'] == 'real' and usage['used_tokens'] == 1082 and usage['context_limit'] == 16384, usage
assert (root/'context-usage.json').is_file()


async def main():
    global scenario, step
    port = HarnessApplicationPort(runtime_script=repository/'resources/viniper-ui/harness_runtime_bridge.js', runtime_data_root=root/'data')
    (root/'核对.md').write_text('DONE')
    try:
        for scenario, reasoning, raw in [
            ('no-tools', 'off', '本轮不使用工具，解方程并输出严格JSON对象，顶层只有proof、value两个字段。'),
            ('docx', 'high', f'只用 file.docx.inspect、file.docx.edit 修改 {docx}。'),
            ('sqlite', 'medium', f'只用 file.sqlite.inspect、file.sqlite.apply 更新 {database}。'),
            ('readonly', 'medium', '本轮仅使用 read_file 读取核对.md。'),
        ]:
            step = 0
            events = [e async for e in port.stream(session_id='parity', prompt='Host guidance: return ordinary text.\n'+raw,
                user_text=raw, reasoning=reasoning, model='qwen-local', workdir=str(root), permission_mode='full',
                provider_id='custom', base_url=endpoint, host_secret_value='cpu-fixture-only')]
            assert not failures, failures
            assert events[-1]['type'] == 'runtime.completed' and events[-1]['status'] == 'run.completed', events[-1]
            projected = [e['event'] for e in events if e.get('type') == 'provider.event']
            budgets = [e for e in projected if e.get('type') == 'context_budget']
            assert budgets and all(e['input_tokens'] > 0 and e['context_tokens'] == 16384 for e in budgets), 'Counts must survive the real bridge redaction boundary'
            for event in budgets:
                actual = scope['record_local_context_budget']('actual-wire', event, 'qwen-local')
                assert actual['used_tokens'] == event['input_tokens'] and actual['source'] == 'real'
            usage = [e['turn_usage'] for e in projected if e.get('type') == 'turn_usage'][-1]
            assert usage['cache_read_input_tokens'] > 0
            assert usage['total_tokens'] == usage['input_tokens'] + usage['output_tokens'] + usage['cache_read_input_tokens'] + usage['cache_creation_input_tokens'], usage
            visible_calls = [e['event'] for e in events if e.get('type') == 'provider.event' and e.get('event', {}).get('type') == 'tool_start']
            if scenario != 'no-tools':
                assert visible_calls and all(c['input'].get('path') for c in visible_calls), 'Frontend must receive actual tool inputs'
        with sqlite3.connect(database) as con:
            assert con.execute('SELECT body FROM notes').fetchall() == [(literal,)]
        with ZipFile(docx) as archive:
            assert archive.read('customXml/item1.xml') == b'KEEP'
        print(json.dumps({'status': 'PASS', 'requests': requests, 'model_calls': 0}, ensure_ascii=False))
    finally:
        await port.shutdown()
        server.shutdown(); server.server_close()


asyncio.run(main())
