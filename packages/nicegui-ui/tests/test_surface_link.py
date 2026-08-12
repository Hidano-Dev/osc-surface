from __future__ import annotations

import asyncio
import gc
import json
from typing import Any

import pytest

from osc_surface_ui.protocol import DecodedFrame, HelloFrame, ManifestFrame, OscFrame
from osc_surface_ui.surface_link import LinkOptions, LinkStatus, SurfaceLink, drain_failures

from .stub_server import StubBridgeServer

HELLO_FRAME = {
    "v": 1,
    "type": "hello",
    "clientId": "test-client",
    "protocolVersion": 1,
    "server": {},
    "unity": {"host": "127.0.0.1", "sendPort": 7090, "receivePort": 7091},
    "bridge": {},
    "expectedProjectId": None,
    "heartbeat": {"intervalMs": 15000},
    "pingIntervalMs": 1000,
    "debug": False,
}
MANIFEST_FRAME = {"v": 1, "type": "manifest", "manifest": {"projectId": "demo"}}
OSC_FRAME = {
    "v": 1,
    "type": "osc",
    "address": "/avatar/blend/smile",
    "args": [{"type": "f", "value": 0.5}],
    "from": {"host": "127.0.0.1", "port": 7090},
}


def build_link(
    server: StubBridgeServer,
    statuses: list[LinkStatus] | None = None,
    frames: list[DecodedFrame] | None = None,
) -> SurfaceLink:
    return SurfaceLink(
        LinkOptions(
            url=server.url(),
            heartbeat_interval_s=0.1,
            initial_reconnect_delay_s=0.01,
            max_reconnect_delay_s=0.02,
        ),
        on_frame=(lambda _frame: None) if frames is None else frames.append,
        on_status=None if statuses is None else statuses.append,
    )


async def test_connects_with_bridge_frames_and_requests_manifest(stub_server, run_task) -> None:
    link = build_link(stub_server)
    run_task(link.run())
    await stub_server.wait_until(lambda: len(stub_server.received) >= 1)
    assert stub_server.received[0] == {"v": 1, "type": "manifestRequest"}


async def test_heartbeat_ack_bypasses_outbox(stub_server, run_task) -> None:
    link = build_link(stub_server)
    run_task(link.run())
    await stub_server.wait_for_connection()
    await stub_server.send({"v": 1, "type": "heartbeat", "t": 42})
    await stub_server.wait_until(lambda: any(f["type"] == "heartbeatAck" for f in stub_server.received))
    assert {"v": 1, "type": "heartbeatAck", "t": 42} in stub_server.received


async def test_rejected_frame_is_logged_and_connection_stays_open(stub_server, run_task, caplog) -> None:
    link = build_link(stub_server)
    run_task(link.run())
    await stub_server.wait_for_connection()
    with caplog.at_level("WARNING"):
        await stub_server.send({"v": 1, "type": "heartbeat", "unknown": True})
    await asyncio.sleep(0.02)
    await stub_server.send({"v": 1, "type": "heartbeat", "t": 7})
    await stub_server.wait_until(lambda: any(f["type"] == "heartbeatAck" for f in stub_server.received))
    assert "不正なフレームを破棄しました" in caplog.text


async def test_sends_osc_without_destination(stub_server, run_task) -> None:
    link = build_link(stub_server)
    run_task(link.run())
    await stub_server.wait_for_connection()
    await stub_server.wait_until(lambda: link.status.connected)
    link.send_osc("/a", [{"type": "f", "value": 0.25}])
    expected = {
        "v": 1,
        "type": "osc",
        "address": "/a",
        "args": [{"type": "f", "value": 0.25}],
    }
    await stub_server.wait_until(lambda: expected in stub_server.received)


async def test_reconnect_requests_manifest_again(stub_server, run_task) -> None:
    link = build_link(stub_server)
    run_task(link.run())
    await stub_server.wait_until(lambda: len(stub_server.received) >= 1)
    await stub_server.drop_connections()
    await stub_server.wait_until(
        lambda: sum(frame == {"v": 1, "type": "manifestRequest"} for frame in stub_server.received) >= 2
    )


async def test_receive_timeout_is_three_heartbeat_intervals() -> None:
    options = LinkOptions(url="ws://127.0.0.1", heartbeat_interval_s=2)
    assert options.receive_timeout_s == 6


async def test_reconnects_when_nothing_arrives_within_the_receive_timeout(
    stub_server, run_task
) -> None:
    # 心拍 3 回分だけ無音が続いた状態。接続をやり直してマニフェストを取り直す。
    link = SurfaceLink(
        LinkOptions(
            url=stub_server.url(),
            heartbeat_interval_s=0.02,
            initial_reconnect_delay_s=0.01,
            max_reconnect_delay_s=0.02,
        ),
        on_frame=lambda _frame: None,
    )
    run_task(link.run())

    await stub_server.wait_until(
        lambda: sum(frame == {"v": 1, "type": "manifestRequest"} for frame in stub_server.received) >= 2
    )


async def test_every_other_frame_goes_to_the_single_handler(stub_server, run_task) -> None:
    frames: list[DecodedFrame] = []
    link = build_link(stub_server, frames=frames)
    run_task(link.run())
    await stub_server.wait_for_connection()
    await stub_server.send(HELLO_FRAME)
    await stub_server.send(MANIFEST_FRAME)
    await stub_server.send(OSC_FRAME)
    await stub_server.send({"v": 1, "type": "heartbeat", "t": 3})
    await stub_server.wait_until(lambda: len(frames) >= 3)
    await stub_server.wait_until(
        lambda: any(frame["type"] == "heartbeatAck" for frame in stub_server.received)
    )

    # 種別ごとの処理は状態層の担当。接続層が自分で処理するのは心拍だけ。
    assert [type(frame) for frame in frames] == [HelloFrame, ManifestFrame, OscFrame]
    assert frames[2].args[0].value == 0.5


