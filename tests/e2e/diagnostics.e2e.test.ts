import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { DiagnosticsSnapshotSchema, OSCDESK_DIAG, type OscArg } from '../../packages/shared/src'
import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { createOscTestClient, type OscTestClient } from './helpers/osc-client'
import { reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('guard and diagnostics E2E', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let wsClient: WsE2eClient | undefined
  let oscClient: OscTestClient | undefined
  let tempDir: string | undefined

  afterEach(async () => {
    await wsClient?.close().catch(() => undefined)
    await oscClient?.close().catch(() => undefined)
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    if (tempDir !== undefined) await fs.rm(tempDir, { recursive: true, force: true })
    wsClient = undefined
    oscClient = undefined
    bridge = undefined
    tempDir = undefined
  })

  test('rejects a mismatched manifest, records the guard event, and answers diagnostics', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oscdesk-guard-e2e-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'oscdesk.config.json')
    const unityPort = await reserveUdpPort()
    const wsPort = await reserveUdpPort()
    const oscListenPort = await reserveUdpPort()

    await fs.writeFile(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: unityPort },
      bridge: { oscListenHost: '127.0.0.1', oscListenPort, wsHost: '127.0.0.1', wsPort },
      ui: { host: '127.0.0.1', port: await reserveUdpPort() },
      debug: true,
      boolFallbackToInt: false,
      expectedProjectId: 'osc-surface-demo',
      diagnostics: {
        ringBufferSize: 200,
        lossRateWindow: 30,
        ndjsonDir: logDir,
        ndjsonMaxTotalBytes: 52_428_800,
      },
      oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
    }), 'utf8')

    await startMockUnity(unityPort, oscListenPort, mockHarness)
    bridge = await startBridge({ configPath, readyTimeoutMs: 30_000 })
    wsClient = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    const rejection = await wsClient.waitForFrame(
      frame => frame.type === 'link' && frame.lastRejection?.receivedProjectId === 'other-project',
      15_000,
    )
    expect(rejection.type).toBe('link')
    expect(rejection.lastRejection).toMatchObject({
      reason: 'project-mismatch',
      receivedProjectId: 'other-project',
    })

    const guardFiles = await waitForNdjsonFiles(logDir)
    const guardRecords = (await fs.readFile(path.join(logDir, guardFiles.find(file => file.startsWith('osc-guard-'))!), 'utf8'))
      .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    expect(guardRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'guard-reject',
        expectedProjectId: 'osc-surface-demo',
        receivedProjectId: 'other-project',
      }),
    ]))

    oscClient = await createOscTestClient()
    const response = await oscClient.request({
      to: { host: '127.0.0.1', port: bridge.ready.oscListenPort },
      message: { address: OSCDESK_DIAG.REQUEST, args: [] },
      expectAddress: OSCDESK_DIAG.SNAPSHOT,
      timeoutMs: 5_000,
    })
    const snapshotArg = response.args[0]
    expect(snapshotArg?.type).toBe('s')
    expect(DiagnosticsSnapshotSchema.parse(JSON.parse((snapshotArg as Extract<OscArg, { type: 's' }>).value))).toEqual(expect.objectContaining({
      recentMessages: expect.any(Array),
    }))
  })
})

async function startMockUnity(listenPort: number, replyPort: number, harness: ProcessHarness): Promise<ManagedProcess> {
  return harness.start({
    command: process.execPath,
    args: [
      path.resolve('packages/mock-unity/dist/mock-unity.js'),
      '--listen-port', String(listenPort),
      '--reply-host', '127.0.0.1',
      '--reply-port', String(replyPort),
      '--scenario', path.resolve('packages/mock-unity/scenarios/wrong-project.json'),
    ],
    readyPattern: /MOCK_UNITY_READY/,
    readyTimeoutMs: 10_000,
  })
}

async function waitForNdjsonFiles(dir: string): Promise<string[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const files = (await fs.readdir(dir)).filter(file => file.endsWith('.ndjson'))
      if (files.length > 0) return files
    } catch { /* writer has not created the directory yet */ }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for NDJSON files in ${dir}.`)
}
