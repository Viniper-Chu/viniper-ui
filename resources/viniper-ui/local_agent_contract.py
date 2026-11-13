"""Read the local deployment's non-secret public policy for the desktop UI."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


def _matching_deployment(base_url, model=None):
    try:
        def endpoint(value):
            url = urlsplit(value)
            if url.username or url.password or url.query or url.fragment:
                raise ValueError('Local deployment endpoint must not contain credentials, query or fragment')
            return url.scheme, url.hostname, url.port, url.path.removesuffix('/chat/completions').rstrip('/')
        current = endpoint(base_url)
        if current[1] not in {'localhost', '127.0.0.1', '::1'}:
            return None
        path = Path(os.environ.get('VINIPER_LOCAL_AGENT_PROFILE') or Path.home()/'本地模型/开发维护/server-profile.json')
        data = json.loads(path.read_text())
        if endpoint(data['endpoint']) != current or (model and model != data['api_model']):
            return None
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def local_placeholder_auth(base_url, model):
    """Only a declared non-secret placeholder for this exact local deployment."""
    if not isinstance(model, str) or not model:
        return ''
    data = _matching_deployment(base_url, model)
    auth = data.get('authentication', {}) if data else {}
    if not isinstance(auth, dict) or auth.get('kind') != 'local-placeholder':
        return ''
    value = auth.get('value')
    return value if isinstance(value, str) else ''


def local_agent_contract(base_url, model=None):
    try:
        data = _matching_deployment(base_url, model)
        if not data:
            return None
        return {'model': data['api_model'], 'context_tokens': data['context_tokens'],
                'compact_at_tokens': data['compaction_trigger_tokens'], 'output_tokens': data['output_limit'],
                'max_iterations': data['max_iterations'],
                'default_reasoning': data.get('thinking_control', {}).get('default', 'medium'),
                'reasoning_options': ['off', *(['minimal'] if 'minimal' in data.get('thinking_control', {}).get('budget_tokens', {}) else []), 'low', 'medium', 'high'],
                'structured_tools_json': data.get('structured_tools_json') is True}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def local_model_notice(base_url, model=None):
    """Surface the matching deployment's deliberate stop, without restarting it."""
    if not _matching_deployment(base_url, model):
        return None
    profile = Path(os.environ.get('VINIPER_LOCAL_AGENT_PROFILE') or Path.home()/'本地模型/开发维护/server-profile.json')
    pause = profile.with_name('暂停运行.json')
    if not pause.is_file():
        return None
    try:
        reason = json.loads(pause.read_text()).get('reason')
    except (OSError, ValueError, AttributeError):
        reason = 'paused'
    if reason == 'specialist_training':
        return {'label': '本地模型正在维护', 'message': '本地模型正在训练或维护，暂时不能执行任务。恢复服务后可继续发送。'}
    cause = '因内存保护暂停' if reason == 'memory_guard' else '已暂停运行'
    return {'label': '本地模型已暂停', 'message': f'本地模型{cause}，暂时不能开始新任务。请先检查后台内存占用并恢复服务；已有会话和当前输入会保留。'}
