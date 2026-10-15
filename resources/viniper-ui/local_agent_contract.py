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
