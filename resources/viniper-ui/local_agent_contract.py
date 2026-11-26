"""Read the local deployment's non-secret public policy for the desktop UI."""
import re
import json
import os
import time
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
        control = data.get('thinking_control', {})
        levels = ('minimal', 'low', 'medium', 'high', 'xhigh', 'max')
        default = control.get('default', 'medium')
        if default == 'off':
            default = 'none'
        aliases = {}
        if control.get('protocol') == 'reasoning_effort':
            supported = control.get('supported_efforts')
            if not isinstance(supported, list):
                return None
            options = [level for level in ('none', *levels) if level in supported]
            declared_aliases = control.get('effort_aliases', {})
            if isinstance(declared_aliases, dict):
                aliases = {key: value for key, value in declared_aliases.items()
                           if key in options and value in options and value not in declared_aliases}
                options = [level for level in options if level not in aliases]
                default = aliases.get(default, default)
            if not options:
                return None
            if default not in options:
                default = options[0]
        else:
            budgets = control.get('budget_tokens', {'low': 256, 'medium': 512, 'high_and_above': 1024})
            options = ['none'] + [level for level in levels if budgets.get(level, budgets.get('high_and_above') if level == 'high' else 0)]
        return {'model': data['api_model'], 'context_tokens': data['context_tokens'],
                'compact_at_tokens': data['compaction_trigger_tokens'], 'output_tokens': data['output_limit'],
                'max_iterations': data['max_iterations'],
                'default_reasoning': 'auto',
                'normal_reasoning': default if default in options else options[-1],
                'reasoning_options': ['auto', *options],
                'reasoning_aliases': aliases,
                'none_disables_thinking': control.get('protocol') != 'reasoning_effort',
                'structured_tools_json': data.get('structured_tools_json') is True}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def choose_local_effort(text, contract, *, task_mode="execute", attachments=False, skills=False):
    """Choose once per user turn; manual levels bypass this function."""
    prompt = re.sub(r"^(?:@[\w-]+[：:,，\s]+)+", "", str(text or "").strip())
    options = contract["reasoning_options"]
    normal = contract["normal_reasoning"]
    quiet = "none" if "none" in options else "off" if "off" in options else normal
    if re.search(r"证明|论证|推导|参数题|参数.{0,12}(?:范围|取值)|含参|实根|单调|分类讨论|复核|验算|定稿|解方程|不等式|排查|调试|规划|\b(?:prove|proof|derive|debug)\b", prompt, re.I) or task_mode in {"plan", "goal"}:
        return "high" if "high" in options else normal
    if attachments or skills:
        return normal
    greeting = r"(?:你好(?:呀|啊|吗)?|您好|早上好|下午好|晚上好|谢谢(?:你)?|多谢|收到|再见|在吗|hi|hello|thanks|thank you)"
    arithmetic = r"(?:请)?(?:帮我)?(?:心算|计算|算一下|算算|求)?\s*[-+]?\d{1,2}\s*[+＋×*÷/−-]\s*[-+]?\d{1,2}(?:\s*(?:=|等于|是)?\s*(?:多少|几))?"
    suffix = r"(?:[，,。；;]\s*(?:只(?:需)?(?:回复|回答)(?:阿拉伯数字|数字|结果|答案)|本轮不使用工具))*[。.!！?？\s]*"
    if re.fullmatch(r"(?:" + greeting + "|" + arithmetic + ")" + suffix, prompt, re.I):
        return quiet
    if re.fullmatch(r"(?:请)?只(?:需)?(?:回复|输出|回答)[：:\s]*[“「][^”」\n]{1,64}[”」][。！!\s]*", prompt):
        return quiet
    return normal


def local_model_notice(base_url, model=None):
    """Surface the matching deployment's deliberate stop, without restarting it."""
    if not _matching_deployment(base_url, model):
        return None
    profile = Path(os.environ.get('VINIPER_LOCAL_AGENT_PROFILE') or Path.home()/'本地模型/开发维护/server-profile.json')
    pause = profile.with_name('暂停运行.json')
    try:
        state = json.loads((profile.parent/'logs/server-state.json').read_text())
        fresh = 0 <= time.time() - float(state.get('updated_at', 0)) < 15
    except (OSError, ValueError, TypeError, AttributeError):
        state, fresh = {}, False
    if not pause.is_file():
        if fresh and state.get('waiting_for_cold_start'):
            return {'label':'等待启动','message':'本地模型正在检查启动所需内存，草稿可继续编辑。'}
        if fresh and state.get('cold_wake_blocked'):
            return {'label':'等待唤醒', 'message':'本地模型已休眠，正在等待内存余量恢复。可以先输入题目。'}
        return None
    try:
        reason = json.loads(pause.read_text()).get('reason')
    except (OSError, ValueError, AttributeError):
        reason = 'paused'
    if reason == 'specialist_training':
        return {'label': '本地模型正在维护', 'message': '本地模型正在训练或维护，暂时不能执行任务。恢复服务后可继续发送。'}
    if reason == 'memory_guard' and fresh and state.get('waiting_for_memory'):
        return {'label':'等待内存恢复','message':'本地模型已释放内存。系统稳定后会自动重启，当前草稿可继续编辑。'}
    cause = '因内存保护暂停' if reason == 'memory_guard' else '已暂停运行'
    return {'label': '本地模型已暂停', 'message': f'本地模型{cause}，暂时不能开始新任务。请先检查后台内存占用并恢复服务；已有会话和当前输入会保留。'}
