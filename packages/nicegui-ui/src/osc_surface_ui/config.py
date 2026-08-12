"""実行時設定の読み込み。

Unity の宛先は custom module と同じ config/surface.config.json を共有する
(案件差分はコードでなくデータ、の規律)。O-S-C サーバーと NiceGUI 自身の
ポートは接続先の話なので CLI / 環境変数で与える。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

SURFACE_CONFIG_ENV_VAR: Final = "OSC_SURFACE_CONFIG"

DEFAULT_OSC_HOST: Final = "127.0.0.1"
DEFAULT_OSC_PORT: Final = 7080
DEFAULT_UI_PORT: Final = 8080
DEFAULT_CLIENT_ID: Final = "nicegui-ui"


class ConfigError(ValueError):
    """設定ファイルが読めない・契約を満たさないときに送出する。"""


@dataclass(frozen=True)
class UnityTarget:
    host: str
    send_port: int
    receive_port: int

    @property
    def target(self) -> str:
        """sendOsc の target 表記。"""
        return f"{self.host}:{self.send_port}"


@dataclass(frozen=True)
class AppConfig:
    unity: UnityTarget
    osc_host: str = DEFAULT_OSC_HOST
    osc_port: int = DEFAULT_OSC_PORT
    ui_host: str = "0.0.0.0"
    ui_port: int = DEFAULT_UI_PORT
    client_id: str = DEFAULT_CLIENT_ID
    auth: str = ""
    expected_project_id: str | None = None
    show_debug_panel: bool = False

    @property
    def websocket_url(self) -> str:
        """ws://<host>:<port>/<clientId>/<auth> (auth 未使用なら末尾スラッシュ)。"""
        return f"ws://{self.osc_host}:{self.osc_port}/{self.client_id}/{self.auth}"


def repo_root() -> Path:
    # packages/nicegui-ui/src/osc_surface_ui/config.py -> リポジトリ root
    return Path(__file__).resolve().parents[4]


def resolve_surface_config_path(env: dict[str, str] | None = None) -> Path:
    environ = os.environ if env is None else env
    configured = environ.get(SURFACE_CONFIG_ENV_VAR, "").strip()

    if configured:
        return Path(configured)

    return repo_root() / "config" / "surface.config.json"


def load_unity_target(path: Path) -> tuple[UnityTarget, str | None]:
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ConfigError(f'設定ファイルを読めません "{path}": {error}') from error
    except ValueError as error:
        raise ConfigError(f'設定ファイルが JSON として不正です "{path}": {error}') from error

    return parse_unity_target(raw, path)


def parse_unity_target(raw: Any, path: Path | str = "<memory>") -> tuple[UnityTarget, str | None]:
    if not isinstance(raw, dict):
        raise ConfigError(f'設定はオブジェクトである必要があります "{path}"。')

    unity = raw.get("unity")
    if not isinstance(unity, dict):
        raise ConfigError(f'"{path}": unity ブロックがありません。')

    host = unity.get("host")
    if not isinstance(host, str) or host == "":
        raise ConfigError(f'"{path}": unity.host は空でない文字列である必要があります。')

    send_port = _parse_port(unity.get("sendPort"), "unity.sendPort", path)
    receive_port = _parse_port(unity.get("receivePort"), "unity.receivePort", path)

    expected_project_id = raw.get("expectedProjectId")
    if expected_project_id is not None and (
        not isinstance(expected_project_id, str) or expected_project_id == ""
    ):
        raise ConfigError(f'"{path}": expectedProjectId は空でない文字列である必要があります。')

    return (
        UnityTarget(host=host, send_port=send_port, receive_port=receive_port),
        expected_project_id,
    )


def _parse_port(value: Any, name: str, path: Path | str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 65535:
        raise ConfigError(f'"{path}": {name} は 1〜65535 の整数である必要があります。')

    return value
