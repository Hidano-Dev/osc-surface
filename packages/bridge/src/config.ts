import fs from 'node:fs'
import path from 'node:path'

import { SurfaceConfigSchema, type Result, type SurfaceConfig } from '@oscdesk/shared'
import { ZodError } from 'zod'

export const SURFACE_CONFIG_ENV_VAR = 'OSC_SURFACE_CONFIG'
export const DEFAULT_SURFACE_CONFIG_PATH = path.resolve(
  __dirname,
  '../../../config/surface.config.json',
)

export type ConfigLoadError =
  | { kind: 'not-found'; path: string }
  | { kind: 'read-failed'; path: string; detail: string }
  | { kind: 'invalid-json'; path: string; detail: string }
  | { kind: 'schema-invalid'; path: string; issues: readonly string[] }

export function formatConfigLoadError(error: ConfigLoadError): string {
  switch (error.kind) {
    case 'not-found':
      return `Config file not found at "${error.path}"`
    case 'read-failed':
      return `Failed to read config at "${error.path}": ${error.detail}`
    case 'invalid-json':
      return `Invalid JSON at "${error.path}": ${error.detail}`
    case 'schema-invalid':
      return `Invalid config at "${error.path}": ${error.issues.join('; ')}`
  }
}

export function resolveSurfaceConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env[SURFACE_CONFIG_ENV_VAR]

  if (typeof configuredPath === 'string' && configuredPath.trim() !== '') {
    return configuredPath.trim()
  }

  return DEFAULT_SURFACE_CONFIG_PATH
}

export function parseSurfaceConfig(raw: unknown): SurfaceConfig {
  const result = SurfaceConfigSchema.safeParse(raw)

  if (result.success) {
    return result.data
  }

  throw new Error(formatConfigValidationError(result.error))
}

export function loadSurfaceConfig(options: {
  path: string
  readFile?: (filePath: string) => string
}): Result<SurfaceConfig, ConfigLoadError> {
  const readFile = options.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf8'))

  let text: string
  try {
    text = readFile(options.path)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return { ok: false, error: { kind: 'not-found', path: options.path } }
    }

    return {
      ok: false,
      error: { kind: 'read-failed', path: options.path, detail: formatUnknownError(error) },
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'invalid-json', path: options.path, detail: formatUnknownError(error) },
    }
  }

  const result = SurfaceConfigSchema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      error: {
        kind: 'schema-invalid',
        path: options.path,
        issues: formatConfigValidationIssues(result.error),
      },
    }
  }

  return { ok: true, value: result.data }
}

function formatConfigValidationError(error: ZodError): string {
  return formatConfigValidationIssues(error).join('; ')
}

function formatConfigValidationIssues(error: ZodError): readonly string[] {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '<root>'

      return `${pathLabel}: ${issue.message}`
    })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
