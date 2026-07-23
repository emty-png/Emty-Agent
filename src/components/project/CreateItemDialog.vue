<script setup lang="ts">
import { File, Folder, X } from 'lucide-vue-next'
import { nextTick, onMounted, ref } from 'vue'

defineProps<{
  parentPath: string
  relativeBase?: string
}>()

const emit = defineEmits<{
  create: [type: 'file' | 'folder', name: string]
  close: []
}>()

const itemType = ref<'file' | 'folder'>('file')
const name = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})

function handleSubmit() {
  let trimmed = name.value.trim()
  if (!trimmed)
    return

  // strip leading slash to keep relative
  trimmed = trimmed.replace(/^\/+/, '')

  // block path traversal
  if (trimmed.split(/[/\\]/).includes('..'))
    return

  emit('create', itemType.value, trimmed)
  name.value = ''
  nextTick(() => inputRef.value?.focus())
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    handleSubmit()
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[2000] flex items-start justify-center pt-[20vh]"
    @click.self="emit('close')"
  >
    <div class="w-[320px] rounded-(--radius-lg) border border-(--color-border-mid) bg-(--color-bg-surface) p-[14px] shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)]">
      <!-- header -->
      <div class="mb-[12px] flex items-center justify-between">
        <div class="flex flex-col gap-[2px]">
          <span class="text-[11px] font-bold uppercase tracking-[0.05em] text-(--color-text-dim)">New</span>
          <span v-if="relativeBase" class="text-[10px] text-(--color-text-tertiary) font-mono">{{ relativeBase }}</span>
        </div>
        <button
          class="grid h-[20px] w-[20px] place-items-center rounded-(--radius-sm) border-none bg-transparent text-(--color-text-tertiary) cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)"
          @click="emit('close')"
        >
          <X :size="13" :stroke-width="2" />
        </button>
      </div>

      <!-- segmented toggle -->
      <div class="mb-[10px] flex rounded-(--radius-md) border border-(--color-border-mid) bg-(--color-bg-base) p-[2px]">
        <button
          class="flex flex-1 items-center justify-center gap-[5px] h-[28px] rounded-(--radius-sm) border-none text-[11.5px] font-[500] cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]"
          :class="itemType === 'file'
            ? 'bg-(--color-accent-muted-plus) text-(--color-accent-text)'
            : 'bg-transparent text-(--color-text-tertiary) hover:text-(--color-text-secondary)'"
          @click="itemType = 'file'"
        >
          <File :size="12" :stroke-width="1.8" />
          File
        </button>
        <button
          class="flex flex-1 items-center justify-center gap-[5px] h-[28px] rounded-(--radius-sm) border-none text-[11.5px] font-[500] cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]"
          :class="itemType === 'folder'
            ? 'bg-(--color-accent-muted-plus) text-(--color-accent-text)'
            : 'bg-transparent text-(--color-text-tertiary) hover:text-(--color-text-secondary)'"
          @click="itemType = 'folder'"
        >
          <Folder :size="12" :stroke-width="1.8" />
          Folder
        </button>
      </div>

      <!-- name input -->
      <input
        ref="inputRef"
        v-model="name"
        class="h-[32px] w-full rounded-(--radius-md) border border-(--color-border-bright) bg-(--color-bg-card) px-[10px] text-[12.5px] text-(--color-text-primary) outline-none box-border [transition:border-color_150ms_cubic-bezier(0.4,0,0.2,1),box-shadow_150ms_cubic-bezier(0.4,0,0.2,1)] placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:shadow-[0_0_0_3px_var(--color-accent-muted),0_0_0_1px_var(--color-accent-muted-plus)]"
        :placeholder="itemType === 'file' ? `${relativeBase || ''}filename.ext` : `${relativeBase || ''}folder-name`"
        @keydown="handleKeydown"
      >

      <!-- actions -->
      <div class="mt-[10px] flex justify-end gap-[6px]">
        <button
          class="h-[28px] rounded-(--radius-sm) border border-(--color-border-mid) bg-transparent px-[10px] text-[11.5px] text-(--color-text-secondary) cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),border-color_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary) active:scale-[0.97] active:duration-[80ms]"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          class="h-[28px] rounded-(--radius-sm) border-none bg-(--color-accent-dim) px-[12px] text-[11.5px] font-[500] text-(--color-accent-text) cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:brightness-110 active:scale-[0.97] active:duration-[80ms] disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!name.trim()"
          @click="handleSubmit"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>