async def test_drops_sends_while_disconnected(stub_server) -> None:
    link = build_link(stub_server)

    link.send_osc("/a", [{"type": "f", "value": 0.25}])
    link.request_manifest()

    assert link._outbox.queue.qsize() == 0


class RecordingWebSocket:
    """送信を保留できる偽接続。心拍応答が送信待ち行列を追い越すことの確認に使う。"""

    def __init__(self, block_type: str | None = None) -> None:
        self.sent: list[dict[str, Any]] = []
        self.entered = False
        self.closed = False
        self.gate = asyncio.Event()
        self._block_type = block_type

    async def __aenter__(self) -> RecordingWebSocket:
        self.entered = True
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self.closed = True

    async def send(self, raw: str) -> None:
        frame = json.loads(raw)
        if frame["type"] == self._block_type:
            await self.gate.wait()
        self.sent.append(frame)

    async def recv(self) -> str:
        await asyncio.sleep(0)
        raise ConnectionResetError("切断")

    def types(self) -> list[str]:
        return [frame["type"] for frame in self.sent]


async def _resolved(value: object) -> object:
    return value


async def test_the_heartbeat_ack_overtakes_the_queued_frames(run_task) -> None:
    socket = RecordingWebSocket(block_type="osc")
    link = SurfaceLink(
        LinkOptions(url="ws://127.0.0.1:1/", heartbeat_interval_s=0.1),
        on_frame=lambda _frame: None,
        connector=lambda _url: _resolved(socket),
    )
    link._connected.set()
    link.send_osc("/a", [{"type": "f", "value": 0.25}])
    run_task(link._write_loop(socket))

    await link._read_frame(socket, json.dumps({"v": 1, "type": "heartbeat", "t": 42}))

    # 値の送信が詰まっていても、心拍応答は待たされない。
    assert socket.types() == ["heartbeatAck"]
    socket.gate.set()


async def test_the_session_opens_and_always_closes_the_connection() -> None:
    """async with await connector(...) でも接続の開閉が抜けないことを押さえる。

    websockets の ClientConnection は __aenter__ が self を返し __aexit__ が close する
    ため、await して取り出してから async with に渡しても閉じ忘れは起きない。
    """
    socket = RecordingWebSocket()
    link = SurfaceLink(
        LinkOptions(url="ws://127.0.0.1:1/"),
        on_frame=lambda _frame: None,
        connector=lambda _url: _resolved(socket),
    )

    with pytest.raises(ConnectionResetError):
        await link._session()

    assert socket.entered is True
    assert socket.closed is True
    assert socket.types() == ["manifestRequest"]


async def test_the_default_connector_ignores_proxies_and_library_keepalive(monkeypatch) -> None:
    """D-023: 生存確認は自前の心拍が持つ。プロキシ環境変数も一切見ない。"""
    captured: dict[str, Any] = {}

    def fake_connect(url: str, **kwargs: Any) -> Any:
        captured.update({"url": url}, **kwargs)
        return asyncio.sleep(0)

    monkeypatch.setattr("websockets.connect", fake_connect)
    link = SurfaceLink(LinkOptions(url="ws://127.0.0.1:7070/"), on_frame=lambda _frame: None)
    await link._connector("ws://127.0.0.1:7070/")

    assert captured == {"url": "ws://127.0.0.1:7070/", "ping_interval": None, "proxy": None}


async def test_a_simultaneous_read_and_write_failure_retrieves_every_exception() -> None:
    """切断では読み取りと書き込みが同時に落ちうる。

    1 個目の例外だけ拾って残りを放置すると、タスクが回収された時点で asyncio が
    "Task exception was never retrieved" を吐く。それを起こさないことを確かめる。
    """
    unhandled: list[dict] = []
    asyncio.get_running_loop().set_exception_handler(lambda _loop, context: unhandled.append(context))

    read_failure = ConnectionResetError("読み取り側の切断")
    write_failure = ConnectionResetError("書き込み側の切断")
    done = [_failed_task(read_failure), _failed_task(write_failure)]

    assert drain_failures(done) in (read_failure, write_failure)

    # 参照を落として __del__ を走らせる。取りこぼしがあればここで警告になる。
    del done
    gc.collect()
    await asyncio.sleep(0)

    assert [context.get("message") for context in unhandled] == []


def _failed_task(error: BaseException) -> asyncio.Future:
    future = asyncio.get_running_loop().create_future()
    future.set_exception(error)
    return future


async def test_drain_failures_ignores_cancelled_tasks() -> None:
    cancelled = asyncio.get_running_loop().create_future()
    cancelled.cancel()
    finished = asyncio.get_running_loop().create_future()
    finished.set_result(None)
    assert drain_failures([cancelled, finished]) is None


async def test_stop_ends_the_run_loop(stub_server, run_task) -> None:
    link = build_link(stub_server)
    task = run_task(link.run())

    await stub_server.wait_for_connection()
    link.stop()
    await stub_server.drop_connections()
    await asyncio.wait_for(task, timeout=5.0)

    assert link.status.connected is False
