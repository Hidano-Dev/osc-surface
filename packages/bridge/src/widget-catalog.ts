import type { ManifestEntry, OscArg } from '@oscdesk/shared'

export type CatalogRangeMode = 'range' | 'xy' | null

export interface WidgetCatalogEntry {
  widgetType: string
  baseProps: Readonly<Record<string, unknown>>
  rangeMode: CatalogRangeMode
}

export const WIDGET_CATALOG: Readonly<Record<ManifestEntry['widget'], WidgetCatalogEntry>> = {
  fader: {
    widgetType: 'fader',
    baseProps: {},
    rangeMode: 'range',
  },
  button: {
    widgetType: 'button',
    baseProps: {
      mode: 'push',
    },
    rangeMode: 'range',
  },
  toggle: {
    widgetType: 'button',
    baseProps: {
      mode: 'toggle',
      on: 1,
      off: 0,
    },
    rangeMode: 'range',
  },
  xy: {
    widgetType: 'xy',
    baseProps: {},
    rangeMode: 'xy',
  },
  text: {
    widgetType: 'text',
    baseProps: {
      interaction: false,
    },
    rangeMode: null,
  },
} as const

export const WIDGET_FALLBACK_BY_VALUE_TYPE: Readonly<Record<ManifestEntry['type'], ManifestEntry['widget']>> = {
  i: 'fader',
  f: 'fader',
  s: 'text',
  b: 'text',
  bool: 'toggle',
} as const

export function getWidgetCatalogEntry(widget: ManifestEntry['widget']): WidgetCatalogEntry {
  return WIDGET_CATALOG[widget]
}

export function buildValueSyncArg(entry: ManifestEntry): { arg: OscArg | null; warnings: readonly string[] } {
  const warnings: string[] = []

  switch (entry.type) {
    case 'i': {
      if (typeof entry.default !== 'number') {
        return { arg: null, warnings }
      }

      if (!Number.isInteger(entry.default)) {
        warnings.push(`Skipping value sync for "${entry.address}" because type "i" requires an integer default.`)
        return { arg: null, warnings }
      }

      return { arg: { type: 'i', value: entry.default }, warnings }
    }

    case 'f': {
      if (typeof entry.default !== 'number') {
        return { arg: null, warnings }
      }

      return { arg: { type: 'f', value: entry.default }, warnings }
    }

    case 's': {
      if (typeof entry.default !== 'string') {
        return { arg: null, warnings }
      }

      return { arg: { type: 's', value: entry.default }, warnings }
    }

    case 'bool': {
      if (typeof entry.default === 'boolean') {
        return { arg: { type: 'i', value: entry.default ? 1 : 0 }, warnings }
      }

      if (typeof entry.default === 'number' && Number.isInteger(entry.default) && (entry.default === 0 || entry.default === 1)) {
        return { arg: { type: 'i', value: entry.default }, warnings }
      }

      if (entry.default !== undefined) {
        warnings.push(`Skipping value sync for "${entry.address}" because type "bool" requires a boolean or 0/1 default.`)
      }

      return { arg: null, warnings }
    }

    case 'b': {
      if (entry.default !== undefined) {
        warnings.push(`Skipping value sync for "${entry.address}" because type "b" is not supported for UI value sync.`)
      }

      return { arg: null, warnings }
    }
  }
}
