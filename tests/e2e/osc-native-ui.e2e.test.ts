import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { OSCDESK } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { createOscTestClient, type OscTestClient } from './helpers/osc-client'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { ProcessHarness, type ManagedProcess } from './helpers/process'

const EVAL_SCENARIO = 'packages/mock-unity/scenarios/touchosc-eval.json'
const LIGHT_ADDRESS = '/stage/light/intensity'

describe('OSC-native UI (TouchOSC role) round trip', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let uiClient: OscTestClient | undefined

  afterEach(async () => {
    await uiClient?.close().catch(() => undefined)
    uiClient = undefined
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('announces on /oscdesk/hello and relays Unity echoes to the peer', async () => {
    const unityPort = await reserveUdpPort()
    const oscListenPort = await reserveUdpPort()
    const uiPort = await reserveUdpPort()

    await startMockUnity(unityPort, oscListenPort)
    bridge = await startBridge({
      configPath: path.resolve('config/oscdesk.touchosc.config.json'),
      unityHost: '127.0.0.1',
      unityPort,
      oscListenPort,
      wsPort: await reserveTcpPort(),
      readyTimeoutMs: 30_000,
    })
    uiClient = await createOscTestClient({ port: uiPort })

    await uiClient.send('127.0.0.1', bridge.ready.oscListenPort, OSCDESK.HELLO, [
      { type: 'i', value: uiPort },
    ])

    const response = await uiClient.request({
      to: { host: '127.0.0.1', port: bridge.ready.oscListenPort },
      message: {
        address: LIGHT_ADDRESS,
        args: [{ type: 'f', value: 200 }],
      },
      expectAddress: LIGHT_ADDRESS,
      timeoutMs: 5_000,
      retries: 2,
    })

    expect(response.args).toEqual([{ type: 'f', value: 200 }])
  }, 60_000)

  test('does not relay from an unannounced peer', async () => {
    const unityPort = await reserveUdpPort()
    const oscListenPort = await reserveUdpPort()

    await startMockUnity(unityPort, oscListenPort)
    bridge = await startBridge({
      configPath: path.resolve('config/oscdesk.touchosc.config.json'),
      unityHost: '127.0.0.1',
      unityPort,
      oscListenPort,
      wsPort: await reserveTcpPort(),
      readyTimeoutMs: 30_000,
    })
    uiClient = await createOscTestClient()

    await expect(
      uiClient.request({
        to: { host: '127.0.0.1', port: bridge.ready.oscListenPort },
        message: {
          address: LIGHT_ADDRESS,
          args: [{ type: 'f', value: 200 }],
        },
        expectAddress: LIGHT_ADDRESS,
        timeoutMs: 1_500,
      }),
    ).rejects.toThrow(/Timed out waiting for OSC response/)
  }, 60_000)

  async function startMockUnity(listenPort: number, replyPort: number): Promise<ManagedProcess> {
    const managed = await mockHarness.start({
      command: process.execPath,
      args: [
        path.resolve('packages/mock-unity/dist/mock-unity.js'),
        '--listen-port', String(listenPort),
        '--reply-host', '127.0.0.1',
        '--reply-port', String(replyPort),
        '--scenario', path.resolve(EVAL_SCENARIO),
      ],
      readyPattern: /^MOCK_UNITY_READY /m,
      readyTimeoutMs: 10_000,
    })

    expect(managed.stdoutSnapshot()).toMatch(/^MOCK_UNITY_READY /m)
    return managed
  }
})
