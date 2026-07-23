import fs from 'node:fs'

import { z } from 'zod'

import {
  ManifestEntrySchema,
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
} from '@osc-surface/shared'

const CHARACTER_NAME_TOKEN = '{characterName}'

const ScenarioCharacterNameSchema = z.object({
  candidates: z.array(z.string().min(1)).min(1),
  randomSuffix: z.boolean().optional(),
})

export const ScenarioSchema = z.object({
  characterName: ScenarioCharacterNameSchema.optional(),
  entries: z.array(ManifestEntrySchema),
  rawManifestOverride: z.string().optional(),
})

export type ScenarioDefinition = z.infer<typeof ScenarioSchema>
export type ScenarioEntry = ManifestEntry

export interface ScenarioRuntimeOptions {
  characterName?: string
  random?: () => number
}

export class ScenarioRuntime {
  readonly characterName: string | null

  readonly #definition: ScenarioDefinition
  readonly #random: () => number
  readonly #values = new Map<string, number | string | boolean>()
  readonly #entriesByAddress: Map<string, ScenarioEntry>

  constructor(definition: ScenarioDefinition, options: ScenarioRuntimeOptions = {}) {
    this.#definition = ScenarioSchema.parse(definition)
    this.#random = options.random ?? Math.random
    this.characterName = resolveCharacterName(this.#definition, options, this.#random)
    this.#entriesByAddress = new Map(this.#definition.entries.map((entry) => [entry.address, entry]))

    for (const entry of this.#definition.entries) {
      if (entry.default !== undefined) {
        this.#values.set(entry.address, resolveEntryValue(entry.default, this.characterName))
      }
    }

    if (this.#definition.rawManifestOverride === undefined) {
      ManifestSchema.parse(this.#buildManifest())
    }
  }

  recordValue(address: string, value: number | string | boolean): void {
    if (address.startsWith('/sys/')) {
      return
    }

    const entry = this.#entriesByAddress.get(address)
    if (!entry || !matchesEntryType(entry, value)) {
      return
    }

    this.#values.set(address, value)
  }

  manifestJson(): string {
    if (this.#definition.rawManifestOverride !== undefined) {
      return this.#definition.rawManifestOverride
    }

    return JSON.stringify(ManifestSchema.parse(this.#buildManifest()))
  }

  #buildManifest(): Manifest {
    return {
      version: 1,
      entries: this.#definition.entries.map((entry) => buildManifestEntry(entry, this.#values, this.characterName)),
    }
  }
}

export function loadScenarioDefinition(filePath: string): ScenarioDefinition {
  const rawJson = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(rawJson) as unknown
  return ScenarioSchema.parse(parsed)
}

function buildManifestEntry(
  entry: ScenarioEntry,
  values: ReadonlyMap<string, number | string | boolean>,
  characterName: string | null,
): ManifestEntry {
  const resolvedEntry: ManifestEntry = {
    ...entry,
    label: replaceCharacterNameToken(entry.label, characterName),
  }

  if (entry.default !== undefined) {
    resolvedEntry.default = values.get(entry.address) ?? resolveEntryValue(entry.default, characterName)
  }

  return resolvedEntry
}

function resolveCharacterName(
  definition: ScenarioDefinition,
  options: ScenarioRuntimeOptions,
  random: () => number,
): string | null {
  if (options.characterName !== undefined) {
    return options.characterName
  }

  if (definition.characterName === undefined) {
    return null
  }

  const candidateIndex = Math.min(
    definition.characterName.candidates.length - 1,
    Math.floor(clampRandom(random()) * definition.characterName.candidates.length),
  )
  const baseName = definition.characterName.candidates[candidateIndex] ?? null

  if (baseName === null) {
    return null
  }

  if (definition.characterName.randomSuffix) {
    return `${baseName}-${String(Math.floor(clampRandom(random()) * 1000)).padStart(3, '0')}`
  }

  return baseName
}

function resolveEntryValue(value: number | string | boolean, characterName: string | null) {
  if (typeof value !== 'string') {
    return value
  }

  return replaceCharacterNameToken(value, characterName)
}

function replaceCharacterNameToken(value: string, characterName: string | null): string {
  return value.replaceAll(CHARACTER_NAME_TOKEN, characterName ?? '')
}

function matchesEntryType(entry: ScenarioEntry, value: number | string | boolean): boolean {
  switch (entry.type) {
    case 'i':
      return typeof value === 'number' && Number.isInteger(value)
    case 'f':
      return typeof value === 'number'
    case 's':
      return typeof value === 'string'
    case 'bool':
      return typeof value === 'boolean'
    case 'b':
      return false
    default:
      return false
  }
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }

  if (value >= 1) {
    return 0.999999999
  }

  return value
}
