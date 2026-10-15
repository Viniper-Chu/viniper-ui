"""HTTP boundary for the desktop-owned loopback service.

Native local clients may omit Origin. Browser clients must belong to this
service; binding to loopback alone does not prevent cross-site requests or
DNS rebinding. Keep this independent of routes and engine ownership.
"""
import json
from typing import Callable


class LocalRequestGuard:
    def __init__(self, app, port: int):
        self.app = app
        self.authorities = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}
        self.origins = {f"http://{host}" for host in self.authorities}

    async def __call__(self, scope, receive: Callable, send: Callable):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        headers = {key.lower(): value.decode("latin-1") for key, value in scope["headers"]}
        host = headers.get(b"host", "").lower()
        origin = headers.get(b"origin")
        fetch_site = headers.get(b"sec-fetch-site", "").lower()
        if host not in self.authorities or (origin is not None and origin not in self.origins) or fetch_site == "cross-site" or (scope["type"] == "websocket" and origin not in self.origins):
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008, "reason": "Origin must match this local workbench"})
            body = json.dumps({"detail": "请求必须来自当前本机工作台。"}, ensure_ascii=False).encode("utf-8")
            await send({"type": "http.response.start", "status": 403, "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
                (b"cache-control", b"no-store"),
            ]})
            return await send({"type": "http.response.body", "body": body})
        return await self.app(scope, receive, send)
