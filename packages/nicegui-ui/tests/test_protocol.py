from __future__ import annotations

import json

import pytest

from osc_surface_ui.protocol import (
    ProtocolError,
    decode_frame,
    encode_frame,
    open_frame,
    parse_received_osc,
    pong_frame,
    send_osc_frame,
)


def test_open_and_pong_frames_match_the_wire_format() -> None:
    assert json.loads(open_frame()) == ["open", {}]
    assert json.loads(pong_frame()) == ["pong"]


def test_decodes_a_data_less_ping_frame() -> None:
    frame = decode_frame('["ping"]')

    assert frame.event == "ping"
    assert frame.data is None


def test_decodes_bytes_frames() -> None:
    frame = decode_frame(b'["receiveOsc",{"address":"/a"}]')

    assert frame.event == "receiveOsc"
    assert frame.data == {"address": "/a"}


@pytest.mark.parametrize("raw", ["not json", "{}", "[]", "[1]"])
def test_rejects_malformed_frames(raw: str) -> None:
    with pytest.raises(ProtocolError):
        decode_frame(raw)


def test_send_osc_puts_every_argument_but_the_last_into_pre_args() -> None:
    payload = json.loads(send_osc_frame("/xy", [0.25, 0.75], "ff", ["127.0.0.1:7090"]))

    assert payload[0] == "sendOsc"
    assert payload[1] == {
        "address": "/xy",
        "v": 0.75,
        "preArgs": [0.25],
        "typeTags": "ff",
        "target": ["127.0.0.1:7090"],
    }


def test_single_argument_send_leaves_pre_args_empty() -> None:
    payload = json.loads(send_osc_frame("/a", [1], "i", ["127.0.0.1:7090"]))

    assert payload[1]["v"] == 1
    assert payload[1]["preArgs"] == []


def test_send_osc_requires_a_target_and_matching_type_tags() -> None:
    with pytest.raises(ProtocolError):
        send_osc_frame("/a", [1], "i", [])

    with pytest.raises(ProtocolError):
        send_osc_frame("/a", [1, 2], "i", ["127.0.0.1:7090"])

    with pytest.raises(ProtocolError):
        send_osc_frame("/a", [], "", ["127.0.0.1:7090"])


def test_received_osc_normalizes_the_unwrapped_single_argument() -> None:
    message = parse_received_osc({"address": "/a", "args": 0.5, "host": "127.0.0.1", "port": 7091})

    assert message.args == (0.5,)
    assert message.first == 0.5
    assert message.host == "127.0.0.1"
    assert message.port == 7091


def test_received_osc_keeps_multiple_arguments_and_tolerates_typed_args() -> None:
    assert parse_received_osc({"address": "/a", "args": [1, "b"]}).args == (1, "b")
    assert parse_received_osc(
        {"address": "/a", "args": [{"type": "f", "value": 0.5}]}
    ).args == (0.5,)


def test_received_osc_without_arguments_is_an_empty_tuple() -> None:
    message = parse_received_osc({"address": "/a"})

    assert message.args == ()
    assert message.first is None


@pytest.mark.parametrize("data", [None, "string", {"args": [1]}])
def test_rejects_malformed_receive_osc(data: object) -> None:
    with pytest.raises(ProtocolError):
        parse_received_osc(data)


def test_encode_frame_keeps_non_ascii_readable() -> None:
    assert "初音" in encode_frame("receiveOsc", {"address": "/a", "args": "初音ミク"})
