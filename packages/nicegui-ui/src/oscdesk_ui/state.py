"""UI から見たサーフェスの状態。

WebSocket 接続・マニフェスト・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。
"""

from __future__ import annotations

import logging
import socket
import time
from dataclasses import dataclass, replace
from typing import Any, Callable, Sequence

from .config import AppConfig, UnityTarget
from .manifest import Manifest, ManifestEntry, ManifestError, parse_manifest
from .protocol import DecodedFrame, HelloFrame, LinkFrame, ManifestFrame, OscFrame
from .surface_link import LinkOptions, LinkStatus, SurfaceLink
from .value_store import DEFAULT_MIN_SEND_INTERVAL_S, ValueStore

logger = logging.getLogger(__name__)


def _resolve_host_addresses(host: str) -> frozenset[str]:
    """設定上のホスト名を数値アドレスの集合へ解決する。失敗時は空集合(文字列比較のみ)。"""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return frozenset()
    return frozenset(str(info[4][0]) for info in infos)


@dataclass(frozen=True)
class ManifestStatus:
    detail: str
    error: str | None = None
    project_id: str | None = None
    entry_count: int = 0
    last_rejection: str | None = None

@dataclass(frozen=True)
class UnityLinkStatus:
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0
    last_pong_seq: int | None = None


