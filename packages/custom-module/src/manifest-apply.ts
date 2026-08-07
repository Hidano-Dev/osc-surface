import type { Manifest, ManifestEntry, OscArg } from '@osc-surface/shared'

import type { LayoutIndex } from './layout-index'
import type { LayoutSnapshot } from './layout-snapshot'
import { buildValueSyncArg, getWidgetCatalogEntry } from './widget-catalog'

export interface EditCommand {
  widgetId: string
  props: Record<string, unknown>
}

export interface ValueSync {
  address: string
  arg: OscArg
}

export type PlanSelfHealEvent =
  | {
      kind: 'id-collision'
      address: string
      requestedId: string
      assignedId: string
    }
  | { kind: 'container-injected' }

export interface ApplyPlan {
  edits: EditCommand[]
  valueSyncs: ValueSync[]
  warnings: readonly string[]
  selfHealEvents: readonly PlanSelfHealEvent[]
}

export const DYNAMIC_CONTAINER_ID = 'dynamic'

export function dynamicWidgetId(address: string): string {
  const normalized = address.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.length > 0 ? `dyn_${normalized}` : 'dyn_root'
}

export function buildApplyPlan(manifest: Manifest, layout: LayoutIndex | LayoutSnapshot): ApplyPlan {
  const snapshot = isLayoutSnapshot(layout) ? layout : null
  const layoutIndex: LayoutIndex = snapshot ? snapshot.index : layout
  const warnings = [...layoutIndex.warnings]
  const edits: EditCommand[] = []
  const valueSyncs: ValueSync[] = []
  const dynamicEntries: ManifestEntry[] = []
  const selfHealEvents: PlanSelfHealEvent[] = []
  const usedIds = new Set(layoutIndex.widgetIds ?? [])
  usedIds.add('root')
  usedIds.add(DYNAMIC_CONTAINER_ID)

  for (const entry of manifest.entries) {
    const existingWidgetId = layoutIndex.idByAddress.get(entry.address)

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

  const dynamicWidgets = buildDynamicWidgets(dynamicEntries, warnings, usedIds, selfHealEvents)
  const dynamicContainerCount = snapshot?.dynamicContainerCount ?? 1

  if (dynamicContainerCount === 0 && dynamicEntries.length > 0) {
    edits.unshift({
      widgetId: 'root',
      props: {
        widgets: [
          ...(snapshot?.rootWidgets ?? []),
          {
            type: 'modal',
            id: DYNAMIC_CONTAINER_ID,
            label: 'Generated',
            popupLabel: 'Generated Widgets',
            layout: 'vertical',
            left: '78%',
            top: '92%',
            width: '20%',
            height: 40,
            popupWidth: '80%',
            popupHeight: '80%',
            scroll: true,
            widgets: [],
          },
        ],
      },
    })
    selfHealEvents.unshift({ kind: 'container-injected' })
  }

  if (dynamicContainerCount > 0 || dynamicEntries.length > 0) {
    edits.push({
      widgetId: DYNAMIC_CONTAINER_ID,
      props: { widgets: dynamicWidgets },
    })
  }

  return {
    edits,
    valueSyncs,
    warnings,
    selfHealEvents,
  }
}

function isLayoutSnapshot(layout: LayoutIndex | LayoutSnapshot): layout is LayoutSnapshot {
  return 'index' in layout && 'dynamicContainerCount' in layout && 'rootWidgets' in layout
}

function buildExistingWidgetProps(entry: ManifestEntry, warnings: string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {
    label: entry.label,
  }

  applyRangeProps(props, entry, warnings)

  return props
}

function buildDynamicWidgets(
  entries: readonly ManifestEntry[],
  warnings: string[],
  usedIds: Set<string>,
  selfHealEvents: PlanSelfHealEvent[],
): Record<string, unknown>[] {
  const ungrouped: Record<string, unknown>[] = []
  const grouped = new Map<string, Record<string, unknown>[]>()
  const orderedGroups: string[] = []

  for (const entry of entries) {
    const widget = buildDynamicWidget(entry, warnings, usedIds, selfHealEvents)
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
    const requestedGroupId = `${dynamicWidgetId(`/group/${groupName}`)}_panel`
    const groupId = allocateWidgetId(requestedGroupId, usedIds, selfHealEvents, `/group/${groupName}`)
    const headingId = allocateWidgetId(`${groupId}__heading`, usedIds, selfHealEvents, `/group/${groupName}`)

    widgets.push({
      type: 'panel',
      id: groupId,
      label: groupName,
      layout: 'vertical',
      widgets: [
        {
          type: 'text',
          id: headingId,
          default: groupName,
          interaction: false,
        },
        ...groupWidgets,
      ],
    })
  }

  return widgets
}

function buildDynamicWidget(
  entry: ManifestEntry,
  warnings: string[],
  usedIds: Set<string>,
  selfHealEvents: PlanSelfHealEvent[],
): Record<string, unknown> {
  const definition = getWidgetCatalogEntry(entry.widget)
  const widgetId = allocateWidgetId(dynamicWidgetId(entry.address), usedIds, selfHealEvents, entry.address)
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

function allocateWidgetId(
  requestedId: string,
  usedIds: Set<string>,
  selfHealEvents: PlanSelfHealEvent[],
  address: string,
): string {
  if (!usedIds.has(requestedId)) {
    usedIds.add(requestedId)
    return requestedId
  }

  let suffix = 2
  let assignedId = `${requestedId}_${suffix}`
  while (usedIds.has(assignedId)) {
    suffix += 1
    assignedId = `${requestedId}_${suffix}`
  }

  usedIds.add(assignedId)
  selfHealEvents.push({
    kind: 'id-collision',
    address,
    requestedId,
    assignedId,
  })
  return assignedId
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
