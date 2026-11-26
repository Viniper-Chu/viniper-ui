"""Group membership and turn-taking inside the normal Viniper conversation transport."""
import re

_MATH_SIGNAL = re.compile(
    r"[=<>≤≥≠∈^]|\\(?:frac|dfrac|tfrac|sqrt|in|leq?|geq?|neq?)|\$|"
    r"方程|函数|区间|实根|零点|取值范围|定义域|值域|最值|单调|导数|数列|不等式|分式|根式"
)
_REVIEW_ROLE_SIGNAL = re.compile(r"复核|复查|审阅|审题|校验|检查")
_SELF_POSE_SIGNAL = re.compile(r"(?:自拟|自编|出题|出一道|拟一道|另拟|再拟)")
_SOLUTION_HEADER = re.compile(
    r"\n\s*(?:#{1,4}\s*)?(?:【?(?:初解|解答|解|证明|分析|求解过程|解题过程)】?\s*[：:\n])"
)
_MATH_CHECK_PROMPT_TAIL = (
    "\n若本题结论属于有理数可表达的（1）含参方程在区间上的不同实根个数、（2）函数在区间上的值域、"
    "或（3）有理/分式方程求根，请在定稿正文最末尾附一个 ```math-check 代码块（单对象 JSON），供应用做精确有理数抽样核对："
    '\n- 含参实根个数：`{"type":"parametric_roots","variable":"x","parameter":"a","parameter_expr":"由原式解出的参数关于x的表达式，如 -x^2+2*x","domain":{"lower":"0","upper":"3","lower_open":false,"upper_open":true},"pieces":[{"condition":"a <= -3","roots":0},{"condition":"-3 < a < 0","roots":1}]}`'
    '\n- 函数值域：`{"type":"function_range","variable":"x","expr":"-x^2+2*x","domain":{"lower":"0","upper":"3","lower_open":false,"upper_open":true},"range":{"lower":"-3","upper":"1","lower_open":true,"upper_open":false}}`'
    '\n- 方程有理根：`{"type":"equation_roots","variable":"x","lhs":"左式","rhs":"右式","roots":["2"]}`'
)


def has_math_problem(text: str) -> bool:
    return bool(_MATH_SIGNAL.search(str(text or "")))


def extract_blind_problem(text: str, spoken: list[tuple[str, str]], members: list[dict] | None = None) -> str:
    """Extract only the unanchored problem statement without exposing any teammate's derivation or answer."""
    raw = str(text or "").strip()
    if not raw:
        return ""
    if _SELF_POSE_SIGNAL.search(raw):
        if not spoken:
            return ""
        first_reply = str(spoken[0][1] or "").strip()
        split_match = _SOLUTION_HEADER.search(first_reply)
        if not split_match:
            return ""
        problem_only = first_reply[:split_match.start()].strip()
        return problem_only if len(problem_only) >= 12 and has_math_problem(problem_only) else ""

    cleaned = raw
    if members:
        roster = "|".join(re.escape(m["name"]) for m in sorted(members, key=lambda x: len(x["name"]), reverse=True))
        if roster:
            cleaned = re.sub(rf"(?<![\w@])@(?:{roster}|全体|全组|everyone)\b", "", cleaned, flags=re.I)
            cleaned = re.sub(
                rf"[，,。；;\s]*(?:写完后|解出后|完成后|先由[^，,。；;\n]*?)?[，,、\s]*(?:交给|交由|转给|交回|转回)\s*@?(?:{roster})[^\n。！？]*",
                "",
                cleaned,
                flags=re.I,
            )
    cleaned = cleaned.strip(" \t\r\n，,。；;：:")
    return cleaned if len(cleaned) >= 8 and has_math_problem(cleaned) else ""


def is_math_reviewer_turn(text: str, member: dict, spoken: list[tuple[str, str]], returning: bool) -> bool:
    if returning or not spoken:
        return False
    combined = f"{member.get('name', '')} {member.get('role', '')} {spoken[-1][1][-120:]}"
    return bool(_REVIEW_ROLE_SIGNAL.search(combined)) and (
        has_math_problem(text) or any(has_math_problem(reply) for _, reply in spoken)
    )


