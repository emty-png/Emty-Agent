import type { Attachment } from '@/stores/chat/attachment-types'
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/attachment-types'
import { openFileDialog, readFileAsAttachment } from '@/utils/attachments'

/**
 * Owns the active tab's attachment list — adding files via the file dialog,
 * drag/drop-style FileList input, or pasted images — plus which attachment
 * (if any) is currently open in the preview modal.
 */
export function useChatAttachments() {
  const chat = useChatStore()

  const attachments = computed({
    get: () => chat.activeTab.draft.attachments,
    set: value => chat.updateTabDraft(chat.activeTab.id, { attachments: value }),
  })

  const previewAttachment = ref<Attachment | null>(null)

  async function addFiles(files: FileList | File[]) {
    const nextAttachments = [...attachments.value]
    for (const file of files) {
      try { nextAttachments.push(await readFileAsAttachment(file)) }
      catch (err) { console.warn('[ChatInput] Failed to read file:', file.name, err) }
    }
    attachments.value = nextAttachments
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id)
  }

  function onPaste(e: ClipboardEvent) {
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
    }
    if (imageFiles.length > 0)
      addFiles(imageFiles)
  }

  async function handleOpenFileDialog() {
    const newAttachments = await openFileDialog()
    attachments.value = [...attachments.value, ...newAttachments]
  }

  return {
    attachments,
    previewAttachment,
    addFiles,
    removeAttachment,
    onPaste,
    handleOpenFileDialog,
  }
}
