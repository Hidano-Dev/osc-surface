import { describe, expect, it } from 'vitest'

import {
  ADDRESSES,
  DiagnosticsSnapshotSchema,
  ManifestSchema,
  SelfHealEventRecordSchema,
  SURFACE,
  SURFACE_DIAG,
  SYS,
  SurfaceConfigSchema,
  SurfaceStatusSchema,
} from './index'
import type { ProtocolAddress } from './index'

describe('shared entrypoint', () => {
  it('exports sys, surface, and diagnostics address constants', () => {
    expect(SYS.PING).toBe('/sys/ping')
    expect(SURFACE.STATUS_REQUEST).toBe('/surface/status/request')
    expect(SURFACE_DIAG.REQUEST).toBe('/surface/diag/request')
    expect(SURFACE_DIAG.SELF_HEAL).toBe('/surface/diag/self-heal')
    expect(ADDRESSES).toEqual({
      SYS,
      SURFACE,
      SURFACE_DIAG,
    })
  })

  it('re-exports shared contract schemas from the package entrypoint', () => {
    expect(ManifestSchema.shape.version.value).toBe(1)
    expect(SurfaceStatusSchema.shape.consecutiveLosses).toBeDefined()
    expect(SurfaceConfigSchema.shape.unity).toBeDefined()
    expect(DiagnosticsSnapshotSchema.shape.recentMessages).toBeDefined()
    expect(SelfHealEventRecordSchema.shape.healKind).toBeDefined()
  })

  it('accepts sys, surface, and diagnostics addresses as protocol addresses', () => {
    const addresses: ProtocolAddress[] = [SYS.STATS, SURFACE.STATUS, SURFACE_DIAG.SNAPSHOT]

    expect(addresses).toEqual(['/sys/stats', '/surface/status', '/surface/diag'])
  })
})
