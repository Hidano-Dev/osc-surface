from __future__ import annotations

import asyncio
import json
import socket
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio

from oscdesk_ui.protocol import ManifestFrame, OscFrame
from oscdesk_ui.surface_link import BridgeLink, LinkOptions


ROOT = Path(__file__).resolve().parents[3]
BRIDGE_BUNDLE = ROOT / "packages" / "bridge" / "dist" / "oscdesk-bridge.js"
MOCK_UNITY_BUNDLE = ROOT / "packages" / "mock-unity" / "dist" / "mock-unity.js"
SCENARIO = ROOT / "packages" / "mock-unity" / "scenarios" / "default.json"


def _unused_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _check_prerequisites() -> None:
    missing: list[str] = []
    if not BRIDGE_BUNDLE.is_file():
        missing.append(
            f"bridge bundle: {BRIDGE_BUNDLE}\n"
            "  fix: corepack pnpm --filter @oscdesk/bridge run build"
        )
    if not MOCK_UNITY_BUNDLE.is_file():
        missing.append(
            f"mock-unity bundle: {MOCK_UNITY_BUNDLE}\n"
            "  fix: corepack pnpm --filter @oscdesk/mock-unity run build"
        )
    node_modules = ROOT / "node_modules"
    if not node_modules.is_dir():
        missing.append(
            f"Node dependencies: {node_modules}\n"
            "  fix: corepack pnpm install"
        )
    else:
        for package in ("osc", "ws"):
            if not (node_modules / package).exists():
                missing.append(
                    f"Node dependency: {node_modules / package}\n"
                    "  fix: corepack pnpm install"
                )

    if missing:
        pytest.fail(
            "実ブリッジ結合テストの前提が不足しています:\n"
            + "\n".join(missing)
            + "\n先に上記の fix コマンドを実行してください。"
        )


async def _ready(process: asyncio.subprocess.Process, prefix: str) -> dict[str, Any]:
    assert process.stdout is not None
    while True:
        line = await asyncio.wait_for(process.stdout.readline(), timeout=10)
        if not line:
            stderr = ""
            if process.stderr is not None:
                stderr = (await process.stderr.read()).decode(errors="replace")
            raise AssertionError(f"{prefix} が ready にならず終了しました: {stderr}")
        text = line.decode("utf-8", errors="replace").strip()
        if text.startswith(prefix + " "):
            return json.loads(text[len(prefix) + 1 :])


async def _stop(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


@pytest_asyncio.fixture
async def bridge_process() -> tuple[BridgeLink, asyncio.Task[None], asyncio.subprocess.Process, asyncio.subprocess.Process]:
    _check_prerequisites()
    unity_port = _unused_port()
    osc_port = _unused_port()
    ws_port = _unused_port()

    mock = await asyncio.create_subprocess_exec(
        "node",
        str(MOCK_UNITY_BUNDLE),
        "--listen-port",
        str(unity_port),
        "--reply-host",
        "127.0.0.1",
        "--reply-port",
        str(osc_port),
        "--scenario",
        str(SCENARIO),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    bridge: asyncio.subprocess.Process | None = None
    link_task: asyncio.Task[None] | None = None
    try:
        await _ready(mock, "MOCK_UNITY_READY")
        bridge = await asyncio.create_subprocess_exec(
            "node",
            str(BRIDGE_BUNDLE),
            "--config",
            str(ROOT / "config" / "oscdesk.config.json"),
            "--ws-port",
            str(ws_port),
            "--osc-listen-port",
            str(osc_port),
            "--unity-port",
            str(unity_port),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        ready = await _ready(bridge, "OSCDESK_BRIDGE_READY")
        received: list[Any] = []
        connected = asyncio.Event()

        def on_frame(frame: Any) -> None:
            received.append(frame)

        def on_status(status: Any) -> None:
            if status.connected:
                connected.set()

        link = BridgeLink(
            LinkOptions(
                url=f"ws://127.0.0.1:{ready['wsPort']}/integration-test/",
                initial_reconnect_delay_s=0.05,
                max_reconnect_delay_s=0.2,
            ),
            on_frame,
            on_status,
        )
        link_task = asyncio.create_task(link.run())
        await asyncio.wait_for(connected.wait(), timeout=10)
        link._integration_received = received  # type: ignore[attr-defined]
        yield link, link_task, bridge, mock
    finally:
        if link_task is not None:
            link_task.cancel()
            await asyncio.gather(link_task, return_exceptions=True)
        if bridge is not None:
            await _stop(bridge)
        await _stop(mock)


@pytest.mark.asyncio
async def test_bridge_link_round_trip_and_initial_frames(bridge_process: Any) -> None:
    link, _link_task, _bridge, _mock = bridge_process
    received = link._integration_received  # type: ignore[attr-defined]

    async def wait_for_frames() -> None:
        for _ in range(100):
            kinds = {frame.type for frame in received}
            if {"hello", "link", "manifest"}.issubset(kinds):
                return
            await asyncio.sleep(0.05)
        raise AssertionError(f"初期フレームが揃いません: {[frame.type for frame in received]}")

    await wait_for_frames()
    link.send_osc("/avatar/blend/smile", [{"type": "f", "value": 0.73}])

    for _ in range(100):
        echoes = [frame for frame in received if isinstance(frame, OscFrame) and frame.address == "/avatar/blend/smile"]
        if echoes:
            echo = echoes[-1]
            assert len(echo.args) == 1
            assert echo.args[0].type == "f"
            assert echo.args[0].value == pytest.approx(0.73)
            assert any(isinstance(frame, ManifestFrame) for frame in received)
            return
        await asyncio.sleep(0.05)
    raise AssertionError("mock-unity から値のエコーバックを受信できませんでした")
