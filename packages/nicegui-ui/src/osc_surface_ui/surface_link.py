"""WebSocket connection to the OscDesk bridge."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Sequence

import websockets

from .protocol import (
    DecodedFrame,
    FrameDecodeError,
    decode_frame,
    encode_heartbeat_ack,
    encode_manifest_request,
    encode_osc_frame,
)

logger = logging.getLogger(__name__)

INITIAL_RECONNECT_DELAY_S = 0.5
MAX_RECONNECT_DELAY_S = 10.0
HEARTBEAT_INTERVAL_S = 15.0
RECEIVE_TIMEOUT_S = HEARTBEAT_INTERVAL_S * 3
OUTBOX_MAX_FRAMES = 256


@dataclass(frozen=True)
class LinkStatus:
    connected: bool
    detail: str
    last_error: str | None = None
    attempts: int = 0


@dataclass
class LinkOptions:
    url: str
    heartbeat_interval_s: float = HEARTBEAT_INTERVAL_S
    receive_timeout_s: float | None = None
    initial_reconnect_delay_s: float = INITIAL_RECONNECT_DELAY_S
    max_reconnect_delay_s: float = MAX_RECONNECT_DELAY_S
    outbox_max_frames: int = OUTBOX_MAX_FRAMES

    def __post_init__(self) -> None:
        if self.receive_timeout_s is None:
            object.__setattr__(self, "receive_timeout_s", self.heartbeat_interval_s * 3)


def drain_failures(done: Iterable[Any]) -> BaseException | None:
    failure: BaseException | None = None
    for task in done:
        if task.cancelled():
            continue
        error = task.exception()
        if error is not None and failure is None:
            failure = error
    return failure


FrameHandler = Callable[[DecodedFrame], None]
StatusHandler = Callable[[LinkStatus], None]
Connector = Callable[[str], Awaitable[Any]]


@dataclass
class _Outbox:
    max_frames: int
    queue: asyncio.Queue[str] = field(init=False)
    dropped: int = 0

    def __post_init__(self) -> None:
        self.queue = asyncio.Queue(maxsize=self.max_frames)

    def put(self, frame: str) -> None:
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
            self.dropped += 1
            with contextlib.suppress(asyncio.QueueFull):
                self.queue.put_nowait(frame)

    def clear(self) -> None:
        while True:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                return


class BridgeLink:
    """Maintain a resilient bridge WebSocket connection."""

    def __init__(
        self,
        options: LinkOptions,
        on_frame: FrameHandler,
        on_status: StatusHandler | None = None,
        connector: Connector | None = None,
    ) -> None:
        self._options = options
        self._on_frame = on_frame
        self._on_status = on_status
        # D-023: the application heartbeat owns liveness; never use proxy env vars.
        self._connector = connector or (
            lambda url: websockets.connect(url, ping_interval=None, proxy=None)
        )
        self._outbox = _Outbox(options.outbox_max_frames)
        self._status = LinkStatus(False, "未接続")
        self._stopping = asyncio.Event()
        self._connected = asyncio.Event()

    @property
    def status(self) -> LinkStatus:
        return self._status

    @property
    def dropped_frames(self) -> int:
        return self._outbox.dropped

    def send_osc(self, address: str, args: Sequence[Any]) -> None:
        if self._connected.is_set():
            self._outbox.put(encode_osc_frame(address, args))

    def request_manifest(self) -> None:
        if self._connected.is_set():
            self._outbox.put(encode_manifest_request())

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        delay = self._options.initial_reconnect_delay_s
        attempts = 0
        while not self._stopping.is_set():
            attempts += 1
            self._set_status(LinkStatus(False, "接続中", attempts=attempts))
            try:
                await self._session()
                delay = self._options.initial_reconnect_delay_s
                attempts = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                message = f"{type(error).__name__}: {error}"
                logger.warning("ブリッジへの接続に失敗しました (%s)", message)
                self._set_status(LinkStatus(False, "再接続待ち", message, attempts))
            if self._stopping.is_set():
                return
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
            delay = min(delay * 2, self._options.max_reconnect_delay_s)

    async def _session(self) -> None:
        async with await self._connector(self._options.url) as websocket:
            self._outbox.clear()
            self._connected.set()
            self._set_status(LinkStatus(True, "接続済み"))
            # A reconnect always refreshes the manifest, including after the first connect.
            self.request_manifest()
            tasks = [
                asyncio.create_task(self._read_loop(websocket)),
                asyncio.create_task(self._write_loop(websocket)),
            ]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                failure = drain_failures(done)
                if failure is not None:
                    raise failure
            finally:
                self._connected.clear()
                self._outbox.clear()
                self._set_status(LinkStatus(False, "切断"))

    async def _read_loop(self, websocket: Any) -> None:
        while True:
            raw = await asyncio.wait_for(websocket.recv(), timeout=self._options.receive_timeout_s)
            await self._read_frame(websocket, raw)

    async def _read_frame(self, websocket: Any, raw: str | bytes) -> None:
        try:
            frame = decode_frame(raw)
        except (FrameDecodeError, ValueError) as error:
            # Rejecting a frame never costs the connection (Req 3-5 の対称適用).
            logger.warning("不正なフレームを破棄しました: %s", error)
            return
        if frame.type == "heartbeat":
            # Bypass the outbox: heartbeat acknowledgements have highest priority.
            await websocket.send(encode_heartbeat_ack(frame.t))
            return
        try:
            self._on_frame(frame)
        except Exception:  # noqa: BLE001
            logger.exception("受信フレームのハンドラで例外が発生しました (%s)", frame.type)

    async def _write_loop(self, websocket: Any) -> None:
        while True:
            await websocket.send(await self._outbox.queue.get())

    def _set_status(self, status: LinkStatus) -> None:
        self._status = status
        if self._on_status is not None:
            try:
                self._on_status(status)
            except Exception:  # noqa: BLE001
                logger.exception("状態ハンドラで例外が発生しました")


# Kept as the module's established public class name until the package rename task.
SurfaceLink = BridgeLink
