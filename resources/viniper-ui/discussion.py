"""Ordered speakers in one shared math discussion."""
import re
import asyncio
import time
import uuid


DISCUSSION_ROLES = {"解题": "解出本题，写出必要条件、关键推导和结论。",
                    "复核": "独立检查题设和论证，指出具体错步或说明结论成立的依据。已有解答时聚焦复核结果。只审阅，避免重复执行制作文件或委派任务。"}

async def discussion_events(transport, session, session_id, text, model, permission, attachments):
    """Two serial model turns share only this room's conversation and normal cancellation path."""
    match = re.match(r"^@(解题|复核)(?:[：:，,\s]+|$)", text.strip())
    roles = [match[1]] if match else list(DISCUSSION_ROLES)
    question = text.strip()[match.end():].strip() if match else text
    previous = ""
    for index, speaker in enumerate(roles):
        prompt = f"你是本次数学讨论的{speaker}成员。{DISCUSSION_ROLES[speaker]}系统已标注发言人，直接写本成员的正文。\n\n用户本轮发言：\n{question}"
        if previous:
            prompt += "\n\n解题成员刚提交的待核答复：\n" + previous
        stream = transport.stream(session_id, prompt, model, permission, attachments,
                                 suppress_user_message=index > 0, display_prompt=text, speaker=speaker)
        terminal = False
        try:
            async for event in stream:
                if event.get("type") == "done" and index + 1 < len(roles):
                    last = session["messages"][-1] if session["messages"] else {}
                    previous = last.get("content", "") if last.get("speaker") == speaker else ""
                    if session.get("last_run_status") == "completed" and previous.strip():
                        yield {**event, "type": "speaker_finished"}
                    else:
                        yield event
                        return
                    terminal = True
                else:
                    yield event
        finally:
            await stream.aclose()
        if not terminal:
            return

async def parallel_discussion(transport, session, session_id, display, question, model, permission, key, save):
    """Deliver the remote opinion whenever it finishes, independently of the local stream."""
    if not question.strip():
        raise ValueError("请写下需要独立解答的题目")
    peer_id = str(uuid.uuid4())
    local = transport.stream(session_id, question, model, permission, [], display_prompt=display, speaker="Qwen")
    port = transport.application_port
    next_local = asyncio.create_task(anext(local, None))
    cloud = None
    cloud_failed = False
    done = None
    peer = None
    try:
        while next_local or cloud:
            pending = [task for task in (next_local, cloud) if task is not None]
            ready, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            if next_local in ready:
                event = next_local.result()
                next_local = None
                if event is not None:
                    if event["type"] == "assistant_start":
                        started = time.time()
                        peer = {"role":"assistant","speaker":"DeepSeek","model":"deepseek-flash","peer_id":peer_id,
                                "peer_pending":True,"content":"","created_at":started,"updated_at":started}
                        session["messages"].append(peer)
                        save()
                        cloud = asyncio.create_task(port.control("discussion.answer", opinion_id=peer_id,
                                                    question=question, host_secret_value=key))
                    if event["type"] == "done":
                        done = event
                        yield {**event, "type": "speaker_finished"}
                        if cloud:
                            yield {"type":"working_status","phase":"notice","content":"等待 DeepSeek 独立解答"}
                    else:
                        yield event
                        if event["type"] == "assistant_start":
                            yield {"type":"discussion_join","message":dict(peer)}
                    next_local = asyncio.create_task(anext(local, None))
            if cloud in ready:
                message = peer
                message.pop("peer_pending", None)
                message.update(updated_at=time.time(),elapsed_seconds=round(time.time()-message["created_at"]))
                try:
                    reply = cloud.result()
                    message["content"] = reply["answer"]
                    if reply.get("usage"):
                        message["provider_usage"] = reply["usage"]
                except Exception as exc:
                    cloud_failed = True
                    message["error"] = str(exc)
                    message["content"] = "DeepSeek 独立解答未完成。" + str(exc)
                cloud = None
                session["updated"] = time.time()
                save()
                yield {"type":"discussion_peer","message":message}
        if cloud_failed:
            session["last_run_status"] = "failed"
            save()
        if done:
            yield done
    finally:
        if next_local:
            next_local.cancel()
            await asyncio.gather(next_local,return_exceptions=True)
        if cloud:
            if peer is not None:
                peer.pop("peer_pending", None)
                peer.update(content="本轮独立解答已停止。",cancelled=True,updated_at=time.time())
                save()
            cloud.cancel()
            await asyncio.gather(cloud,return_exceptions=True)
            try:
                await port.control("discussion.cancel",opinion_id=peer_id)
            except RuntimeError:
                pass
        await local.aclose()
