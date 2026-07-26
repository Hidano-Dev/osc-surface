import { z } from 'zod'

const nonNegativeInt = z.number().int().nonnegative()
const positiveInt = z.number().int().positive()
const iso8601Timestamp = z.string().datetime({ offset: true })
const oscAddress = z.string().startsWith('/')

export const StatsPayloadSchema = z.object({
  received: nonNegativeInt,
  parseErrors: nonNegativeInt,
  lastReceivedAt: iso8601Timestamp,
})

export const ManifestEntrySchema = z.object({
  address: oscAddress,
  label: z.string(),
  type: z.enum(['i', 'f', 's', 'b', 'bool']),
  widget: z.enum(['fader', 'button', 'toggle', 'xy', 'text']),
  range: z.tuple([z.number(), z.number()]).optional(),
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  group: z.string().optional(),
})

export const ManifestSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  entries: z.array(ManifestEntrySchema),
})

export const SurfaceStatusSchema = z.object({
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lastPongSeq: nonNegativeInt.nullable(),
})

export const RecordedArgSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('value'),
    type: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]),
    truncated: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal('blob'),
    byteLength: nonNegativeInt,
  }),
])

export const MessageRecordSchema = z.object({
  ts: iso8601Timestamp,
  dir: z.enum(['in', 'out']),
  address: oscAddress,
  args: z.array(RecordedArgSchema).readonly(),
  peer: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
})

export const SubnetVerdictSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sameHost'),
  }),
  z.object({
    kind: z.literal('sameSubnet'),
    matchedInterface: z.string().min(1),
  }),
  z.object({
    kind: z.literal('differentSubnet'),
    checkedInterfaces: positiveInt,
  }),
  z.object({
    kind: z.literal('indeterminate'),
    reason: z.enum(['hostname', 'ipv6Destination', 'noIpv4Interface']),
  }),
])

export const ReachabilitySchema = z.enum(['unknown', 'reachable', 'lost'])

export const DiagnosticsSnapshotSchema = z.object({
  reachability: ReachabilitySchema,
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lossRate: z.object({
    windowSize: positiveInt,
    observed: nonNegativeInt,
    lost: nonNegativeInt,
    rate: z.number().min(0).max(1).nullable(),
  }),
  subnet: SubnetVerdictSchema,
  logUsage: z.object({
    totalBytes: nonNegativeInt,
    limitBytes: positiveInt,
    overLimit: z.boolean(),
  }),
  recentMessages: z.array(MessageRecordSchema).readonly(),
})

export const SurfaceDiagnosticsConfigSchema = z
  .object({
    ringBufferSize: z.number().int().min(1).max(10_000).default(200),
    lossRateWindow: z.number().int().min(1).max(1_000).default(30),
    ndjsonDir: z.string().min(1).default('logs/diagnostics'),
    ndjsonMaxTotalBytes: positiveInt.default(52_428_800),
  })
  .default({})

export const SurfaceConfigSchema = z.object({
  unity: z.object({
    host: z.string().min(1),
    sendPort: z.number().int().min(1).max(65535),
    receivePort: z.number().int().min(1).max(65535),
  }),
  debug: z.boolean(),
  boolFallbackToInt: z.boolean(),
  expectedProjectId: z.string().min(1).optional(),
  diagnostics: SurfaceDiagnosticsConfigSchema,
})

export const GuardEventRecordSchema = z.object({
  ts: iso8601Timestamp,
  kind: z.literal('guard-reject'),
  expectedProjectId: z.string().min(1),
  receivedProjectId: z.string().min(1),
  peer: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
})

export type StatsPayload = z.infer<typeof StatsPayloadSchema>
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type GuardEventRecord = z.infer<typeof GuardEventRecordSchema>
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>
export type RecordedArg = z.infer<typeof RecordedArgSchema>
export type MessageRecord = z.infer<typeof MessageRecordSchema>
export type SubnetVerdict = z.infer<typeof SubnetVerdictSchema>
export type Reachability = z.infer<typeof ReachabilitySchema>
export type DiagnosticsSnapshot = z.infer<typeof DiagnosticsSnapshotSchema>
export type SurfaceDiagnosticsConfig = z.infer<typeof SurfaceDiagnosticsConfigSchema>
export type SurfaceConfig = z.infer<typeof SurfaceConfigSchema>
