import { describe, expect, it } from 'vitest'

import { OscUiConfigSchema } from '@oscdesk/shared'

import { OscUiRouter } from './osc-ui-router'

const UNITY = { host: '127.0.0.1', port: 7090 }

function createRouter(overrides: Record<string, unknown> = {}) {
  return new OscUiRouter({
    unity: UNITY,
    config: OscUiConfigSchema.parse({ enabled: true, ...overrides }),
  })
}

describe('OscUiRouter', () => {
  it('forwards messages from a registered UI peer to Unity', () => {
    const router = createRouter()

    expect(router.registerPeer('192.168.0.50', 9000, 0)).toEqual({
      added: true,
      peer: { host: '192.168.0.50', port: 9000 },
    })
    // TouchOSC の送信元ポートは受信ポートと異なる一時ポートになる
    expect(router.route({ host: '192.168.0.50', port: 54321 }, 10)).toEqual({ kind: 'to-unity' })
  })

  it('fans Unity echo-back out to every registered UI peer', () => {
    const router = createRouter()

    router.registerPeer('192.168.0.50', 9000, 0)
    router.registerPeer('192.168.0.51', 9000, 0)

    expect(router.route(UNITY, 10)).toEqual({
      kind: 'to-ui',
      targets: [
        { host: '192.168.0.50', port: 9000 },
        { host: '192.168.0.51', port: 9000 },
      ],
    })
  })

  it('ignores Unity echo-back while no UI peer is known', () => {
    expect(createRouter().route(UNITY, 10)).toEqual({ kind: 'ignore', reason: 'no-ui-peers' })
  })

  it('ignores traffic from peers that never announced themselves', () => {
    expect(createRouter().route({ host: '10.0.0.9', port: 5000 }, 10)).toEqual({
      kind: 'ignore',
      reason: 'unknown-peer',
    })
  })

  it('checks Unity before UI so both can share a host', () => {
    const router = createRouter()

    // TouchOSC デスクトップ版を Unity と同じ PC で動かすケース
    router.registerPeer('127.0.0.1', 9000, 0)

    expect(router.route({ host: '127.0.0.1', port: 7090 }, 10)).toEqual({
      kind: 'to-ui',
      targets: [{ host: '127.0.0.1', port: 9000 }],
    })
    expect(router.route({ host: '127.0.0.1', port: 54321 }, 10)).toEqual({ kind: 'to-unity' })
  })

  it('treats static peers as always present and de-duplicates them', () => {
    const router = createRouter({ staticPeers: [{ host: '192.168.0.60', port: 9000 }] })

    expect(router.route(UNITY, 10)).toEqual({
      kind: 'to-ui',
      targets: [{ host: '192.168.0.60', port: 9000 }],
    })

    router.registerPeer('192.168.0.60', 9000, 10)

    expect(router.activePeers(10)).toEqual([{ host: '192.168.0.60', port: 9000 }])
  })

  it('keeps registered peers forever when peerTtlMs is 0', () => {
    const router = createRouter()

    router.registerPeer('192.168.0.50', 9000, 0)

    expect(router.activePeers(10_000_000)).toEqual([{ host: '192.168.0.50', port: 9000 }])
  })

  it('expires idle peers once peerTtlMs elapses', () => {
    const router = createRouter({ peerTtlMs: 1_000 })

    router.registerPeer('192.168.0.50', 9000, 0)

    expect(router.activePeers(1_000)).toEqual([{ host: '192.168.0.50', port: 9000 }])
    expect(router.activePeers(1_001)).toEqual([])
    expect(router.route(UNITY, 1_001)).toEqual({ kind: 'ignore', reason: 'no-ui-peers' })
  })

  it('keeps a peer alive while it is still being operated', () => {
    const router = createRouter({ peerTtlMs: 1_000 })

    router.registerPeer('192.168.0.50', 9000, 0)

    expect(router.route({ host: '192.168.0.50', port: 54321 }, 900)).toEqual({ kind: 'to-unity' })
    // 900ms 時点の操作で延命されているので 1_001ms でもまだ生きている
    expect(router.activePeers(1_001)).toEqual([{ host: '192.168.0.50', port: 9000 }])
  })
})
