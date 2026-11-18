"""Group membership and turn-taking inside the normal Viniper conversation transport."""
import re


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


async def discussion_events(transport, session, session_id, text, members, permission, attachments):
    """One shared outcome. Honor explicit recipients, or let the lead hand off the work."""
    by_name = {m["name"]: m for m in members}
    explicit = addressed(text.strip(), members)
    order = list(explicit) or [members[0]["name"]]
    roster = "\n".join(f"@{m['name']}（{m['model']}）：{m['role']}" for m in members)
    history = []
    for m in session.get("messages", [])[-16:]:
        if m.get("role") not in ("assistant", "user") or m.get("pending") or m.get("error") or m.get("cancelled"):
            continue
        content = m.get("content", "").strip()
        if content:
            author = m.get("speaker") or ("用户" if m["role"] == "user" else "成员")
            if len(content) > 8192:
                content = content[:4000] + "\n[早先发言中段省略，完整内容保存在群聊]\n" + content[-4000:]
            history.append(f"{author}：{content}")
    if history and history[-1] == f"用户：{text}":
        history.pop()  # A retry may immediately follow a failed turn with no reply.
    spoken = []
    correction = ""
    while order:
        name = order.pop(0)
        member = by_name[name]
        prompt = (f"你是群聊中的 @{name}，只以自己的身份发言。你的分工：{member['role']}。\n成员与分工：\n{roster}\n"
                  "这是应用已建立的真实群聊。直接完成自己的分工，不代替其他成员发言。群聊调度器负责邀请和转交；请勿用终端、搜索源码或访问接口来管理群聊。")
        returning = any(who == name for who, _ in spoken)
        if returning:
            prompt += "\n队友已把本轮交回给你。先写明等价变形的适用条件，明确区分局部极值与全局最值。只保留服务于证明的验算，引用的算式须与实际计算一致。请对照复核意见直接给出定稿，保留本轮题目和已核对的关键推导；新补充的数值等式或不等式须独立验算，非负根式可通过比较平方核对。定稿后结束。"
        elif not explicit and len(spoken) < len(members):
            prompt += "\n需要队友继续时，末尾单独写一行「交接给 @成员名：具体任务」。可以直接完成时就给出结果。"
        prompt += "\n\n本轮用户消息：\n"+text
        if spoken:
            prompt += "\n\n本轮成员发言：\n"+"\n".join(f"@{who}：{reply}" for who,reply in spoken)
        if correction:
            prompt += "\n定稿算式核验发现了不相等的两侧：" + correction + "请重新给出完整定稿，删去无关的验算；区分原式的适用条件，逐项核对保留的等式。"
        verify_math = returning or bool(explicit and re.search(r"定稿|终稿", text))
        stream = transport.stream(session_id, prompt, member["model"], permission, attachments,
                                  suppress_user_message=bool(spoken or correction), display_prompt=text, speaker=name, room_history=history, verify_final_math=verify_math)
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
                        yield {"type":"error", "content":"再次核算仍有不等的两侧，本轮未通过定稿核验。" + issue}
                        yield event
                        return
                    correction = issue
                    order.insert(0, name)
                    yield {**event, "type":"speaker_finished", "next_speaker":name}
                    advanced = True
                    continue
                if session.get("last_run_status") != "completed" or last.get("speaker") != name or not reply:
                    yield event
                    return
                correction = ""
                spoken.append((name, reply))
                if not explicit and len(spoken) <= len(members) and sum(who == name for who,_ in spoken) == 1:
                    handoff = re.fullmatch(r"交接给\s*@([\w-]+)(?:\s*[：:]\s*.+)?", reply.splitlines()[-1].strip().strip("*"))
                    target = handoff[1] if handoff else ""
                    already = {who for who,_ in spoken}
                    # A teammate may return the result to the lead once for synthesis.
                    if target in by_name and target != name and (target not in already or
                            (target == members[0]["name"] and sum(who == target for who,_ in spoken) == 1)):
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