def room_members(session, default_model):
    if "members" in session:
        return session["members"]
    model = session.get("model") or default_model
    return [{"name": "解题", "model": model, "role": "主答并分配需要协作的任务"},
            {"name": "复核", "model": model, "role": "检查推导、证据和交付物"}]


def validate_members(members, available):
    if not isinstance(members, list) or not 2 <= len(members) <= 6:
        raise ValueError("群聊需要 2 至 6 位成员")
    result, names = [], set()
    for item in members:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ("name", "role", "model")):
            raise ValueError("请填写成员名称、模型和分工")
        name, role, model = (item[k].strip() for k in ("name", "role", "model"))
        if not re.fullmatch(r"[\w-]{1,24}", name) or name.casefold() in {"everyone", "全体", "全组", "并行"} | names:
            raise ValueError("成员名须唯一，可用 1 至 24 个汉字、字母、数字、下划线或短横线")
        if not role or len(role) > 180:
            raise ValueError("请为每位成员填写 1 至 180 字的分工")
        if model not in available:
            raise ValueError(f"{name} 的模型已不可用，请在群成员中重新选择")
        names.add(name.casefold())
        result.append({"name": name, "model": model, "role": role})
    return result


def addressed(text, members):
    names = {m["name"].casefold(): m["name"] for m in members}
    picked = []
    # Require a boundary before @ so email addresses are never invitations.
    pattern = r"(?<![\w@])@([\w-]+)"
    for match in re.finditer(pattern, text):
        token = match[1].casefold()
        if token in {"everyone", "全体", "全组"}:
            picked = [m["name"] for m in members]
        elif token in names and names[token] not in picked:
            picked.append(names[token])
        elif match.start() == 0 and token not in names:
            raise ValueError(f"群内没有 @{match[1]}，请从成员列表选择")
    if not re.sub(pattern, "", text).strip(" \t\r\n:：,，、"):
        raise ValueError("点名后请写下任务")
    return picked


def requested_review_chain(text, members, explicit):
    """A named review and return is a user assignment, even if a model forgets its handoff line."""
    # Do not schedule tools/providers from code, quotations or a negated/conditional example.
    prose = re.sub(r'```.*?(?:```|$)|`[^`\n]*`|「[^」]*」|“[^”]*”|《[^》]*》|"[^"\n]*"', " ", text, flags=re.S)
    names = {m["name"].casefold(): m["name"] for m in members}
    roster = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    transfers = list(re.finditer(r"(交给|交由|转给|交回|转回)\s*@?(" + roster + r")(?![a-zA-Z0-9_-])", prose, re.I))
    if not transfers or len(transfers) > 2 or transfers[-1][1] not in {"交回", "转回"}:
        return []
    lead = names[transfers[-1][2].casefold()]
    if len(transfers) == 2:
        reviewer = names[transfers[0][2].casefold()]
    else:
        prefix = prose[:transfers[0].start()]
        assigned = list(re.finditer(r"@?(" + roster + r")\s*(?:独立)?(?:复核|复查|审题|校验)", prefix, re.I))
        if len(assigned) != 1 or not re.search(re.escape(lead) + r"\s*(?:先)?(?:出题|自拟|主答|解题|初解)", prefix, re.I):
            return []
        reviewer = names[assigned[0][1].casefold()]
        if re.search(r"不用|不要|无需|不必|禁止|假如|如果|是否", prefix):
            return []
    for transfer in transfers:
        clause = re.split(r"[，,。！？；;\n]", prose[:transfer.start()])[-1]
        if re.search(r"不要|不必|无需|不用|不再|不应|别|禁止|是否|如果|假如|例如|举例|能否|避免|取消", clause):
            return []
    if reviewer == lead or any(n not in (lead, reviewer) for n in explicit):
        return []
    return [lead, reviewer, lead]


