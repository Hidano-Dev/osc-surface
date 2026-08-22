"""マニフェストのエントリから NiceGUI のウィジェットを組み立てる。

案件差分はコードでなくデータ(マニフェスト)で表現する規律に従い、
ここには「型 × ウィジェット種別 → 部品」の対応だけを置く。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from nicegui import ui

from .manifest import ManifestEntry

# 送信を伴うウィジェットに使える値型。文字列・blob は表示専用に落とす。
INTERACTIVE_VALUE_TYPES = ("i", "f", "bool")

XY_PAD_SIZE_PX = 240
XY_MARKER_SIZE_PX = 18

# ポインタ操作の解放イベントを取りこぼしても、いつまでもエコーバックを
# 無視し続けないための保険。
HOLD_TIMEOUT_S = 2.0


@dataclass
class WidgetBinding:
    """1 エントリ分の UI 部品と、表示更新のための状態。"""

    entry: ManifestEntry
    apply: Callable[[tuple[Any, ...] | None], None]
    revision: int = -1
    is_display_only: bool = True
    _applying: bool = field(default=False, repr=False)


class WidgetFactory:
    """UI 操作を SurfaceState へ橋渡ししながらウィジェットを作る。"""

    def __init__(
        self,
        on_local: Callable[[ManifestEntry, tuple[Any, ...]], None],
        on_discrete: Callable[[ManifestEntry, tuple[Any, ...]], None],
        on_hold_begin: Callable[[ManifestEntry], None],
        on_hold_end: Callable[[ManifestEntry], None],
    ) -> None:
        self._on_local = on_local
        self._on_discrete = on_discrete
        self._on_hold_begin = on_hold_begin
        self._on_hold_end = on_hold_end

    def build(self, entry: ManifestEntry) -> WidgetBinding:
        if is_display_only(entry):
            return self._build_display(entry)

        if entry.widget == "toggle":
            return self._build_toggle(entry)

        if entry.widget == "button":
            return self._build_button(entry)

        if entry.widget == "xy":
            return self._build_xy(entry)

        return self._build_fader(entry)

    # --- 表示専用 ---------------------------------------------------------

    def _build_display(self, entry: ManifestEntry) -> WidgetBinding:
        with ui.card().classes("w-full q-pa-sm"):
            ui.label(entry.label).classes("text-caption text-grey-7")
            value_label = ui.label("-").classes("text-body1 break-all")

        def apply(values: tuple[Any, ...] | None) -> None:
            value_label.text = format_values(values)

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=True)
        return binding

    # --- フェーダー -------------------------------------------------------

    def _build_fader(self, entry: ManifestEntry) -> WidgetBinding:
        low, high = entry.value_range or (0.0, 1.0)
        step = 1 if entry.type == "i" else _fader_step(low, high)
        binding_holder: dict[str, WidgetBinding] = {}

        with ui.card().classes("w-full q-pa-sm"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label(entry.label).classes("text-caption text-grey-7")
                value_label = ui.label("-").classes("text-caption text-grey-8")

            slider = ui.slider(min=low, max=high, step=step, value=low).classes("w-full")

        def on_change(event: Any) -> None:
            binding = binding_holder["binding"]
            if binding._applying:
                return

            value = int(event.value) if entry.type == "i" else float(event.value)
            self._on_local(entry, (value,))

        slider.on_value_change(on_change)
        self._attach_hold(slider, entry)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            value_label.text = format_values(values)
            number = _as_number(values)

            if number is None:
                return

            binding._applying = True
            try:
                slider.value = entry.clamp(number)
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- トグル -----------------------------------------------------------

    def _build_toggle(self, entry: ManifestEntry) -> WidgetBinding:
        binding_holder: dict[str, WidgetBinding] = {}

        with ui.card().classes("w-full q-pa-sm"):
            switch = ui.switch(entry.label, value=False)

        def on_change(event: Any) -> None:
            binding = binding_holder["binding"]
            if binding._applying:
                return

            self._on_discrete(entry, (1 if event.value else 0,))

        switch.on_value_change(on_change)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            state = _as_bool(values)

            if state is None:
                return

            binding._applying = True
            try:
                switch.value = state
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- ボタン(押している間 on) ----------------------------------------

    def _build_button(self, entry: ManifestEntry) -> WidgetBinding:
        on_value, off_value = _button_values(entry)
        pressed: dict[str, bool] = {"value": False}

        with ui.card().classes("w-full q-pa-sm"):
            button = ui.button(entry.label).classes("w-full").style("touch-action:none")
            state_label = ui.label("-").classes("text-caption text-grey-8")

        def press(_event: Any) -> None:
            pressed["value"] = True
            self._on_discrete(entry, (on_value,))

        def release(_event: Any) -> None:
            # 押していないのに離脱イベントで off を送らない。
            if not pressed["value"]:
                return

            pressed["value"] = False
            self._on_discrete(entry, (off_value,))

        button.on("pointerdown", press)

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            button.on(event_name, release)

        def apply(values: tuple[Any, ...] | None) -> None:
            state_label.text = format_values(values)

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        return binding

    # --- XY パッド --------------------------------------------------------

    def _build_xy(self, entry: ManifestEntry) -> WidgetBinding:
        low, high = entry.value_range or (0.0, 1.0)
        span = high - low or 1.0
        pressed: dict[str, bool] = {"value": False}

        with ui.card().classes("w-full q-pa-sm"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label(entry.label).classes("text-caption text-grey-7")
                value_label = ui.label("-").classes("text-caption text-grey-8")

            pad = (
                ui.element("div")
                .classes("relative bg-grey-3 rounded-borders")
                .style(
                    f"width:{XY_PAD_SIZE_PX}px;height:{XY_PAD_SIZE_PX}px;"
                    "touch-action:none;max-width:100%"
                )
            )

            with pad:
                marker = (
                    ui.element("div")
                    .classes("absolute bg-primary rounded-full")
                    .style(
                        f"width:{XY_MARKER_SIZE_PX}px;height:{XY_MARKER_SIZE_PX}px;"
                        f"margin-left:-{XY_MARKER_SIZE_PX // 2}px;margin-top:-{XY_MARKER_SIZE_PX // 2}px;"
                        "left:0;top:0;pointer-events:none"
                    )
                )

        def to_value(offset: float) -> float:
            ratio = min(max(offset / XY_PAD_SIZE_PX, 0.0), 1.0)
            return low + ratio * span

        def handle(event: Any, *, is_down: bool) -> None:
            args = event.args or {}
            offset_x = args.get("offsetX")
            offset_y = args.get("offsetY")

            if offset_x is None or offset_y is None:
                return

            if is_down:
                pressed["value"] = True
                self._on_hold_begin(entry)
            elif not pressed["value"]:
                return

            # 画面の上が Y の最大になるよう反転する(コントロールサーフェスの慣習)。
            x = to_value(float(offset_x))
            y = to_value(float(XY_PAD_SIZE_PX - float(offset_y)))

            # type "i" のエントリは整数へ丸めてから送る。小数のまま i タグを付けると
            # ブリッジの WireArgSchema(int32 のみ受理)で拒否され Unity へ届かない
            if entry.type == "i":
                self._on_local(entry, (round(x), round(y)))
            else:
                self._on_local(entry, (x, y))

        def release(_event: Any) -> None:
            if not pressed["value"]:
                return

            pressed["value"] = False
            self._on_hold_end(entry)

        pad.on("pointerdown", lambda event: handle(event, is_down=True), args=["offsetX", "offsetY"])
        pad.on(
            "pointermove",
            lambda event: handle(event, is_down=False),
            args=["offsetX", "offsetY"],
            throttle=0.03,
        )

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            pad.on(event_name, release)

        def apply(values: tuple[Any, ...] | None) -> None:
            value_label.text = format_values(values)

            if values is None or len(values) < 2:
                return

            x, y = _as_number((values[0],)), _as_number((values[1],))

            if x is None or y is None:
                return

            left = (min(max(x, low), high) - low) / span * XY_PAD_SIZE_PX
            top = XY_PAD_SIZE_PX - (min(max(y, low), high) - low) / span * XY_PAD_SIZE_PX
            marker.style(f"left:{left:.1f}px;top:{top:.1f}px")

        return WidgetBinding(entry=entry, apply=apply, is_display_only=False)

    # --- 共通 -------------------------------------------------------------

    def _attach_hold(self, element: Any, entry: ManifestEntry) -> None:
        element.on("pointerdown", lambda _: self._on_hold_begin(entry))

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            element.on(event_name, lambda _: self._on_hold_end(entry))


def is_display_only(entry: ManifestEntry) -> bool:
    """表示専用として扱うべきエントリか。

    text ウィジェットに加え、送信できない値型(文字列 / blob)を割り当てられた
    操作系ウィジェットも表示専用に落とす。誤った型の OSC を Unity に投げるより
    表示だけに留めるほうが安全。
    """
    if entry.is_display_only:
        return True

    return entry.type not in INTERACTIVE_VALUE_TYPES


def format_values(values: tuple[Any, ...] | None) -> str:
    if values is None:
        return "-"

    return ", ".join(_format_value(value) for value in values)


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"

    if isinstance(value, float):
        return f"{value:.3f}".rstrip("0").rstrip(".")

    if isinstance(value, (bytes, bytearray)):
        return f"blob:{len(value)}"

    return str(value)


def _fader_step(low: float, high: float) -> float:
    span = abs(high - low)

    if span == 0:
        return 0.01

    return span / 1000.0


def _as_number(values: tuple[Any, ...] | None) -> float | None:
    if not values:
        return None

    value = values[0]

    if isinstance(value, bool):
        return 1.0 if value else 0.0

    if isinstance(value, (int, float)):
        return float(value)

    return None


def _as_bool(values: tuple[Any, ...] | None) -> bool | None:
    number = _as_number(values)

    if number is None:
        return None

    return number != 0


def _button_values(entry: ManifestEntry) -> tuple[Any, Any]:
    """押下時 / 解放時に送る値。widget-catalog.ts の on: 1 / off: 0 に合わせる。"""
    if entry.type == "f":
        return (1.0, 0.0)

    return (1, 0)
