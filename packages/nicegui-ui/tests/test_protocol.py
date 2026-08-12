from __future__ import annotations

import json

import pytest

from osc_surface_ui.protocol import (
    FrameDecodeError,
    WireArg,
    decode_frame,
    encode_heartbeat_ack,
    encode_manifest_request,
    encode_osc_frame,
)


def test_upstream_frames_use_the_bridge_wire_format() -> None:
    assert json.loads(encode_manifest_request()) == {"v": 1, "type": "manifestRequest"}
    assert json.loads(encode_heartbeat_ack(4)) == {"v": 1, "type": "heartbeatAck", "t": 4}
    assert json.loads(encode_osc_frame("/a", [WireArg("f", 0.5)])) == {
        "v": 1,
        "type": "osc",
        "address": "/a",
        "args": [{"type": "f", "value": 0.5}],
    }


def test_downstream_osc_preserves_tagged_arguments() -> None:
    frame = decode_frame(json.dumps({
        "v": 1,
        "type": "osc",
        "address": "/a",
        "args": [{"type": "i", "value": 1}],
        "from": {"host": "127.0.0.1", "port": 7000},
    }))
    assert frame.type == "osc"
    assert [(arg.type, arg.value) for arg in frame.args] == [("i", 1)]


@pytest.mark.parametrize("frame", [
    ["receiveOsc", {"address": "/a"}],
    {"v": 2, "type": "heartbeat", "t": 1},
    {"v": 1, "type": "heartbeat", "unknown": True, "t": 1},
    {"v": 1, "type": "heartbeat", "t": "1"},
])
def test_legacy_or_invalid_downstream_frames_are_rejected(frame) -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps(frame))


def test_heartbeat_is_decoded() -> None:
    frame = decode_frame('{"v":1,"type":"heartbeat","t":9}')
    assert frame.type == "heartbeat"
    assert frame.t == 9
