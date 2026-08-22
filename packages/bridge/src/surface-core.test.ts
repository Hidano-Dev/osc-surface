import { describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  OSCDESK,
  SYS,
  type DownstreamFrame,
} from '@oscdesk/shared'

import { OscUiRouter } from './osc-ui-router'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

const BRIDGE_CONFIG: BridgeConfig = {
  unity: { host: '127.0.0.1', sendPort: 9000 },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  ui: { host: '0.0.0.0', port: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 200,
    lossRateWindow: 30,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
  oscUi: { enabled: true, staticPeers: [], peerTtlMs: 0 },
}

const VALID_MANIFEST_JSON = JSON.stringify({
  version: 1,
  projectId: 'oscdesk-demo',
  entries: [{ address: '/avatar/blend/smile', type: 'f', widget: 'fader', label: 'Smile', range: [0, 1], default: 0.75 }],
})

const DIAGNOSTICS_SNAPSHOT = DiagnosticsSnapshotSchema.parse({
  reachability: 'reachable', lastRttMs: 12, consecutiveLosses: 0,
  lossRate: { windowSize: 30, observed: 1, lost: 0, rate: 0 },
  subnet: { kind: 'sameHost' }, logUsage: { totalBytes: 128, limitBytes: 1024, overLimit: false }, recentMessages: [],
})

function makeCore(overrides: Partial<Parameters<typeof createSurfaceCore>[0]> = {}) {
  const sendFn = vi.fn()
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const core = createSurfaceCore({ config: BRIDGE_CONFIG, sendFn, publish, ...overrides })
  return { core, sendFn, publish }
}

describe('createSurfaceCore', () => {
  it('requests the manifest on init, then starts a 2 second loop for ping and manifest retries', () => {
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback, intervalMs) => { expect(intervalMs).toBe(2000); tick = callback; return 1 as never })
    const { core, sendFn } = makeCore({ setIntervalFn })
    core.start()
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, SYS.MANIFEST_REQUEST)
    tick?.()
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, SYS.PING, { type: 'i', value: 1 })
  })

  it('swallows pong messages and publishes no pong frame while updating link state', () => {
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100)
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 1 as never })
    const { core, publish } = makeCore({ now, setIntervalFn })

    core.start(); tick?.()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: { host: '127.0.0.1', port: 9000 } })
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 's', value: '1' }], from: { host: '127.0.0.1', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: SYS.PONG }), expect.anything())
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: SYS.PONG }))
  })

  it('swallows internal addresses and publishes external OSC messages', () => {
    const { core, publish } = makeCore()

    core.handleOscIn({ address: SYS.STATS, args: [{ type: 's', value: '{}' }], from: { host: '127.0.0.1', port: 9000 } })
    core.handleOscIn({ address: '/avatar/position', args: [{ type: 'f', value: 1.25 }], from: { host: '127.0.0.1', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: SYS.STATS }))
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'osc', address: '/avatar/position',
      args: [{ type: 'f', value: 1.25 }], from: { host: '127.0.0.1', port: 9000 },
    })
  })

  it('keeps diagnostics fully disabled when debug is false', () => {
    const createDiagnosticsEngine = vi.fn()
    const { core } = makeCore({ createDiagnosticsEngine })
    core.start()
    expect(createDiagnosticsEngine).not.toHaveBeenCalled()
  })

  it('enables diagnostics hooks in debug mode and records bridge traffic and ping state', () => {
    const recordIncoming = vi.fn(); const recordOutgoing = vi.fn(); const onPingCycle = vi.fn(); const onPongAccepted = vi.fn()
    const createDiagnosticsEngine = vi.fn().mockReturnValue({ recordIncoming, recordOutgoing, onPingCycle, onPongAccepted, dispose: vi.fn() })
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 7 as never })
    const { core } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true }, createDiagnosticsEngine, setIntervalFn,
    })

    core.start(); tick?.()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: { host: '127.0.0.1', port: 9000 } })

    expect(createDiagnosticsEngine).toHaveBeenCalledTimes(1)
    expect(recordOutgoing).toHaveBeenCalledWith(SYS.MANIFEST_REQUEST, [], '127.0.0.1', 9000)
    expect(recordOutgoing).toHaveBeenCalledWith(SYS.PING, [{ type: 'i', value: 1 }], '127.0.0.1', 9000)
    expect(onPingCycle).toHaveBeenCalledWith({ previousLost: false })
    expect(recordIncoming).toHaveBeenCalledWith(SYS.PONG, [{ type: 'i', value: 1 }], '127.0.0.1', 9000)
    expect(onPongAccepted).toHaveBeenCalledTimes(1)
  })

  it('records UI-originated OSC traffic before sending it to Unity', () => {
    const recordOutgoing = vi.fn()
    const { core, sendFn } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true },
      createDiagnosticsEngine: vi.fn().mockReturnValue({ recordOutgoing, dispose: vi.fn() }),
    })
    core.start()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, '/avatar/position', { type: 'f', value: 1.25 })
    expect(recordOutgoing).toHaveBeenCalledWith('/avatar/position', [{ type: 'f', value: 1.25 }], '127.0.0.1', 9000)
  })

  it('records mismatched manifests without regenerating UI', () => {
    const recordRejection = vi.fn()
    const { core, publish } = makeCore({ config: { ...BRIDGE_CONFIG, expectedProjectId: 'expected' }, createGuardEventLog: vi.fn().mockReturnValue({ recordRejection, dispose: vi.fn() }) })
    core.start(); core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } })
    expect(recordRejection).toHaveBeenCalledWith(expect.objectContaining({ expectedProjectId: 'expected', receivedProjectId: 'oscdesk-demo' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'link' }), undefined)
  })

  it('logs non-repeated manifest validation failures and keeps requesting', () => {
    const logError = vi.fn(); const { core, sendFn } = makeCore({ logError })
    core.start(); core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: '{' }], from: { host: '127.0.0.1', port: 9000 } })
    expect(logError).toHaveBeenCalledWith('(ERROR, BRIDGE)', expect.stringContaining('Manifest'))
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, SYS.MANIFEST_REQUEST)
  })

  it('broadcasts the accepted manifest to websocket clients', () => {
    const { core, publish } = makeCore(); core.start()
    core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'manifest' }))
  })

  it('publishes the accepted manifest to a newly opened session only', () => {
    const { core, publish } = makeCore(); core.start()
    core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } })
    publish.mockClear(); core.onUiConnected('client-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'manifest' }), 'client-1')
  })

  it('publishes the link frame to the client when it connects and disposes the guard log on stop', () => {
    const dispose = vi.fn(); const createGuardEventLog = vi.fn().mockReturnValue({ recordRejection: vi.fn(), dispose })
    const { core, publish } = makeCore({ createGuardEventLog })
    core.start(); core.onUiConnected('client-1')

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'link' }), 'client-1')
    expect(createGuardEventLog).toHaveBeenCalledTimes(1)
    core.stop()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('publishes hello, link, then the accepted manifest when a UI connects', () => {
    const { core, publish } = makeCore()
    core.start()
    core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } })
    publish.mockClear()

    core.onUiConnected('client-1')

    expect(publish.mock.calls.map(([frame, target]) => [frame.type, target])).toEqual([
      ['hello', 'client-1'],
      ['link', 'client-1'],
      ['manifest', 'client-1'],
    ])
  })

  it('puts the resolved Unity, bridge, heartbeat, and debug settings in hello', () => {
    const { core } = makeCore({
      config: {
        ...BRIDGE_CONFIG,
        debug: true,
        unity: { host: 'unity.example.test', sendPort: 9100 },
        bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9200, wsHost: '0.0.0.0', wsPort: 9300 },
      },
    })

    expect(core.helloFrame('client-1')).toEqual({
      v: 1,
      type: 'hello',
      clientId: 'client-1',
      protocolVersion: 1,
      server: { name: 'oscdesk-bridge', version: '0.1.0' },
      unity: { host: 'unity.example.test', sendPort: 9100 },
      bridge: { oscListenPort: 9200, wsPort: 9300 },
      expectedProjectId: null,
      heartbeat: { intervalMs: 15_000, timeoutMs: 30_000 },
      pingIntervalMs: 2_000,
      debug: true,
    })
  })

  it('sends a UI value only to the configured Unity destination', () => {
    const { core, sendFn } = makeCore({
      config: {
        ...BRIDGE_CONFIG,
        unity: { host: 'unity.example.test', sendPort: 9100 },
      },
    })
    core.start()
    sendFn.mockClear()

    core.handleUiFrame({ v: 1, type: 'osc', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

    expect(sendFn).toHaveBeenCalledTimes(1)
    expect(sendFn).toHaveBeenCalledWith('unity.example.test', 9100, '/avatar/position', { type: 'f', value: 1.25 })
  })

  it('blocks UI values in the internal namespace and warns only once', () => {
    const logWarn = vi.fn()
    const { core, sendFn } = makeCore({ logWarn })
    core.start()
    sendFn.mockClear()

    const frame = { v: 1 as const, type: 'osc' as const, address: OSCDESK.STATUS, args: [] }
    core.handleUiFrame(frame, 'client-1')
    core.handleUiFrame(frame, 'client-1')

    expect(sendFn).not.toHaveBeenCalled()
    expect(logWarn).toHaveBeenCalledTimes(1)
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining(OSCDESK.STATUS))
  })

  it('throttles link-state frames to at most one per ping period', () => {
    let nowMs = 0
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 1 as never })
    const { core, publish } = makeCore({ now: () => nowMs, setIntervalFn })
    core.start()
    core.onUiConnected('client-1')
    publish.mockClear()

    nowMs = 1_000; tick?.()
    nowMs = 1_999; tick?.()
    nowMs = 2_000; tick?.()

    expect(publish.mock.calls.filter(([frame]) => frame.type === 'link')).toHaveLength(1)
  })

  it('answers a websocket manifest request without leaking it to the network', () => {
    const { core, publish, sendFn } = makeCore(); core.start()
    core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } }); publish.mockClear(); sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'manifestRequest' }, 'nicegui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'manifest' }), 'nicegui-1'); expect(sendFn).not.toHaveBeenCalled()
  })

  it('stays silent on a manifest request received before any manifest is accepted', () => {
    const { core, publish, sendFn } = makeCore(); core.start(); publish.mockClear(); sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'manifestRequest' }, 'nicegui-1')
    expect(publish).not.toHaveBeenCalled(); expect(sendFn).not.toHaveBeenCalled()
  })

  it('clears the ping timer only once when stop is called repeatedly', () => {
    const clearIntervalFn = vi.fn(); const { core } = makeCore({
      clearIntervalFn, setIntervalFn: () => 99 as never,
    })
    core.start(); core.stop(); core.stop()
    expect(clearIntervalFn).toHaveBeenCalledTimes(1)
    expect(clearIntervalFn).toHaveBeenCalledWith(99)
  })

  it('swallows the announcement and registers the UI peer', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    expect(router.registerPeer('192.168.0.50', 9100, 0)).toEqual({ added: true, peer: { host: '192.168.0.50', port: 9100 } })
  })

  it('publishes registered-peer OSC frames and sends the same UI message to Unity', () => {
    const { core, publish, sendFn } = makeCore()
    const message = { address: '/avatar/position', args: [{ type: 'f' as const, value: 0.5 }], from: { host: '192.168.0.50', port: 9100 } }
    core.handleOscIn(message)
    core.handleUiFrame({ v: 1, type: 'osc', address: message.address, args: message.args }, 'client-1')

    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'osc', address: message.address, args: message.args, from: message.from })
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, message.address, ...message.args)
  })

  it('falls back to the source port when the announcement carries no port', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    router.registerPeer('192.168.0.50', 54321, 0); expect(router.activePeers(0)).toContainEqual({ host: '192.168.0.50', port: 54321 })
  })

  it('routes Unity replies sent from an ephemeral source port to registered UI peers', () => {
    const router = new OscUiRouter({ unity: { host: '10.0.0.5', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    router.registerPeer('192.168.0.50', 9100, 0)
    // uOsc 系実装は返信を別ソケットから送るため、送信元ポートは待受ポートと一致しない
    expect(router.route({ host: '10.0.0.5', port: 51234 }, 0)).toEqual({
      kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }],
    })
  })

  it('registers a portless hello using the datagram source port', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: OSCDESK.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } })
    // 登録されたピア(送信元ポート)からの OSC が Unity へ中継されることが登録の証左
    const message = { address: '/avatar/position', args: [{ type: 'f' as const, value: 0.5 }], from: { host: '192.168.0.50', port: 54321 } }
    core.handleOscIn(message)
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, message.address, ...message.args)
  })

  it('answers a UDP manifest request from a native client without touching Unity', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: SYS.MANIFEST, args: [{ type: 's', value: VALID_MANIFEST_JSON }], from: { host: '127.0.0.1', port: 9000 } })
    sendFn.mockClear()

    core.handleOscIn({ address: OSCDESK.MANIFEST_REQUEST, args: [], from: { host: '192.168.0.60', port: 4000 } })
    expect(sendFn).toHaveBeenCalledTimes(1)
    const [host, port, address, arg] = sendFn.mock.calls[0] as [string, number, string, { type: string; value: string }]
    expect([host, port, address, arg.type]).toEqual(['192.168.0.60', 4000, OSCDESK.MANIFEST, 's'])
    expect(JSON.parse(arg.value).projectId).toBe('oscdesk-demo')
  })

  it('stays silent on a UDP manifest request before any manifest is accepted', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: OSCDESK.MANIFEST_REQUEST, args: [], from: { host: '192.168.0.60', port: 4000 } })
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('answers a UDP status request with the link snapshot', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: OSCDESK.STATUS_REQUEST, args: [], from: { host: '192.168.0.60', port: 4000 } })
    expect(sendFn).toHaveBeenCalledTimes(1)
    const [host, port, address, arg] = sendFn.mock.calls[0] as [string, number, string, { type: string; value: string }]
    expect([host, port, address, arg.type]).toEqual(['192.168.0.60', 4000, OSCDESK.STATUS, 's'])
    expect(JSON.parse(arg.value)).toMatchObject({ unity: { reachability: 'unknown' }, manifest: { state: 'none' } })
  })

  it('fans Unity echo-back out to the registered UI peer', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); router.registerPeer('192.168.0.50', 9100, 0)
    expect(router.route({ host: '127.0.0.1', port: 9000 }, 0)).toEqual({ kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }] })
  })

  it('drops traffic from peers that never announced themselves', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); expect(router.route({ host: '10.0.0.9', port: 5000 }, 0)).toEqual({ kind: 'ignore', reason: 'unknown-peer' })
  })

  it('does not route at all while oscUi is disabled', () => {
    const { core, publish } = makeCore({ config: { ...BRIDGE_CONFIG, oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 } } }); core.start(); core.handleOscIn({ address: OSCDESK.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })

  it('stops routing once the runtime is stopped', () => {
    const { core, publish } = makeCore(); core.start(); core.stop(); core.handleOscIn({ address: '/avatar/position', args: [], from: { host: '127.0.0.1', port: 9000 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })
})
