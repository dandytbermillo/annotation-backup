import { Plugin, PluginKey } from "@tiptap/pm/state"

export const annotationDecorationsKey = new PluginKey("annotationDecorations")

// Minimal AnnotationDecorations plugin placeholder to satisfy collab imports.
// Legacy Yjs builds can swap this file for the full implementation if needed.
export const AnnotationDecorations = () =>
  new Plugin({
    key: annotationDecorationsKey,
    props: {},
  })
