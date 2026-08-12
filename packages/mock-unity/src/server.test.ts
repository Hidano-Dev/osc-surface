import dgram from 'node:dgram'

import { afterEach, describe, expect, it } from 'vitest'

import { SYS, StatsPayloadSchema } from '@oscdesk/shared'
import type { OscMessagePacket, OscPacket } from '@oscdesk/shared'
import { decodeOscPacket, encodeOscPacket } from '@oscdesk/osc-codec'

import { startMockUnityServer } from './server'

describe('startMockUnityServer', () => {
  const resources: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    while (resources.length > 0) {
      await resources.pop()?.close()
    }
  })

  it('responds to ping on UDP and uses the incoming sender by default', async () => {
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    const reply = await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: {
        address: SYS.PING,
        args: [{ type: 'i', value: 11 }],
      },
    })

    expect(reply).toEqual({
      address: SYS.PONG,
      args: [{ type: 'i', value: 11 }],
    })
  })

  it('increments parseErrors after malformed datagrams and reports them via /sys/stats', async () => {
    const errors: string[] = []
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      log: {
        error(message: string) {
          errors.push(message)
        },
      },
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    await sendRaw(client.socket, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]), server.listenPort)

    const reply = await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: {
        address: SYS.STATS_REQUEST,
        args: [],
      },
    })

    expect(reply.address).toBe(SYS.STATS)
    expect(reply.args).toHaveLength(1)
    expect(reply.args[0]?.type).toBe('s')

    const payload = StatsPayloadSchema.parse(JSON.parse(String(reply.args[0]?.value)))
    expect(payload.parseErrors).toBe(1)
    expect(payload.received).toBe(1)
    expect(errors[0]).toContain('Failed to decode OSC packet')
  })

  it('sends startup replies after the socket begins listening', async () => {
    const client = await createUdpClient()
    resources.push(client)
    const startup = new Promise<OscPacket>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.socket.off('message', handleMessage)
        reject(new Error('Timed out waiting for startup reply.'))
      }, 2000)
      const handleMessage = (data: Buffer) => {
        clearTimeout(timeout)
        client.socket.off('message', handleMessage)
        resolve(decodeOscPacket(data))
      }
      client.socket.on('message', handleMessage)
    })

    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      replyTarget: {
        host: '127.0.0.1',
        port: client.socket.address().port,
      },
      startupReplies: [
        {
          kind: 'message',
          packet: {
            address: SYS.MANIFEST,
            args: [{ type: 's', value: '{"version":1,"projectId":"osc-surface-demo","entries":[]}' }],
          },
        },
      ],
    })
    resources.push(server)

    const packet = await startup
    expect(packet).toMatchObject({
      address: SYS.MANIFEST,
      args: [{ type: 's', value: expect.stringContaining('"projectId":"osc-surface-demo"') }],
    })
  })
})

async function createUdpClient() {
  const socket = dgram.createSocket('udp4')
  await bindSocket(socket, 0, '127.0.0.1')

  return {
    socket,
    async close() {
      await closeSocket(socket)
    },
  }
}

async function request(
  socket: dgram.Socket,
  options: {
    to: { host: string; port: number }
    packet: OscMessagePacket
  },
) {
  const response = new Promise<OscPacket>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for UDP reply.'))
    }, 2000)

    const handleMessage = (data: Buffer) => {
      cleanup()
      resolve(decodeOscPacket(data))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('message', handleMessage)
    }

    socket.on('message', handleMessage)
  })

  await sendPacket(socket, encodeOscPacket(options.packet), options.to.port, options.to.host)
  const packet = await response

  if (!('address' in packet)) {
    throw new Error('Expected OSC message packet.')
  }

  return packet
}

function sendRaw(socket: dgram.Socket, data: Uint8Array, port: number): Promise<void> {
  return sendPacket(socket, data, port, '127.0.0.1')
}

function sendPacket(socket: dgram.Socket, data: Uint8Array, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(data, port, host, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function bindSocket(socket: dgram.Socket, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      socket.off('listening', handleListening)
      socket.off('error', handleError)
    }

    socket.once('listening', handleListening)
    socket.once('error', handleError)
    socket.bind(port, host)
  })
}

function closeSocket(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve()
    })
  })
}
