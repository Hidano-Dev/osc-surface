import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { SurfaceConfigSchema } from '@oscdesk/shared'

import {
  DEFAULT_SURFACE_CONFIG_PATH,
  SURFACE_CONFIG_ENV_VAR,
  loadSurfaceConfig,
  parseSurfaceConfig,
  resolveSurfaceConfigPath,
} from './config'

describe('resolveSurfaceConfigPath', () => {
  it('uses the environment override when present', () => {
    expect(
      resolveSurfaceConfigPath({
        [SURFACE_CONFIG_ENV_VAR]: 'C:/tmp/custom-surface.config.json',
      } as NodeJS.ProcessEnv),
    ).toBe('C:/tmp/custom-surface.config.json')
  })

  it('falls back to the default repository config path', () => {
    expect(DEFAULT_SURFACE_CONFIG_PATH).toBe(
      path.resolve(__dirname, '../../../config/surface.config.json'),
    )
    expect(resolveSurfaceConfigPath({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SURFACE_CONFIG_PATH)
  })
})

describe('parseSurfaceConfig', () => {
  it('parses a valid runtime config', () => {
    expect(
      parseSurfaceConfig({
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
          receivePort: 9001,
        },
        debug: false,
        boolFallbackToInt: true,
      }),
    ).toEqual(
      SurfaceConfigSchema.parse({
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
          receivePort: 9001,
        },
        debug: false,
        boolFallbackToInt: true,
        diagnostics: {
          ringBufferSize: 200,
          lossRateWindow: 30,
          ndjsonDir: 'logs/diagnostics',
          ndjsonMaxTotalBytes: 52_428_800,
        },
      }),
    )
  })

  it('reports nested validation failures with field paths', () => {
    expect(() =>
      parseSurfaceConfig({
        unity: {
          host: '',
          sendPort: 0,
        },
        debug: 'false',
        boolFallbackToInt: false,
      }),
    ).toThrow(
      'unity.host: String must contain at least 1 character(s); unity.sendPort: Number must be greater than or equal to 1; unity.receivePort: Required; debug: Expected boolean, received string',
    )
  })
})

describe('loadSurfaceConfig', () => {
  const validConfig = {
        unity: {
          host: 'localhost',
          sendPort: 9000,
          receivePort: 9001,
        },
        debug: true,
        boolFallbackToInt: false,
      }

  it('loads config through the injected file reader', () => {
    const readFile = vi.fn(() => JSON.stringify(validConfig))

    const result = loadSurfaceConfig({ path: 'D:/tmp/override.json', readFile })

    expect(readFile).toHaveBeenCalledWith('D:/tmp/override.json')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unity.host).toBe('localhost')
    }
  })

  it('distinguishes a missing file from another read failure', () => {
    const notFound = loadSurfaceConfig({
      path: 'D:/missing/surface.config.json',
      readFile: () => {
        const error = new Error('missing') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      },
    })
    const denied = loadSurfaceConfig({
      path: 'D:/denied/surface.config.json',
      readFile: () => {
        throw new Error('EACCES')
      },
    })

    expect(notFound).toEqual({ ok: false, error: { kind: 'not-found', path: 'D:/missing/surface.config.json' } })
    expect(denied).toEqual({
      ok: false,
      error: { kind: 'read-failed', path: 'D:/denied/surface.config.json', detail: 'EACCES' },
    })
  })

  it('distinguishes invalid JSON from schema validation failures', () => {
    const invalidJson = loadSurfaceConfig({ path: 'invalid.json', readFile: () => '{' })
    const invalidSchema = loadSurfaceConfig({
      path: 'schema.json',
      readFile: () => JSON.stringify({ ...validConfig, unity: { ...validConfig.unity, sendPort: 70000 } }),
    })

    expect(invalidJson).toMatchObject({ ok: false, error: { kind: 'invalid-json', path: 'invalid.json' } })
    expect(invalidSchema).toEqual({
      ok: false,
      error: {
        kind: 'schema-invalid',
        path: 'schema.json',
        issues: ['unity.sendPort: Number must be less than or equal to 65535'],
      },
    })
  })
})
