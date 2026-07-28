import type { Attachment } from '@/stores/chat/core/attachmentTypes'
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { isImageMime } from '@/stores/chat/core/attachmentTypes'
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
    if (chat.activeTab.mode === 'design') {
      console.warn('Attachments are not supported in design mode.')
      return
    }

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
    if (chat.activeTab.mode === 'design') {
      console.warn('Attachments are not supported in design mode.')
      return
    }

    try {
      const newAttachments = await openFileDialog()
      attachments.value = [...attachments.value, ...newAttachments]
    }
    catch (err: unknown) {
      console.warn('Failed to attach files:', err instanceof Error ? err.message : err)
    }
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
