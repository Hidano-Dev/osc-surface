import { describe, expect, it } from 'vitest'

import type { Manifest } from '@osc-surface/shared'

import { ManifestClient } from './manifest-client'

const VALID_MANIFEST: Manifest = {
  version: 1,
  entries: [
    {
      address: '/avatar/blend/smile',
      label: 'Smile',
      type: 'f',
      widget: 'fader',
      range: [0, 1],
      default: 0.25,
      group: 'Face',
    },
  ],
}

describe('ManifestClient', () => {
  it('requests immediately and keeps retrying at the configured interval until a manifest is accepted', () => {
    const client = new ManifestClient({ requestIntervalMs: 2000 })

    expect(client.shouldRequest(0)).toBe(true)

    client.onRequestSent(0)

    expect(client.shouldRequest(1999)).toBe(false)
    expect(client.shouldRequest(2000)).toBe(true)

    const accepted = client.onManifestPayload(JSON.stringify(VALID_MANIFEST))

    expect(accepted).toEqual({
      accepted: true,
      manifest: VALID_MANIFEST,
    })
    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(4000)).toBe(false)
  })

  it('rejects invalid JSON, keeps the last accepted manifest unchanged, and suppresses repeated logs', () => {
    const client = new ManifestClient()

    const first = client.onManifestPayload('{')
    const second = client.onManifestPayload('{')

    expect(first.accepted).toBe(false)
    if (first.accepted) {
      throw new Error('expected manifest JSON to be rejected')
    }

    expect(first.reason).toBe('json-parse-error')
    expect(first.isRepeat).toBe(false)
    expect(second).toMatchObject({
      accepted: false,
      reason: 'json-parse-error',
      isRepeat: true,
    })
    expect(client.current()).toBeNull()
    expect(client.shouldRequest(0)).toBe(true)
  })

  it('rejects schema-invalid manifests and keeps requesting until a valid payload arrives', () => {
    const client = new ManifestClient()

    const invalidPayload = JSON.stringify({
      version: 1,
      entries: [
        {
          address: '/avatar/blend/smile',
          label: 'Smile',
          type: 'invalid',
          widget: 'fader',
        },
      ],
    })

    const rejected = client.onManifestPayload(invalidPayload)

    expect(rejected).toEqual({
      accepted: false,
      reason: 'schema-error',
      detail: expect.stringContaining('entries.0.type'),
      isRepeat: false,
    })
    expect(client.current()).toBeNull()
    expect(client.shouldRequest(0)).toBe(true)
  })

  it('restarts requesting immediately when reachability recovers after a settled manifest', () => {
    const client = new ManifestClient({ requestIntervalMs: 2000 })

    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    expect(client.shouldRequest(5000)).toBe(false)

    client.onReachabilityRecovered()

    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(5000)).toBe(true)

    client.onRequestSent(5000)
    expect(client.shouldRequest(6999)).toBe(false)
    expect(client.shouldRequest(7000)).toBe(true)
  })

  it('accepts the same manifest again after recovery without re-entering a rejection state', () => {
    const client = new ManifestClient()

    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    client.onReachabilityRecovered()

    const accepted = client.onManifestPayload(JSON.stringify(VALID_MANIFEST))

    expect(accepted).toEqual({
      accepted: true,
      manifest: VALID_MANIFEST,
    })
    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(0)).toBe(false)
  })
})
