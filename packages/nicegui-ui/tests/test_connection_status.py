from __future__ import annotations

from oscdesk_ui.config import AppConfig
from oscdesk_ui.protocol import decode_frame
from oscdesk_ui.state import SurfaceState


def test_link_frame_updates_unity_status_and_latest_rejection() -> None:
    state = SurfaceState(AppConfig())

    state._on_frame(
        decode_frame(
            '{"v":1,"type":"link","unity":{"reachability":"reachable",'
            '"lastRttMs":12.5,"consecutiveLosses":0,"lastPongSeq":4},'
            '"manifest":{"state":"none"},"lastRejection":null}'
        )
    )
    assert state.unity_link_status.reachability == "reachable"
    assert state.unity_link_status.last_rtt_ms == 12.5

    state._on_frame(
        decode_frame(
            '{"v":1,"type":"link","unity":{"reachability":"lost",'
            '"lastRttMs":12.5,"consecutiveLosses":3,"lastPongSeq":4},'
            '"manifest":{"state":"none"},"lastRejection":{'
            '"ts":"2026-08-13T00:00:00+00:00","reason":"project-mismatch",'
            '"detail":"projectId mismatch","receivedProjectId":"other"}}'
        )
    )
    assert state.unity_link_status.reachability == "lost"
    assert state.unity_link_status.consecutive_losses == 3
    assert state.last_rejection is not None
    assert state.last_rejection["reason"] == "project-mismatch"
    assert state.manifest_status.last_rejection == "project-mismatch: projectId mismatch"
