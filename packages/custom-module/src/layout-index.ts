export interface LayoutIndex {
  idByAddress: ReadonlyMap<string, string>
  warnings: readonly string[]
}

interface BuildLayoutIndexOptions {
  excludeContainerIds: readonly string[]
}

type JsonRecord = Record<string, unknown>

export function buildLayoutIndex(layoutJson: unknown, options: BuildLayoutIndexOptions): LayoutIndex {
  const idByAddress = new Map<string, string>()
  const warnings: string[] = []
  const excludedIds = new Set(options.excludeContainerIds)

  if (!isRecord(layoutJson)) {
    warnings.push('Layout JSON must be an object; returning an empty index.')
    return { idByAddress, warnings }
  }

  visitNode(layoutJson, '$', excludedIds, idByAddress, warnings)

  return {
    idByAddress,
    warnings,
  }
}

function visitNode(
  node: unknown,
  path: string,
  excludedIds: ReadonlySet<string>,
  idByAddress: Map<string, string>,
  warnings: string[],
): void {
  if (!isRecord(node)) {
    return
  }

  const widgetId = typeof node.id === 'string' ? node.id : null
  if (widgetId !== null && excludedIds.has(widgetId)) {
    return
  }

  const widgets = Array.isArray(node.widgets) ? node.widgets : null
  const resolvedAddress = resolveAddress(node, widgetId, widgets !== null, path, warnings)

  if (widgetId !== null && resolvedAddress !== null) {
    addIndexEntry(resolvedAddress, widgetId, path, idByAddress, warnings)
  }

  if (widgets === null) {
    visitNestedObjects(node, path, excludedIds, idByAddress, warnings)
    return
  }

  for (let index = 0; index < widgets.length; index += 1) {
    visitNode(widgets[index], `${path}.widgets[${index}]`, excludedIds, idByAddress, warnings)
  }

  visitNestedObjects(node, path, excludedIds, idByAddress, warnings)
}

function resolveAddress(
  node: JsonRecord,
  widgetId: string | null,
  isContainer: boolean,
  path: string,
  warnings: string[],
): string | null {
  const rawAddress = node.address

  if (typeof rawAddress === 'string') {
    if (rawAddress === 'auto') {
      if (widgetId === null) {
        warnings.push(`Skipping auto-address widget at ${path} because it has no string id.`)
        return null
      }

      return `/${widgetId}`
    }

    return rawAddress
  }

  if (rawAddress !== undefined) {
    warnings.push(`Skipping widget at ${path} because address must be a string when provided.`)
    return null
  }

  if (isContainer) {
    return null
  }

  if (hasNestedObjectValue(node)) {
    return null
  }

  if (widgetId === null) {
    warnings.push(`Skipping widget at ${path} because it has neither address nor string id.`)
    return null
  }

  return `/${widgetId}`
}

function addIndexEntry(
  address: string,
  widgetId: string,
  path: string,
  idByAddress: Map<string, string>,
  warnings: string[],
): void {
  const existingId = idByAddress.get(address)

  if (existingId !== undefined) {
    warnings.push(
      `Duplicate layout address "${address}" at ${path}; keeping existing widget "${existingId}" and skipping "${widgetId}".`,
    )
    return
  }

  idByAddress.set(address, widgetId)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function visitNestedObjects(
  node: JsonRecord,
  path: string,
  excludedIds: ReadonlySet<string>,
  idByAddress: Map<string, string>,
  warnings: string[],
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'widgets' || key === 'address' || key === 'id') {
      continue
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visitNode(value[index], `${path}.${key}[${index}]`, excludedIds, idByAddress, warnings)
      }
      continue
    }

    visitNode(value, `${path}.${key}`, excludedIds, idByAddress, warnings)
  }
}

function hasNestedObjectValue(node: JsonRecord): boolean {
  return Object.entries(node).some(([key, value]) => {
    if (key === 'address' || key === 'id' || key === 'type') {
      return false
    }

    if (Array.isArray(value)) {
      return value.length > 0
    }

    return isRecord(value)
  })
}
