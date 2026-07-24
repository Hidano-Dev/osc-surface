import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SurfaceConfigSchema } from '@osc-surface/shared'

import {
  DEFAULT_SURFACE_CONFIG_PATH,
  SURFACE_CONFIG_ENV_VAR,
  loadSurfaceConfig,
  parseSurfaceConfig,
  resolveSurfaceConfigPath,
  type JsonLoader,
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
  it('loads config through the injected loader using the resolved path', () => {
    const seenPaths: string[] = []
    const loader: JsonLoader = (filePath) => {
      seenPaths.push(filePath)

      return {
        unity: {
          host: 'localhost',
          sendPort: 9000,
          receivePort: 9001,
        },
        debug: true,
        boolFallbackToInt: false,
      }
    }

    const config = loadSurfaceConfig(loader, {
      [SURFACE_CONFIG_ENV_VAR]: 'D:/tmp/override.json',
    } as NodeJS.ProcessEnv)

    expect(seenPaths).toEqual(['D:/tmp/override.json'])
    expect(config).toEqual({
      unity: {
        host: 'localhost',
        sendPort: 9000,
        receivePort: 9001,
      },
      debug: true,
      boolFallbackToInt: false,
      diagnostics: {
        ringBufferSize: 200,
        lossRateWindow: 30,
        ndjsonDir: 'logs/diagnostics',
        ndjsonMaxTotalBytes: 52_428_800,
      },
    })
  })

  it('surfaces loader failures with the attempted path', () => {
    const loader: JsonLoader = (filePath, onError) => {
      onError?.(new Error(`ENOENT: ${filePath}`))

      return undefined
    }

    expect(() =>
      loadSurfaceConfig(loader, {
        [SURFACE_CONFIG_ENV_VAR]: 'D:/missing/surface.config.json',
      } as NodeJS.ProcessEnv),
    ).toThrow(
      'Failed to load OSC Surface config at "D:/missing/surface.config.json": ENOENT: D:/missing/surface.config.json',
    )
  })

  it('wraps schema validation failures with the config path', () => {
    const loader: JsonLoader = () => ({
      unity: {
        host: '127.0.0.1',
        sendPort: 70000,
        receivePort: 9001,
      },
      debug: false,
      boolFallbackToInt: false,
    })

    expect(() => loadSurfaceConfig(loader, {} as NodeJS.ProcessEnv)).toThrow(
      `Invalid OSC Surface config at "${DEFAULT_SURFACE_CONFIG_PATH}": unity.sendPort: Number must be less than or equal to 65535`,
    )
  })
})
