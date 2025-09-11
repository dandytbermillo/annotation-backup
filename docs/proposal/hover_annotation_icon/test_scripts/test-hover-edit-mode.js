// Runtime test for hover icon in edit mode (no code changes required)
// Usage: Paste into the browser DevTools console on the page with the editor.
// It logs event delivery and whether annotated spans are detected under the cursor.

(function () {
  const log = (...args) => console.log('[HoverEditTest]', ...args)

  // 1) Check annotated elements exist
  const count = document.querySelectorAll('.annotation, .annotation-hover-target').length
  log('Annotated elements count:', count)
  if (count === 0) {
    log('No .annotation/.annotation-hover-target found. Verify marks/decorations are rendering.')
  }

  // 2) Attach capture-phase listeners on editor and document
  const editor = document.querySelector('.tiptap-editor [contenteditable="true"], .tiptap-editor')
  if (!editor) {
    log('Editor root not found (.tiptap-editor). Will use document fallback only.')
  } else {
    ['pointermove', 'mousemove', 'mouseover'].forEach(ev => editor.addEventListener(ev, e => {
      if (Math.random() < 0.05) log('[ED]', ev, (e.target && (e.target as Element).className) || e.target)
    }, { capture: true }))
  }

  document.addEventListener('pointermove', e => {
    if (Math.random() < 0.02) log('[DOC]', 'pointermove', (e.target && (e.target as Element).className) || e.target)
  }, { capture: true })

  // 3) Hit-test under the pointer and resolve annotation
  const handler = (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const ann = hit && (hit.closest('.annotation, .annotation-hover-target'))
    if (Math.random() < 0.05) {
      log('HIT:', hit && (hit as HTMLElement).className, 'ANN:', !!ann, ann && (ann.getAttribute('data-branch') || ann.getAttribute('data-branch-id')))
    }
  }
  document.addEventListener('pointermove', handler, { capture: true })

  log('Installed runtime hover test listeners. Move the mouse over annotated text while the editor is focused.')
})();

