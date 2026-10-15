"""Owned POSIX PTY sessions with bounded replay for the desktop terminal view."""
from __future__ import annotations

import asyncio
import codecs
from collections import deque
from dataclasses import dataclass, field
import errno
import fcntl
import os
from pathlib import Path
import signal
import struct
import sys
import termios
from typing import AsyncIterator, Sequence
import uuid


class NativeTerminalConflict(RuntimeError):
    pass


@dataclass
class _Terminal:
    session_id: str
    process: asyncio.subprocess.Process
    master_fd: int | None
    cols: int
    rows: int
    terminal_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "running"
    sequence: int = 0
    exit_code: int | None = None
    closing: bool = False
    output_truncated: bool = False
    buffered_bytes: int = 0
    events: deque = field(default_factory=deque)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    input_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    decoder: object = field(default_factory=lambda: codecs.getincrementaldecoder("utf-8")("replace"))
    wait_task: asyncio.Task | None = None
    stop_task: asyncio.Task | None = None


class NativeTerminalManager:
    def __init__(self, max_buffer_bytes: int = 512 * 1024, *, grace_seconds: float = 2.0, max_retained_sessions: int = 32):
        if os.name != "posix":
            raise RuntimeError("Native PTY requires a POSIX host")
        self.max_buffer_bytes = max(1024, int(max_buffer_bytes))
        self.grace_seconds = max(0.05, float(grace_seconds))
        self.max_retained_sessions = max(1, int(max_retained_sessions))
        self._terminals: dict[str, _Terminal] = {}
        self._lifecycle_lock = asyncio.Lock()
        self._shutting_down = False

    @staticmethod
    def _dimensions(cols: int, rows: int) -> tuple[int, int]:
        cols, rows = int(cols), int(rows)
        if not 2 <= cols <= 1000 or not 1 <= rows <= 500:
            raise ValueError("Terminal dimensions are out of range")
        return cols, rows

    def _terminal(self, session_id: str) -> _Terminal:
        terminal = self._terminals.get(str(session_id))
        if terminal is None:
            raise KeyError("Native terminal session not found")
        return terminal

    def active(self, session_id: str) -> bool:
        terminal = self._terminals.get(str(session_id))
        return bool(terminal and terminal.status != "exited")

    def session_ids(self) -> list[str]:
        return list(self._terminals)

    def snapshot(self, session_id: str) -> dict:
        terminal = self._terminal(session_id)
        return {
            "session_id": terminal.session_id, "terminal_id": terminal.terminal_id,
            "status": terminal.status, "pid": terminal.process.pid,
            "cols": terminal.cols, "rows": terminal.rows,
            "sequence": terminal.sequence,
            "oldest_sequence": terminal.events[0][0]["sequence"] if terminal.events else terminal.sequence + 1,
            "output": "".join(item[0].get("data", "") for item in terminal.events if item[0]["type"] == "output"),
            "output_truncated": terminal.output_truncated,
            "exit_code": terminal.exit_code, "closing": terminal.closing,
        }

    def _publish(self, terminal: _Terminal, event: dict) -> None:
        terminal.sequence += 1
        payload = {**event, "sequence": terminal.sequence,
                   "session_id": terminal.session_id, "terminal_id": terminal.terminal_id}
        size = len(str(payload.get("data", "")).encode("utf-8")) + 192
        terminal.events.append((payload, size))
        terminal.buffered_bytes += size
        while terminal.buffered_bytes > self.max_buffer_bytes and len(terminal.events) > 1:
            dropped, dropped_size = terminal.events.popleft()
            terminal.buffered_bytes -= dropped_size
            if dropped["type"] == "output":
                terminal.output_truncated = True
        changed = terminal.changed
        terminal.changed = asyncio.Event()
        changed.set()

    def _close_master(self, terminal: _Terminal) -> None:
        fd = terminal.master_fd
        if fd is None:
            return
        terminal.master_fd = None
        loop = asyncio.get_running_loop()
        loop.remove_reader(fd)
        loop.remove_writer(fd)
        try:
            trailing = terminal.decoder.decode(b"", final=True)
            if trailing:
                self._publish(terminal, {"type": "output", "data": trailing})
        finally:
            os.close(fd)

    def _read_ready(self, terminal: _Terminal, *, drain: bool = False) -> None:
        # Bound work per event-loop callback. The kernel PTY then supplies
        # backpressure while replay memory remains bounded independently.
        for _ in range(4096 if drain else 8):
            fd = terminal.master_fd
            if fd is None:
                return
            try:
                data = os.read(fd, min(8192, max(256, self.max_buffer_bytes // 4)))
            except BlockingIOError:
                return
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EBADF):
                    self._publish(terminal, {"type": "error", "reason": "terminal-read-failed"})
                self._close_master(terminal)
                return
            if not data:
                self._close_master(terminal)
                return
            text = terminal.decoder.decode(data, final=False)
            if text:
                self._publish(terminal, {"type": "output", "data": text})

    async def open(self, session_id: str, argv: Sequence[str], cwd: str, env: dict[str, str], cols: int = 100, rows: int = 30) -> dict:
        session_id = str(session_id)
        if not session_id or len(session_id) > 200:
            raise ValueError("Invalid terminal session id")
        if isinstance(argv, (str, bytes)) or not argv or any(not isinstance(arg, str) or "\0" in arg for arg in argv):
            raise ValueError("Terminal executable and arguments must be an argv list")
        if not Path(cwd).is_dir():
            raise ValueError("Terminal working directory does not exist")
        cols, rows = self._dimensions(cols, rows)
        async with self._lifecycle_lock:
            if self._shutting_down:
                raise RuntimeError("Native terminals are shutting down")
            if self.active(session_id):
                raise NativeTerminalConflict("This session already owns a native terminal")
            for key in list(self._terminals):
                if len(self._terminals) < self.max_retained_sessions:
                    break
                if not self.active(key):
                    self._terminals.pop(key)
            if session_id not in self._terminals and len(self._terminals) >= self.max_retained_sessions:
                raise NativeTerminalConflict("Too many native terminals are open")
            master, slave = os.openpty()
            try:
                os.set_blocking(master, False)
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                child_env = {str(key): str(value) for key, value in env.items()}
                child_env.setdefault("TERM", "xterm-256color")
                child_env.setdefault("COLORTERM", "truecolor")
                child_env.setdefault("LANG", "en_US.UTF-8")
                process = await asyncio.create_subprocess_exec(
                    sys.executable, "-I", str(Path(__file__).with_name("native_pty_runner.py")), str(slave), *argv,
                    cwd=cwd, env=child_env, pass_fds=(slave,), start_new_session=True,
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except BaseException:
                os.close(master)
                raise
            finally:
                os.close(slave)
            terminal = _Terminal(session_id, process, master, cols, rows)
            self._terminals[session_id] = terminal
            self._publish(terminal, {"type": "state", "status": "running", "exit_code": None})
            asyncio.get_running_loop().add_reader(master, self._read_ready, terminal)
            terminal.wait_task = asyncio.create_task(self._wait_for_exit(terminal))
            return self.snapshot(session_id)

    @staticmethod
    def _group_alive(terminal: _Terminal) -> bool:
        try:
            os.killpg(terminal.process.pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # Darwin reports EPERM for a group whose only remaining member is
            # a zombie, before asyncio's child watcher reaps its leader. Its
            # PID is still visible to kill(pid, 0), but getpgid reports ESRCH.
            # Keep genuine permission errors for live process groups visible.
            if sys.platform == "darwin":
                try:
                    os.getpgid(terminal.process.pid)
                except ProcessLookupError:
                    return False
            raise

    async def _stop_group(self, terminal: _Terminal) -> None:
        def send(sig: signal.Signals) -> None:
            try:
                os.killpg(terminal.process.pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                # The group can enter the Darwin zombie state between the
                # liveness probe and signal delivery as well.
                if self._group_alive(terminal):
                    raise
        if not self._group_alive(terminal):
            return
        send(signal.SIGTERM)
        deadline = asyncio.get_running_loop().time() + self.grace_seconds
        while self._group_alive(terminal) and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.025)
        if self._group_alive(terminal):
            send(signal.SIGKILL)
        # The child watcher reaps the session leader. Orphaned descendants are
        # reaped by the OS; never search for processes by a broad executable name.

    async def _ensure_stopped(self, terminal: _Terminal) -> None:
        if terminal.stop_task is None:
            terminal.stop_task = asyncio.create_task(self._stop_group(terminal))
        await asyncio.shield(terminal.stop_task)

    async def _wait_for_exit(self, terminal: _Terminal) -> None:
        try:
            terminal.exit_code = await terminal.process.wait()
            # A CLI that exits with an outstanding child must not leave an
            # owned shell holding the PTY open forever.
            await self._ensure_stopped(terminal)
            self._read_ready(terminal, drain=True)
        finally:
            self._close_master(terminal)
            terminal.status = "exited"
            self._publish(terminal, {"type": "state", "status": "exited", "exit_code": terminal.exit_code})

    async def write(self, session_id: str, data: str | bytes) -> int:
        terminal = self._terminal(session_id)
        payload = data.encode("utf-8") if isinstance(data, str) else bytes(data)
        if len(payload) > 256 * 1024:
            raise ValueError("Terminal input is too large")
        async with terminal.input_lock:
            offset = 0
            while offset < len(payload):
                fd = terminal.master_fd
                if fd is None or terminal.status == "exited" or terminal.closing:
                    raise RuntimeError("Native terminal has exited")
                try:
                    offset += os.write(fd, payload[offset:])
                except BlockingIOError:
                    writable = asyncio.get_running_loop().create_future()
                    def ready() -> None:
                        if not writable.done():
                            writable.set_result(None)
                    asyncio.get_running_loop().add_writer(fd, ready)
                    try:
                        await asyncio.wait_for(writable, timeout=5)
                    finally:
                        if terminal.master_fd == fd:
                            asyncio.get_running_loop().remove_writer(fd)
                except OSError as error:
                    if error.errno in (errno.EIO, errno.EBADF):
                        raise RuntimeError("Native terminal has exited") from None
                    raise
            return offset

    async def resize(self, session_id: str, cols: int, rows: int) -> dict:
        terminal = self._terminal(session_id)
        cols, rows = self._dimensions(cols, rows)
        if terminal.master_fd is None or terminal.status == "exited":
            raise RuntimeError("Native terminal has exited")
        fcntl.ioctl(terminal.master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        terminal.cols, terminal.rows = cols, rows
        self._publish(terminal, {"type": "resize", "cols": cols, "rows": rows})
        return self.snapshot(session_id)

    async def subscribe(self, session_id: str, after_sequence: int = 0) -> AsyncIterator[dict]:
        terminal = self._terminal(session_id)
        cursor = max(0, int(after_sequence))
        if cursor > terminal.sequence:
            cursor = 0  # A previous incarnation's cursor cannot hide a new PTY.
        while True:
            changed = terminal.changed
            buffered = [event for event, _ in terminal.events]
            oldest = buffered[0]["sequence"] if buffered else terminal.sequence + 1
            if cursor < oldest - 1:
                yield {"type": "gap", "session_id": session_id, "terminal_id": terminal.terminal_id,
                       "from_sequence": cursor + 1, "to_sequence": oldest - 1, "sequence": oldest - 1}
                cursor = oldest - 1
            for event in buffered:
                if event["sequence"] > cursor:
                    cursor = event["sequence"]
                    yield dict(event)
            if terminal.status == "exited" and cursor >= terminal.sequence:
                return
            await changed.wait()

    async def close(self, session_id: str) -> dict:
        terminal = self._terminal(session_id)
        terminal.closing = True
        await self._ensure_stopped(terminal)
        if terminal.wait_task:
            await asyncio.shield(terminal.wait_task)
        return self.snapshot(session_id)

    async def shutdown(self) -> None:
        async with self._lifecycle_lock:
            self._shutting_down = True
        await asyncio.gather(*(self.close(session_id) for session_id in self.session_ids()), return_exceptions=False)


__all__ = ["NativeTerminalManager", "NativeTerminalConflict"]
