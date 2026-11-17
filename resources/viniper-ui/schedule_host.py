"""Dispatch the Harness scheduler through the same application run path as chat."""
import asyncio


class ScheduleHost:
    def __init__(self, port, coordinator, stream, sessions):
        self.port, self.coordinator, self.stream, self.sessions = port, coordinator, stream, sessions
        self.task = None
        self.last_error = ""

    async def snapshot(self):
        result = await self.port.control("scheduler.snapshot")
        by_schedule = {}
        for entry in result.get("history", []):
            by_schedule.setdefault(entry["scheduleId"], []).append(entry)
        rows = []
        for definition in result.get("definitions", []):
            if definition.get("status") == "deleted":
                continue
            history = by_schedule.get(definition["id"], [])
            last = history[0]["detail"] if history else ""
            rows.append({**definition, "title": definition["name"], "cron": definition["schedule"].get("expression", ""),
                         "last_result": "目标会话已删除；任务已停用，请重新创建任务。" if definition.get("status") == "project-invalid" else last,
                         "history": history, "upcoming": result.get("previews", {}).get(definition["id"], [])})
        return rows

    def start(self):
        self.task = asyncio.create_task(self.loop())

    async def tick(self):
        result = await self.port.control("scheduler.claim")
        for job in result.get("due", []):
            sid = job.get("native_session_id")
            session = self.sessions.get(sid)
            accepted, detail = False, "目标会话不存在，本次未执行。"
            if session and session.get("mode") == "viniper":
                if self.coordinator.has_active(sid):
                    await self.port.control("scheduler.defer", id=job["id"])
                    continue
                else:
                    # A schedule stores its own prompt. Composer skills belong to the preceding manual turn.
                    session["selected_skills"] = []
                    session["task_mode"] = "execute"
                    self.coordinator.start(sid, lambda sid=sid, job=job, session=session: self.stream(sid, job["prompt"],
                        model=session.get("model"), permission_mode=session.get("permission_mode", "ask")),
                        metadata={"mode": "viniper", "schedule_id": job["id"], "permission_mode": session.get("permission_mode", "ask")})
                    accepted, detail = True, "已开始执行；在会话中查看结果或处理权限请求。"
            await self.port.control("scheduler.record", id=job["id"], accepted=accepted, detail=detail)

    async def loop(self):
        while True:
            await asyncio.sleep(10)
            try:
                await self.tick()
                self.last_error = ""
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)

    async def shutdown(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
