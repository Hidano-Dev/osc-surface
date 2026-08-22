import dgram from 'node:dgram'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeOscPacket } from '@oscdesk/osc-codec'

import { startUdpTransport } from './udp-transport'

const sockets: dgram.Socket[] = []

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => closeSocket(socket)))
})

describe('UdpTransport', () => {
  it('starts on a real port and receives messages with source information', async () => {
    const received: unknown[] = []
    const transport = await startUdpTransport({
      host: '127.0.0.1',
      port: 0,
      onMessage: (message) => received.push(message),
      onDecodeError: vi.fn(),
      onSocketError: vi.fn(),
    })

    transport.send('127.0.0.1', transport.port, '/test', [{ type: 'i', value: 7 }])
    await waitFor(() => received.length === 1)

    expect(received[0]).toMatchObject({ address: '/test', args: [{ type: 'i', value: 7 }] })
    expect(received[0]).toMatchObject({ from: { host: '127.0.0.1', port: transport.port } })
    await transport.close()
  })

  it('emits bundle messages in order and reports malformed packets without stopping', async () => {
    const received: unknown[] = []
    const onDecodeError = vi.fn()
    const transport = await startUdpTransport({
      host: '127.0.0.1',
      port: 0,
      onMessage: (message) => received.push(message),
      onDecodeError,
      onSocketError: vi.fn(),
    })
    const sender = await createSocket()

    sender.send(Buffer.from([0xde, 0xad]), transport.port, '127.0.0.1')
    await waitFor(() => onDecodeError.mock.calls.length === 1)
    sender.send(encodeOscPacket({ timeTag: { seconds: 0, fractions: 1 }, packets: [
      { address: '/first', args: [] },
      { address: '/second', args: [] },
    ] }), transport.port, '127.0.0.1')
    await waitFor(() => received.length === 2)

    expect(received.map((message) => (message as { address: string }).address)).toEqual(['/first', '/second'])
    await transport.close()
  })

  it('propagates bind failure', async () => {
    const occupied = await createSocket()
    const address = occupied.address()
    if (typeof address === 'string') throw new Error('Expected UDP address information')
    await expect(startUdpTransport({
      host: '127.0.0.1',
      port: address.port,
      onMessage: vi.fn(),
      onDecodeError: vi.fn(),
      onSocketError: vi.fn(),
    })).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})

async function createSocket(): Promise<dgram.Socket> {
  const socket = dgram.createSocket('udp4')
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('listening', () => resolve())
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1')
  })
  return socket
}

function closeSocket(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for UDP event')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
