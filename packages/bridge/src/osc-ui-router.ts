import { OSCDESK, type OscUiConfig, type OscUiPeer } from '@oscdesk/shared'

/**
 * OSC ネイティブ UI (TouchOSC / OSC/PILOT 等) を UI として使うためのルーター。
 *
 * WebSocket UI からの値は UiHub 経由でオーケストレータが Unity へ送るが、UI が
 * OSC ネイティブアプリの場合はその経路を通らず、UDP へ直接届く。素の OSC には
 * 「誰に返すか」の情報が無いため、名乗り (/oscdesk/hello) で登録したピアと Unity の
 * 間をどちら向きに中継するかを、ここで純粋ロジックとして判定する。
 *
 * 判定は以下の優先順位で行う。Unity の返信は待受ソケットとは別のソケットから
 * 送られることがあり(uOsc の uOscClient 等)、送信元ポートが待受ポートと一致する
 * 保証はないため、ポート一致は「確定できる場合の早道」としてのみ使う:
 *
 *   1. 送信元が Unity の host + sendPort に一致 → 確実に Unity。エコーバックとして
 *      登録済みの UI ピア全員へ配る(単一ソケット実装の mock-unity はここで確定)
 *   2. 送信元ホストが既知の UI ピア → UI 操作とみなし Unity へ転送する
 *   3. 送信元ホストが Unity の host に一致 → エフェメラルな送信元ポートを使う
 *      Unity 実装からのエコーバックとみなし、UI ピア全員へ配る
 *   4. それ以外 → 素性不明として捨てる
 *
 * 制約: Unity と OSC ネイティブ UI が同一ホストに同居し、かつ Unity が待受と別の
 * ソケットから返信する場合は 2 と 3 を区別できない(2 が先に当たり、エコーが Unity へ
 * 送り返される)。この構成では Unity 側で送信元ポートを待受ポートに固定すること。
 */
export type RouteDecision =
  | { kind: 'to-unity' }
  | { kind: 'to-ui'; targets: readonly OscUiPeer[] }
  | { kind: 'ignore'; reason: 'no-ui-peers' | 'unknown-peer' }

export interface OscUiRouterOptions {
  /** Unity 側の host と、サーフェスが Unity へ送るポート。 */
  unity: OscUiPeer
  /**
   * unity.host がホスト名(localhost / LAN DNS 名)のときの、名前解決済み数値アドレス。
   * UDP の送信元は常に数値アドレスで届くため、文字列比較だけでは一致しない。
   */
  unityAddresses?: readonly string[]
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
  readonly #unityHosts: ReadonlySet<string>
  readonly #staticPeers: readonly OscUiPeer[]
  readonly #peerTtlMs: number
  readonly #registered = new Map<string, PeerRecord>()

  constructor(options: OscUiRouterOptions) {
    this.#unity = options.unity
    this.#unityHosts = new Set([options.unity.host, ...(options.unityAddresses ?? [])])
    this.#staticPeers = options.config.staticPeers
    this.#peerTtlMs = options.config.peerTtlMs
  }

  /** `${OSCDESK.HELLO}` を受けて UI ピアを登録する。既知なら lastSeen を更新するだけ。 */
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
    if (this.#isUnitySocket(source)) {
      return this.#toUi(nowMs)
    }

    if (this.#isKnownUiHost(source.host, nowMs)) {
      this.#touchHost(source.host, nowMs)

      return { kind: 'to-unity' }
    }

    if (this.#unityHosts.has(source.host)) {
      return this.#toUi(nowMs)
    }

    return { kind: 'ignore', reason: 'unknown-peer' }
  }

  #toUi(nowMs: number): RouteDecision {
    const targets = this.activePeers(nowMs)

    return targets.length > 0 ? { kind: 'to-ui', targets } : { kind: 'ignore', reason: 'no-ui-peers' }
  }

  #isUnitySocket(source: OscUiPeer): boolean {
    return this.#unityHosts.has(source.host) && source.port === this.#unity.port
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
