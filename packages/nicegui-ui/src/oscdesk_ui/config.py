"""Runtime configuration supplied by CLI arguments and environment."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Final

DEFAULT_OSC_HOST: Final = "127.0.0.1"
DEFAULT_OSC_PORT: Final = 7080
DEFAULT_UI_PORT: Final = 8080
DEFAULT_CLIENT_ID: Final = "nicegui-ui"

@dataclass(frozen=True)
class UnityTarget:
    host: str
    send_port: int
    receive_port: int
    @property
    def target(self) -> str:
        return f"{self.host}:{self.send_port}"

@dataclass(frozen=True)
class AppConfig:
    osc_host: str = DEFAULT_OSC_HOST
    osc_port: int = DEFAULT_OSC_PORT
    ui_host: str = "0.0.0.0"
    ui_port: int = DEFAULT_UI_PORT
    client_id: str = DEFAULT_CLIENT_ID
    unity: UnityTarget | None = None
    @property
    def websocket_url(self) -> str:
        # ブリッジは URL パスを見ない(認証つきパス方式は廃止)。clientId は接続元を
        # ログで識別するための目印としてのみ残す。
        return f"ws://{self.osc_host}:{self.osc_port}/{self.client_id}"
