from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

from websockets.asyncio.server import ServerConnection, serve


class StubBridgeServer:
    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []
        self.connections: set[ServerConnection] = set()
        self._server: Any = None
        self._connected = asyncio.Event()

    @property
    def port(self) -> int:
        return self._server.sockets[0].getsockname()[1]

    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/"

    async def start(self) -> None:
        self._server = await serve(self._handle, "127.0.0.1", 0, ping_interval=None)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, connection: ServerConnection) -> None:
        self.connections.add(connection)
        self._connected.set()
        try:
            async for raw in connection:
                self.received.append(json.loads(raw))
        except Exception:  # noqa: BLE001
            pass
        finally:
            self.connections.discard(connection)

    async def wait_for_connection(self) -> None:
        await asyncio.wait_for(self._connected.wait(), timeout=5)

    async def send(self, frame: dict[str, Any]) -> None:
        payload = json.dumps(frame)
        for connection in list(self.connections):
            await connection.send(payload)

    async def drop_connections(self) -> None:
        for connection in list(self.connections):
            await connection.close()

    async def wait_until(self, predicate: Callable[[], bool], timeout: float = 5) -> None:
        deadline = asyncio.get_running_loop().time() + timeout
        while not predicate():
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError("条件が時間内に満たされませんでした")
            await asyncio.sleep(0.01)
