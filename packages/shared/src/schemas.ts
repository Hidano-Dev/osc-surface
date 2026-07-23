import { z } from 'zod'

const nonNegativeInt = z.number().int().nonnegative()
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
  entries: z.array(ManifestEntrySchema),
})

export const SurfaceStatusSchema = z.object({
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lastPongSeq: nonNegativeInt.nullable(),
})

export const SurfaceConfigSchema = z.object({
  unity: z.object({
    host: z.string().min(1),
    sendPort: z.number().int().min(1).max(65535),
    receivePort: z.number().int().min(1).max(65535),
  }),
  debug: z.boolean(),
  boolFallbackToInt: z.boolean(),
})

export type StatsPayload = z.infer<typeof StatsPayloadSchema>
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>
export type SurfaceConfig = z.infer<typeof SurfaceConfigSchema>
