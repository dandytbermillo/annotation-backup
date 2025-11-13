import { isValidElement } from "react"

import type { AnnotationWorkspaceViewProps } from "@/components/annotation-workspace-view/types"

export type SerializedAnnotationWorkspaceViewProps = ReturnType<
  typeof serializeAnnotationWorkspaceViewProps
>

export function serializeAnnotationWorkspaceViewProps(
  props: AnnotationWorkspaceViewProps,
): Record<string, unknown> {
  return normalizeValue(props, new WeakSet())
}

export function compareAnnotationWorkspaceViewProps(
  legacy: AnnotationWorkspaceViewProps,
  shell: AnnotationWorkspaceViewProps,
) {
  const legacySerialized = serializeAnnotationWorkspaceViewProps(legacy)
  const shellSerialized = serializeAnnotationWorkspaceViewProps(shell)

  return {
    legacy: legacySerialized,
    shell: shellSerialized,
    isEqual: JSON.stringify(legacySerialized) === JSON.stringify(shellSerialized),
  }
}

function normalizeValue(value: unknown, seen: WeakSet<object>): any {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === "function") {
    return "[function]"
  }

  if (isValidElement(value)) {
    return "[react-element]"
  }

  if (value instanceof Map) {
    return {
      __type: "Map",
      entries: Array.from(value.entries()).map(([key, entryValue]) => [
        normalizeValue(key, seen),
        normalizeValue(entryValue, seen),
      ]),
    }
  }

  if (value instanceof Set) {
    return {
      __type: "Set",
      values: Array.from(value.values()).map(entry => normalizeValue(entry, seen)),
    }
  }

  if (Array.isArray(value)) {
    return value.map(entry => normalizeValue(entry, seen))
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]"
    }

    seen.add(value)
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, normalizeValue(entryValue, seen)])
    seen.delete(value)

    return Object.fromEntries(normalizedEntries)
  }

  return value ?? "[unknown]"
}
