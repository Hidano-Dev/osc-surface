"""全モジュールが import できることだけを見る保険。

タスク 7.6 の一括置換で `page.py` のインデントが壊れ、UI が起動不能なまま
段 8 と実装検証を通過した。当時 `page.py` を import するテストが 1 つも無く、
pytest も vitest も緑のままだったのが原因。構文・import レベルの破損は
ここで必ず落ちるようにしておく。
"""
from __future__ import annotations

import importlib

import pytest

MODULES = [
    "oscdesk_ui",
    "oscdesk_ui.__main__",
    "oscdesk_ui.config",
    "oscdesk_ui.manifest",
    "oscdesk_ui.page",
    "oscdesk_ui.protocol",
    "oscdesk_ui.state",
    "oscdesk_ui.surface_link",
    "oscdesk_ui.value_store",
    "oscdesk_ui.widgets",
]


@pytest.mark.parametrize("module_name", MODULES)
def test_module_imports(module_name: str) -> None:
    assert importlib.import_module(module_name) is not None


def test_cli_parses_without_legacy_auth_option() -> None:
    """O-S-C の認証つきパス方式は廃止済み。--auth を復活させないための表明。"""
    from oscdesk_ui.__main__ import build_config, parse_args

    args = parse_args(["--osc-host", "192.168.1.10", "--osc-port", "7080"])
    assert not hasattr(args, "auth")

    config = build_config(args)
    assert config.websocket_url == "ws://192.168.1.10:7080/nicegui-ui"
