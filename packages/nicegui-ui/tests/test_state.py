from __future__ import annotations

from typing import Any

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.protocol import ManifestFrame, OscFrame, Peer, WireArg
from oscdesk_ui.state import SurfaceState

MANIFEST = {
    "version": 1,
    "projectId": "oscdesk-demo",
    "entries": [
        {
            "address": "/avatar/blend/smile",
            "label": "Smile",
            "type": "f",
            "widget": "fader",
            "range": [0, 1],
            "default": 0.35,
            "group": "Face",
        },
        {
            "address": "/avatar/toggle/visible",
            "label": "Visible",
            "type": "bool",
            "widget": "toggle",
            "default": True,
        },
        {
            "address": "/avatar/text/name",
            "label": "Name",
            "type": "s",
            "widget": "text",
        },
    ],
}


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.manifest_requests = 0

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_manifest(self) -> None:
        self.manifest_requests += 1


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def build_state() -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    config = AppConfig(
        unity=UnityTarget(host="127.0.0.1", send_port=7090, receive_port=7091),
    )
    state = SurfaceState(config, clock=clock, min_send_interval_s=0.1, link_factory=FakeLink)

    return state, state.link, clock  # type: ignore[return-value]


def deliver_manifest(state: SurfaceState, manifest: dict | str = MANIFEST) -> None:
    payload = manifest if isinstance(manifest, dict) else {"invalid": manifest}
    state._on_frame(ManifestFrame(type="manifest", manifest=payload))


def deliver_echo(state: SurfaceState, address: str, *args: Any) -> None:
    state._on_frame(
        OscFrame(
            type="osc",
            address=address,
            args=tuple(WireArg(type=type_tag, value=value) for type_tag, value in args),
            source=Peer(host="127.0.0.1", port=7091),
        )
    )


def test_adopts_a_manifest_and_seeds_defaults() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state)

    assert state.manifest is not None
    assert state.manifest_revision == 1
    assert state.manifest_status.detail == "採用済み"
    assert state.manifest_status.entry_count == 3
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)


def test_ignores_a_repeated_identical_manifest() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state)
    deliver_manifest(state)

    assert state.manifest_revision == 1


def test_reports_a_broken_manifest_without_crashing() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state, "{not json")

    assert state.manifest is None
    assert state.manifest_status.detail == "不正"


def test_sends_operated_values_to_the_configured_unity_target() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.set_local(entry, (0.5,))

    assert link.sent == [("/avatar/blend/smile", [{"type": "f", "value": 0.5}])]


def test_sends_bool_entries_as_int_zero_or_one() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/toggle/visible")
    assert entry is not None

    state.set_discrete(entry, (0,))

    assert link.sent == [("/avatar/toggle/visible", [{"type": "i", "value": 0}])]


def test_never_sends_for_display_only_entries() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/text/name")
    assert entry is not None

    state.set_local(entry, ("hello",))

    assert link.sent == []


def test_thins_out_a_drag_and_sends_the_final_value_on_tick() -> None:
    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.2,))
    clock.now = 0.02
    state.set_local(entry, (0.3,))

    assert [values for _address, values in link.sent] == [[{"type": "f", "value": 0.1}]]

    clock.now = 0.2
    state.tick()

    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.3}],
    ]


def test_release_sends_the_final_value_immediately() -> None:
    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.9,))
    state.end_hold(entry)

    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.9}],
    ]


def test_echo_back_is_the_source_of_truth_once_the_operation_ends() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.9,))
    deliver_echo(state, entry.address, ("f", 0.1))

    assert state.values.values_of(entry.address) == (0.9,)

    state.end_hold(entry)
    deliver_echo(state, entry.address, ("f", 0.1))

    assert state.values.values_of(entry.address) == (0.1,)


def test_non_unity_sources_never_confirm_values() -> None:
    """oscUi 有効時は OSC ネイティブ UI の操作値も from つきで届く。
    Unity 以外の送信元は表示キャッシュを確定させない(値の確定は Unity のエコーのみ)。"""
    state, _link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None
    before = state.values.values_of(entry.address)

    state._on_frame(
        OscFrame(
            type="osc",
            address=entry.address,
            args=(WireArg(type="f", value=0.1),),
            source=Peer(host="192.168.0.50", port=9100),
        )
    )

    assert state.values.values_of(entry.address) == before


def test_internal_namespaces_never_reach_the_value_store() -> None:
    state, _link, _clock = build_state()

    deliver_echo(state, "/sys/pong", ("i", 1))

    assert state.values.values_of("/sys/pong") is None
    assert state.values.values_of("/oscdesk/diag") is None


def test_disconnect_drops_pending_sends() -> None:
    from oscdesk_ui.surface_link import LinkStatus

    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.3,))
    state._on_link_status(LinkStatus(connected=False, detail="切断"))

    clock.now = 1.0
    state.tick()

    assert [values for _address, values in link.sent] == [[{"type": "f", "value": 0.1}]]
