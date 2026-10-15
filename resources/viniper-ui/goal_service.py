"""Bounded, session-owned goals over the same run coordinator as normal chat.

The Harness settings store owns durable goal state. A goal never starts a second
run in a busy conversation, and an answer without tool progress cannot spin an
unbounded continuation loop.
"""
from __future__ import annotations

import asyncio
import copy
import time
import uuid

DONE = "[VINIPER_GOAL_DONE]"
CONTINUE = "[VINIPER_GOAL_CONTINUE]"


class GoalService:
    def __init__(self, *, port, coordinator, stream, session, save_sessions, legacy=None):
        self.port = port
        self.coordinator = coordinator
        self.stream = stream
        self.session = session
        self.save_sessions = save_sessions
        self.legacy = legacy or {}
        self.items = None
        self.tasks = {}
        self.lock = asyncio.Lock()

    async def initialize(self):
        async with self.lock:
            if self.items is not None:
                return
            loaded = await self.port.control("goals.load")
            self.items = loaded.get("goals")
            if self.items is None:
                self.items = copy.deepcopy(self.legacy)
            for goal in self.items.values():
                goal["status"] = {"running": "paused", "active": "paused", "waiting": "blocked", "failed": "blocked", "completed": "complete"}.get(goal.get("status"), goal.get("status", "paused"))
                if goal["status"] == "paused":
                    goal["current_step"] = "已暂停；继续后从现有结果推进。"
            await self.save()

    async def save(self):
        await self.port.control("goals.save", goals=copy.deepcopy(self.items))

    async def create(self, body):
        await self.initialize()
        sid, prompt = str(body.get("session_id") or ""), str(body.get("prompt") or "").strip()
        if not sid or not prompt:
            raise ValueError("目标需要所属会话和明确的任务内容")
        session = self.session(sid)
        if any(g["session_id"] == sid and g["status"] not in {"complete"} for g in self.items.values()):
            raise ValueError("此会话已有目标，请先完成或移除它")
        now = time.time()
        goal = {"id": uuid.uuid4().hex[:12], "session_id": sid, "prompt": prompt,
                "title": str(body.get("title") or prompt)[:160], "status": "paused",
                "attachments": body.get("attachments") or [],
                "reasoning": str(body.get("reasoning") or session.get("reasoning") or "medium"),
                "skills": copy.deepcopy(body.get("skills") or session.get("selected_skills") or []),
                "model": str(body.get("model") or ""), "permission_mode": body.get("permission_mode", "ask"),
                "turn_count": 0, "max_turns": min(100, max(1, int(body.get("max_turns") or 12))),
                "created": now, "updated": now, "current_step": "准备开始", "last_output": "", "last_error": ""}
        self.items[goal["id"]] = goal
        await self.save()
        return copy.deepcopy(goal)

    async def list(self, sid=None):
        await self.initialize()
        return sorted((copy.deepcopy(g) for g in self.items.values() if not sid or g["session_id"] == sid), key=lambda g: g["updated"], reverse=True)

    async def control(self, gid, action):
        await self.initialize()
        if gid not in self.items:
            raise KeyError(gid)
        goal = self.items[gid]
        if action == "continue":
            if goal["status"] == "complete":
                raise ValueError("已完成的目标不能继续；请创建新目标")
            if self.coordinator.has_active(goal["session_id"]):
                raise ValueError("此会话正在执行任务，请等当前任务结束")
            if goal["turn_count"] >= goal["max_turns"]:
                goal["max_turns"] = goal["turn_count"] + 12
            goal.update(status="active", last_error="", updated=time.time())
            await self.save()
            if gid not in self.tasks or self.tasks[gid].done():
                self.tasks[gid] = asyncio.create_task(self.run(gid))
        elif action in {"stop", "blocked", "complete", "delete"}:
            goal["status"] = {"stop": "paused", "blocked": "blocked", "complete": "complete", "delete": "paused"}[action]
            goal["updated"] = time.time()
            goal["current_step"] = "已暂停，已完成的操作会保留。"
            # Pause stops future turns; the current tool is allowed to settle.
            # The separate Stop button cancels the owned runtime when requested.
            await self.save()
            task = self.tasks.pop(gid, None)
            if task and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if action == "delete":
                del self.items[gid]
                await self.save()
        else:
            raise ValueError("未知目标操作")
        return copy.deepcopy(goal)

    async def run(self, gid):
        try:
            while (goal := self.items.get(gid)) and goal["status"] == "active":
                sid = goal["session_id"]
                if self.coordinator.has_active(sid):
                    goal.update(status="paused", current_step="会话有其他任务，目标已暂停。")
                    break
                if goal["turn_count"] >= goal["max_turns"]:
                    goal.update(status="budget_limited", current_step="已到本次轮次上限；点击继续可增加 12 轮。")
                    break
                # Resume the goal's own choices, even after an intervening chat/plan.
                session = self.session(sid)
                session.update(task_mode="goal", reasoning=goal.get("reasoning", session.get("reasoning", "medium")),
                               selected_skills=copy.deepcopy(goal.get("skills", session.get("selected_skills", []))))
                self.save_sessions()
                goal.update(current_step=f"正在推进第 {goal['turn_count'] + 1} 轮", updated=time.time())
                await self.save()
                instruction = (f"目标：{goal['prompt']}\n继续完成下一项必要工作并验证。已有成果请复用。"
                    "不要把计划当成完成，也不要重复空转。需要用户信息时明确提出。"
                    f"只有目标交付并验证完成才在末尾单独写 {DONE}；有具体下一步则写 {CONTINUE}。")
                first = goal["turn_count"] == 0
                record = self.coordinator.start(sid, lambda: self.stream(sid, instruction, model=goal["model"],
                    permission_mode=goal["permission_mode"], attachments=goal.get("attachments", []) if first else [], suppress_user_message=not first,
                    display_prompt=goal["prompt"]),
                    metadata={"mode": "viniper", "goal_id": gid, "model": goal["model"], "permission_mode": goal["permission_mode"]})
                output, error, tools = [], "", 0
                async for event in self.coordinator.subscribe(sid, record.run_id):
                    if event.get("type") == "text": output.append(event.get("content", ""))
                    if event.get("type") == "error": error = event.get("content", "执行失败")
                    if event.get("type") == "tool_result": tools += 1
                text = "".join(output).strip()
                goal["turn_count"] += 1
                goal["last_output"] = text.replace(DONE, "").replace(CONTINUE, "").strip()[-4000:]
                goal["updated"] = time.time()
                if goal["status"] != "active": break
                if record.status == "cancelled": goal.update(status="paused", current_step="已停止当前任务。")
                elif error or record.status == "failed": goal.update(status="blocked", last_error=error, current_step="执行失败，需要处理后继续。")
                elif text.endswith(DONE): goal.update(status="complete", current_step="目标已完成。")
                elif not tools or not text.endswith(CONTINUE): goal.update(status="blocked", current_step="本轮没有可继续的执行进展，请补充信息或引导后继续。")
                if goal["status"] != "active": break
                await self.save()
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if goal := self.items.get(gid): goal.update(status="blocked", last_error=str(exc), current_step="目标暂停，需要处理错误。")
        finally:
            if self.items is not None:
                await self.save()

    async def shutdown(self):
        for task in self.tasks.values(): task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        if self.items is not None:
            for goal in self.items.values():
                if goal["status"] == "active": goal.update(status="paused", current_step="应用退出，目标已暂停。")
            await self.save()
