import type { Manifest, ManifestEntry, OscArg } from '@osc-surface/shared'

import type { LayoutIndex } from './layout-index'
import { buildValueSyncArg, getWidgetCatalogEntry } from './widget-catalog'

export interface EditCommand {
  widgetId: string
  props: Record<string, unknown>
}

export interface ValueSync {
  address: string
  arg: OscArg
}

export interface ApplyPlan {
  edits: EditCommand[]
  valueSyncs: ValueSync[]
  warnings: readonly string[]
}

export const DYNAMIC_CONTAINER_ID = 'dynamic'

export function dynamicWidgetId(address: string): string {
  const normalized = address.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.length > 0 ? `dyn_${normalized}` : 'dyn_root'
}

export function buildApplyPlan(manifest: Manifest, layout: LayoutIndex): ApplyPlan {
  const warnings = [...layout.warnings]
  const edits: EditCommand[] = []
  const valueSyncs: ValueSync[] = []
  const dynamicEntries: ManifestEntry[] = []

  for (const entry of manifest.entries) {
    const existingWidgetId = layout.idByAddress.get(entry.address)

    if (existingWidgetId !== undefined) {
      edits.push({
        widgetId: existingWidgetId,
        props: buildExistingWidgetProps(entry, warnings),
      })
    } else {
      dynamicEntries.push(entry)
    }

    const valueSync = buildValueSyncArg(entry)
    warnings.push(...valueSync.warnings)

    if (valueSync.arg !== null) {
      valueSyncs.push({
        address: entry.address,
        arg: valueSync.arg,
      })
    }
  }

  edits.push({
    widgetId: DYNAMIC_CONTAINER_ID,
    props: {
      widgets: buildDynamicWidgets(dynamicEntries, warnings),
    },
  })

  return {
    edits,
    valueSyncs,
    warnings,
  }
}

function buildExistingWidgetProps(entry: ManifestEntry, warnings: string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {
    label: entry.label,
  }

  applyRangeProps(props, entry, warnings)

  return props
}

function buildDynamicWidgets(entries: readonly ManifestEntry[], warnings: string[]): Record<string, unknown>[] {
  const ungrouped: Record<string, unknown>[] = []
  const grouped = new Map<string, Record<string, unknown>[]>()
  const orderedGroups: string[] = []

  for (const entry of entries) {
    const widget = buildDynamicWidget(entry, warnings)
    const groupName = normalizeGroupName(entry.group)

    if (groupName === null) {
      ungrouped.push(widget)
      continue
    }

    if (!grouped.has(groupName)) {
      grouped.set(groupName, [])
      orderedGroups.push(groupName)
    }

    grouped.get(groupName)?.push(widget)
  }

  const widgets = [...ungrouped]

  for (const groupName of orderedGroups) {
    const groupWidgets = grouped.get(groupName) ?? []
    const groupId = `${dynamicWidgetId(`/group/${groupName}`)}_panel`

    widgets.push({
      type: 'panel',
      id: groupId,
      label: groupName,
      layout: 'vertical',
      widgets: [
        {
          type: 'text',
          id: `${groupId}__heading`,
          default: groupName,
          interaction: false,
        },
        ...groupWidgets,
      ],
    })
  }

  return widgets
}

function buildDynamicWidget(entry: ManifestEntry, warnings: string[]): Record<string, unknown> {
  const definition = getWidgetCatalogEntry(entry.widget)
  const widgetId = dynamicWidgetId(entry.address)
  const props: Record<string, unknown> = {
    type: definition.widgetType,
    id: widgetId,
    address: entry.address,
    label: entry.label,
    ...definition.baseProps,
  }

  applyRangeProps(props, entry, warnings)
  applyDefaultProp(props, entry, warnings)

  return props
}

function applyRangeProps(props: Record<string, unknown>, entry: ManifestEntry, warnings: string[]): void {
  if (entry.range === undefined) {
    return
  }

  const definition = getWidgetCatalogEntry(entry.widget)
  const [min, max] = entry.range

  switch (definition.rangeMode) {
    case 'range':
      props.range = { min, max }
      return

    case 'xy':
      props.rangeX = { min, max }
      props.rangeY = { min, max }
      return

    case null:
      warnings.push(`Ignoring range for "${entry.address}" because widget "${entry.widget}" does not support range props.`)
      return
  }
}

function applyDefaultProp(props: Record<string, unknown>, entry: ManifestEntry, warnings: string[]): void {
  if (entry.default === undefined) {
    return
  }

  const valueSync = buildValueSyncArg(entry)
  const nonSyncWarnings = valueSync.warnings.filter((warning) => !warning.includes('value sync'))
  warnings.push(...nonSyncWarnings)

  if (entry.type === 'b') {
    return
  }

  if (entry.type === 'bool') {
    if (valueSync.arg?.type === 'i') {
      props.default = valueSync.arg.value
    }
    return
  }

  if (entry.type === 'i' && valueSync.arg?.type === 'i') {
    props.default = valueSync.arg.value
    return
  }

  if (entry.type === 'f' && valueSync.arg?.type === 'f') {
    props.default = valueSync.arg.value
    return
  }

  if (entry.type === 's' && valueSync.arg?.type === 's') {
    props.default = valueSync.arg.value
  }
}

function normalizeGroupName(group: string | undefined): string | null {
  if (typeof group !== 'string') {
    return null
  }

  const trimmed = group.trim()
  return trimmed.length > 0 ? trimmed : null
}
