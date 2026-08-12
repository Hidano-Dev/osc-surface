"""O-S-C サーバーとの WebSocket フレーム。

仕様は docs/CUSTOM_UI_INTEGRATION.md §3 を正とする。
すべてのフレームは ["イベント名", データ] の JSON 配列。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Final, Sequence

EVENT_OPEN: Final = "open"
EVENT_SEND_OSC: Final = "sendOsc"
EVENT_RECEIVE_OSC: Final = "receiveOsc"
EVENT_PING: Final = "ping"
EVENT_PONG: Final = "pong"

# サーバーは 25 秒ごとに ping を送り、5 秒以内に pong が返らないと接続を切る
# (vendor: src/server/node/ipc/client.mjs)。短時間の動作確認では顕在化しない。
PING_TIMEOUT_S: Final = 5.0


class ProtocolError(ValueError):
    """フレームが仕様どおりでないときに送出する。"""


@dataclass(frozen=True)
class Frame:
    event: str
    data: Any = None


@dataclass(frozen=True)
class ReceivedOsc:
    address: str
    args: tuple[Any, ...]
    host: str | None = None
    port: int | None = None

    @property
    def first(self) -> Any:
        return self.args[0] if self.args else None


def encode_frame(event: str, data: Any = None) -> str:
    if data is None:
        return json.dumps([event], separators=(",", ":"))
    return json.dumps([event, data], separators=(",", ":"), ensure_ascii=False)


def decode_frame(raw: str | bytes) -> Frame:
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")

    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise ProtocolError(f"JSON として解釈できないフレームです: {error}") from error

    if not isinstance(parsed, list) or not parsed:
        raise ProtocolError("フレームは要素 1 個以上の配列である必要があります。")

    event = parsed[0]
    if not isinstance(event, str):
        raise ProtocolError("フレームの先頭要素はイベント名(文字列)である必要があります。")

    return Frame(event=event, data=parsed[1] if len(parsed) > 1 else None)


def open_frame() -> str:
    """接続直後に送るフレーム。サーバーから serverTargets 等が返る。"""
    return encode_frame(EVENT_OPEN, {})


def pong_frame() -> str:
    return encode_frame(EVENT_PONG)


def send_osc_frame(address: str, args: Sequence[Any], type_tags: str, target: Sequence[str]) -> str:
    """OSC 送信フレームを組み立てる。

    サーバー側は args = preArgs.concat(v) として復元するため、最後の 1 個を v、
    残りを preArgs に置く。target は必須(省略すると何も送信されない)。
    """
    if not args:
        raise ProtocolError("sendOsc には引数が 1 個以上必要です。")

    if len(type_tags) != len(args):
        raise ProtocolError(
            f"typeTags の長さ({len(type_tags)})と引数の個数({len(args)})が一致しません。"
        )

    if not target:
        raise ProtocolError("sendOsc には target が必須です。")

    return encode_frame(
        EVENT_SEND_OSC,
        {
            "address": address,
            "v": args[-1],
            "preArgs": list(args[:-1]),
            "typeTags": type_tags,
            "target": list(target),
        },
    )


def parse_received_osc(data: Any) -> ReceivedOsc:
    """receiveOsc のペイロードを正規化する。

    この経路では OSC の型タグが落ち、引数が 1 個のときは配列も外れて素の値になる
    (docs/CUSTOM_UI_INTEGRATION.md §3)。ここで必ずタプルへ揃える。
    """
    if not isinstance(data, dict):
        raise ProtocolError("receiveOsc のペイロードはオブジェクトである必要があります。")

    address = data.get("address")
    if not isinstance(address, str):
        raise ProtocolError("receiveOsc の address は文字列である必要があります。")

    raw_args = data.get("args")
    if raw_args is None:
        args: tuple[Any, ...] = ()
    elif isinstance(raw_args, list):
        args = tuple(_unwrap_arg(item) for item in raw_args)
    else:
        args = (_unwrap_arg(raw_args),)

    host = data.get("host")
    port = data.get("port")

    return ReceivedOsc(
        address=address,
        args=args,
        host=host if isinstance(host, str) else None,
        port=port if isinstance(port, int) else None,
    )


def _unwrap_arg(item: Any) -> Any:
    """念のため {type, value} 形式で届いた場合も素の値へ揃える。"""
    if isinstance(item, dict) and "value" in item:
        return item["value"]
    return item


def format_target(host: str, port: int) -> str:
    return f"{host}:{port}"
