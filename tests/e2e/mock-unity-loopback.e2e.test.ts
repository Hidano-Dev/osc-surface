import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('bridge + mock-unity loopback', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('verifies reachability, manifest acceptance, echo, and recovery after silent Unity', async () => {
    const unityPort = await reserveUdpPort()
    bridge = await startBridge({
      wsPort: await reserveUdpPort(),
      oscListenPort: await reserveUdpPort(),
      unityHost: '127.0.0.1',
      unityPort,
      readyTimeoutMs: 30_000,
    })

    await startMockUnity(unityPort, bridge.ready.oscListenPort)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    const hello = await client.waitForFrame((frame) => frame.type === 'hello')
    expect(hello.type).toBe('hello')

    const reachable = await client.waitForFrame(
      (frame) => frame.type === 'link' && frame.unity.reachability === 'reachable',
      15_000,
    )
    expect(reachable.type).toBe('link')
    expect(reachable.unity.lastPongSeq).toBeGreaterThanOrEqual(1)
    expect(reachable.unity.lastRttMs).toBeGreaterThanOrEqual(0)

    const manifest = await client.waitForFrame(
      (frame) => frame.type === 'manifest' && frame.manifest.projectId === 'oscdesk-demo',
      15_000,
    )
    expect(manifest.type).toBe('manifest')
    expect(manifest.manifest.entries.length).toBeGreaterThan(0)

    client.sendOsc('/avatar/blend/smile', [{ type: 'f', value: 0.6 }])
    const echo = await client.waitForFrame(
      (frame) => frame.type === 'osc' && frame.address === '/avatar/blend/smile',
      5_000,
    )
    expect(echo.type).toBe('osc')
    expect(echo.args).toEqual([{ type: 'f', value: expect.closeTo(0.6, 5) }])

    await mockHarness.stopAll()
    await startMockUnity(unityPort, bridge.ready.oscListenPort, 'silent')

    const lost = await client.waitForFrame(
      (frame) => frame.type === 'link' && frame.unity.reachability === 'lost',
      15_000,
    )
    expect(lost.type).toBe('link')
    expect(lost.unity.consecutiveLosses).toBeGreaterThan(0)

    await mockHarness.stopAll()
    await startMockUnity(unityPort, bridge.ready.oscListenPort)

    const recovered = await client.waitForFrame(
      (frame) => frame.type === 'link' && frame.unity.reachability === 'reachable',
      15_000,
    )
    expect(recovered.type).toBe('link')
    expect(recovered.unity.consecutiveLosses).toBe(0)

    const recoveredManifest = await client.waitForFrame(
      (frame) => frame.type === 'manifest' && frame.manifest.projectId === 'oscdesk-demo',
      15_000,
    )
    expect(recoveredManifest.type).toBe('manifest')
  })

  async function startMockUnity(
    listenPort: number,
    replyPort: number,
    fault?: 'silent',
  ): Promise<ManagedProcess> {
    const args = [
      path.resolve('packages/mock-unity/dist/mock-unity.js'),
      '--listen-port', String(listenPort),
      '--reply-host', '127.0.0.1',
      '--reply-port', String(replyPort),
      '--scenario', path.resolve('packages/mock-unity/scenarios/default.json'),
    ]
    if (fault !== undefined) args.push('--fault', fault)

    return mockHarness.start({
      command: process.execPath,
      args,
      readyPattern: /^MOCK_UNITY_READY /m,
      readyTimeoutMs: 10_000,
    })
  }
})
