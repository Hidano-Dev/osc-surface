import { describe, expect, it } from 'vitest'

import type { OscPacket } from '@oscdesk/shared'

import { OscDecodeError, decodeOscPacket, encodeOscPacket } from './osc-codec'

describe('encodeOscPacket / decodeOscPacket', () => {
  it('round-trips scalar OSC argument types with metadata preserved', () => {
    const packet: OscPacket = {
      address: '/sys/echo',
      args: [
        { type: 'i', value: 7 },
        { type: 'f', value: 3.5 },
        { type: 's', value: 'surface' },
        { type: 'b', value: Uint8Array.from([1, 2, 3, 4]) },
      ],
    }

    const encoded = encodeOscPacket(packet)
    const decoded = decodeOscPacket(encoded)

    expect(decoded).toEqual(packet)
  })

  it('keeps single-argument messages as arrays on decode', () => {
    const encoded = encodeOscPacket({
      address: '/sys/ping',
      args: [{ type: 'i', value: 42 }],
    })

    const decoded = decodeOscPacket(encoded)

    expect('address' in decoded && decoded.args).toEqual([{ type: 'i', value: 42 }])
  })

  it('round-trips nested bundles with time tags', () => {
    const packet: OscPacket = {
      timeTag: {
        seconds: 123,
        fractions: 456,
      },
      packets: [
        {
          address: '/sys/ping',
          args: [{ type: 'i', value: 1 }],
        },
        {
          timeTag: {
            seconds: 321,
            fractions: 654,
          },
          packets: [
            {
              address: '/sys/blob',
              args: [{ type: 'b', value: Uint8Array.from([9, 8, 7]) }],
            },
          ],
        },
      ],
    }

    const encoded = encodeOscPacket(packet)
    const decoded = decodeOscPacket(encoded)

    expect(decoded).toEqual(packet)
  })

  it('wraps malformed packet decode failures in OscDecodeError', () => {
    expect(() => decodeOscPacket(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toThrow(
      OscDecodeError,
    )

    try {
      decodeOscPacket(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
    } catch (error) {
      expect(error).toBeInstanceOf(OscDecodeError)
      expect((error as OscDecodeError).cause).toBeInstanceOf(Error)
    }
  })
})
