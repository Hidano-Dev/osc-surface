from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from oscdesk_ui.protocol import (
    FrameDecodeError,
    WireArg,
    decode_frame,
    encode_heartbeat_ack,
    encode_manifest_request,
    encode_osc_frame,
)


SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "wire-samples.json"


def _samples() -> list[dict[str, Any]]:
    data = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))
    return data["cases"]


def _encode_upstream(frame: dict[str, Any]) -> str:
    if frame["type"] == "osc":
        args = [WireArg(arg["type"], arg["value"]) for arg in frame["args"]]
        return encode_osc_frame(frame["address"], args)
    if frame["type"] == "manifestRequest":
        return encode_manifest_request()
    if frame["type"] == "heartbeatAck":
        return encode_heartbeat_ack(frame["t"])
    raise AssertionError(f"unhandled upstream sample type: {frame['type']}")


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_wire_sample(case: dict[str, Any]) -> None:
    frame = case["frame"]

    # These assertions are intentionally asymmetric with the TypeScript-side checks from task 1.6.
    if case["direction"] == "downstream":
        if not case["valid"]:
            with pytest.raises(FrameDecodeError):
                decode_frame(json.dumps(frame))
            return

        decoded = decode_frame(json.dumps(frame))
        assert decoded.type == frame["type"]
        if frame["type"] == "osc":
            assert len(decoded.args) == len(frame["args"])
            assert [(arg.type, arg.value) for arg in decoded.args] == [
                (arg["type"], arg["value"]) for arg in frame["args"]
            ]
        return

    if not case["valid"]:
        pytest.skip("Python does not produce invalid upstream sample shapes")

    encoded = _encode_upstream(frame)
    assert json.loads(encoded) == frame
