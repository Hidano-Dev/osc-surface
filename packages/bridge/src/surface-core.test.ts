import { describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  SURFACE,
  SYS,
  type DownstreamFrame,
  type SurfaceConfig,
} from '@oscdesk/shared'

import { OscUiRouter } from './osc-ui-router'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

const BRIDGE_CONFIG: BridgeConfig = {
  unity: { host: '127.0.0.1', sendPort: 9000, receivePort: 9001 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 200,
    lossRateWindow: 30,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
  oscUi: { enabled: true, staticPeers: [], peerTtlMs: 0 },
  bridge: { oscListenPort: 9001, wsPort: 8080 },
}

const VALID_MANIFEST_JSON = JSON.stringify({
  version: 1,
  projectId: 'osc-surface-demo',
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
    expect(recordRejection).toHaveBeenCalledWith(expect.objectContaining({ expectedProjectId: 'expected', receivedProjectId: 'osc-surface-demo' }))
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

  it('fans Unity echo-back out to the registered UI peer', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); router.registerPeer('192.168.0.50', 9100, 0)
    expect(router.route({ host: '127.0.0.1', port: 9000 }, 0)).toEqual({ kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }] })
  })

  it('drops traffic from peers that never announced themselves', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); expect(router.route({ host: '10.0.0.9', port: 5000 }, 0)).toEqual({ kind: 'ignore', reason: 'unknown-peer' })
  })

  it('does not route at all while oscUi is disabled', () => {
    const { core, publish } = makeCore({ config: { ...BRIDGE_CONFIG, oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 } } }); core.start(); core.handleOscIn({ address: SURFACE.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })

  it('stops routing once the runtime is stopped', () => {
    const { core, publish } = makeCore(); core.start(); core.stop(); core.handleOscIn({ address: '/avatar/position', args: [], from: { host: '127.0.0.1', port: 9000 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })
})