def room_background(messages, text):
    records = [m for m in messages[-16:] if m.get("role") in ("assistant", "user")
               and m.get("content") and not any(m.get(k) for k in ("pending", "error", "cancelled"))]
    if records and records[-1]["role"] == "user" and records[-1]["content"].strip() == text:
        records.pop()

    # For a new standalone exercise, the last solution identifies the old problem.
    # Keep the user's instructions. Earlier model drafts are needed for recall,
    # comparison and continuation, which use the ordinary full-history path.
    fresh = re.search(r"(?:换|另出|再出|另拟|再拟|新出)(?:一[道题个])?.{0,24}(?:参数题|数学题|含参.{0,8}题)|(?:自拟|自编).{0,8}(?:全新|新的).{0,12}(?:参数题|数学题)", text)
    recall = re.search(r"根据|以前|前两|原题|原解|上述|相同|同样|同一|第[一二三四五六七八九十0-9]+[轮题次]|沿用|按照|照着|接着|回顾|恢复|借鉴|延续|参考|复用|比较|对比|对照|之前|此前|前面|前文|上次|上题|上一|上轮|前一|上道|前几|历次|历史|群记录|同类|类似|以往|从前|刚才|方才|不要换|不换|别换|无需换|不用换|基于|类比|吸取|结合", text)
    if fresh and not recall:
        latest = next((m for m in reversed(records) if m["role"] == "assistant"), None)
        selected = [m for m in records if m["role"] == "user" or m is latest]
    else:
        selected = records

    history = []
    for m in selected:
        content = m["content"].strip()
        if content:
            author = m.get("speaker") or ("用户" if m["role"] == "user" else "成员")
            if len(content) > 8192:
                content = content[:4000] + "\n[早先发言中段省略，完整内容保存在群聊]\n" + content[-4000:]
            history.append(f"{author}：{content}")
    if len(selected) < len(records):
        history.insert(0, "换题背景：保留最近的用户要求和最后一份答复，早先的成员草稿保存在原群。")
    return history


