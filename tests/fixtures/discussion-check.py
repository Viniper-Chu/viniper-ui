"""Verify configurable rooms through the same streaming transport as normal turns."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "resources/viniper-ui"))
from math_review import inconsistent_equality
from discussion import room_background, requested_review_chain, addressed, discussion_events, room_members, validate_members


async def check():
    members = [{"name": n, "role": r, "model": m} for n,r,m in [
        ("主答","分工","cloud-a"), ("计算","求解","cloud-b"), ("检查","校验","cloud-c")]]
    ids = {m["model"] for m in members}
    assert validate_members(members, ids) == members
    assert room_members({"model":"legacy"}, "")[1]["model"] == "legacy"
    for invalid in [members[:1], members * 3, [members[0], members[0]], [members[0], {**members[1],"model":"missing"}]]:
        try: validate_members(invalid, ids)
        except ValueError: pass
        else: raise AssertionError(invalid)
    assert addressed("@检查 @主答 检查", members) == ["检查","主答"]
    assert addressed("发给 a@domain.com", members) == []
    for text in ["@missing 题目","@everyone"]:
        try: addressed(text, members)
        except ValueError: pass
        else: raise AssertionError(text)
    assert inconsistent_equality(r"核对 $\dfrac32-\dfrac12=\dfrac12\neq0$ 得到四根。")
    assert not inconsistent_equality(r"核对 $\frac{3}{2}-\frac{1}{2}=1$，且 $x+1=3$。")
    assert not inconsistent_equality(r"旧稿误写 $3/2-1/2=1/2$。")
    assert not inconsistent_equality(r"算式 $3/2-1/2=1/2$ 不成立。")
    old = [{"role":"user","content":"以后给精确值"}, {"role":"assistant","speaker":"主答","content":"早期推导"},
           {"role":"assistant","speaker":"复核","content":"旧的旁证"}, {"role":"assistant","speaker":"主答","content":"题面与订正"},
           {"role":"assistant","content":"失败草稿","error":True}]
    brief = room_background(old, "换一道高中数学参数题，成员各自发言。")
    assert brief[1:] == ["用户：以后给精确值", "主答：题面与订正"]
    full = room_background(old, "请恢复上次推导")
    assert "复核：旧的旁证" in full and "主答：早期推导" in full
    for prompt in ("沿用之前的证明，换一道参数题", "不要换一道数学题", "再出一道同类参数题", "换一道参数题，结合第2题的证明"):
        assert room_background(old, prompt) == full
    retries = 0
    calls, closed = [], []
    session = {"messages": []}
    failed = False
    class Transport:
        async def stream(self, sid, prompt, model, mode, attachments, *, speaker, display_prompt, suppress_user_message, room_history, verify_final_math):
            nonlocal retries
            calls.append((speaker,model,prompt,suppress_user_message))
            try:
                yield {"type":"assistant_start","speaker":speaker,"model":model}
                answer = {"主答":"题面区间含左端点\n" + "推导" * 1800 + "取代号枫针\n交接给 @计算：算出结果", "计算":"结果 42\n交接给 @检查：复核", "检查":"无误\n交接给 @主答：收束"}[speaker]
                session["messages"].append({"role":"assistant","speaker":speaker,"content":answer})
                session["last_run_status"] = "failed" if failed else "completed"
                if retries and verify_final_math:
                    retries -= 1
                    session["last_run_status"] = "failed"
                    yield {"type":"done", "arithmetic_issue":"两个分数不相等"}
                else:
                    yield {"type":"done"}
            finally:
                closed.append(speaker)
    def start(text):
        return discussion_events(Transport(),session,"room",text,members,"ask",[])
    events = [e async for e in start("求解")]
    assert [c[1] for c in calls] == ["cloud-a","cloud-b","cloud-c","cloud-a"]
    assert "交回给你" in calls[-1][2] and "交回给你" not in calls[0][2]
    assert [c[3] for c in calls] == [False,True,True,True]
    assert "题面区间含左端点" in calls[1][2] and "取代号枫针" in calls[1][2] and "结果 42" in calls[2][2]
    assert [e["next_speaker"] for e in events if e["type"]=="speaker_finished"] == ["计算","检查","主答"]
    assert events[-1]["type"] == "done"
    for text, expected in [("@全体 回答",list(ids)), ("@检查 再看看",["cloud-c"]),("@检查 @主答 回答",["cloud-c","cloud-a"])]:
        calls.clear()
        events = [e async for e in start(text)]
        actual = [c[1] for c in calls]
        assert (set(actual) == ids and len(actual)==3) if text.startswith("@全体") else actual == expected
    calls.clear()
    assert requested_review_chain("主答写完后交给 检查 复核，再交回 主答。",members,[]) == ["主答","检查","主答"]
    assert requested_review_chain("主答出题、检查复核、再交回主答定稿",members,[]) == ["主答","检查","主答"]
    assert not requested_review_chain("不要交给 检查 复核，再交回 主答。",members,[])
    assert not requested_review_chain("解释「交给 检查 复核，再交回 主答」",members,[])
    events = [e async for e in start("主答出题，交给 检查 复核，再交回 主答 定稿。")]
    assert [c[0] for c in calls]==["主答","检查","主答"]
    assert [e["next_speaker"] for e in events if e["type"]=="speaker_finished"]==["检查","主答"]
    assert "本轮下一位" in calls[0][2] and "交回给你" in calls[2][2]
    calls.clear()
    retries = 1
    events = [e async for e in start("求解")]
    assert [c[0] for c in calls] == ["主答","计算","检查","主答","主答"]
    assert "两个分数不相等" in calls[-1][2] and "取代号枫针" in calls[-1][2]
    calls.clear()
    retries = 2
    events = [e async for e in start("@主答 定稿")]
    assert len(calls)==2 and calls[-1][3] and any(e["type"]=="error" for e in events)
    calls.clear()
    failed = True
    events = [e async for e in start("审题")]
    assert len(calls)==1 and events[-1]["type"]=="done"
    live = start("取消测试")
    await anext(live)
    await live.aclose()
    assert closed[-1]=="主答"
    # Replace the obsolete active room model through the real update handler.
    import ast
    import copy
    source = Path(__file__).resolve().parents[2]/"resources/viniper-ui/server.py"
    fn = next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=="update_session")
    fn.decorator_list = []
    original = {"discussion":True,"model":"retired","members":[{**members[0],"model":"retired"},members[2]],
                "messages":[{"speaker":"主答","model":"retired","content":"原文"}]}
    old_messages = copy.deepcopy(original["messages"])
    scope = {"Request":object,"safe_session":lambda _:original,"checked_room_members":lambda xs:validate_members(xs,ids),
             "room_members":room_members, "save_sessions_to_disk":lambda:None,
             "agent_run_coordinator":lambda:type("Idle",(),{"has_active":lambda self,sid:False})()}
    exec(compile(ast.Module(body=[fn],type_ignores=[]),"room-update","exec"),scope)
    class Change:
        async def json(self):return {"members":[members[0],members[2]]}
    await scope["update_session"]("room",Change())
    assert original["model"]=="cloud-a" and original["messages"]==old_messages
    original["model"]="cloud-c"
    await scope["update_session"]("room",Change())
    assert original["model"]=="cloud-c"

asyncio.run(check())
