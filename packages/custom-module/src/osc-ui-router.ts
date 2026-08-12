import type { OscUiConfig, OscUiPeer } from '@osc-surface/shared'

/**
 * OSC ネイティブ UI (TouchOSC / OSC/PILOT 等) を UI として使うためのルーター。
 *
 * O-S-C 本体は「OSC 受信 → ブラウザへ配る」しか行わず、OSC 受信を別の OSC 宛先へ
 * 転送する経路を持たない。ブラウザ UI では各ウィジェットが持つ target が
 * その役割を担っているため、UI が OSC ネイティブアプリになると転送役が居なくなる。
 * ここではその転送判断だけを純粋ロジックとして担う。
 *
 * 判定は以下の優先順位で行う(同一ホストに Unity と UI が同居していても壊れないよう、
 * Unity 判定を先に置く):
 *
 *   1. 送信元が Unity (host + sendPort が一致) → Unity からのエコーバックとみなし、
 *      登録済みの UI ピア全員へ配る
 *   2. 送信元ホストが既知の UI ピア → UI 操作とみなし Unity へ転送する
 *   3. それ以外 → 素性不明として捨てる
 */
export type RouteDecision =
  | { kind: 'to-unity' }
  | { kind: 'to-ui'; targets: readonly OscUiPeer[] }
  | { kind: 'ignore'; reason: 'no-ui-peers' | 'unknown-peer' }

export interface OscUiRouterOptions {
  /** Unity 側の host と、サーフェスが Unity へ送るポート。 */
  unity: OscUiPeer
  config: OscUiConfig
}

export interface RegisterResult {
  added: boolean
  peer: OscUiPeer
}

interface PeerRecord {
  peer: OscUiPeer
  lastSeenMs: number
}

function peerKey(peer: OscUiPeer): string {
  return `${peer.host}:${String(peer.port)}`
}

export class OscUiRouter {
  readonly #unity: OscUiPeer
  readonly #staticPeers: readonly OscUiPeer[]
  readonly #peerTtlMs: number
  readonly #registered = new Map<string, PeerRecord>()

  constructor(options: OscUiRouterOptions) {
    this.#unity = options.unity
    this.#staticPeers = options.config.staticPeers
    this.#peerTtlMs = options.config.peerTtlMs
  }

  /** /surface/hello を受けて UI ピアを登録する。既知なら lastSeen を更新するだけ。 */
  registerPeer(host: string, port: number, nowMs: number): RegisterResult {
    const peer: OscUiPeer = { host, port }
    const key = peerKey(peer)
    const added = !this.#registered.has(key)

    this.#registered.set(key, { peer, lastSeenMs: nowMs })

    return { added, peer }
  }

  /** 現在配信対象となる UI ピア。静的ピアは常に生存扱い。 */
  activePeers(nowMs: number): readonly OscUiPeer[] {
    this.#pruneExpired(nowMs)

    const seen = new Set<string>()
    const peers: OscUiPeer[] = []

    for (const peer of [...this.#staticPeers, ...[...this.#registered.values()].map((record) => record.peer)]) {
      const key = peerKey(peer)

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      peers.push(peer)
    }

    return peers
  }

  route(source: OscUiPeer, nowMs: number): RouteDecision {
    if (this.#isUnity(source)) {
      const targets = this.activePeers(nowMs)

      return targets.length > 0 ? { kind: 'to-ui', targets } : { kind: 'ignore', reason: 'no-ui-peers' }
    }

    if (this.#isKnownUiHost(source.host, nowMs)) {
      this.#touchHost(source.host, nowMs)

      return { kind: 'to-unity' }
    }

    return { kind: 'ignore', reason: 'unknown-peer' }
  }

  #isUnity(source: OscUiPeer): boolean {
    return source.host === this.#unity.host && source.port === this.#unity.port
  }

  #isKnownUiHost(host: string, nowMs: number): boolean {
    if (this.#staticPeers.some((peer) => peer.host === host)) {
      return true
    }

    this.#pruneExpired(nowMs)

    return [...this.#registered.values()].some((record) => record.peer.host === host)
  }

  /**
   * 操作が続いている限りピアを生かし続ける。名乗りの定期送信を UI 側に強制しないため。
   */
  #touchHost(host: string, nowMs: number): void {
    for (const record of this.#registered.values()) {
      if (record.peer.host === host) {
        record.lastSeenMs = nowMs
      }
    }
  }

  #pruneExpired(nowMs: number): void {
    if (this.#peerTtlMs <= 0) {
      return
    }

    for (const [key, record] of this.#registered) {
      if (nowMs - record.lastSeenMs > this.#peerTtlMs) {
        this.#registered.delete(key)
      }
    }
  }
}