class SurfaceState:
    def __init__(
        self,
        config: AppConfig,
        clock: Callable[[], float] = time.monotonic,
        min_send_interval_s: float = DEFAULT_MIN_SEND_INTERVAL_S,
        link_factory: Callable[..., SurfaceLink] | None = None,
    ) -> None:
        self._config = config
        self._clock = clock
        self.values = ValueStore(min_send_interval_s=min_send_interval_s)

        self._manifest: Manifest | None = None
        self._manifest_revision = 0
        self._manifest_status = ManifestStatus(detail="待機中")
        self._link_status = LinkStatus(connected=False, detail="未接続")
        self._unity_link_status = UnityLinkStatus()
        self._last_rejection: dict[str, Any] | None = None
        self._hello: HelloFrame | None = None
        # unity.host がホスト名(localhost / LAN DNS 名)のとき、UDP の送信元は数値
        # アドレスで届くため、名前解決した集合を突き合わせに使う(host 単位でキャッシュ)
        self._resolved_unity_host: str | None = None
        self._resolved_unity_addrs: frozenset[str] = frozenset()

        build_link = link_factory or SurfaceLink
        self.link = build_link(
            LinkOptions(url=config.websocket_url),
            self._on_frame,
            self._on_link_status,
        )

    # --- 参照 -------------------------------------------------------------

    @property
    def config(self) -> AppConfig:
        return self._config

    @property
    def manifest(self) -> Manifest | None:
        return self._manifest

    @property
    def manifest_revision(self) -> int:
        return self._manifest_revision

    @property
    def manifest_status(self) -> ManifestStatus:
        return self._manifest_status

    @property
    def link_status(self) -> LinkStatus:
        return self._link_status

    @property
    def unity_link_status(self) -> UnityLinkStatus:
        return self._unity_link_status

    @property
    def last_rejection(self) -> dict[str, Any] | None:
        return self._last_rejection

    @property
    def hello(self) -> HelloFrame | None:
        return self._hello

    # --- UI からの操作 ----------------------------------------------------

    def begin_hold(self, address: str) -> None:
        self.values.channel(address).begin_hold()

    def end_hold(self, entry: ManifestEntry) -> None:
        values = self.values.channel(entry.address).end_hold(self._clock())

        if values is not None:
            self._send(entry, values)

    def set_local(self, entry: ManifestEntry, values: Sequence[Any]) -> None:
        """UI 操作による値変更。間引きに掛かった分は tick() が後から送る。"""
        to_send = self.values.channel(entry.address).on_local(tuple(values), self._clock())

        if to_send is not None:
            self._send(entry, to_send)

    def set_discrete(self, entry: ManifestEntry, values: Sequence[Any]) -> None:
        """ボタン・トグルの操作。取りこぼすと状態が食い違うため間引かない。"""
        to_send = self.values.channel(entry.address).on_local_immediate(tuple(values), self._clock())
        self._send(entry, to_send)

    def tick(self) -> None:
        """間引きで保留された最終値を送る。UI 側の定期タイマーから呼ぶ。"""
        now = self._clock()

        for address, values in self.values.flush_due(now):
            entry = self.entry_for(address)

            if entry is not None:
                self._send(entry, values)

    def entry_for(self, address: str) -> ManifestEntry | None:
        if self._manifest is None:
            return None

        for entry in self._manifest.entries:
            if entry.address == address:
                return entry

        return None

    # --- リンクからの受信 -------------------------------------------------

    def _on_link_status(self, status: LinkStatus) -> None:
        self._link_status = status

        if not status.connected:
            # 送信途中の状態を捨てる。再接続後の値は Unity のエコーバックで復元する。
            self.values.reset_send_state()

    def _on_frame(self, frame: DecodedFrame) -> None:
        """接続層から届く全フレームの入口。種別の分岐はここだけで行う。"""
        if isinstance(frame, HelloFrame):
            self._on_hello(frame)
            return

        if isinstance(frame, LinkFrame):
            self._on_link(frame)
            return

        if isinstance(frame, ManifestFrame):
            self._on_manifest(frame.manifest)
            return

        if not isinstance(frame, OscFrame):
            return

        if frame.address.startswith("/sys/"):
            return

        if not frame.args:
            return

        # 値の確定は Unity のエコーバックのみ(絶対規律)。oscUi 有効時は OSC ネイティブ
        # UI の操作値も from つきの osc フレームとして届くため、送信元ホストが Unity で
        # ないものは表示キャッシュへ入れない。hello 前(unity 未取得)も確定させない
        if frame.source is None or not self._is_unity_source(frame.source.host):
            return

        self.values.on_echo(frame.address, tuple(arg.value for arg in frame.args))

    def _is_unity_source(self, host: str) -> bool:
        unity = self._config.unity
        if unity is None:
            return False
        if host == unity.host:
            return True
        if self._resolved_unity_host != unity.host:
            self._resolved_unity_host = unity.host
            self._resolved_unity_addrs = _resolve_host_addresses(unity.host)
        return host in self._resolved_unity_addrs

    def _on_manifest(self, payload: Any) -> None:
        try:
            manifest = parse_manifest(payload)
        except ManifestError as error:
            logger.error("マニフェストを採用できません: %s", error)
            self._manifest_status = ManifestStatus(detail="不正", error=str(error))
            return

        expected = None

        if expected is not None and manifest.project_id != expected:
            detail = f'projectId 不一致 (期待 "{expected}" / 受信 "{manifest.project_id}")'
            logger.error("%s", detail)
            self._manifest_status = ManifestStatus(detail="誤接続の疑い", error=detail)
            return

        if self._manifest is not None and manifest == self._manifest:
            return

        self._manifest = manifest
        self._manifest_revision += 1
        self.values.seed_defaults(manifest.entries)
        self._manifest_status = ManifestStatus(
            detail="採用済み",
            project_id=manifest.project_id,
            entry_count=len(manifest.entries),
        )

    def _on_hello(self, frame: HelloFrame) -> None:
        self._hello = frame
        unity = frame.unity or {}
        if isinstance(unity.get("host"), str) and isinstance(unity.get("sendPort"), int):
            receive_port = unity.get("receivePort", unity["sendPort"])
            if not isinstance(receive_port, int):
                return
            self._config = replace(self._config, unity=UnityTarget(unity["host"], unity["sendPort"], receive_port))
        heartbeat = frame.heartbeat or {}
        interval_ms = heartbeat.get("intervalMs", frame.ping_interval_ms)
        if isinstance(interval_ms, (int, float)) and interval_ms > 0:
            self.link.update_heartbeat(float(interval_ms) / 1000)

    def _on_link(self, frame: LinkFrame) -> None:
        unity = frame.unity or {}
        self._unity_link_status = UnityLinkStatus(
            reachability=str(unity.get("reachability", "unknown")),
            last_rtt_ms=unity.get("lastRttMs"),
            consecutive_losses=int(unity.get("consecutiveLosses", 0)),
            last_pong_seq=unity.get("lastPongSeq"),
        )
        self._last_rejection = frame.last_rejection
        rejection = frame.last_rejection
        rejection_text = None
        if rejection is not None:
            reason = rejection.get("reason", "不明")
            detail = rejection.get("detail", "")
            rejection_text = f"{reason}: {detail}" if detail else str(reason)

        manifest = frame.manifest or {}
        if manifest.get("state") == "accepted":
            project_id = manifest.get("projectId")
            entry_count = manifest.get("entryCount", 0)
            if isinstance(project_id, str) and isinstance(entry_count, int):
                self._manifest_status = replace(
                    self._manifest_status,
                    detail="採用済み",
                    project_id=project_id,
                    entry_count=entry_count,
                    last_rejection=rejection_text,
                )
        elif manifest.get("state") == "none" and self._manifest is None:
            self._manifest_status = replace(
                self._manifest_status,
                detail="待機中",
                last_rejection=rejection_text,
            )
        else:
            self._manifest_status = replace(
                self._manifest_status,
                last_rejection=rejection_text,
            )

    # --- 送信 -------------------------------------------------------------

    def _send(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        if entry.is_display_only:
            return

        type_tags = entry.type_tag * len(values)
        self.link.send_osc(
            entry.address,
            [
                {"type": type_tag, "value": value}
                for type_tag, value in zip(type_tags, values, strict=True)
            ],
        )
