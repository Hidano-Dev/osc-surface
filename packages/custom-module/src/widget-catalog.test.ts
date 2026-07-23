import { describe, expect, it } from 'vitest'

import type { ManifestEntry } from '@osc-surface/shared'

import {
  buildValueSyncArg,
  getWidgetCatalogEntry,
  WIDGET_CATALOG,
  WIDGET_FALLBACK_BY_VALUE_TYPE,
} from './widget-catalog'

describe('widget-catalog', () => {
  it('exposes the manifest widget to O-S-C widget mapping as data', () => {
    expect(WIDGET_CATALOG.fader).toEqual({
      widgetType: 'fader',
      baseProps: {},
      rangeMode: 'range',
    })
    expect(WIDGET_CATALOG.button).toEqual({
      widgetType: 'button',
      baseProps: { mode: 'push' },
      rangeMode: 'range',
    })
    expect(WIDGET_CATALOG.toggle).toEqual({
      widgetType: 'button',
      baseProps: { mode: 'toggle', on: 1, off: 0 },
      rangeMode: 'range',
    })
    expect(WIDGET_CATALOG.xy).toEqual({
      widgetType: 'xy',
      baseProps: {},
      rangeMode: 'xy',
    })
    expect(WIDGET_CATALOG.text).toEqual({
      widgetType: 'text',
      baseProps: { interaction: false },
      rangeMode: null,
    })
    expect(getWidgetCatalogEntry('toggle')).toBe(WIDGET_CATALOG.toggle)
  })

  it('keeps the future widget fallback map as static data', () => {
    expect(WIDGET_FALLBACK_BY_VALUE_TYPE).toEqual({
      i: 'fader',
      f: 'fader',
      s: 'text',
      b: 'text',
      bool: 'toggle',
    })
  })

  it('builds value sync args from supported defaults and skips binary sync', () => {
    expect(buildValueSyncArg(entry({ type: 'i', default: 2 }))).toEqual({
      arg: { type: 'i', value: 2 },
      warnings: [],
    })
    expect(buildValueSyncArg(entry({ type: 'f', default: 0.25 }))).toEqual({
      arg: { type: 'f', value: 0.25 },
      warnings: [],
    })
    expect(buildValueSyncArg(entry({ type: 's', default: 'Alice' }))).toEqual({
      arg: { type: 's', value: 'Alice' },
      warnings: [],
    })
    expect(buildValueSyncArg(entry({ type: 'bool', default: true }))).toEqual({
      arg: { type: 'i', value: 1 },
      warnings: [],
    })
    expect(buildValueSyncArg(entry({ type: 'bool', default: 0 }))).toEqual({
      arg: { type: 'i', value: 0 },
      warnings: [],
    })
    expect(buildValueSyncArg(entry({ type: 'b', default: 'ignored' }))).toEqual({
      arg: null,
      warnings: ['Skipping value sync for "/avatar/value" because type "b" is not supported for UI value sync.'],
    })
  })

  it('warns when defaults do not match the manifest value type', () => {
    expect(buildValueSyncArg(entry({ type: 'i', default: 1.5 }))).toEqual({
      arg: null,
      warnings: ['Skipping value sync for "/avatar/value" because type "i" requires an integer default.'],
    })
    expect(buildValueSyncArg(entry({ type: 'bool', default: 'true' }))).toEqual({
      arg: null,
      warnings: ['Skipping value sync for "/avatar/value" because type "bool" requires a boolean or 0/1 default.'],
    })
  })
})

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    address: '/avatar/value',
    label: 'Value',
    type: 'f',
    widget: 'fader',
    ...overrides,
  }
}
