from __future__ import annotations

from osc_surface_ui.value_store import ValueChannel, ValueStore

INTERVAL = 0.1


def channel() -> ValueChannel:
    return ValueChannel(address="/a", min_send_interval_s=INTERVAL)


def test_first_local_change_is_sent_immediately() -> None:
    assert channel().on_local((0.5,), now=0.0) == (0.5,)


def test_changes_inside_the_interval_are_thinned_out() -> None:
    ch = channel()

    assert ch.on_local((0.1,), now=0.0) == (0.1,)
    assert ch.on_local((0.2,), now=0.01) is None
    assert ch.on_local((0.3,), now=0.02) is None
    # 表示は間引かれた最新値のまま先に進む。
    assert ch.values == (0.3,)


def test_the_last_thinned_value_is_flushed_once_the_interval_passes() -> None:
    ch = channel()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.3,), now=0.02)

    assert ch.flush_due(now=0.05) is None
    assert ch.flush_due(now=0.11) == (0.3,)
    assert ch.flush_due(now=0.5) is None


def test_release_flushes_the_final_value_without_waiting() -> None:
    ch = channel()
    ch.begin_hold()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.9,), now=0.01)

    assert ch.end_hold(now=0.02) == (0.9,)
    assert ch.holding is False


def test_echo_is_ignored_while_holding_and_wins_after_release() -> None:
    ch = channel()
    ch.begin_hold()
    ch.on_local((0.9,), now=0.0)

    assert ch.on_echo((0.1,)) is False
    assert ch.values == (0.9,)

    ch.end_hold(now=0.01)

    assert ch.on_echo((0.1,)) is True
    assert ch.values == (0.1,)


def test_echo_of_an_unchanged_value_does_not_bump_the_revision() -> None:
    ch = channel()
    ch.on_echo((1,))
    revision = ch.revision

    assert ch.on_echo((1,)) is False
    assert ch.revision == revision


def test_discrete_changes_are_never_thinned_out() -> None:
    ch = channel()

    assert ch.on_local_immediate((1,), now=0.0) == (1,)
    assert ch.on_local_immediate((0,), now=0.001) == (0,)
    assert ch.flush_due(now=10.0) is None


def test_reset_drops_pending_sends_so_stale_values_never_reach_unity() -> None:
    ch = channel()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.3,), now=0.01)
    ch.reset_send_state()

    assert ch.flush_due(now=10.0) is None


def test_store_flushes_every_channel_that_is_due() -> None:
    store = ValueStore(min_send_interval_s=INTERVAL)
    store.channel("/a").on_local((1,), now=0.0)
    store.channel("/a").on_local((2,), now=0.01)
    store.channel("/b").on_local((3,), now=0.0)

    assert store.flush_due(now=0.2) == [("/a", (2,))]


def test_defaults_seed_the_display_but_never_overwrite_a_known_value() -> None:
    store = ValueStore()
    store.on_echo("/known", (7,))

    class Entry:
        def __init__(self, address: str, default: object) -> None:
            self.address = address
            self.default = default
            self.has_default = True

    store.seed_defaults([Entry("/known", 1), Entry("/fresh", 2)])

    assert store.values_of("/known") == (7,)
    assert store.values_of("/fresh") == (2,)
