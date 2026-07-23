import path from 'node:path'

import { SurfaceConfigSchema, type SurfaceConfig } from '@osc-surface/shared'
import { ZodError } from 'zod'

export const SURFACE_CONFIG_ENV_VAR = 'OSC_SURFACE_CONFIG'
export const DEFAULT_SURFACE_CONFIG_PATH = path.resolve(
  __dirname,
  '../../../config/surface.config.json',
)

export type JsonLoader = (
  filePath: string,
  errorCallback?: (error: unknown) => void,
) => unknown

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

export function loadSurfaceConfig(
  loader: JsonLoader,
  env: NodeJS.ProcessEnv = process.env,
): SurfaceConfig {
  const filePath = resolveSurfaceConfigPath(env)
  let loadError: unknown

  const raw = loader(filePath, (error) => {
    loadError = error
  })

  if (loadError !== undefined) {
    throw new Error(
      `Failed to load OSC Surface config at "${filePath}": ${formatUnknownError(loadError)}`,
    )
  }

  try {
    return parseSurfaceConfig(raw)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid OSC Surface config at "${filePath}": ${error.message}`)
    }

    throw error
  }
}

function formatConfigValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '<root>'

      return `${pathLabel}: ${issue.message}`
    })
    .join('; ')
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
