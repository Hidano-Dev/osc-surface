"""NiceGUI 版サーフェスの起動口。

ブリッジは別プロセスで先に立ち上げておくこと(通常は start-oscdesk.bat が両方を面倒見る)。

    node packages/bridge/dist/oscdesk-bridge.js
    python -m oscdesk_ui --osc-port 7080 --ui-port 8080
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from nicegui import app, ui

from .config import (
    DEFAULT_CLIENT_ID,
    DEFAULT_OSC_HOST,
    DEFAULT_OSC_PORT,
    DEFAULT_UI_PORT,
    AppConfig,
)
from .page import SurfacePage
from .state import SurfaceState

logger = logging.getLogger(__name__)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="oscdesk-ui",
        description="OSCDesk の NiceGUI 版コントロールサーフェス",
    )
    parser.add_argument("--osc-host", default=DEFAULT_OSC_HOST, help="ブリッジのホスト")
    parser.add_argument("--osc-port", type=int, default=DEFAULT_OSC_PORT, help="ブリッジの WebSocket ポート")
    parser.add_argument("--ui-host", default="0.0.0.0", help="NiceGUI の待ち受けホスト")
    parser.add_argument("--ui-port", type=int, default=DEFAULT_UI_PORT, help="NiceGUI のポート")
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="WebSocket の clientId")
    parser.add_argument("--show-ui", action="store_true", help="起動時にブラウザを開く")
    parser.add_argument("--verbose", action="store_true", help="デバッグログを出す")

    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> AppConfig:
    return AppConfig(
        osc_host=args.osc_host,
        osc_port=args.osc_port,
        ui_host=args.ui_host,
        ui_port=args.ui_port,
        client_id=args.client_id,
    )


def create_app(config: AppConfig) -> SurfaceState:
    """状態を作り、NiceGUI のページとライフサイクルに配線する。"""
    state = SurfaceState(config)
    link_task: dict[str, asyncio.Task[None]] = {}

    @ui.page("/")
    def index() -> None:
        SurfacePage(state).build()

    async def start() -> None:
        link_task["task"] = asyncio.create_task(state.link.run())

    async def shutdown() -> None:
        state.link.stop()
        task = link_task.pop("task", None)

        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    app.on_startup(start)
    app.on_shutdown(shutdown)

    return state


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    config = build_config(args)

    create_app(config)

    logger.info("Bridge: %s", config.websocket_url)

    ui.run(
        host=config.ui_host,
        port=config.ui_port,
        title="OSCDesk",
        show=args.show_ui,
        reload=False,
        favicon="🎛️",
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
