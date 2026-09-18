import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("official DeepSeek Claude defaults override stale Kimi mappings and cross the WSL bridge without forcing explicit subagent models", () => {
  const script = String.raw`
import ast, copy, json, os, re, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping

root = Path(sys.argv[1])
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'resources' / 'viniper-ui'))
import agent_runtime
from model_catalog import PROVIDER_MODEL_ALIASES
from agent_runtime import AgentRunSpec, WslAgentRuntime
from agent_host_bridge import HostInteractionChannel, build_permission_prompt_mcp_config

# No server import, settings-file access, inherited credentials or native spawn.
source_file = root / 'resources' / 'viniper-ui' / 'server.py'
tree = ast.parse(source_file.read_text(encoding='utf-8-sig'), filename=str(source_file))
functions = {
    'build_claude_env', 'provider_model_id', 'runtime_bridge_keys',
    'official_deepseek_claude_models', 'claude_native_model_id', 'prepare_agent_host_channel',
}
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in functions]
assert {node.name for node in nodes} == functions
aliases = next(node for node in tree.body if isinstance(node, ast.Assign) and any(
    isinstance(target, ast.Name) and target.id == 'DEEPSEEK_PROVIDER_MODEL_ALIASES' for target in node.targets))

endpoint = 'https://api.deepseek.com/anthropic'
pro = 'deepseek-v4-pro[1m]'
flash = 'deepseek-flash'
default_keys = (
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
)
fake_settings = {'env': {
    'ANTHROPIC_DEFAULT_SONNET_MODEL': 'Kimi-K3',
    'ANTHROPIC_DEFAULT_OPUS_MODEL': 'Kimi-K3',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL': 'Kimi-K2.5',
    'CLAUDE_CODE_SUBAGENT_MODEL': 'Kimi-K3',
}}
fake_host_env = {
    'ANTHROPIC_MODEL': 'Kimi-K3', 'FIXTURE_MODEL': 'Kimi-K3',
    'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST': 'legacy-fixture',
    'HTTP_PROXY': 'http://127.0.0.1:7890', 'NO_PROXY': 'localhost',
    'WSLENV': 'EXISTING/p:ANTHROPIC_MODEL',
}
provider_names = {'api_key': 'ANTHROPIC_AUTH_TOKEN', 'base_url': 'FIXTURE_BASE_URL', 'model': 'FIXTURE_MODEL'}
session = {'id': 'fixture-session', 'claude_agents': [
    {'name': 'explicit-agent', 'description': 'fixture', 'prompt': 'fixture', 'model': 'opus'},
]}
settings_before, env_before, session_before = copy.deepcopy(fake_settings), dict(fake_host_env), copy.deepcopy(session)
build_calls = []

def build_agent_env(cfg, session, **kwargs):
    build_calls.append(kwargs)
    return {**fake_settings['env'], **fake_host_env}

def forbidden(*args, **kwargs):
    raise AssertionError('fixture must not request a provider or start a process')

ns = {
    'PROVIDER_MODEL_ALIASES': PROVIDER_MODEL_ALIASES,
    'Any': Any, 'Mapping': Mapping, 'MODE_CLAUDE': 'claude', 'MODE_VINIPER': 'viniper',
    'normalize_provider_mode': lambda mode: mode,
    'provider_config': forbidden,
    'build_agent_env': build_agent_env,
    'load_app_settings': lambda: copy.deepcopy(fake_settings),
    'provider_for_mode': lambda settings, mode: {'id': 'fixture'},
    'provider_env_names': lambda provider: dict(provider_names),
    'AUTO_COMPACT_WINDOW_ENV': agent_runtime.AUTO_COMPACT_WINDOW_ENV,
    'DEFAULT_DEEPSEEK_BASE_URL': endpoint,
    'WslAgentRuntime': WslAgentRuntime, 'WindowsNativeRuntime': agent_runtime.WindowsNativeRuntime,
    'HostInteractionChannel': HostInteractionChannel, 'Path': Path,
}
exec(compile(ast.Module(body=[aliases, *nodes], type_ignores=[]), str(source_file), 'exec'), ns)

def build(model, base_url=endpoint, mode='claude'):
    return ns['build_claude_env']({
        'model': model, 'base_url': base_url, 'api_key': 'fixture-token',
        'api_key_env': 'ANTHROPIC_AUTH_TOKEN',
    }, session, mode=mode, effective_context_window=1048576, auto_compact_supported=False)

positives = []
for selected_model in (pro, 'deepseek-v4-pro', flash, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-flash[1m]'):
    for suffix in ('', '/'):
        result = build(selected_model, endpoint + suffix)
        main = pro if selected_model in (pro, 'deepseek-v4-pro') else flash + '[1m]'
        assert result['ANTHROPIC_MODEL'] == main, (selected_model, result['ANTHROPIC_MODEL'])
        assert result[provider_names['model']] == main
        assert result['ANTHROPIC_DEFAULT_SONNET_MODEL'] == flash + '[1m]'
        assert result['ANTHROPIC_DEFAULT_OPUS_MODEL'] == flash + '[1m]'
        assert result['ANTHROPIC_DEFAULT_HAIKU_MODEL'] == flash
        assert result['CLAUDE_CODE_SUBAGENT_MODEL'] == flash
        assert result['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] == 'legacy-fixture'
        assert 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' not in result
        assert result['ANTHROPIC_AUTH_TOKEN'] == 'fixture-token'
        assert result['ANTHROPIC_BASE_URL'] == endpoint + suffix
        assert result['CLAUDE_CODE_MAX_RETRIES'] == '1'
        cfg = {'model': selected_model, 'base_url': endpoint + suffix}
        assert ns['claude_native_model_id'](selected_model, cfg, mode='claude') == main
        assert ns['official_deepseek_claude_models'](cfg, mode='claude') == {
            'ANTHROPIC_MODEL': main,
            'ANTHROPIC_DEFAULT_SONNET_MODEL': flash + '[1m]',
            'ANTHROPIC_DEFAULT_OPUS_MODEL': flash + '[1m]',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL': flash,
            'CLAUDE_CODE_SUBAGENT_MODEL': flash,
        }
        positives.append(result)

# HTTP request normalization remains independent of the CLI context suffix.
assert ns['provider_model_id'](pro) == 'deepseek-v4-pro'
assert ns['provider_model_id']('deepseek-v4-pro') == 'deepseek-v4-pro'
assert ns['provider_model_id'](flash) == flash
assert ns['provider_model_id']('Kimi-K3') == 'Kimi-K3'

negatives = [
    (pro, 'https://proxy.example/anthropic', 'claude'),
    (pro, 'https://api.deepseek.com.example/anthropic', 'claude'),
    (pro, 'https://api.deepseek.com/anthropic-other', 'claude'),
    (pro, 'https://api.deepseek.com/anthropic?proxy=1', 'claude'),
    (pro, 'http://api.deepseek.com/anthropic', 'claude'),
    (pro, endpoint, 'viniper'),
    ('Kimi-K3', endpoint, 'claude'),
    ('deepseek-chat', endpoint, 'claude'),
]
for model, base_url, mode in negatives:
    result = build(model, base_url, mode)
    assert result['ANTHROPIC_MODEL'] == ns['provider_model_id'](model), (model, base_url, mode)
    assert result[provider_names['model']] == ns['provider_model_id'](model)
    for key in default_keys:
        assert result[key] == fake_settings['env'][key], (key, model, base_url, mode)
    assert result['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] == 'legacy-fixture'
    assert 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' not in result
    cfg = {'model': model, 'base_url': base_url}
    assert ns['official_deepseek_claude_models'](cfg, mode=mode) == {}
    assert ns['claude_native_model_id'](model, cfg, mode=mode) == ns['provider_model_id'](model)
    excluded_keys = ns['runtime_bridge_keys'](mode, cfg=cfg)
    assert 'ANTHROPIC_DEFAULT_OPUS_MODEL' not in excluded_keys
    assert 'ANTHROPIC_DEFAULT_HAIKU_MODEL' not in excluded_keys

keys = ns['runtime_bridge_keys']('claude', cfg={'model': pro, 'base_url': endpoint})
required = ('ANTHROPIC_MODEL', *default_keys)
assert all(key in keys for key in required), keys
assert len(keys) == len(set(keys))
assert 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' not in keys
assert 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST' not in keys

# Both native launch routes must use the CLI-specific model selector; the
# HTTP-facing provider_model_id remains independently tested above.
for name in ('stream_claude_impl', 'execute_claude_native_command'):
    launch = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == name)
    assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
               and node.func.id == 'claude_native_model_id' for node in ast.walk(launch)), name

# Exercise the real runtime bridge with a synthetic os module. This neither
# reads nor alters the host's environment or invokes WSL/proxy discovery.
real_os_module = agent_runtime.os
real_environment_object = os.environ
synthetic_env = dict(fake_host_env)
synthetic_before = dict(synthetic_env)
resolved_proxies = []
def resolve_proxy(value):
    resolved_proxies.append(value)
    return value.replace('127.0.0.1', '192.0.2.10')

runtime = WslAgentRuntime(command_runner=forbidden, process_factory=forbidden, proxy_resolver=resolve_proxy)
agent_runtime.os = SimpleNamespace(environ=synthetic_env)
try:
    for result in positives:
        selected = copy.deepcopy(result)
        agents = {'explicit-agent': {'description': 'fixture', 'prompt': 'fixture', 'model': 'opus'}}
        spec = AgentRunSpec(
            session_id='fixture-session', claude_session_id='56669f4b-a61c-47cf-a8d2-ea58fcfaeea1',
            session_name='fixture', workdir=str(root), model=result['ANTHROPIC_MODEL'],
            permission_mode='default', resume=False, environment=selected, bridge_keys=keys, agents=agents,
        )
        bridged = runtime._bridge_environment(spec)
        for key in required:
            assert bridged[key] == result[key], key
        wslenv = bridged['WSLENV'].split(':')
        exported_names = [item.split('/', 1)[0] for item in wslenv]
        assert all(exported_names.count(key) == 1 for key in required), wslenv
        assert 'EXISTING/p' in wslenv
        assert bridged['HTTP_PROXY'] == 'http://192.0.2.10:7890'
        assert 'HTTP_PROXY' in exported_names and 'NO_PROXY' in exported_names
        assert 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' not in bridged
        assert bridged['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] == 'legacy-fixture'
        assert spec.environment == result and selected == result
        assert spec.agents['explicit-agent']['model'] == 'opus'
        assert synthetic_env == synthetic_before
finally:
    agent_runtime.os = real_os_module

assert os.environ is real_environment_object
assert fake_settings == settings_before and fake_host_env == env_before and session == session_before
assert all(call['effective_context_window'] == 1048576 and call['auto_compact_supported'] is False for call in build_calls)
assert resolved_proxies == ['http://127.0.0.1:7890'] * len(positives)

# Write/read the actual run-local --settings file, retaining the existing hook
# and safety payload. Only the five model environment names are added.
task = root.parents[1] / 'codex' / '工作输出' / 'viniper-agent-usability-r28-20260905'
task.mkdir(parents=True, exist_ok=True)
data_root = Path(tempfile.mkdtemp(prefix='deepseek-mapping-test-', dir=task))
hook_payload = {
    'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'fixture-hook'}]}]},
    'permissions': {'deny': ['Bash(fixture-denied:*)']},
    'sandbox': {'enabled': True},
}
class FixtureWsl:
    def map_path(self, value): return '/fixture/' + Path(value).name

ns.update({
    're': re, 'json': json, '__file__': str(source_file), 'DATA_DIR': data_root,
    'WslAgentRuntime': FixtureWsl,
    'build_passive_hook_settings': lambda: copy.deepcopy(hook_payload),
    'build_hook_settings': forbidden,
    'build_permission_prompt_mcp_config': build_permission_prompt_mcp_config,
})
settings_cases = 0
for model, base_url, mode in [(pro, endpoint, 'claude'), (flash, endpoint + '/', 'claude'), *negatives]:
    cfg = {'model': model, 'base_url': base_url, 'api_key': 'must-not-enter-settings'}
    channel, path, mcp_path = ns['prepare_agent_host_channel'](
        FixtureWsl(), 'fixture-session', 'run-' + str(settings_cases), provider_cfg=cfg, mode=mode,
    )
    payload = json.loads(path.read_text(encoding='utf-8'))
    mapping = ns['official_deepseek_claude_models'](cfg, mode=mode)
    expected = {**hook_payload, **({'env': mapping} if mapping else {})}
    assert payload == expected, (model, base_url, mode, payload)
    assert path.is_relative_to(data_root) and mcp_path.is_relative_to(data_root)
    assert mcp_path.is_file() and channel.root == path.parent
    if mapping:
        assert set(payload['env']) == set(required)
        assert all('Kimi' not in value for value in payload['env'].values())
    assert 'must-not-enter-settings' not in path.read_text(encoding='utf-8')
    assert 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST' not in payload.get('env', {})
    assert 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' not in payload.get('env', {})
    settings_cases += 1

print(json.dumps({'positiveCases': len(positives), 'unchangedCases': len(negatives), 'wslBridgeCases': len(positives),
                  'runLocalSettingsCases': settings_cases, 'providerCalls': 0, 'nativeProcesses': 0,
                  'realSettingsReads': 0, 'globalEnvironmentMutations': 0}))
`;
  const args = process.platform === "win32" ? ["-3", "-E", "-c", script, process.cwd()] : ["-c", script, process.cwd()];
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", args, {
    cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    positiveCases: 12, unchangedCases: 8, wslBridgeCases: 12,
    runLocalSettingsCases: 10, providerCalls: 0, nativeProcesses: 0,
    realSettingsReads: 0, globalEnvironmentMutations: 0,
  });
});
