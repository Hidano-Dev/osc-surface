import { describe, expect, it } from 'vitest'

import {
  ADDRESSES,
  DiagnosticsSnapshotSchema,
  ManifestSchema,
  SelfHealEventRecordSchema,
  INTERNAL_PREFIXES,
  isInternalAddress,
  isOscdeskAddress,
  OSCDESK,
  OSCDESK_DIAG,
  SYS,
  BridgeConfigSchema,
  SurfaceStatusSchema,
} from './index'
import type { ProtocolAddress } from './index'

describe('shared entrypoint', () => {
  it('exports sys, oscdesk, and diagnostics address constants', () => {
    expect(SYS.PING).toBe('/sys/ping')
    expect(OSCDESK.HELLO).toBe('/oscdesk/hello')
    expect(OSCDESK.STATUS_REQUEST).toBe('/oscdesk/status/request')
    expect(OSCDESK.STATUS).toBe('/oscdesk/status')
    expect(OSCDESK.MANIFEST_REQUEST).toBe('/oscdesk/manifest/request')
    expect(OSCDESK.MANIFEST).toBe('/oscdesk/manifest')
    expect(OSCDESK_DIAG.REQUEST).toBe('/oscdesk/diag/request')
    expect(OSCDESK_DIAG.SNAPSHOT).toBe('/oscdesk/diag')
    expect(ADDRESSES).toEqual({ SYS, OSCDESK, OSCDESK_DIAG })
  })

  it('classifies internal and oscdesk addresses separately', () => {
    expect(INTERNAL_PREFIXES).toEqual(['/sys/', '/oscdesk/'])
    expect(isInternalAddress('/sys/ping')).toBe(true)
    expect(isInternalAddress('/oscdesk/hello')).toBe(true)
    expect(isInternalAddress('/user/value')).toBe(false)
    expect(isOscdeskAddress('/oscdesk/hello')).toBe(true)
    expect(isOscdeskAddress('/sys/ping')).toBe(false)
  })

  it('re-exports shared contract schemas from the package entrypoint', () => {
    expect(ManifestSchema.shape.version.value).toBe(1)
    expect(SurfaceStatusSchema.shape.consecutiveLosses).toBeDefined()
    expect(BridgeConfigSchema.shape.unity).toBeDefined()
    expect(DiagnosticsSnapshotSchema.shape.recentMessages).toBeDefined()
    expect(SelfHealEventRecordSchema.shape.healKind).toBeDefined()
  })

  it('accepts sys, oscdesk, and diagnostics addresses as protocol addresses', () => {
    const addresses: ProtocolAddress[] = [SYS.STATS, OSCDESK.STATUS, OSCDESK_DIAG.SNAPSHOT]
    expect(addresses).toEqual(['/sys/stats', '/oscdesk/status', '/oscdesk/diag'])
  })
})
