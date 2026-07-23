import { describe, expect, it } from 'vitest'

import {
  ADDRESSES,
  ManifestSchema,
  SURFACE,
  SYS,
  SurfaceConfigSchema,
  SurfaceStatusSchema,
} from './index'
import type { ProtocolAddress } from './index'

describe('shared entrypoint', () => {
  it('exports both sys and surface address constants', () => {
    expect(SYS.PING).toBe('/sys/ping')
    expect(SURFACE.STATUS_REQUEST).toBe('/surface/status/request')
    expect(ADDRESSES).toEqual({
      SYS,
      SURFACE,
    })
  })

  it('re-exports shared contract schemas from the package entrypoint', () => {
    expect(ManifestSchema.shape.version.value).toBe(1)
    expect(SurfaceStatusSchema.shape.consecutiveLosses).toBeDefined()
    expect(SurfaceConfigSchema.shape.unity).toBeDefined()
  })

  it('accepts sys and surface addresses as protocol addresses', () => {
    const addresses: ProtocolAddress[] = [SYS.STATS, SURFACE.STATUS]

    expect(addresses).toEqual(['/sys/stats', '/surface/status'])
  })
})
