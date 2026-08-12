import { z } from 'zod'

import { ManifestSchema } from './schemas'

export const WIRE_PROTOCOL_VERSION = 1 as const

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const WireArgSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('i'), value: z.number() }),
  strictObject({ type: z.literal('f'), value: z.number() }),
  strictObject({ type: z.literal('s'), value: z.string() }),
  strictObject({ type: z.literal('b'), value: z.string() }),
])

const VersionSchema = z.literal(WIRE_PROTOCOL_VERSION)
const PeerSchema = strictObject({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
})
const OscFrameFields = {
  v: VersionSchema,
  type: z.literal('osc'),
  address: z.string().startsWith('/'),
  args: z.array(WireArgSchema),
}

export const LinkUnityStatusSchema = strictObject({
  reachability: z.enum(['unknown', 'reachable', 'lost']),
  lastRttMs: z.number().nonnegative().nullable(),
  consecutiveLosses: z.number().int().nonnegative(),
  lastPongSeq: z.number().int().nonnegative().nullable(),
})

export const LinkManifestStatusSchema = z.discriminatedUnion('state', [
  strictObject({ state: z.literal('none') }),
  strictObject({
    state: z.literal('accepted'),
    projectId: z.string(),
    entryCount: z.number().int().nonnegative(),
  }),
])

export const LinkRejectionSchema = strictObject({
  ts: z.string().datetime({ offset: true }),
  reason: z.enum(['project-mismatch', 'schema-error', 'json-parse-error']),
  detail: z.string(),
  receivedProjectId: z.string().nullable(),
})

const HelloFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('hello'),
  clientId: z.string(),
  protocolVersion: z.number().int(),
  server: strictObject({ name: z.string(), version: z.string() }),
  unity: strictObject({ host: z.string(), sendPort: z.number().int().min(1).max(65535) }),
  bridge: strictObject({
    oscListenPort: z.number().int().min(1).max(65535),
    wsPort: z.number().int().min(1).max(65535),
  }),
  expectedProjectId: z.string().nullable(),
  heartbeat: strictObject({ intervalMs: z.number().positive(), timeoutMs: z.number().positive() }),
  pingIntervalMs: z.number().positive(),
  debug: z.boolean(),
})

const ManifestFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('manifest'),
  manifest: ManifestSchema,
})

const DownstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  from: PeerSchema,
})

const LinkFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('link'),
  unity: LinkUnityStatusSchema,
  manifest: LinkManifestStatusSchema,
  lastRejection: LinkRejectionSchema.nullable(),
})

const HeartbeatFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeat'),
  t: z.number(),
})

const NoticeFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  detail: z.string(),
})

export const DownstreamFrameSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  ManifestFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
])

const UpstreamOscFrameSchema = strictObject(OscFrameFields)
const ManifestRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('manifestRequest') })
const HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeatAck'),
  t: z.number(),
})

export const UpstreamFrameSchema = z.discriminatedUnion('type', [
  UpstreamOscFrameSchema,
  ManifestRequestFrameSchema,
  HeartbeatAckFrameSchema,
])

export type WireArg = z.infer<typeof WireArgSchema>
export type DownstreamFrame = z.infer<typeof DownstreamFrameSchema>
export type UpstreamFrame = z.infer<typeof UpstreamFrameSchema>
export type LinkUnityStatus = z.infer<typeof LinkUnityStatusSchema>
export type LinkManifestStatus = z.infer<typeof LinkManifestStatusSchema>
export type LinkRejection = z.infer<typeof LinkRejectionSchema>

export type FrameRejectReason = 'invalid-json' | 'schema-error'
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export function parseUpstreamFrame(raw: string): Result<UpstreamFrame, FrameRejectReason> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }

  const result = UpstreamFrameSchema.safeParse(value)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: 'schema-error' }
}
