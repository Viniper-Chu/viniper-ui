"""Verify configurable rooms through the same streaming transport as normal turns."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "resources/viniper-ui"))
from math_review import inconsistent_equality
from discussion import addressed, discussion_events, room_members, validate_members


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
asyncio.run(check())
