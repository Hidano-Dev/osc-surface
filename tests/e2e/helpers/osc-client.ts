import dgram from 'node:dgram'

import type { AddressInfo } from 'node:dgram'

import type { OscArg, OscMessagePacket, OscPacket } from '@osc-surface/shared'

const osc = require('osc') as {
  readPacket: (data: Uint8Array | ArrayBuffer, options?: OscCodecOptions) => OscJsMessage | OscJsBundle
  writePacket: (packet: OscJsMessage | OscJsBundle, options?: OscCodecOptions) => Uint8Array
}

const OSC_CODEC_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false,
} as const

type OscCodecOptions = {
  metadata?: boolean
  unpackSingleArgs?: boolean
}

type OscJsArg = {
  type: string
  value: unknown
}

type OscJsMessage = {
  address: string
  args?: OscJsArg[] | OscJsArg
}

type OscJsBundle = {
  timeTag: {
    raw?: [number, number]
    native?: number
  }
  packets: Array<OscJsMessage | OscJsBundle>
}

interface RequestOptions {
  to: { host: string; port: number }
  message: { address: string; args: OscArg[] }
  expectAddress: string
  timeoutMs: number
  retries?: number
}

export interface OscTestClient {
  send(host: string, port: number, address: string, args: OscArg[]): Promise<void>
  request(options: RequestOptions): Promise<OscMessagePacket>
  sendRaw(host: string, port: number, data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export async function createOscTestClient(bind?: { host?: string; port?: number }): Promise<OscTestClient> {
  const socket = dgram.createSocket('udp4')
  await bindSocket(socket, bind?.port ?? 0, bind?.host ?? '127.0.0.1')
  return new UdpOscTestClient(socket)
}

class UdpOscTestClient implements OscTestClient {
  readonly #socket: dgram.Socket
  #closed = false

  constructor(socket: dgram.Socket) {
    this.#socket = socket
  }

  async send(host: string, port: number, address: string, args: OscArg[]): Promise<void> {
    await this.sendRaw(host, port, encodePacket({ address, args }))
  }

  async request(options: RequestOptions): Promise<OscMessagePacket> {
    const retries = options.retries ?? 0
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const responsePromise = this.waitForResponse(options.expectAddress, options.timeoutMs)

      await this.send(
        options.to.host,
        options.to.port,
        options.message.address,
        options.message.args,
      )

      try {
        return await responsePromise
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    throw lastError ?? new Error('OSC request failed without an error.')
  }

  async sendRaw(host: string, port: number, data: Uint8Array): Promise<void> {
    this.assertOpen()

    await new Promise<void>((resolve, reject) => {
      this.#socket.send(data, port, host, (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#closed = true

    await new Promise<void>((resolve, reject) => {
      this.#socket.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private waitForResponse(expectAddress: string, timeoutMs: number): Promise<OscMessagePacket> {
    this.assertOpen()

    return new Promise<OscMessagePacket>((resolve, reject) => {
      const onMessage = (buffer: Buffer) => {
        let packet: OscPacket

        try {
          packet = decodePacket(new Uint8Array(buffer))
        } catch {
          return
        }

        for (const message of collectMessages(packet)) {
          if (message.address === expectAddress) {
            cleanup()
            resolve(message)
            return
          }
        }
      }

      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }

      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for OSC response "${expectAddress}" after ${timeoutMs}ms.`))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        this.#socket.off('message', onMessage)
        this.#socket.off('error', onError)
      }

      this.#socket.on('message', onMessage)
      this.#socket.on('error', onError)
    })
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new Error('OSC test client is already closed.')
    }
  }
}

function encodePacket(packet: OscMessagePacket): Uint8Array {
  return osc.writePacket(
    {
      address: packet.address,
      args: packet.args.map((arg) => ({ type: arg.type, value: arg.value })),
    },
    OSC_CODEC_OPTIONS,
  )
}

function decodePacket(data: Uint8Array): OscPacket {
  return fromOscJsPacket(osc.readPacket(data, OSC_CODEC_OPTIONS))
}

function fromOscJsPacket(packet: OscJsMessage | OscJsBundle): OscPacket {
  if (isOscJsBundle(packet)) {
    return {
      timeTag: {
        seconds: packet.timeTag.raw?.[0] ?? 0,
        fractions: packet.timeTag.raw?.[1] ?? 1,
        native: packet.timeTag.native,
      },
      packets: packet.packets.map(fromOscJsPacket),
    }
  }

  return {
    address: packet.address,
    args: normalizeArgs(packet.args),
  }
}

function normalizeArgs(args: OscJsMessage['args']): OscArg[] {
  if (args === undefined) {
    return []
  }

  const entries = Array.isArray(args) ? args : [args]
  return entries.map(normalizeArg)
}

function normalizeArg(arg: OscJsArg): OscArg {
  switch (arg.type) {
    case 'i':
      return { type: 'i', value: requireNumber(arg, Number.isInteger, 'int32') }
    case 'f':
      return { type: 'f', value: requireNumber(arg, Number.isFinite, 'float32') }
    case 's':
      if (typeof arg.value !== 'string') {
        throw new Error(`Expected OSC string for type tag "s", received ${typeof arg.value}.`)
      }
      return { type: 's', value: arg.value }
    case 'b':
      return { type: 'b', value: toUint8Array(arg.value) }
    default:
      throw new Error(`Unsupported OSC type tag "${arg.type}" in test client.`)
  }
}

function requireNumber(
  arg: OscJsArg,
  validator: (value: number) => boolean,
  label: string,
): number {
  if (typeof arg.value !== 'number' || !validator(arg.value)) {
    throw new Error(`Expected OSC ${label} for type tag "${arg.type}".`)
  }

  return arg.value
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  throw new Error('Expected OSC blob payload to be binary data.')
}

function collectMessages(packet: OscPacket): OscMessagePacket[] {
  if ('address' in packet) {
    return [packet]
  }

  return packet.packets.flatMap(collectMessages)
}

function isOscJsBundle(packet: OscJsMessage | OscJsBundle): packet is OscJsBundle {
  return 'timeTag' in packet && 'packets' in packet
}

async function bindSocket(socket: dgram.Socket, port: number, host: string): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('listening', onListening)
      reject(error)
    }

    const onListening = () => {
      socket.off('error', onError)
      resolve()
    }

    socket.once('error', onError)
    socket.once('listening', onListening)
    socket.bind(port, host)
  })

  return socket.address() as AddressInfo
}
