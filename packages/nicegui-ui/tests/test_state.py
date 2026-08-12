from __future__ import annotations

import json
from typing import Any

from osc_surface_ui.config import AppConfig, UnityTarget
from osc_surface_ui.protocol import ReceivedOsc
from osc_surface_ui.state import MANIFEST_ADDRESS, SurfaceState

MANIFEST = {
    "version": 1,
    "projectId": "osc-surface-demo",
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
        self.sent: list[tuple[str, list[Any], str, list[str]]] = []
        self.manifest_requests = 0

    def send_osc(self, address: str, args: list[Any], type_tags: str, target: list[str]) -> None:
        self.sent.append((address, args, type_tags, list(target)))

    def request_manifest(self) -> None:
        self.manifest_requests += 1


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def build_state(expected_project_id: str | None = None) -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    config = AppConfig(
        unity=UnityTarget(host="127.0.0.1", send_port=7090, receive_port=7091),
        expected_project_id=expected_project_id,
    )
    state = SurfaceState(config, clock=clock, min_send_interval_s=0.1, link_factory=FakeLink)

    return state, state.link, clock  # type: ignore[return-value]


def deliver_manifest(state: SurfaceState, manifest: dict | str = MANIFEST) -> None:
    payload = manifest if isinstance(manifest, str) else json.dumps(manifest)
    state._on_osc(ReceivedOsc(address=MANIFEST_ADDRESS, args=(payload,)))


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


def test_rejects_a_manifest_from_another_project() -> None:
    state, _link, _clock = build_state(expected_project_id="osc-surface-demo")

    deliver_manifest(state, {**MANIFEST, "projectId": "other-project"})

    assert state.manifest is None
    assert state.manifest_status.detail == "誤接続の疑い"
    assert "other-project" in (state.manifest_status.error or "")


def test_reports_a_broken_manifest_without_crashing() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state, "{not json")

    assert state.manifest is None
    assert state.manifest_status.detail == "不正"


def test_keeps_asking_for_the_manifest_only_until_it_has_one() -> None:
    state, _link, _clock = build_state()

    assert state._wants_manifest() is True

    deliver_manifest(state)

    assert state._wants_manifest() is False


def test_sends_operated_values_to_the_configured_unity_target() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.set_local(entry, (0.5,))

    assert link.sent == [("/avatar/blend/smile", [0.5], "f", ["127.0.0.1:7090"])]


def test_sends_bool_entries_as_int_zero_or_one() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/toggle/visible")
    assert entry is not None

    state.set_discrete(entry, (0,))

    assert link.sent == [("/avatar/toggle/visible", [0], "i", ["127.0.0.1:7090"])]


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

    assert [values for _address, values, _tags, _target in link.sent] == [[0.1]]

    clock.now = 0.2
    state.tick()

    assert [values for _address, values, _tags, _target in link.sent] == [[0.1], [0.3]]


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

    assert [values for _address, values, _tags, _target in link.sent] == [[0.1], [0.9]]


def test_echo_back_is_the_source_of_truth_once_the_operation_ends() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.9,))
    state._on_osc(ReceivedOsc(address=entry.address, args=(0.1,)))

    assert state.values.values_of(entry.address) == (0.9,)

    state.end_hold(entry)
    state._on_osc(ReceivedOsc(address=entry.address, args=(0.1,)))

    assert state.values.values_of(entry.address) == (0.1,)


def test_internal_namespaces_never_reach_the_value_store() -> None:
    state, _link, _clock = build_state()

    state._on_osc(ReceivedOsc(address="/sys/pong", args=(1,)))
    state._on_osc(ReceivedOsc(address="/surface/diag", args=("{}",)))

    assert state.values.values_of("/sys/pong") is None
    assert state.values.values_of("/surface/diag") is None


def test_disconnect_drops_pending_sends() -> None:
    from osc_surface_ui.surface_link import LinkStatus

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

    assert [values for _address, values, _tags, _target in link.sent] == [[0.1]]
