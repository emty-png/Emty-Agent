<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { ChevronDown, FolderOpen, FolderPlus, FolderX } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from '@/stores/project'

defineProps<{ compact?: boolean }>()

const project = useProjectStore()

const pickerOpen = ref(false)
const picking = ref(false)

const projectName = computed(() => {
  if (!project.projectPath)
    return null
  return project.projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null
})

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}

function closePicker() {
  pickerOpen.value = false
}

function selectProject(path: string) {
  project.setProject(path)
  closePicker()
}

function clearProject() {
  project.clearProject()
  closePicker()
}

async function pickFolder() {
  if (picking.value)
    return
  picking.value = true
  try {
    const selected = await open({
      directory: true,
      recursive: true,
      multiple: false,
      title: 'Open project folder',
    })
    if (typeof selected === 'string') {
      project.addProject(selected)
      closePicker()
    }
  }
  finally {
    picking.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && pickerOpen.value)
    pickerOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ── Tailwind v4 class strings ────────────────────────────────────────────────
const triggerClasses = computed(() => {
  const base = 'flex items-center gap-1.5 h-[28px] px-2 border rounded-(--radius-md) text-[12.5px] cursor-pointer shrink-0 transition-[background,border-color,border-radius] duration-120ms'
  return pickerOpen.value
    ? `${base} bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg) text-(--color-text-secondary)`
    : `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)`
})

function itemClasses(isActive: boolean, variant?: 'new' | 'danger') {
  const base = 'flex items-center gap-2 w-full h-[30px] px-2 border rounded-(--radius-md) text-[12.5px] font-medium cursor-pointer text-left transition-[background,border-color,color] duration-100'

  if (isActive) {
    return `${base} bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary)`
  }
  if (variant === 'new') {
    return `${base} bg-transparent border-transparent text-(--color-accent-text) hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:text-(--color-accent-text)`
  }
  if (variant === 'danger') {
    return `${base} bg-transparent border-transparent text-(--color-danger-text) hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] hover:border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:text-(--color-danger-text)`
  }
  return `${base} bg-transparent border-transparent text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)`
}
</script>

<template>
  <div class="relative flex items-center">
    <!-- Trigger -->
    <button
      :class="triggerClasses"
      aria-label="Select project"
      @click="togglePicker"
    >
      <FolderOpen :size="13" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
      <span v-if="!compact" class="whitespace-nowrap overflow-hidden text-ellipsis">{{ projectName ?? 'Select Project' }}</span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        class="shrink-0 transition-transform duration-200"
        :class="pickerOpen ? 'rotate-180 text-(--color-text-tertiary)' : 'text-(--color-text-tertiary)'"
      />
    </button>

    <!-- Positioned wrapper -->
    <div class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[10000]">
      <Transition
        enter-active-class="transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom"
        enter-from-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
        enter-to-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-active-class="transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)] origin-bottom"
        leave-from-class="opacity-100 [transform:translateY(0)_scale(1)]"
        leave-to-class="opacity-0 [transform:translateY(8px)_scale(0.96)]"
      >
        <div
          v-if="pickerOpen"
          class="w-[210px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_4px_12px_rgba(0,0,0,0.3),0_12px_28px_rgba(0,0,0,0.35)] p-1 flex flex-col gap-0.5"
        >
          <!-- New Project -->
          <button
            :class="itemClasses(false, 'new')"
            :disabled="picking"
            @click="pickFolder"
          >
            <FolderPlus :size="13" :stroke-width="1.8" class="shrink-0" />
            <span>New Project</span>
          </button>

          <!-- Existing projects -->
          <template v-if="project.openProjects.length > 0">
            <div class="h-px bg-(--color-border-mid) mx-1 my-0.5" />
            <button
              v-for="path in project.openProjects"
              :key="path"
              :class="itemClasses(project.projectPath === path)"
              @click="selectProject(path)"
            >
              <FolderOpen :size="13" :stroke-width="1.8" class="shrink-0 text-(--color-text-tertiary)" />
              <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() }}</span>
            </button>
          </template>

          <!-- No Project -->
          <div class="h-px bg-(--color-border-mid) mx-1 my-0.5" />
          <button
            :class="itemClasses(false, 'danger')"
            @click="clearProject"
          >
            <FolderX :size="13" :stroke-width="1.8" class="shrink-0" />
            <span>No Project</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Backdrop -->
    <div v-if="pickerOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="closePicker" />
  </div>
</template>
