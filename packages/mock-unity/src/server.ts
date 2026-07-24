import dgram from 'node:dgram'

import type { RemoteInfo, Socket } from 'node:dgram'

import { type OscMessagePacket, type OscPacket } from '@osc-surface/shared'

import { OscDecodeError, decodeOscPacket, encodeOscPacket } from './osc-adapter'
import { type MockUnityReply, MockUnityResponder } from './responder'

export interface ReplyTarget {
  host: string
  port: number
}

export interface MockUnityServerOptions {
  listenPort: number
  replyTarget?: ReplyTarget
  host?: string
  responder?: MockUnityResponder
  log?: Pick<Console, 'error'>
}

export interface MockUnityServer {
  readonly listenPort: number
  close(): Promise<void>
}

export async function startMockUnityServer(options: MockUnityServerOptions): Promise<MockUnityServer> {
  const socket = dgram.createSocket('udp4')
  const responder = options.responder ?? new MockUnityResponder()
  const host = options.host ?? '0.0.0.0'
  const log = options.log ?? console

  await bindSocket(socket, options.listenPort, host)

  socket.on('message', (data, remote) => {
    void handleIncomingPacket({
      data,
      remote,
      socket,
      responder,
      replyTarget: options.replyTarget,
      log,
    })
  })

  socket.on('error', (error) => {
    log.error(`[mock-unity] UDP socket error: ${formatError(error)}`)
  })

  const address = socket.address()
  const listenPort = typeof address === 'string' ? options.listenPort : address.port

  return {
    listenPort,
    async close() {
      await closeSocket(socket)
    },
  }
}

interface IncomingPacketContext {
  data: Uint8Array
  remote: RemoteInfo
  socket: Socket
  responder: MockUnityResponder
  replyTarget?: ReplyTarget
  log: Pick<Console, 'error'>
}

async function handleIncomingPacket(context: IncomingPacketContext): Promise<void> {
  let packet: OscPacket

  try {
    packet = decodeOscPacket(context.data)
  } catch (error) {
    if (error instanceof OscDecodeError) {
      context.responder.recordParseError()
      context.log.error(`[mock-unity] Failed to decode OSC packet: ${formatError(error.cause)}`)
      return
    }

    throw error
  }

  const replies = context.responder.handlePacket(packet)
  const target = context.replyTarget ?? {
    host: context.remote.address,
    port: context.remote.port,
  }

  for (const reply of replies) {
    await sendReply(context.socket, reply, target.port, target.host)
  }
}

function bindSocket(socket: Socket, port: number, host: string): Promise<void> {
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

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve()
    })
  })
}

function sendPacket(socket: Socket, payload: Uint8Array, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, host, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function sendReply(
  socket: Socket,
  reply: MockUnityReply,
  port: number,
  host: string,
): Promise<void> {
  if (reply.delayMs !== undefined && reply.delayMs > 0) {
    await wait(reply.delayMs)
  }

  const payload = reply.kind === 'message' ? encodeOscPacket(reply.packet) : reply.payload
  await sendPacket(socket, payload, port, host)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

export function isOscMessagePacket(packet: OscPacket): packet is OscMessagePacket {
  return 'address' in packet
}
