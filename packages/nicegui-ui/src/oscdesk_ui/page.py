"""NiceGUI のページ組み立て。

ページは複数同時に開かれうる。状態(接続・マニフェスト・値)はプロセスに 1 つで、
各ページはタイマーで revision を見て差分だけを取り込む。バックグラウンドタスクから
他クライアントの要素を直接触らずに済み、高頻度のエコーバックも自然に間引ける。
"""

from __future__ import annotations

import time
from typing import Any, Callable

from nicegui import ui

from .manifest import ManifestEntry
from .state import SurfaceState
from .widgets import HOLD_TIMEOUT_S, WidgetBinding, WidgetFactory

SYNC_INTERVAL_S = 0.05


class SurfacePage:
    def __init__(self, state: SurfaceState, clock: Callable[[], float] = time.monotonic) -> None:
        self._state = state
        self._clock = clock
        self._bindings: list[WidgetBinding] = []
        self._manifest_revision = -1
        self._hold_started_at: dict[str, float] = {}

        self._factory = WidgetFactory(
            on_local=self._on_local,
            on_discrete=self._on_discrete,
            on_hold_begin=self._on_hold_begin,
            on_hold_end=self._on_hold_end,
        )

    def build(self) -> None:
        ui.page_title("OSCDesk")

        with ui.header().classes("items-center justify-between q-px-md q-py-sm"):
            ui.label("OSCDesk").classes("text-h6")
            with ui.row().classes("items-center q-gutter-x-md"):
                self._link_badge = ui.badge("ブリッジ: -").props("color=grey-7")
                self._unity_badge = ui.badge("Unity: -").props("color=grey-7")
                self._manifest_badge = ui.badge("マニフェスト: -").props("color=grey-7")

        with ui.column().classes("w-full q-pa-md items-stretch").style("max-width:900px;margin:0 auto"):
            with ui.card().classes("w-full q-pa-sm"):
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    self._manifest_label = ui.label("-").classes("text-caption")
                    ui.button("再取得", on_click=self._state.link.request_manifest).props(
                        "flat dense no-caps"
                    ).classes("whitespace-nowrap")

                self._link_label = ui.label("-").classes("text-caption text-grey-7 break-all")
                self._target_label = ui.label("-").classes("text-caption text-grey-7")
                self._error_label = ui.label("").classes("text-caption text-negative")

            self._container = ui.column().classes("w-full items-stretch")

        ui.timer(SYNC_INTERVAL_S, self.sync)

    # --- 定期同期 ---------------------------------------------------------

    def sync(self) -> None:
        self._state.tick()
        self._release_stale_holds()
        self._sync_status()

        if self._manifest_revision != self._state.manifest_revision:
            self._rebuild()

        for binding in self._bindings:
            channel = self._state.values.get(binding.entry.address)

            if channel is None or channel.revision == binding.revision:
                continue

            binding.revision = channel.revision
            binding.apply(channel.values)

    def _sync_status(self) -> None:
        link = self._state.link_status
        manifest = self._state.manifest_status
        config = self._state.config

        bridge_detail = f"ブリッジ: {link.detail}"
        if self._link_badge.text != bridge_detail:
            self._link_badge.text = bridge_detail
            self._link_badge.props(f"color={'positive' if link.connected else 'warning'}")

        reachability = self._state.unity_link_status
        rtt = "-" if reachability.last_rtt_ms is None else f"{reachability.last_rtt_ms:g} ms"
        if reachability.reachability == "lost":
            unity_detail = f"Unity 未接続 (RTT {rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "negative"
        elif reachability.reachability == "reachable":
            unity_detail = f"Unity 接続中 ({rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "positive"
        else:
            unity_detail = "Unity 未確認"
            unity_color = "grey-7"
        self._unity_badge.text = unity_detail
        self._unity_badge.props(f"color={unity_color}")

        self._link_label.text = f"ブリッジ: {config.websocket_url}"

        manifest_detail = f"マニフェスト: {manifest.detail}"
        if manifest.project_id is not None:
            manifest_detail += f" — {manifest.project_id} ({manifest.entry_count} 件)"
        self._manifest_label.text = manifest_detail
        if manifest.last_rejection:
            manifest_detail += f" / 直近拒否: {manifest.last_rejection}"
        self._manifest_badge.text = manifest_detail
        self._manifest_badge.props(f"color={'negative' if manifest.last_rejection else 'positive'}")

        # hello フレーム受信前は unity が None(ブリッジ未接続・再接続中の新規ページ)
        unity_target = "未取得 (hello 待ち)" if config.unity is None else config.unity.target
        self._target_label.text = f"Unity 宛先: {unity_target}"
        self._error_label.text = manifest.error or link.last_error or ""

    def _release_stale_holds(self) -> None:
        """pointerup を取りこぼしても、いつまでもエコーバックを無視し続けない保険。"""
        if not self._hold_started_at:
            return

        now = self._clock()

        for address, started_at in list(self._hold_started_at.items()):
            if now - started_at < HOLD_TIMEOUT_S:
                continue

            entry = self._state.entry_for(address)
            self._hold_started_at.pop(address, None)

            if entry is not None:
                self._state.end_hold(entry)

    def _rebuild(self) -> None:
        self._manifest_revision = self._state.manifest_revision
        self._bindings = []
        self._hold_started_at.clear()
        self._container.clear()
        manifest = self._state.manifest

        with self._container:
            if manifest is None:
                ui.label(
                    "マニフェスト待ち。ブリッジからの manifest フレームを待っています"
                    "(元は Unity の /sys/manifest)。"
                ).classes("text-grey-7")
                return

            if not manifest.entries:
                ui.label("マニフェストにエントリがありません。").classes("text-grey-7")
                return

            for group, entries in manifest.groups():
                if group is not None:
                    ui.label(group).classes("text-subtitle2 q-mt-md")

                for entry in entries:
                    self._bindings.append(self._factory.build(entry))

    # --- UI からの操作 ----------------------------------------------------

    def _on_local(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        self._state.set_local(entry, values)

    def _on_discrete(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        self._state.set_discrete(entry, values)

    def _on_hold_begin(self, entry: ManifestEntry) -> None:
        self._hold_started_at[entry.address] = self._clock()
        self._state.begin_hold(entry.address)

    def _on_hold_end(self, entry: ManifestEntry) -> None:
        self._hold_started_at.pop(entry.address, None)
        self._state.end_hold(entry)
