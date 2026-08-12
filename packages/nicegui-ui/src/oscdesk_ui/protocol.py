"""OscDesk WebSocket wire protocol (version 1).

The wire representation is deliberately strict.  A frame that is not one of
the documented downstream frames is rejected instead of being guessed at.
"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from typing import Any, Final, Sequence

WIRE_PROTOCOL_VERSION: Final = 1
KNOWN_DOWNSTREAM_TYPES: Final = frozenset(
    {"hello", "manifest", "osc", "link", "heartbeat", "notice"}
)
WIRE_ARG_TYPES: Final = frozenset({"i", "f", "s", "b"})


class FrameDecodeError(ValueError):
    """A JSON value is not a valid version 1 downstream frame."""


# Kept as the public name used by the connection layer during the migration.
ProtocolError = FrameDecodeError


@dataclass(frozen=True)
class WireArg:
    type: str
    value: int | float | str


@dataclass(frozen=True)
class Peer:
    host: str
    port: int


@dataclass(frozen=True)
class DecodedFrame:
    """Common value-object surface shared by all downstream frame variants."""

    type: str
    v: int = WIRE_PROTOCOL_VERSION


@dataclass(frozen=True)
class OscFrame(DecodedFrame):
    address: str = ""
    args: tuple[WireArg, ...] = ()
    source: Peer | None = None


@dataclass(frozen=True)
class HelloFrame(DecodedFrame):
    client_id: str = ""
    protocol_version: int = 0
    server: dict[str, Any] | None = None
    unity: dict[str, Any] | None = None
    bridge: dict[str, Any] | None = None
    expected_project_id: str | None = None
    heartbeat: dict[str, Any] | None = None
    ping_interval_ms: float = 0
    debug: bool = False


@dataclass(frozen=True)
class ManifestFrame(DecodedFrame):
    manifest: dict[str, Any] | None = None


@dataclass(frozen=True)
class LinkFrame(DecodedFrame):
    unity: dict[str, Any] | None = None
    manifest: dict[str, Any] | None = None
    last_rejection: dict[str, Any] | None = None


@dataclass(frozen=True)
class HeartbeatFrame(DecodedFrame):
    timestamp: int | float = 0

    @property
    def t(self) -> int | float:
        return self.timestamp


@dataclass(frozen=True)
class NoticeFrame(DecodedFrame):
    level: str = ""
    code: str = ""
    detail: str = ""


@dataclass(frozen=True)
class UpstreamOscFrame:
    v: int
    type: Final[str] = "osc"
    address: str = ""
    args: tuple[WireArg, ...] = ()


@dataclass(frozen=True)
class ManifestRequestFrame:
    v: int
    type: Final[str] = "manifestRequest"


@dataclass(frozen=True)
class HeartbeatAckFrame:
    v: int
    t: int | float
    type: Final[str] = "heartbeatAck"


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FrameDecodeError(f"{label} must be an object")
    return value


def _strict(value: Any, allowed: set[str], label: str) -> dict[str, Any]:
    result = _object(value, label)
    unknown = set(result) - allowed
    if unknown:
        raise FrameDecodeError(f"unknown {label} key(s): {', '.join(sorted(unknown))}")
    return result


def _number(value: Any, label: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FrameDecodeError(f"{label} must be a number")
    return value


def _arg(value: Any) -> WireArg:
    item = _strict(value, {"type", "value"}, "argument")
    tag = item.get("type")
    if tag not in WIRE_ARG_TYPES:
        raise FrameDecodeError(f"unsupported argument type tag: {tag!r}")
    if "value" not in item:
        raise FrameDecodeError("argument value is missing")
    arg_value = item["value"]
    if tag == "i" and (isinstance(arg_value, bool) or not isinstance(arg_value, int)):
        raise FrameDecodeError("integer argument value does not match tag i")
    if tag == "f" and (isinstance(arg_value, bool) or not isinstance(arg_value, (int, float))):
        raise FrameDecodeError("numeric argument value does not match tag f")
    if tag == "s" and not isinstance(arg_value, str):
        raise FrameDecodeError("string argument value does not match tag s")
    if tag == "b":
        if not isinstance(arg_value, str):
            raise FrameDecodeError("blob argument value does not match tag b")
        try:
            base64.b64decode(arg_value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise FrameDecodeError("blob argument is not valid base64") from error
    return WireArg(tag, arg_value)


def decode_frame(raw: str | bytes | bytearray) -> DecodedFrame:
    """Decode one downstream JSON frame and preserve argument tags/order."""
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError as error:
            raise FrameDecodeError("frame is not UTF-8") from error
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise FrameDecodeError("frame is not valid JSON") from error
    frame = _object(value, "frame")
    if set(frame) - {"v", "type", "clientId", "protocolVersion", "server", "unity", "bridge", "expectedProjectId", "heartbeat", "pingIntervalMs", "debug", "manifest", "address", "args", "from", "lastRejection", "t", "level", "code", "detail"}:
        raise FrameDecodeError("frame contains unknown key(s)")
    if frame.get("v") != WIRE_PROTOCOL_VERSION:
        raise FrameDecodeError("missing or mismatched protocol version")
    kind = frame.get("type")
    if not isinstance(kind, str) or kind not in KNOWN_DOWNSTREAM_TYPES:
        raise FrameDecodeError(f"unknown downstream frame type: {kind!r}")

    if kind == "osc":
        _strict(frame, {"v", "type", "address", "args", "from"}, "frame")
        if not isinstance(frame.get("address"), str) or not frame["address"].startswith("/"):
            raise FrameDecodeError("osc address must start with '/'")
        args = frame.get("args")
        if not isinstance(args, list):
            raise FrameDecodeError("osc args must be an array")
        source = _strict(frame["from"], {"host", "port"}, "from")
        if not isinstance(source.get("host"), str) or not isinstance(source.get("port"), int):
            raise FrameDecodeError("invalid osc source")
        return OscFrame("osc", 1, frame["address"], tuple(_arg(arg) for arg in args), Peer(source["host"], source["port"]))
    if kind == "heartbeat":
        _strict(frame, {"v", "type", "t"}, "frame")
        return HeartbeatFrame("heartbeat", 1, _number(frame.get("t"), "heartbeat timestamp"))
    if kind == "notice":
        _strict(frame, {"v", "type", "level", "code", "detail"}, "frame")
        if not all(isinstance(frame.get(key), str) for key in ("level", "code", "detail")):
            raise FrameDecodeError("invalid notice fields")
        return NoticeFrame("notice", 1, frame["level"], frame["code"], frame["detail"])
    if kind == "manifest":
        _strict(frame, {"v", "type", "manifest"}, "frame")
        return ManifestFrame("manifest", 1, _object(frame.get("manifest"), "manifest"))
    if kind == "link":
        _strict(frame, {"v", "type", "unity", "manifest", "lastRejection"}, "frame")
        return LinkFrame("link", 1, _object(frame["unity"], "unity"), _object(frame["manifest"], "manifest"), frame["lastRejection"] if frame.get("lastRejection") is None else _object(frame["lastRejection"], "lastRejection"))
    _strict(frame, {"v", "type", "clientId", "protocolVersion", "server", "unity", "bridge", "expectedProjectId", "heartbeat", "pingIntervalMs", "debug"}, "frame")
    if not isinstance(frame.get("clientId"), str):
        raise FrameDecodeError("hello clientId must be a string")
    return HelloFrame("hello", 1, frame["clientId"], frame["protocolVersion"], _object(frame["server"], "server"), _object(frame["unity"], "unity"), _object(frame["bridge"], "bridge"), frame["expectedProjectId"], _object(frame["heartbeat"], "heartbeat"), _number(frame["pingIntervalMs"], "pingIntervalMs"), frame["debug"])


def _wire_arg(arg: WireArg | tuple[str, Any] | dict[str, Any]) -> dict[str, Any]:
    if isinstance(arg, WireArg):
        return {"type": arg.type, "value": arg.value}
    if isinstance(arg, tuple) and len(arg) == 2:
        return {"type": arg[0], "value": arg[1]}
    if isinstance(arg, dict) and set(arg) == {"type", "value"}:
        return dict(arg)
    raise FrameDecodeError("invalid upstream argument")


def encode_osc_frame(address: str, args: Sequence[WireArg | tuple[str, Any] | dict[str, Any]]) -> str:
    if not isinstance(address, str) or not address.startswith("/"):
        raise ProtocolError("OSC address must start with '/'")
    payload = {"v": 1, "type": "osc", "address": address, "args": [_wire_arg(arg) for arg in args]}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def encode_manifest_request() -> str:
    return '{"v":1,"type":"manifestRequest"}'


def encode_heartbeat_ack(timestamp: int | float) -> str:
    _number(timestamp, "heartbeat timestamp")
    return json.dumps({"v": 1, "type": "heartbeatAck", "t": timestamp}, separators=(",", ":"))


def encode_frame(frame: Any) -> str:
    if isinstance(frame, (UpstreamOscFrame, ManifestRequestFrame, HeartbeatAckFrame)):
        data = {"v": frame.v, "type": frame.type}
        if frame.type == "osc":
            data.update({"address": frame.address, "args": [_wire_arg(arg) for arg in frame.args]})
        elif frame.type == "heartbeatAck":
            data["t"] = frame.t
        return json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    raise ProtocolError("encode_frame accepts an upstream frame value object")