async def discussion_events(transport, session, session_id, text, members, permission, attachments):
    """One shared outcome. Honor explicit recipients, or let the lead hand off the work."""
    by_name = {m["name"]: m for m in members}
    explicit = addressed(text.strip(), members)
    prescribed = requested_review_chain(text, members, explicit)
    order = list(prescribed or explicit) or [members[0]["name"]]
    roster = "\n".join(f"@{m['name']}（{m['model']}）：{m['role']}" for m in members)
    history = room_background(session.get("messages", []), text)
    spoken = []
    correction = ""
    while order:
        name = order.pop(0)
        member = by_name[name]
        returning = any(who == name for who, _ in spoken)
        reviewer_turn = is_math_reviewer_turn(text, member, spoken, returning)
        blind_notes = ""
        if reviewer_turn:
            blind_problem = extract_blind_problem(text, spoken, members)
            blind_fn = getattr(transport, "blind_math_check", None)
            if blind_problem and callable(blind_fn):
                blind_notes = (await blind_fn(
                    session_id, blind_problem, member["model"], permission, attachments, speaker=name
                ) or "").strip()

        prompt = (f"你是群聊中的 @{name}，只以自己的身份发言。你的分工：{member['role']}。\n成员与分工：\n{roster}\n"
                  "这是应用已建立的真实群聊。直接完成自己的分工，不代替其他成员发言。群聊调度器负责邀请和转交；请勿用终端、搜索源码或访问接口来管理群聊。")
        prompt += "\n\n本轮用户消息：\n" + text
        if blind_notes:
            prompt += (
                "\n\n【你在查看队友初解前已完成的独立盲解与工具验算（防锚定基准）】\n"
                + blind_notes
                + "\n\n请以这份独立盲解为基准：先写出你的独立定义域、值域、开闭端点与分段表，再逐项对照下方队友初解，指出任何漏判端点、重根误计或不等价变形，并补充至少一组新抽查验算。"
            )
        elif reviewer_turn:
            prompt += (
                "\n\n【独立盲审防锚定要求】请先不依赖队友结论，从原题独立推导定义域、等价变形条件、各单调分支、值域、开闭端点归属与根数分段表（可用已注册工具精确验算），"
                "再与下方队友初解逐行比对，明确指出错步或确认一致，并补充一组新抽查验算。"
            )
        if spoken:
            prompt += "\n\n本轮成员发言：\n" + "\n".join(f"@{who}：{reply}" for who, reply in spoken)
        if returning:
            prompt += "\n\n队友已把本轮交回给你。先写明等价变形的适用条件，明确区分局部极值与全局最值。只保留服务于证明的验算，引用的算式须与实际计算一致。请对照复核意见直接给出定稿，保留本轮题目和已核对的关键推导；新补充的数值等式或不等式须独立验算，非负根式可通过比较平方核对。定稿后结束。"
            if has_math_problem(text) or any(has_math_problem(reply) for _, reply in spoken):
                prompt += _MATH_CHECK_PROMPT_TAIL
        elif prescribed and order:
            prompt += f"\n\n本轮下一位已由用户指定为 @{order[0]}。请只提交你本人的" + ("初解" if not spoken else "独立复核与本轮新抽查") + "，由应用实际转交。先前群聊的复核仅供参考，不能代替这次发言。"
        elif not explicit and len(spoken) < len(members):
            prompt += "\n\n需要队友继续时，末尾单独写一行「交接给 @成员名：具体任务」。可以直接完成时就给出结果。"
        if correction:
            prompt += "\n定稿算式或有理数抽样核验发现问题：" + correction + "请修正错误后重新给出完整定稿（若附有 math-check 代码块也一并更新），删去无关的验算；区分原式的适用条件，逐项核对保留的等式与开闭端点。"
        verify_math = returning or bool(explicit and re.search(r"定稿|终稿", text))
        # M7: For local returning speakers, place their own prior draft into room_history as chronological context.
        effective_history = list(history)
        if returning and spoken:
            for who, reply in spoken[:-1]:
                clipped = reply if len(reply) <= 6000 else reply[:3000] + "\n[中段省略]\n" + reply[-3000:]
                effective_history.append(f"{who}：{clipped}")
        stream = transport.stream(session_id, prompt, member["model"], permission, attachments,
                                  suppress_user_message=bool(spoken or correction), display_prompt=text, speaker=name, room_history=effective_history, verify_final_math=verify_math)
        advanced = False
        try:
            async for event in stream:
                if event.get("type") != "done":
                    yield event
                    continue
                last = session["messages"][-1] if session.get("messages") else {}
                reply = last.get("content", "").strip()
                issue = event.get("arithmetic_issue")
                if issue:
                    if correction:
                        yield {"type": "error", "content": "再次核算仍有未通过项，本轮未通过定稿核验。" + issue}
                        yield event
                        return
                    correction = issue
                    order.insert(0, name)
                    yield {**event, "type": "speaker_finished", "next_speaker": name}
                    advanced = True
                    continue
                if session.get("last_run_status") != "completed" or last.get("speaker") != name or not reply:
                    yield event
                    return
                correction = ""
                spoken.append((name, reply))
                if not (explicit or prescribed) and len(spoken) <= len(members) and sum(who == name for who, _ in spoken) == 1:
                    handoff = re.fullmatch(r"交接给\s*@([\w-]+)(?:\s*[：:]\s*.+)?", reply.splitlines()[-1].strip().strip("*"))
                    target = handoff[1] if handoff else ""
                    already = {who for who, _ in spoken}
                    # A teammate may return the result to the lead once for synthesis.
                    if target in by_name and target != name and (target not in already or
                            (target == members[0]["name"] and sum(who == target for who, _ in spoken) == 1)):
                        order.append(target)
                if not order:
                    yield event
                    return
                yield {**event, "type": "speaker_finished", "next_speaker": order[0]}
                advanced = True
        finally:
            await stream.aclose()
        if not advanced:
            return
