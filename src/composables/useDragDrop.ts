import type { Attachment } from '@/stores/chat/attachment-types'
import { nextTick, onUnmounted, ref } from 'vue'
import { readFileFromPath } from '@/utils/attachments'

export interface DragPreview {
  id: string
  name: string
  path: string
}

/**
 * Manages drag-and-drop via Tauri's native `onDragDropEvent`.
 *
 * DOM drag events are swallowed by Tauri's webview, so we use the
 * Tauri API which provides file paths on drop.
 */
export function useDragDrop(
  options?: { onFilesDropped?: (attachments: Attachment[]) => void },
) {
  const isDragging = ref(false)
  const dragPreviews = ref<DragPreview[]>([])
  const isReading = ref(false)

  let unlisten: (() => void) | null = null

  function nameFromPath(p: string): string {
    return p.split(/[\\/]/).pop() ?? 'file'
  }

  async function init() {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    unlisten = await getCurrentWebview().onDragDropEvent(event => {
      const { type } = event.payload

      if (type === 'enter') {
        const paths = event.payload.paths
        isReading.value = false
        isDragging.value = true
        dragPreviews.value = paths.map((p, i) => ({
          id: `${p}-${i}`,
          name: nameFromPath(p),
          path: p,
        }))
      }
      else if (type === 'over') {
        // no-op
      }
      else if (type === 'drop') {
        const paths = event.payload.paths
        // Keep overlay visible while reading files
        isReading.value = true

        if (paths.length > 0) {
          ;(async () => {
            const attachments: Attachment[] = []
            for (const p of paths) {
              try {
                attachments.push(await readFileFromPath(p))
              }
              catch (err) {
                console.warn('[useDragDrop] Failed to read:', p, err)
              }
            }
            // Add to store first, then hide overlay
            if (attachments.length > 0)
              options?.onFilesDropped?.(attachments)
            await nextTick()
            isDragging.value = false
            isReading.value = false
            dragPreviews.value = []
          })()
        }
        else {
          isDragging.value = false
          isReading.value = false
          dragPreviews.value = []
        }
      }
      else if (type === 'leave') {
        if (!isReading.value) {
          isDragging.value = false
          dragPreviews.value = []
        }
      }
    })
  }

  init()

  onUnmounted(() => {
    unlisten?.()
  })

  return {
    isDragging,
    dragPreviews,
    isReading,
  }
}
