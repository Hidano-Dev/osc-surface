"""O-S-C サーバーへの WebSocket 接続。

docs/CUSTOM_UI_INTEGRATION.md §3 のフレーム仕様に沿った最小クライアント。
- 接続直後に ["open", {}] を送る
- ["ping"] には必ず ["pong"] を返す(5 秒で切断される)
- 送信は ["sendOsc", {...}]。target は必須
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Sequence

import websockets

from .protocol import (
    EVENT_PING,
    EVENT_RECEIVE_OSC,
    ReceivedOsc,
    decode_frame,
    open_frame,
    parse_received_osc,
    pong_frame,
    send_osc_frame,
)

logger = logging.getLogger(__name__)

INITIAL_RECONNECT_DELAY_S = 0.5
MAX_RECONNECT_DELAY_S = 10.0
# サーバーの ping 間隔は 25 秒。2 回聞こえなければ死んでいるとみなす。
RECEIVE_TIMEOUT_S = 60.0
MANIFEST_REQUEST_INTERVAL_S = 2.0
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
    manifest_request_address: str
    manifest_request_target: Sequence[str]
    manifest_request_interval_s: float = MANIFEST_REQUEST_INTERVAL_S
    receive_timeout_s: float = RECEIVE_TIMEOUT_S
    initial_reconnect_delay_s: float = INITIAL_RECONNECT_DELAY_S
    max_reconnect_delay_s: float = MAX_RECONNECT_DELAY_S
    outbox_max_frames: int = OUTBOX_MAX_FRAMES


def drain_failures(done: Iterable[Any]) -> BaseException | None:
    """終了したタスクすべてから例外を回収し、最初の 1 つを返す。

    切断時は読み取りタスクと書き込みタスクが同時に終わりうる。1 個目で raise して
    残りを放置すると、asyncio が "Task exception was never retrieved" を吐く。
    """
    failure: BaseException | None = None

    for task in done:
        if task.cancelled():
            continue

        error = task.exception()

        if error is not None and failure is None:
            failure = error

    return failure


OscHandler = Callable[[ReceivedOsc], None]
StatusHandler = Callable[[LinkStatus], None]
Connector = Callable[[str], Awaitable[Any]]


@dataclass
class _Outbox:
    """未接続時の送信は捨てる(古い操作を後から流さない)。"""

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


class SurfaceLink:
    def __init__(
        self,
        options: LinkOptions,
        on_osc: OscHandler,
        on_status: StatusHandler | None = None,
        wants_manifest: Callable[[], bool] | None = None,
        connector: Connector | None = None,
    ) -> None:
        self._options = options
        self._on_osc = on_osc
        self._on_status = on_status
        self._wants_manifest = wants_manifest or (lambda: False)
        # ping_interval=None: 死活監視はアプリ層の ["ping"]/["pong"] が担う。
        # proxy=None: 相手は LAN 内の O-S-C なので、環境変数の HTTP プロキシを経由させない。
        self._connector = connector or (
            lambda url: websockets.connect(url, ping_interval=None, proxy=None)
        )
        self._outbox = _Outbox(max_frames=options.outbox_max_frames)
        self._status = LinkStatus(connected=False, detail="未接続")
        self._stopping = asyncio.Event()
        self._connected = asyncio.Event()

    @property
    def status(self) -> LinkStatus:
        return self._status

    @property
    def dropped_frames(self) -> int:
        return self._outbox.dropped

    def send_osc(self, address: str, args: Sequence[Any], type_tags: str, target: Sequence[str]) -> None:
        """UI スレッド(同じイベントループ)から呼ぶ送信キュー投入。"""
        if not self._connected.is_set():
            return

        self._outbox.put(send_osc_frame(address, args, type_tags, target))

    def request_manifest(self) -> None:
        """マニフェストの再配信を要求する。custom module 内で消費され UDP には出ない。"""
        if not self._connected.is_set():
            return

        self._outbox.put(
            send_osc_frame(
                self._options.manifest_request_address,
                [1],
                "i",
                self._options.manifest_request_target,
            )
        )

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        """切断されても諦めずに再接続し続ける常駐タスク。"""
        delay = self._options.initial_reconnect_delay_s
        attempts = 0

        while not self._stopping.is_set():
            attempts += 1
            self._set_status(LinkStatus(connected=False, detail="接続中", attempts=attempts))

            try:
                await self._session()
                delay = self._options.initial_reconnect_delay_s
                attempts = 0
                self._set_status(LinkStatus(connected=False, detail="切断", attempts=attempts))
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - 接続失敗の理由は表示に回す
                message = f"{type(error).__name__}: {error}"
                logger.warning("O-S-C への接続に失敗しました (%s)", message)
                self._set_status(
                    LinkStatus(connected=False, detail="再接続待ち", last_error=message, attempts=attempts)
                )

            if self._stopping.is_set():
                return

            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)

            delay = min(delay * 2, self._options.max_reconnect_delay_s)

    async def _session(self) -> None:
        async with await self._connector(self._options.url) as websocket:
            self._outbox.clear()
            self._connected.set()
            self._set_status(LinkStatus(connected=True, detail="接続済み"))

            await websocket.send(open_frame())
            self.request_manifest()

            tasks = [
                asyncio.create_task(self._read_loop(websocket)),
                asyncio.create_task(self._write_loop(websocket)),
                asyncio.create_task(self._manifest_loop()),
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

    async def _read_loop(self, websocket: Any) -> None:
        while True:
            raw = await asyncio.wait_for(websocket.recv(), timeout=self._options.receive_timeout_s)

            try:
                frame = decode_frame(raw)
            except ValueError as error:
                logger.warning("不正なフレームを無視しました: %s", error)
                continue

            if frame.event == EVENT_PING:
                # 5 秒以内に返さないと切断される。何よりも優先する。
                await websocket.send(pong_frame())
                continue

            if frame.event != EVENT_RECEIVE_OSC:
                continue

            try:
                message = parse_received_osc(frame.data)
            except ValueError as error:
                logger.warning("不正な receiveOsc を無視しました: %s", error)
                continue

            try:
                self._on_osc(message)
            except Exception:  # noqa: BLE001 - UI 側の例外で接続を殺さない
                logger.exception("受信ハンドラで例外が発生しました (%s)", message.address)

    async def _write_loop(self, websocket: Any) -> None:
        while True:
            frame = await self._outbox.queue.get()
            await websocket.send(frame)

    async def _manifest_loop(self) -> None:
        while True:
            await asyncio.sleep(self._options.manifest_request_interval_s)

            if self._wants_manifest():
                self.request_manifest()

    def _set_status(self, status: LinkStatus) -> None:
        self._status = status

        if self._on_status is None:
            return

        try:
            self._on_status(status)
        except Exception:  # noqa: BLE001
            logger.exception("状態ハンドラで例外が発生しました")
