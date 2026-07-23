import dgram from 'node:dgram'

import { afterEach, describe, expect, test } from 'vitest'

import type { OscArg } from '@osc-surface/shared'

import { createOscTestClient } from './helpers/osc-client'

const osc = require('osc') as {
  readPacket: (data: Uint8Array, options?: { metadata?: boolean; unpackSingleArgs?: boolean }) => {
    address: string
    args?: Array<{ type: string; value: unknown }> | { type: string; value: unknown }
  }
  writePacket: (
    packet: { address: string; args?: Array<{ type: string; value: unknown }> },
    options?: { metadata?: boolean; unpackSingleArgs?: boolean },
  ) => Uint8Array
}

const OSC_CODEC_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false,
} as const

describe('OscTestClient', () => {
  const sockets = new Set<dgram.Socket>()

  afterEach(async () => {
    await Promise.all([...sockets].map(closeSocket))
    sockets.clear()
  })

  test('requestで一致するOSCレスポンスを復元できる', async () => {
    const server = await createServer()
    const client = await createOscTestClient()

    try {
      server.socket.on('message', (buffer, remote) => {
        const packet = osc.readPacket(new Uint8Array(buffer), OSC_CODEC_OPTIONS)
        const incomingArgs = Array.isArray(packet.args) ? packet.args : packet.args === undefined ? [] : [packet.args]

        expect(packet.address).toBe('/probe')
        expect(incomingArgs).toEqual([
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 's', value: 'ready' },
          { type: 'b', value: Uint8Array.from([1, 2, 3]) },
        ])

        const response = osc.writePacket(
          {
            address: '/reply',
            args: [
              { type: 'i', value: 7 },
              { type: 'f', value: 1.5 },
              { type: 's', value: 'ready' },
              { type: 'b', value: Uint8Array.from([1, 2, 3]) },
            ],
          },
          OSC_CODEC_OPTIONS,
        )

        server.socket.send(response, remote.port, remote.address)
      })

      const response = await client.request({
        to: { host: '127.0.0.1', port: server.port },
        message: {
          address: '/probe',
          args: [
            { type: 'i', value: 7 },
            { type: 'f', value: 1.5 },
            { type: 's', value: 'ready' },
            { type: 'b', value: Uint8Array.from([1, 2, 3]) },
          ],
        },
        expectAddress: '/reply',
        timeoutMs: 2_000,
      })

      expect(response).toEqual({
        address: '/reply',
        args: [
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 's', value: 'ready' },
          { type: 'b', value: Uint8Array.from([1, 2, 3]) },
        ],
      })
    } finally {
      await client.close()
    }
  })

  test('requestはタイムアウト時に再送し、sendRawで生バイト列を送れる', async () => {
    const server = await createServer()
    const client = await createOscTestClient()
    const attempts: OscArg[][] = []
    let rawPayload: Uint8Array | undefined

    try {
      server.socket.on('message', (buffer, remote) => {
        try {
          const packet = osc.readPacket(new Uint8Array(buffer), OSC_CODEC_OPTIONS)
          const args = Array.isArray(packet.args) ? packet.args : packet.args === undefined ? [] : [packet.args]
          attempts.push(
            args.map((arg) => {
              switch (arg.type) {
                case 'i':
                case 'f':
                  return { type: arg.type, value: arg.value as number }
                case 's':
                  return { type: 's', value: arg.value as string }
                default:
                  throw new Error(`Unexpected OSC type tag ${arg.type}`)
              }
            }),
          )

          if (attempts.length === 2) {
            const response = osc.writePacket(
              {
                address: '/retried',
                args: [{ type: 'i', value: attempts.length }],
              },
              OSC_CODEC_OPTIONS,
            )

            server.socket.send(response, remote.port, remote.address)
          }
        } catch {
          rawPayload = new Uint8Array(buffer)
        }
      })

      const response = await client.request({
        to: { host: '127.0.0.1', port: server.port },
        message: {
          address: '/retry-me',
          args: [{ type: 'i', value: 1 }],
        },
        expectAddress: '/retried',
        timeoutMs: 100,
        retries: 1,
      })

      expect(response).toEqual({
        address: '/retried',
        args: [{ type: 'i', value: 2 }],
      })
      expect(attempts).toEqual([
        [{ type: 'i', value: 1 }],
        [{ type: 'i', value: 1 }],
      ])

      await client.sendRaw('127.0.0.1', server.port, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
      await waitFor(() => rawPayload !== undefined)

      expect(rawPayload).toEqual(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
    } finally {
      await client.close()
    }
  })

  test('close後は再利用できない', async () => {
    const client = await createOscTestClient()
    await client.close()

    await expect(client.send('127.0.0.1', 9_999, '/after-close', [])).rejects.toThrow(
      'OSC test client is already closed.',
    )
  })

  async function createServer(): Promise<{ socket: dgram.Socket; port: number }> {
    const socket = dgram.createSocket('udp4')
    sockets.add(socket)

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', () => {
        socket.off('error', reject)
        resolve()
      })
    })

    const address = socket.address()
    if (typeof address === 'string') {
      throw new Error('Expected UDP server to bind to an IPv4 address.')
    }

    return { socket, port: address.port }
  }
})

async function closeSocket(socket: dgram.Socket): Promise<void> {
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

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!assertion()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting after ${timeoutMs}ms.`)
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
