"""O-S-C サーバーの WebSocket 面だけを真似たスタブ。

docs/CUSTOM_UI_INTEGRATION.md §3 のフレーム仕様に沿って
["open"] の受理・["ping"] の送出・["receiveOsc"] のブロードキャストを再現する。
本物の O-S-C は vendor submodule が必要なため、単体テストではこちらを使う。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

from websockets.asyncio.server import ServerConnection, serve


class StubOscServer:
    def __init__(self) -> None:
        self.received: list[list[Any]] = []
        self.paths: list[str] = []
        self.connections: set[ServerConnection] = set()
        self._server: Any = None
        self._connected = asyncio.Event()

    @property
    def port(self) -> int:
        return self._server.sockets[0].getsockname()[1]

    def url(self, client_id: str = "test-client") -> str:
        return f"ws://127.0.0.1:{self.port}/{client_id}/"

    async def start(self) -> None:
        self._server = await serve(self._handle, "127.0.0.1", 0, ping_interval=None)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, connection: ServerConnection) -> None:
        self.connections.add(connection)
        self.paths.append(connection.request.path if connection.request else "")
        self._connected.set()

        try:
            async for raw in connection:
                self.received.append(json.loads(raw))
        except Exception:  # noqa: BLE001 - 切断は正常系
            pass
        finally:
            self.connections.discard(connection)

    async def wait_for_connection(self, timeout: float = 5.0) -> None:
        await asyncio.wait_for(self._connected.wait(), timeout=timeout)

    async def send_ping(self) -> None:
        await self.broadcast_frame(["ping"])

    async def send_osc(self, address: str, args: Any) -> None:
        await self.broadcast_frame(["receiveOsc", {"address": address, "args": args}])

    async def broadcast_frame(self, frame: list[Any]) -> None:
        payload = json.dumps(frame)

        for connection in list(self.connections):
            await connection.send(payload)

    async def drop_connections(self) -> None:
        for connection in list(self.connections):
            await connection.close()

    def frames(self, event: str) -> list[Any]:
        return [frame[1] if len(frame) > 1 else None for frame in self.received if frame[0] == event]

    async def wait_until(
        self, predicate: Callable[[], bool], timeout: float = 5.0, interval: float = 0.01
    ) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        while not predicate():
            if loop.time() > deadline:
                raise AssertionError("条件が時間内に満たされませんでした。")
            await asyncio.sleep(interval)
