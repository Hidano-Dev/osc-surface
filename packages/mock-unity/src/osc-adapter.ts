import osc = require('osc')

import type {
  OscArg,
  OscBundlePacket,
  OscMessagePacket,
  OscPacket,
  OscTimeTag,
} from '@oscdesk/shared'

const OSC_READ_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false,
} as const

const OSC_WRITE_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false,
} as const

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

export class OscDecodeError extends Error {
  readonly cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'OscDecodeError'
    this.cause = cause
  }
}

export function encodeOscPacket(packet: OscPacket): Uint8Array {
  return osc.writePacket(toOscJsPacket(packet), OSC_WRITE_OPTIONS)
}

export function decodeOscPacket(data: Uint8Array): OscPacket {
  try {
    const packet = osc.readPacket(data, OSC_READ_OPTIONS) as OscJsMessage | OscJsBundle
    return fromOscJsPacket(packet)
  } catch (error) {
    throw new OscDecodeError('Failed to decode OSC packet.', error)
  }
}

function toOscJsPacket(packet: OscPacket): OscJsMessage | OscJsBundle {
  if (isBundlePacket(packet)) {
    return {
      timeTag: {
        raw: [packet.timeTag.seconds, packet.timeTag.fractions],
        native: packet.timeTag.native,
      },
      packets: packet.packets.map(toOscJsPacket),
    }
  }

  return {
    address: packet.address,
    args: packet.args.map((arg) => ({
      type: arg.type,
      value: arg.value,
    })),
  }
}

function fromOscJsPacket(packet: OscJsMessage | OscJsBundle): OscPacket {
  if (isOscJsBundle(packet)) {
    return {
      timeTag: normalizeTimeTag(packet.timeTag),
      packets: packet.packets.map(fromOscJsPacket),
    }
  }

  const args = normalizeArgs(packet.args)

  return {
    address: packet.address,
    args,
  }
}

function normalizeTimeTag(timeTag: OscJsBundle['timeTag']): OscTimeTag {
  const [seconds, fractions] = timeTag.raw ?? [0, 1]

  return {
    seconds,
    fractions,
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
      throw new Error(`Unsupported OSC type tag "${arg.type}" in Phase 1 adapter.`)
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

function isBundlePacket(packet: OscPacket): packet is OscBundlePacket {
  return 'timeTag' in packet && 'packets' in packet
}

function isOscJsBundle(packet: OscJsMessage | OscJsBundle): packet is OscJsBundle {
  return 'timeTag' in packet && 'packets' in packet
}

export type { OscArg, OscBundlePacket, OscMessagePacket, OscPacket, OscTimeTag }
