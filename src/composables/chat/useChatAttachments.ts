import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/core/attachmentTypes'
import { useSettingsStore } from '@/stores/settings'
import { openFileDialog, readFileAsAttachment } from '@/utils/attachments'

/**
 * Owns the active tab's attachment list — adding files via the file dialog,
 * drag/drop-style FileList input, or pasted images — plus which attachment
 * (if any) is currently open in the preview modal.
 */
export function useChatAttachments() {
  const chat = useChatStore()
  const settings = useSettingsStore()

  const attachments = computed({
    get: () => chat.activeTab.draft.attachments,
    set: value => chat.updateTabDraft(chat.activeTab.id, { attachments: value }),
  })

  const previewAttachment = ref<Attachment | null>(null)

  // Whether the currently selected model advertises vision / attachment support.
  // We still *allow* image drops for non-vision models (the requirement) — the
  // chat input will warn and the serializer will handle fallback. This computed
  // is exported so the UI can surface the warning.
  const activeModelSupportsAttachments = computed(() => {
    const uid = chat.activeTab.modelUid ?? settings.agent.defaultModelUid ?? settings.activeModelUid
    const m = settings.enabledModels.find(x => x.uid === uid) ?? settings.activeModel
    return Boolean(m?.supportsAttachments)
  })

  const hasImageAttachments = computed(() =>
    attachments.value.some(a => a.type === 'image' || isImageMime(a.mimeType)),
  )

  async function addFiles(files: FileList | File[]) {
    // Allow image attachments for *any* model, including those where
    // supportsAttachments === false. Previously dropping an image on a
    // text-only model would be ignored; now we store the image and let
    // ChatInput/ModelPicker surface a warning and offer a model switch.
    const nextAttachments = [...attachments.value]
    for (const file of files) {
      try { nextAttachments.push(await readFileAsAttachment(file)) }
      catch (err: unknown) {
        console.warn('[ChatInput] Failed to read file:', file.name, err instanceof Error ? err.message : err)
      }
    }
    attachments.value = nextAttachments
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id)
  }

  function onPaste(e: ClipboardEvent) {
    // Paste should work for any model, even text-only ones — we allow the image
    // to be attached and rely on the vision warning + serializer fallback.
    const items = e.clipboardData?.items
    if (!items)
      return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          imageFiles.push(
            isImageMime(file.type)
              ? new File([file], `Pasted image.${file.type.split('/')[1] ?? 'png'}`, { type: file.type })
              : file,
          )
        }
      }
      else if (item.type.startsWith('image/')) {
        // Some browsers expose image paste as string item — handle gracefully
        const file = item.getAsFile?.()
        if (file) {
          e.preventDefault()
          imageFiles.push(file)
        }
      }
    }
    if (imageFiles.length > 0)
      addFiles(imageFiles)
  }

  async function handleOpenFileDialog() {
    // File picker is allowed regardless of vision support — images will be
    // attached even for text-only models (warning shown in ChatInput).
    try {
      const newAttachments = await openFileDialog()
      attachments.value = [...attachments.value, ...newAttachments]
    }
    catch (err: unknown) {
      console.warn('Failed to attach files:', err instanceof Error ? err.message : err)
    }
  }

  // Browser-native drop fallback (DataTransfer) — ensures image dropping works
  // outside Tauri's onDragDropEvent (e.g., web preview, or models without
  // native vision). This is the explicit "image dropping for models that don't
  // support it" path.
  async function handleDomDrop(e: DragEvent) {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0)
      return
    e.preventDefault()
    const list: File[] = []
    for (const f of Array.from(files)) {
      // Accept any file; image detection is inside readFileAsAttachment
      list.push(f)
    }
    if (list.length > 0)
      await addFiles(list)
  }

  function handleDomDragOver(e: DragEvent) {
    // Always allow drop, even for non-vision models — we show a warning instead
    // of blocking.
    e.preventDefault()
    if (e.dataTransfer)
      e.dataTransfer.dropEffect = 'copy'
  }

  return {
    attachments,
    previewAttachment,
    activeModelSupportsAttachments,
    hasImageAttachments,
    addFiles,
    removeAttachment,
    onPaste,
    handleOpenFileDialog,
    handleDomDrop,
    handleDomDragOver,
  }
}
