import { buildLayoutIndex, type LayoutIndex } from './layout-index'

const DYNAMIC_CONTAINER_ID = 'dynamic'
const DYNAMIC_CONTAINER_TYPES = new Set(['panel', 'modal', 'tab', 'root'])

export interface LayoutSnapshot {
  index: LayoutIndex
  dynamicContainerCount: number
  rootWidgets: readonly Record<string, unknown>[]
  warnings: readonly string[]
}

export type SnapshotRefreshResult =
  | { ok: true; snapshot: LayoutSnapshot }
  | { ok: false; error: string; lastGood: LayoutSnapshot | null }

export interface LayoutSnapshotStore {
  refresh(): SnapshotRefreshResult
  current(): LayoutSnapshot | null
}

export function createLayoutSnapshotStore(deps: { loadLayout: () => unknown }): LayoutSnapshotStore {
  let lastGood: LayoutSnapshot | null = null

  return {
    refresh() {
      try {
        const layout = deps.loadLayout()

        if (!isRecord(layout)) {
          throw new Error('Layout JSON must be an object.')
        }

        const warnings: string[] = []
        const index = buildLayoutIndex(layout, { excludeContainerIds: [DYNAMIC_CONTAINER_ID] })
        warnings.push(...index.warnings)

        const dynamicContainerCount = countDynamicContainers(layout)
        if (dynamicContainerCount > 1) {
          warnings.push(
            `Layout warning: duplicate dynamic container id "${DYNAMIC_CONTAINER_ID}" found ${dynamicContainerCount} times; continuing with all matches.`,
          )
        }

        const rootWidgets = readRootWidgets(layout, warnings)
        const snapshot: LayoutSnapshot = { index, dynamicContainerCount, rootWidgets, warnings }
        lastGood = snapshot
        return { ok: true, snapshot }
      } catch (error) {
        return { ok: false, error: errorMessage(error), lastGood }
      }
    },

    current() {
      return lastGood
    },
  }
}

function readRootWidgets(layout: Record<string, unknown>, warnings: string[]): readonly Record<string, unknown>[] {
  const content = layout.content
  if (!isRecord(content) || !Array.isArray(content.widgets)) {
    warnings.push('Layout content.widgets must be an array; using an empty root widget list.')
    return []
  }

  const rootWidgets: Record<string, unknown>[] = []
  for (const widget of content.widgets) {
    if (isRecord(widget)) {
      rootWidgets.push(widget)
    } else {
      warnings.push('Layout content.widgets contains a non-object widget; ignoring it.')
    }
  }

  return rootWidgets
}

function countDynamicContainers(layout: unknown): number {
  if (!isRecord(layout)) {
    return 0
  }

  let count = 0
  visit(layout, (node) => {
    if (node.id === DYNAMIC_CONTAINER_ID && typeof node.type === 'string' && DYNAMIC_CONTAINER_TYPES.has(node.type)) {
      count += 1
    }
  })
  return count
}

function visit(node: Record<string, unknown>, callback: (node: Record<string, unknown>) => void): void {
  callback(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'address') {
      continue
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isRecord(child)) visit(child, callback)
      }
    } else if (isRecord(value)) {
      visit(value, callback)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
