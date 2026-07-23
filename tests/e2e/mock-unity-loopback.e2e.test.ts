import dgram from 'node:dgram'

import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { SURFACE, SYS, StatsPayloadSchema, SurfaceStatusSchema } from '../../packages/shared/src'

import { createOscTestClient } from './helpers/osc-client'
import { ProcessHarness } from './helpers/process'

describe('mock-unity direct loopback', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  afterAll(async () => {
    await harness.stopAll()
  })

  test('test client and mock-unity round-trip ping, echo, and stats after malformed UDP', async () => {
    const listenPort = await reserveUdpPort()

    await harness.start({
      command: process.execPath,
      args: ['packages/mock-unity/dist/mock-unity.js', '--listen-port', String(listenPort)],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })

    const client = await createOscTestClient()

    try {
      const pong = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: SYS.PING,
          args: [{ type: 'i', value: 42 }],
        },
        expectAddress: SYS.PONG,
        timeoutMs: 2_000,
      })

      expect(pong).toEqual({
        address: SYS.PONG,
        args: [{ type: 'i', value: 42 }],
      })

      const echo = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: '/roundtrip/probe',
          args: [
            { type: 'i', value: 7 },
            { type: 'f', value: 1.5 },
            { type: 's', value: 'ready' },
          ],
        },
        expectAddress: '/roundtrip/probe',
        timeoutMs: 2_000,
      })

      expect(echo).toEqual({
        address: '/roundtrip/probe',
        args: [
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 's', value: 'ready' },
        ],
      })

      await client.sendRaw('127.0.0.1', listenPort, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))

      const statsResponse = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: SYS.STATS_REQUEST,
          args: [],
        },
        expectAddress: SYS.STATS,
        timeoutMs: 2_000,
      })

      expect(statsResponse.args).toHaveLength(1)
      expect(statsResponse.args[0]).toMatchObject({ type: 's' })

      const stats = StatsPayloadSchema.parse(JSON.parse(statsResponse.args[0]!.value as string))

      expect(stats.parseErrors).toBeGreaterThanOrEqual(1)
      expect(stats.received).toBe(3)
      expect(Date.parse(stats.lastReceivedAt)).not.toBeNaN()
    } finally {
      await client.close()
    }
  })
})

describe('mock-unity + O-S-C full chain loopback', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  afterAll(async () => {
    await harness.stopAll()
  })

  test('polls surface status until ping/pong succeeds through the custom module', async () => {
    await harness.start({
      command: process.execPath,
      args: [
        'packages/mock-unity/dist/mock-unity.js',
        '--listen-port',
        '9000',
        '--reply-host',
        '127.0.0.1',
        '--reply-port',
        '9001',
      ],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })

    await harness.start({
      command: process.execPath,
      args: [
        'vendor/open-stage-control/app',
        '-n',
        '-p',
        '7080',
        '-o',
        '9001',
        '-s',
        '127.0.0.1:9000',
        '-l',
        'layouts/main.json',
        '-c',
        'packages/custom-module/dist/osc-surface.js',
      ],
      readyPattern: /Server started, app available at/,
      readyTimeoutMs: 30_000,
    })

    const client = await createOscTestClient()

    try {
      const status = await waitForSurfaceStatus(client, 15_000)

      expect(status.lastRttMs).not.toBeNull()
      expect(status.lastRttMs).toBeGreaterThanOrEqual(0)
      expect(status.consecutiveLosses).toBe(0)
      expect(status.lastPongSeq).not.toBeNull()
      expect(status.lastPongSeq).toBeGreaterThanOrEqual(1)
    } finally {
      await client.close()
    }
  })
})

async function reserveUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', () => {
        socket.off('error', reject)
        resolve()
      })
    })

    const address = socket.address()
    if (typeof address === 'string') {
      throw new Error('Expected an IPv4 UDP address while reserving a port.')
    }

    return address.port
  } finally {
    await new Promise<void>((resolve, reject) => {
      socket.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

async function waitForSurfaceStatus(
  client: Awaited<ReturnType<typeof createOscTestClient>>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = SurfaceStatusSchema.parse({
    lastRttMs: null,
    consecutiveLosses: 0,
    lastPongSeq: null,
  })

  while (Date.now() < deadline) {
    let response

    try {
      response = await client.request({
        to: { host: '127.0.0.1', port: 9001 },
        message: {
          address: SURFACE.STATUS_REQUEST,
          args: [],
        },
        expectAddress: SURFACE.STATUS,
        timeoutMs: 500,
        retries: 1,
      })
    } catch {
      await sleep(250)
      continue
    }

    expect(response.args).toHaveLength(1)
    expect(response.args[0]).toMatchObject({ type: 's' })

    lastStatus = SurfaceStatusSchema.parse(JSON.parse(response.args[0]!.value as string))
    if (lastStatus.lastRttMs !== null && lastStatus.consecutiveLosses === 0 && lastStatus.lastPongSeq !== null) {
      return lastStatus
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for full-chain surface status after ${timeoutMs}ms: ${JSON.stringify(lastStatus)}`)
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
