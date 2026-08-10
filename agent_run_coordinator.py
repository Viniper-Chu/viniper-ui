"""Session-owned Agent run lifecycle and replayable event subscriptions."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Iterable


class ActiveRunExists(RuntimeError):
    """Raised when a session already owns an active Agent run."""


class AgentRunJournal:
    """Persist only the process identity needed to recover abandoned Agent runs."""

    _FIELDS = {
        "session_id",
        "coordinator_run_id",
        "owner_pid",
        "runtime",
        "session_key",
        "process_identity",
        "runtime_pid",
        "runtime_pgid",
        "host_channel",
        "interaction_kind",
        "interaction_request_id",
        "started_at",
        "updated_at",
    }

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _load(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        runs = payload.get("runs") if isinstance(payload, dict) else None
        return {"version": 1, "runs": runs if isinstance(runs, dict) else {}}

    def _save(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

    def begin(self, entry: dict[str, Any]) -> dict[str, Any]:
        session_id = str(entry.get("session_id") or "").strip()
        run_id = str(entry.get("coordinator_run_id") or "").strip()
        session_key = str(entry.get("session_key") or "").strip()
        runtime_pgid = int(entry.get("runtime_pgid") or 0)
        if not session_id or not run_id or not session_key or runtime_pgid <= 1:
            raise ValueError("run journal requires session, coordinator run, session key, and process group")
        now = float(entry.get("updated_at") or time.time())
        safe = {key: copy.deepcopy(entry.get(key)) for key in self._FIELDS if key in entry}
        safe.update({
            "session_id": session_id,
            "coordinator_run_id": run_id,
            "session_key": session_key,
            "owner_pid": int(entry.get("owner_pid") or 0),
            "runtime_pid": int(entry.get("runtime_pid") or 0),
            "runtime_pgid": runtime_pgid,
            "started_at": float(entry.get("started_at") or now),
            "updated_at": now,
        })
        payload = self._load()
        payload["runs"][session_id] = safe
        self._save(payload)
        return copy.deepcopy(safe)

    def mark_interaction(self, session_id: str, *, kind: str, request_id: str) -> None:
        payload = self._load()
        entry = payload["runs"].get(str(session_id))
        if not isinstance(entry, dict):
            return
        entry["interaction_kind"] = str(kind or "")
        entry["interaction_request_id"] = str(request_id or "")
        entry["updated_at"] = time.time()
        self._save(payload)

    def finish(self, session_id: str, coordinator_run_id: str = "", *, status: str = "") -> bool:
        payload = self._load()
        entry = payload["runs"].get(str(session_id))
        if not isinstance(entry, dict):
            return False
        if coordinator_run_id and str(entry.get("coordinator_run_id") or "") != str(coordinator_run_id):
            return False
        del payload["runs"][str(session_id)]
        self._save(payload)
        return True

    def active(self) -> list[dict[str, Any]]:
        payload = self._load()
        return [copy.deepcopy(value) for value in payload["runs"].values() if isinstance(value, dict)]


class DurableInteractionStore:
    """Server-authoritative lifecycle for one structured CLI interaction per session.

    Raw tool input and upstream permission suggestions remain private in this
    file.  ``public_for_session`` is the only renderer projection and never
    exposes file content, edit bodies, environment values, or response payloads.
    """

    _OPEN_STATES = {
        "created", "pending", "answering", "response_committed", "awaiting_cli_ack",
    }
    _TERMINAL_STATES = {"accepted", "denied", "cancelled", "failed", "terminal"}
    _ACK_STAGES = {
        "response_committed",
        "response_read",
        "stdout_written_and_flushed",
        "mcp_response_written_and_flushed",
        "hook_exit",
        "cli_tool_result",
    }
    _PUBLIC_CONTEXT_FIELDS = {
        "blocked_path", "decision_reason", "decision_reason_type", "title",
        "display_name", "description", "risk", "agent_id",
    }

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()

    @staticmethod
    def _json_copy(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {str(key): DurableInteractionStore._json_copy(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [DurableInteractionStore._json_copy(item) for item in value]
        aborted = getattr(value, "aborted", None)
        if aborted is not None:
            return {"present": True, "aborted": bool(aborted)}
        return {"present": True, "type": type(value).__name__}

    @staticmethod
    def response_behavior(response: Any) -> str:
        """Read the documented allow/deny decision from MCP or hook output."""
        if not isinstance(response, dict):
            return ""
        direct = str(response.get("behavior") or "").strip().lower()
        if direct:
            return direct
        hook = response.get("hookSpecificOutput")
        if not isinstance(hook, dict):
            return ""
        permission_decision = str(hook.get("permissionDecision") or "").strip().lower()
        if permission_decision:
            return permission_decision
        decision = hook.get("decision")
        return str(decision.get("behavior") or "").strip().lower() if isinstance(decision, dict) else ""

    def _empty(self) -> dict[str, Any]:
        return {"version": 1, "records": {}, "active": {}}

    def _load(self) -> dict[str, Any]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
        payload = self._empty()
        if isinstance(raw, dict):
            if isinstance(raw.get("records"), dict):
                payload["records"] = raw["records"]
            if isinstance(raw.get("active"), dict):
                payload["active"] = raw["active"]
        return payload

    def _save(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _key(session_id: str, request_id: str) -> str:
        return f"{session_id}\x1f{request_id}"

    def _record(self, payload: dict[str, Any], session_id: str, request_id: str) -> dict[str, Any]:
        record = payload["records"].get(self._key(str(session_id), str(request_id)))
        if not isinstance(record, dict):
            raise ValueError("interaction request is stale or unknown")
        return record

    def create(self, entry: dict[str, Any]) -> dict[str, Any]:
        session_id = str(entry.get("session_id") or "").strip()
        request_id = str(entry.get("request_id") or entry.get("tool_use_id") or "").strip()
        tool_use_id = str(entry.get("tool_use_id") or request_id).strip()
        run_id = str(entry.get("run_id") or entry.get("coordinator_run_id") or "").strip()
        kind = str(entry.get("kind") or "").strip()
        if not session_id or not request_id or not tool_use_id or not run_id or kind not in {"question", "permission"}:
            raise ValueError("durable interaction requires session, run, request, tool use, and kind")
        now = float(entry.get("created_at") or time.time())
        key = self._key(session_id, request_id)
        with self._lock:
            payload = self._load()
            existing = payload["records"].get(key)
            if isinstance(existing, dict):
                immutable = (
                    str(existing.get("session_id") or ""),
                    str(existing.get("run_id") or ""),
                    str(existing.get("tool_use_id") or ""),
                    str(existing.get("kind") or ""),
                )
                candidate = (session_id, run_id, tool_use_id, kind)
                if immutable != candidate:
                    raise ValueError("interaction identity conflicts with durable record")
                return copy.deepcopy(existing)
            active_id = str(payload["active"].get(session_id) or "")
            if active_id:
                active = payload["records"].get(self._key(session_id, active_id))
                if isinstance(active, dict) and str(active.get("state") or "") in self._OPEN_STATES:
                    raise ValueError("session already has an unsettled interaction")

            questions = self._json_copy(entry.get("_original_questions") or entry.get("questions") or [])
            tool_input = self._json_copy(entry.get("_tool_input") or entry.get("input") or {})
            suggestions = self._json_copy(entry.get("_permission_suggestions") or entry.get("permission_suggestions") or [])
            context: dict[str, Any] = {}
            raw_context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
            for field in (
                "blocked_path", "decision_reason", "decision_reason_type", "title",
                "display_name", "description", "risk", "agent_id", "signal", "abort",
            ):
                if field in entry:
                    context[field] = self._json_copy(entry.get(field))
                elif field in raw_context:
                    context[field] = self._json_copy(raw_context.get(field))
            public_display = self._json_copy(entry.get("display") or entry.get("display_payload") or {})
            record = {
                "session_id": session_id,
                "run_id": run_id,
                "request_id": request_id,
                "tool_use_id": tool_use_id,
                "bridge_request_id": str(entry.get("bridge_request_id") or ""),
                "response_mode": str(entry.get("_response_mode") or entry.get("response_mode") or ""),
                "process_identity": str(entry.get("process_identity") or ""),
                "host_channel": str(entry.get("host_channel") or ""),
                "kind": kind,
                "tool_name": str(entry.get("tool_name") or ("AskUserQuestion" if kind == "question" else "工具")),
                "questions": questions,
                "agent_id": self._json_copy(entry.get("agent_id")),
                "response_text": self._json_copy(entry.get("response")),
                "summary": str(entry.get("summary") or ""),
                "workdir": str(entry.get("workdir") or ""),
                "display": public_display if isinstance(public_display, dict) else {},
                "allowed_actions": [str(item) for item in entry.get("allowed_actions") or []],
                "context": context,
                "private": {
                    "original_questions": questions,
                    "tool_input": tool_input,
                    "permission_suggestions": suggestions,
                    "context": copy.deepcopy(context),
                    "raw_envelope": self._json_copy(entry.get("_raw_hook") or entry.get("raw_envelope") or {}),
                },
                "state": "created",
                "terminal": False,
                "ack_stages": [],
                "created_at": now,
                "updated_at": now,
            }
            payload["records"][key] = record
            payload["active"][session_id] = request_id
            self._save(payload)
            return copy.deepcopy(record)

    def _transition(self, session_id: str, request_id: str, state: str, allowed: set[str]) -> dict[str, Any]:
        with self._lock:
            payload = self._load()
            record = self._record(payload, session_id, request_id)
            current = str(record.get("state") or "")
            if current == state:
                return copy.deepcopy(record)
            if current not in allowed:
                raise ValueError(f"interaction cannot transition from {current} to {state}")
            record["state"] = state
            record["updated_at"] = time.time()
            self._save(payload)
            return copy.deepcopy(record)

    def mark_pending(self, session_id: str, request_id: str) -> dict[str, Any]:
        return self._transition(session_id, request_id, "pending", {"created"})

    def begin_answer(self, session_id: str, request_id: str) -> dict[str, Any]:
        return self._transition(session_id, request_id, "answering", {"created", "pending"})

    def commit_response(
        self,
        session_id: str,
        request_id: str,
        *,
        action: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        response_copy = self._json_copy(response)
        with self._lock:
            payload = self._load()
            record = self._record(payload, session_id, request_id)
            if "response" in record:
                if str(record.get("action") or "") == str(action) and record.get("response") == response_copy:
                    return copy.deepcopy(record)
                raise ValueError("interaction response already contains a different decision")
            if str(record.get("state") or "") not in {"created", "pending", "answering"}:
                raise ValueError("interaction is no longer answerable")
            record["action"] = str(action)
            record["response"] = response_copy
            record["state"] = "response_committed"
            if "response_committed" not in record["ack_stages"]:
                record["ack_stages"].append("response_committed")
            record["updated_at"] = time.time()
            self._save(payload)
            return copy.deepcopy(record)

    def mark_awaiting_cli_ack(self, session_id: str, request_id: str) -> dict[str, Any]:
        return self._transition(session_id, request_id, "awaiting_cli_ack", {"response_committed"})

    def record_ack(
        self,
        session_id: str,
        request_id: str,
        stage: str,
        *,
        success: bool | None = None,
        exit_code: int | None = None,
    ) -> dict[str, Any]:
        stage_value = str(stage or "")
        if stage_value not in self._ACK_STAGES:
            raise ValueError("unknown interaction acknowledgement stage")
        with self._lock:
            payload = self._load()
            record = self._record(payload, session_id, request_id)
            if stage_value not in record["ack_stages"]:
                record["ack_stages"].append(stage_value)
            if exit_code is not None:
                record["hook_exit_code"] = int(exit_code)
            if stage_value == "cli_tool_result":
                record["cli_tool_result_success"] = bool(success)
                behavior = self.response_behavior(record.get("response"))
                if behavior == "deny":
                    state = "denied"
                else:
                    state = "accepted" if bool(success) else "failed"
                record["state"] = state
                record["terminal"] = True
                if state != "failed":
                    payload["active"].pop(str(session_id), None)
            elif str(record.get("state") or "") == "response_committed":
                record["state"] = "awaiting_cli_ack"
            record["updated_at"] = time.time()
            self._save(payload)
            return copy.deepcopy(record)

    def fail_owner(self, session_id: str, run_id: str, *, reason: str) -> dict[str, Any]:
        with self._lock:
            payload = self._load()
            request_id = str(payload["active"].get(str(session_id)) or "")
            if not request_id:
                raise ValueError("session has no durable interaction")
            record = self._record(payload, session_id, request_id)
            if run_id and str(record.get("run_id") or "") != str(run_id):
                raise ValueError("interaction belongs to a different run")
            if str(record.get("state") or "") not in self._OPEN_STATES:
                return copy.deepcopy(record)
            record["state"] = "failed"
            record["terminal"] = True
            record["failure_message"] = str(reason or "任务中断；请求未执行")
            record["updated_at"] = time.time()
            self._save(payload)
            return copy.deepcopy(record)

    def mark_cancelled(self, session_id: str, request_id: str, *, reason: str = "") -> dict[str, Any]:
        with self._lock:
            payload = self._load()
            record = self._record(payload, session_id, request_id)
            if str(record.get("state") or "") in {"accepted", "denied", "cancelled"}:
                return copy.deepcopy(record)
            record["state"] = "cancelled"
            record["terminal"] = True
            if reason:
                record["failure_message"] = str(reason)
            record["updated_at"] = time.time()
            payload["active"].pop(str(session_id), None)
            self._save(payload)
            return copy.deepcopy(record)

    def record_permission_denied(self, event: dict[str, Any]) -> dict[str, Any]:
        session_id = str(event.get("session_id") or "").strip()
        request_id = str(event.get("tool_use_id") or event.get("request_id") or "").strip()
        if not session_id or not request_id:
            raise ValueError("permission_denied requires session and tool use id")
        now = time.time()
        record = {
            "session_id": session_id,
            "run_id": str(event.get("run_id") or ""),
            "request_id": request_id,
            "tool_use_id": request_id,
            "tool_name": str(event.get("tool_name") or "工具"),
            "agent_id": self._json_copy(event.get("agent_id")),
            "kind": "permission",
            "state": "denied",
            "terminal": True,
            "decision_reason_type": self._json_copy(event.get("decision_reason_type")),
            "decision_reason": self._json_copy(event.get("decision_reason")),
            "message": self._json_copy(event.get("message")),
            "uuid": self._json_copy(event.get("uuid")),
            "matching_tool_result": self._json_copy(event.get("tool_result")),
            "ack_stages": ["cli_tool_result"] if isinstance(event.get("tool_result"), dict) else [],
            "created_at": now,
            "updated_at": now,
            "private": {"event": self._json_copy(event)},
        }
        with self._lock:
            payload = self._load()
            payload["records"][self._key(session_id, request_id)] = record
            payload["active"].pop(session_id, None)
            self._save(payload)
        return copy.deepcopy(record)

    def latest_for_session(self, session_id: str) -> dict[str, Any] | None:
        sid = str(session_id)
        with self._lock:
            payload = self._load()
            records = [
                value for value in payload["records"].values()
                if isinstance(value, dict) and str(value.get("session_id") or "") == sid
            ]
            if not records:
                return None
            return copy.deepcopy(max(records, key=lambda item: float(item.get("updated_at") or 0)))

    def record_for(self, session_id: str, request_id: str) -> dict[str, Any] | None:
        with self._lock:
            payload = self._load()
            record = payload["records"].get(self._key(str(session_id), str(request_id)))
            return copy.deepcopy(record) if isinstance(record, dict) else None

    @classmethod
    def _public_record(cls, record: dict[str, Any]) -> dict[str, Any]:
        state = str(record.get("state") or "")
        public = {
            "type": "interaction_request",
            "kind": str(record.get("kind") or ""),
            "request_id": str(record.get("request_id") or ""),
            "tool_use_id": str(record.get("tool_use_id") or record.get("request_id") or ""),
            "session_id": str(record.get("session_id") or ""),
            "run_id": str(record.get("run_id") or ""),
            "tool_name": str(record.get("tool_name") or ""),
            "questions": copy.deepcopy(record.get("questions") or []),
            "agent_id": copy.deepcopy(record.get("agent_id")),
            "response": copy.deepcopy(record.get("response_text")),
            "summary": str(record.get("summary") or ""),
            "workdir": str(record.get("workdir") or ""),
            "display": copy.deepcopy(record.get("display") or {}),
            "interaction_state": state,
            "terminal": bool(record.get("terminal")),
            "allowed_actions": (
                [] if state not in {"created", "pending"}
                else [str(item) for item in record.get("allowed_actions") or []]
            ),
        }
        context = record.get("context") if isinstance(record.get("context"), dict) else {}
        for field in cls._PUBLIC_CONTEXT_FIELDS:
            if field in context and context[field] not in (None, ""):
                public[field] = copy.deepcopy(context[field])
        if record.get("failure_message"):
            public["failure_message"] = str(record["failure_message"])
        return public

    def public_for_session(self, session_id: str) -> dict[str, Any] | None:
        sid = str(session_id)
        with self._lock:
            payload = self._load()
            request_id = str(payload["active"].get(sid) or "")
            if not request_id:
                return None
            record = payload["records"].get(self._key(sid, request_id))
            if not isinstance(record, dict):
                return None
            state = str(record.get("state") or "")
            if state not in self._OPEN_STATES and state != "failed":
                return None
            return self._public_record(record)

    def active(self) -> list[dict[str, Any]]:
        with self._lock:
            payload = self._load()
            result: list[dict[str, Any]] = []
            for session_id, request_id in payload["active"].items():
                record = payload["records"].get(self._key(str(session_id), str(request_id)))
                if isinstance(record, dict) and str(record.get("state") or "") in self._OPEN_STATES:
                    result.append(copy.deepcopy(record))
            return result


@dataclass
class AgentRunRecord:
    session_id: str
    run_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    events: list[dict[str, Any]] = field(default_factory=list)
    sequence: int = 0
    status: str = "running"
    pending_interaction: dict[str, Any] | None = None
    awaiting_interaction_ack: dict[str, Any] | None = None
    cancel_requested: bool = False
    terminal: bool = False
    had_error: bool = False
    saw_done: bool = False
    task: asyncio.Task[None] | None = None


class AgentRunCoordinator:
    """Own Agent producers independently from any individual SSE subscriber."""

    def __init__(
        self,
        decode: Callable[[Any], Iterable[dict[str, Any]]] | None = None,
        *,
        max_events: int = 2048,
    ) -> None:
        self._records: dict[str, AgentRunRecord] = {}
        self._decode = decode or self._default_decode
        self._max_events = max(64, int(max_events))

    @staticmethod
    def _default_decode(value: Any) -> Iterable[dict[str, Any]]:
        if isinstance(value, dict):
            return [value]
        return []

    def start(
        self,
        session_id: str,
        producer_factory: Callable[[], AsyncIterator[Any]] | AsyncIterator[Any],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> AgentRunRecord:
        sid = str(session_id)
        current = self._records.get(sid)
        if current is not None and not current.terminal:
            raise ActiveRunExists(f"session {sid} already has an active run")
        record = AgentRunRecord(
            session_id=sid,
            run_id=str(uuid.uuid4()),
            metadata=copy.deepcopy(metadata or {}),
        )
        self._records[sid] = record
        producer = producer_factory() if callable(producer_factory) else producer_factory
        record.task = asyncio.create_task(self._consume(record, producer), name=f"viniper-agent-run:{sid}:{record.run_id}")
        return record

    def snapshot(self, session_id: str) -> dict[str, Any] | None:
        record = self._records.get(str(session_id))
        if record is None:
            return None
        return {
            "session_id": record.session_id,
            "run_id": record.run_id,
            "active": not record.terminal,
            "terminal": record.terminal,
            "status": record.status,
            "sequence": record.sequence,
            "pending_interaction": copy.deepcopy(record.pending_interaction),
            "awaiting_interaction_ack": copy.deepcopy(record.awaiting_interaction_ack),
            "cancel_requested": record.cancel_requested,
            "input_ready": bool(record.metadata.get("input_ready")),
        }

    def has_active(self, session_id: str) -> bool:
        record = self._records.get(str(session_id))
        return bool(record is not None and not record.terminal)

    def run_metadata(self, session_id: str) -> dict[str, Any]:
        record = self._records.get(str(session_id))
        if record is None or record.terminal:
            return {}
        return copy.deepcopy(record.metadata)

    async def subscribe(
        self,
        session_id: str,
        run_id: str,
        *,
        after_sequence: int = 0,
    ) -> AsyncIterator[dict[str, Any]]:
        record = self._records.get(str(session_id))
        if record is None or record.run_id != str(run_id):
            return
        cursor = max(0, int(after_sequence or 0))
        while True:
            async with record.condition:
                ready = [event for event in record.events if int(event.get("sequence") or 0) > cursor]
                if not ready and record.terminal:
                    return
                if not ready:
                    await record.condition.wait()
                    continue
            for event in ready:
                cursor = max(cursor, int(event.get("sequence") or 0))
                yield copy.deepcopy(event)

    async def commit_interaction_response(self, session_id: str, request_id: str) -> None:
        record = self._records.get(str(session_id))
        if record is None or record.terminal:
            return
        awaiting_id = str((record.awaiting_interaction_ack or {}).get("request_id") or "")
        if awaiting_id == str(request_id):
            return
        pending_id = str((record.pending_interaction or {}).get("request_id") or "")
        if pending_id and pending_id != str(request_id):
            return
        record.pending_interaction = None
        record.awaiting_interaction_ack = {"request_id": str(request_id)}
        record.status = "awaiting_cli_ack"
        await self._publish(record, {
            "type": "interaction_response_committed",
            "request_id": str(request_id),
            "session_id": record.session_id,
        })

    async def acknowledge_interaction(self, session_id: str, request_id: str, *, success: bool) -> None:
        record = self._records.get(str(session_id))
        if record is None or record.terminal:
            return
        awaiting_id = str((record.awaiting_interaction_ack or {}).get("request_id") or "")
        if not awaiting_id and record.status in {"running", "failed"}:
            return
        if awaiting_id and awaiting_id != str(request_id):
            return
        record.pending_interaction = None
        record.awaiting_interaction_ack = None
        record.status = "running" if success else "failed"
        if not success:
            record.had_error = True
        await self._publish(record, {
            "type": "interaction_resolved",
            "request_id": str(request_id),
            "success": bool(success),
            "session_id": record.session_id,
        })

    async def resolve_interaction(self, session_id: str, request_id: str) -> None:
        """Compatibility path for non-hook interactions accepted on stdin."""
        await self.acknowledge_interaction(session_id, request_id, success=True)

    async def request_cancel(self, session_id: str) -> None:
        record = self._records.get(str(session_id))
        if record is None or record.terminal:
            return
        record.cancel_requested = True
        record.pending_interaction = None
        record.awaiting_interaction_ack = None
        record.status = "cancelled"
        await self._publish(record, {
            "type": "run_status",
            "status": "cancelled",
            "session_id": record.session_id,
        })

    async def cancel(self, session_id: str) -> bool:
        record = self._records.get(str(session_id))
        if record is None or record.terminal:
            return False
        if not record.cancel_requested:
            await self.request_cancel(session_id)
        task = record.task
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return True

    async def shutdown(self) -> None:
        tasks = [record.task for record in self._records.values() if record.task and not record.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _publish(self, record: AgentRunRecord, payload: dict[str, Any]) -> dict[str, Any]:
        event = copy.deepcopy(payload)
        record.sequence += 1
        event["sequence"] = record.sequence
        event["run_id"] = record.run_id
        event.setdefault("session_id", record.session_id)
        record.events.append(event)
        if len(record.events) > self._max_events:
            del record.events[: len(record.events) - self._max_events]
        async with record.condition:
            record.condition.notify_all()
        return event

    def _project_event(self, record: AgentRunRecord, payload: dict[str, Any]) -> None:
        event_type = str(payload.get("type") or "")
        if event_type == "interaction_request":
            record.pending_interaction = copy.deepcopy(payload)
            record.awaiting_interaction_ack = None
            record.status = "waiting_input"
        elif event_type == "interaction_response_committed":
            record.pending_interaction = None
            record.awaiting_interaction_ack = {"request_id": str(payload.get("request_id") or "")}
            record.status = "awaiting_cli_ack"
        elif event_type == "interaction_resolved":
            record.pending_interaction = None
            record.awaiting_interaction_ack = None
            record.status = "running" if payload.get("success", True) else "failed"
            if payload.get("success") is False:
                record.had_error = True
        elif event_type == "queue_dispatch":
            record.pending_interaction = None
            record.status = "running"
            record.had_error = False
            record.saw_done = False
        elif event_type in {"assistant_start", "runtime_started", "working_status"}:
            if not record.cancel_requested:
                record.status = "running"
            if event_type == "runtime_started":
                record.metadata["input_ready"] = True
        elif event_type == "error":
            record.had_error = True
            record.status = "failed"
        elif event_type == "done":
            record.saw_done = True
            record.pending_interaction = None
            record.awaiting_interaction_ack = None
            record.status = "cancelled" if record.cancel_requested else ("failed" if record.had_error else "completed")

    async def _consume(self, record: AgentRunRecord, producer: AsyncIterator[Any]) -> None:
        try:
            async for chunk in producer:
                for payload in self._decode(chunk):
                    if not isinstance(payload, dict):
                        continue
                    self._project_event(record, payload)
                    await self._publish(record, payload)
        except asyncio.CancelledError:
            record.cancel_requested = True
            record.status = "cancelled"
            raise
        except Exception as exc:
            record.had_error = True
            record.status = "failed"
            await self._publish(record, {"type": "error", "content": f"Agent 运行协调器失败：{exc}"})
        finally:
            if not record.saw_done:
                if not record.cancel_requested and not record.had_error:
                    record.had_error = True
                    record.status = "failed"
                    await self._publish(record, {"type": "error", "content": "Agent 任务流意外结束。"})
                await self._publish(record, {"type": "done"})
            record.pending_interaction = None
            record.awaiting_interaction_ack = None
            record.terminal = True
            record.metadata["input_ready"] = False
            record.status = "cancelled" if record.cancel_requested else ("failed" if record.had_error else "completed")
            async with record.condition:
                record.condition.notify_all()
