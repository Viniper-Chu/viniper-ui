"""Exercise speaker ownership, handoff, failure and closing a live group stream."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "resources/viniper-ui"))
from discussion import discussion_events, parallel_discussion


async def check():
    calls = []
    session = {"messages": []}
    closed = []
    fail = False

    class Model:
        async def stream(self, sid, prompt, model, mode, attachments, *, speaker, display_prompt, suppress_user_message):
            calls.append((speaker, prompt, suppress_user_message))
            try:
                yield {"type": "assistant_start", "speaker": speaker}
                answer = "两个候选根" if speaker == "解题" else "代回排除增根"
                session["messages"].append({"role": "assistant", "speaker": speaker, "content": answer})
                session["last_run_status"] = "failed" if fail else "completed"
                yield {"type": "done"}
            finally:
                closed.append(speaker)

    def start(text):
        return discussion_events(Model(), session, "room", text, "qwen-local", "ask", [])

    events = [event async for event in start("审题")]
    assert [event["type"] for event in events] == ["assistant_start", "speaker_finished", "assistant_start", "done"]
    assert [c[0] for c in calls] == ["解题", "复核"] and calls[1][2] and "两个候选根" in calls[1][1]
    calls.clear()
    events = [event async for event in start("@复核：重查端点")]
    assert len(calls) == 1 and calls[0][0] == "复核" and not calls[0][2]
    calls.clear()
    fail = True
    events = [event async for event in start("审题")]
    assert len(calls) == 1 and events[-1]["type"] == "done"
    fail = False
    calls.clear()
    live = start("审题")
    await anext(live)
    await live.aclose()
    assert len(calls) == 1 and closed[-1] == "解题"


async def check_parallel():
    cloud_started, local_open, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    class Port:
        async def control(self, op, **data):
            if op == "discussion.answer":
                assert set(data) == {"opinion_id","question","host_secret_value"}
                assert data["question"] == "本轮题目"
                cloud_started.set()
                await local_open.wait()
                return {"answer":"独立答案"}
    class Transport:
        application_port = Port()
        async def stream(self, *args, **kwargs):
            yield {"type":"assistant_start", "speaker":"Qwen"}
            local_open.set()
            await cloud_started.wait()
            await release.wait()
            yield {"type":"text","content":"本地答案"}
            yield {"type":"done"}
    session = {"messages":[]}
    events = []
    async for event in parallel_discussion(Transport(),session,"room","@并行 本轮题目","本轮题目","qwen-local","ask","test",lambda:None):
        events.append(event["type"])
        if event["type"] == "discussion_peer":
            assert event["message"]["speaker"] == "DeepSeek"
            release.set()
    assert events.index("discussion_peer") < events.index("text") and events[-1] == "done"
    assert session["messages"][0]["content"] == "独立答案"

async def check_parallel_stop():
    engaged, aborted = asyncio.Event(), asyncio.Event()
    never = asyncio.Event()
    class Port:
        async def control(self, op, **kwargs):
            if op == "discussion.cancel":
                aborted.set()
            else:
                engaged.set()
                await never.wait()
    class Transport:
        application_port = Port()
        async def stream(self,*_,**kwargs):
            yield {"type":"assistant_start"}
            await never.wait()
    session = {"messages":[]}
    stream = parallel_discussion(Transport(),session,"room","@并行 题","题","qwen-local","ask","test",lambda:None)
    await anext(stream)
    assert (await anext(stream))["type"] == "discussion_join"
    await engaged.wait()
    await stream.aclose()
    assert aborted.is_set() and session["messages"][0]["cancelled"]
    assert "peer_pending" not in session["messages"][0]


asyncio.run(check())
asyncio.run(asyncio.wait_for(check_parallel(), 3))

asyncio.run(asyncio.wait_for(check_parallel_stop(), 3))
