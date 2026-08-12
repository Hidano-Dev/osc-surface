from __future__ import annotations

import asyncio
import gc
import json

import pytest

from osc_surface_ui.protocol import ReceivedOsc
from osc_surface_ui.surface_link import LinkOptions, LinkStatus, SurfaceLink, drain_failures

from .stub_server import StubOscServer

TARGET = ["127.0.0.1:7090"]


def build_link(
    server: StubOscServer,
    received: list[ReceivedOsc],
    statuses: list[LinkStatus] | None = None,
    wants_manifest: bool = False,
    manifest_request_interval_s: float = 0.05,
) -> SurfaceLink:
    return SurfaceLink(
        LinkOptions(
            url=server.url(),
            manifest_request_address="/surface/manifest/request",
            manifest_request_target=TARGET,
            manifest_request_interval_s=manifest_request_interval_s,
            initial_reconnect_delay_s=0.05,
            max_reconnect_delay_s=0.1,
        ),
        on_osc=received.append,
        on_status=None if statuses is None else statuses.append,
        wants_manifest=lambda: wants_manifest,
    )


async def test_opens_the_session_and_asks_for_the_manifest(stub_server, run_task) -> None:
    received: list[ReceivedOsc] = []
    link = build_link(stub_server, received)
    run_task(link.run())

    await stub_server.wait_until(lambda: len(stub_server.frames("sendOsc")) >= 1)

    assert stub_server.received[0] == ["open", {}]
    assert stub_server.frames("sendOsc")[0]["address"] == "/surface/manifest/request"
    assert stub_server.frames("sendOsc")[0]["target"] == TARGET
    # clientId は URL のパスに載る(末尾スラッシュで auth 無しを示す)。
    assert stub_server.paths[0] == "/test-client/"


async def test_answers_the_server_ping_so_the_connection_is_not_dropped(stub_server, run_task) -> None:
    link = build_link(stub_server, [])
    run_task(link.run())

    await stub_server.wait_for_connection()
    await stub_server.send_ping()
    await stub_server.wait_until(lambda: ["pong"] in stub_server.received)


async def test_dispatches_received_osc_with_unwrapped_arguments(stub_server, run_task) -> None:
    received: list[ReceivedOsc] = []
    link = build_link(stub_server, received)
    run_task(link.run())

    await stub_server.wait_for_connection()
    await stub_server.send_osc("/avatar/blend/smile", 0.5)
    await stub_server.wait_until(lambda: len(received) >= 1)

    assert received[0].address == "/avatar/blend/smile"
    assert received[0].args == (0.5,)


async def test_sends_queued_osc_values(stub_server, run_task) -> None:
    link = build_link(stub_server, [])
    run_task(link.run())

    await stub_server.wait_until(lambda: len(stub_server.frames("sendOsc")) >= 1)
    link.send_osc("/avatar/blend/smile", [0.25], "f", TARGET)
    await stub_server.wait_until(lambda: len(stub_server.frames("sendOsc")) >= 2)

    payload = stub_server.frames("sendOsc")[-1]

    assert payload == {
        "address": "/avatar/blend/smile",
        "v": 0.25,
        "preArgs": [],
        "typeTags": "f",
        "target": TARGET,
    }


async def test_drops_sends_while_disconnected(stub_server) -> None:
    link = build_link(stub_server, [])

    link.send_osc("/avatar/blend/smile", [0.25], "f", TARGET)

    assert link._outbox.queue.qsize() == 0


async def test_keeps_asking_until_the_manifest_arrives(stub_server, run_task) -> None:
    link = build_link(stub_server, [], wants_manifest=True)
    run_task(link.run())

    await stub_server.wait_until(lambda: len(stub_server.frames("sendOsc")) >= 3, timeout=5.0)

    addresses = {frame["address"] for frame in stub_server.frames("sendOsc")}
    assert addresses == {"/surface/manifest/request"}


async def test_reconnects_after_the_server_drops_the_connection(stub_server, run_task) -> None:
    statuses: list[LinkStatus] = []
    link = build_link(stub_server, [], statuses=statuses)
    run_task(link.run())

    await stub_server.wait_until(lambda: len(stub_server.frames("open")) >= 1)
    await stub_server.drop_connections()
    await stub_server.wait_until(lambda: len(stub_server.frames("open")) >= 2, timeout=5.0)

    assert link.status.connected is True
    assert any(status.connected is False for status in statuses)


class RecordingWebSocket:
    """接続の開閉と送信フレームを記録するだけの偽接続。"""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.entered = False
        self.closed = False

    async def __aenter__(self) -> RecordingWebSocket:
        self.entered = True
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self.closed = True

    async def send(self, frame: str) -> None:
        self.sent.append(frame)

    async def recv(self) -> str:
        await asyncio.sleep(0)
        raise ConnectionResetError("切断")


async def test_the_session_opens_and_always_closes_the_connection() -> None:
    """async with await connector(...) でも接続の開閉が抜けないことを押さえる。

    websockets の ClientConnection は __aenter__ が self を返し __aexit__ が close する
    ため、await して取り出してから async with に渡しても閉じ忘れは起きない。
    """
    socket = RecordingWebSocket()
    link = SurfaceLink(
        LinkOptions(
            url="ws://127.0.0.1:1/test/",
            manifest_request_address="/surface/manifest/request",
            manifest_request_target=TARGET,
        ),
        on_osc=lambda _message: None,
        connector=lambda _url: _resolved(socket),
    )

    with pytest.raises(ConnectionResetError):
        await link._session()

    assert socket.entered is True
    assert socket.closed is True
    assert json.loads(socket.sent[0]) == ["open", {}]


async def _resolved(value: object) -> object:
    return value


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


async def test_drain_failures_ignores_cancelled_tasks_and_clean_exits() -> None:
    cancelled = asyncio.get_running_loop().create_future()
    cancelled.cancel()
    finished = asyncio.get_running_loop().create_future()
    finished.set_result(None)

    assert drain_failures([cancelled, finished]) is None


def _failed_task(error: BaseException) -> asyncio.Future:
    future = asyncio.get_running_loop().create_future()
    future.set_exception(error)
    return future


async def test_stop_ends_the_run_loop(stub_server, run_task) -> None:
    link = build_link(stub_server, [])
    task = run_task(link.run())

    await stub_server.wait_for_connection()
    link.stop()
    await stub_server.drop_connections()
    await asyncio.wait_for(task, timeout=5.0)

    assert link.status.connected is False
