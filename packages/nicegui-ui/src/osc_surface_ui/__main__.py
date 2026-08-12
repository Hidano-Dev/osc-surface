"""NiceGUI 版サーフェスの起動口。

O-S-C サーバー(headless)は別プロセスで先に立ち上げておくこと。

    node vendor/open-stage-control/app -n --no-qrcode -p 7080 -o 7091 \
        -c packages/custom-module/dist/osc-surface.js
    python -m osc_surface_ui --osc-port 7080 --ui-port 8080
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from nicegui import app, ui

from .config import (
    DEFAULT_CLIENT_ID,
    DEFAULT_OSC_HOST,
    DEFAULT_OSC_PORT,
    DEFAULT_UI_PORT,
    AppConfig,
    ConfigError,
    load_unity_target,
    resolve_surface_config_path,
)
from .page import SurfacePage
from .state import SurfaceState

logger = logging.getLogger(__name__)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="osc-surface-ui",
        description="OSC Surface の NiceGUI 版コントロールサーフェス",
    )
    parser.add_argument("--config", type=Path, default=None, help="surface.config.json のパス")
    parser.add_argument("--osc-host", default=DEFAULT_OSC_HOST, help="O-S-C サーバーのホスト")
    parser.add_argument("--osc-port", type=int, default=DEFAULT_OSC_PORT, help="O-S-C の HTTP/WS ポート")
    parser.add_argument("--ui-host", default="0.0.0.0", help="NiceGUI の待ち受けホスト")
    parser.add_argument("--ui-port", type=int, default=DEFAULT_UI_PORT, help="NiceGUI のポート")
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="WebSocket の clientId")
    parser.add_argument(
        "--auth",
        default="",
        help="O-S-C を --authentication 付きで起動した場合の user:password",
    )
    parser.add_argument("--show-ui", action="store_true", help="起動時にブラウザを開く")
    parser.add_argument("--verbose", action="store_true", help="デバッグログを出す")

    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> AppConfig:
    config_path = args.config or resolve_surface_config_path()
    unity, expected_project_id = load_unity_target(Path(config_path))

    return AppConfig(
        unity=unity,
        osc_host=args.osc_host,
        osc_port=args.osc_port,
        ui_host=args.ui_host,
        ui_port=args.ui_port,
        client_id=args.client_id,
        auth=args.auth,
        expected_project_id=expected_project_id,
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

    try:
        config = build_config(args)
    except ConfigError as error:
        raise SystemExit(f"[ERROR] {error}") from error

    create_app(config)

    logger.info("O-S-C: %s / Unity 宛先: %s", config.websocket_url, config.unity.target)

    ui.run(
        host=config.ui_host,
        port=config.ui_port,
        title="OSC Surface",
        show=args.show_ui,
        reload=False,
        favicon="🎛️",
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
