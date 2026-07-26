<script setup lang="ts">
import { Brain, ChevronDown, Eye, Search, Wrench, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const chat = useChatStore()
const s = useSettingsStore()
const { enabledModels } = storeToRefs(s)

const pickerOpen = ref(false)
const pickerSearch = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  pickerOpen.value = true
  pickerSearch.value = ''
  nextTick(() => searchInputRef.value?.focus())
}

function closePicker() {
  pickerOpen.value = false
}

function selectModel(uid: string) {
  chat.setTabModel(chat.activeTab.id, uid)
  closePicker()
}

// ── grouped + filtered models ─────────────────────────────────────────────────
const groupedModels = computed(() => {
  const query = pickerSearch.value.toLowerCase().trim()
  const models = enabledModels.value.filter(
    m => !query
      || m.name.toLowerCase().includes(query)
      || m.providerName.toLowerCase().includes(query),
  )
  const groups = new Map<string, { providerName: string; models: typeof models }>()
  for (const m of models) {
    if (!groups.has(m.providerId))
      groups.set(m.providerId, { providerName: m.providerName, models: [] })
    groups.get(m.providerId)!.models.push(m)
  }
  return [...groups.entries()].map(([id, g]) => ({ providerId: id, ...g }))
})

// ── active model ──────────────────────────────────────────────────────────────
const activeModelUid = computed(() => chat.activeTab.modelUid ?? s.agent.defaultModelUid ?? s.activeModelUid)
const activeModel = computed(
  () => enabledModels.value.find(m => m.uid === activeModelUid.value)
    ?? enabledModels.value[0]
    ?? null,
)
const activeLabel = computed(() => activeModel.value?.name ?? 'No model')

// ── global close ──────────────────────────────────────────────────────────────
function onKeydownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape')
    closePicker()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydownGlobal)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownGlobal)
})

// ── Presentation: Tailwind v4 class strings ─────────────────────────────────
const modelBtnClasses = computed(() => {
  const shared = [
    'flex items-center gap-1.5 h-[30px] pl-2.5 pr-2 border rounded-(--radius-md)',
    'bg-transparent cursor-pointer max-w-[260px]',
    '[transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),border-radius_150ms_cubic-bezier(0.16,1,0.3,1)]',
    'active:scale-[0.97] active:duration-[80ms]',
    'hover:bg-(--color-state-hover) hover:border-(--color-border-mid) hover:rounded-(--radius-lg)',
  ].join(' ')

  return pickerOpen.value
    ? `${shared} bg-(--color-state-hover) border-(--color-border-mid) rounded-(--radius-lg)`
    : `${shared} border-transparent`
})

const chevronClasses = computed(() => {
  const base = 'text-(--color-text-tertiary) shrink-0 [transition:transform_200ms_cubic-bezier(0.4,0,0.2,1)]'
  return pickerOpen.value ? `${base} rotate-180` : base
})

function modelRowClasses(isActive: boolean) {
  const base = [
    'flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 my-[2px] h-[32px] px-2 border',
    'rounded-(--radius-sm) text-left box-border cursor-pointer',
    '[transition:background_100ms_cubic-bezier(0.4,0,0.2,1),border-color_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)]',
  ].join(' ')

  if (isActive) {
    return `${base} bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-text-primary)`
  }
  return `${base} bg-transparent border-transparent text-(--color-text-secondary) `
    + 'hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)'
}
</script>

<template>
  <div class="relative">
    <!-- ── Trigger ──────────────────────────────────────────────────────────── -->
    <button
      :class="modelBtnClasses"
      aria-label="Select model"
      @click="openPicker"
    >
      <Zap v-if="!activeModel" :size="13" :stroke-width="2.5" class="text-(--color-text-tertiary) shrink-0" />
      <span class="text-[13px] font-semibold text-(--color-text-primary) tracking-[0.01em] whitespace-nowrap overflow-hidden text-ellipsis shrink">{{ activeLabel }}</span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        :class="chevronClasses"
      />
    </button>

    <!-- ── Dropdown (always above trigger) ──────────────────────────────────── -->
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
          class="w-[300px] max-h-[300px] bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
        >
          <!-- Search toolbar -->
          <div class="flex items-center gap-1.5 px-2.5 pt-2.5 pb-2 border-b border-(--color-border-mid) shrink-0">
            <div class="relative flex-1">
              <Search :size="13" :stroke-width="2" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none" />
              <input
                ref="searchInputRef"
                v-model="pickerSearch"
                class="w-full h-8 pl-[30px] pr-2.5 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-md) text-(--color-text-primary) text-[12.5px] outline-none box-border [transition:border-color_150ms_cubic-bezier(0.4,0,0.2,1),box-shadow_150ms_cubic-bezier(0.4,0,0.2,1)] placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:shadow-[0_0_0_3px_var(--color-accent-muted),0_0_0_1px_var(--color-accent-muted-plus)]"
                placeholder="Search models…"
              >
            </div>
          </div>

          <!-- Empty: no providers configured -->
          <div v-if="enabledModels.length === 0" class="px-5 py-8 text-center flex flex-col items-center gap-1.5">
            <span class="text-(--color-text-dim) mb-1 opacity-60 flex">
              <Zap :size="22" :stroke-width="1.5" />
            </span>
            <p class="m-0 text-[13px] font-medium text-(--color-text-secondary)">
              No models available
            </p>
            <p class="m-0 text-xs text-(--color-text-tertiary) leading-[1.6]">
              Open Settings → Providers and add a provider key.
            </p>
          </div>

          <!-- Empty: no search results -->
          <div v-else-if="groupedModels.length === 0" class="px-5 py-8 text-center flex flex-col items-center gap-1.5">
            <p class="m-0 text-[13px] font-medium text-(--color-text-secondary)">
              No results for "{{ pickerSearch }}"
            </p>
          </div>

          <!-- Model groups -->
          <div
            v-else
            class="overflow-y-auto overflow-x-hidden flex-1 pt-1.5 pb-2 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-md)"
          >
            <div
              v-for="group in groupedModels"
              :key="group.providerId"
              class="mb-0.5"
            >
              <span class="block px-4 pt-2.5 pb-[5px] text-[11px] font-bold tracking-[0.08em] uppercase text-(--color-text-dim) select-none">{{ group.providerName }}</span>

              <button
                v-for="m in group.models"
                :key="m.uid"
                :class="modelRowClasses(m.uid === activeModel?.uid)"
                @click="selectModel(m.uid)"
              >
                <!-- Model name -->
                <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium tracking-[0.01em]">{{ m.name }}</span>

                <!-- Capability badges -->
                <div class="flex items-center gap-1 shrink-0">
                  <span
                    v-if="m.supportsThinking"
                    class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                  >
                    <Brain :size="11" :stroke-width="2" class="block text-(--color-accent-text)" />
                  </span>

                  <span
                    v-if="m.supportsToolCalls"
                    class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                  >
                    <Wrench :size="11" :stroke-width="2" class="block text-(--color-success-text)" />
                  </span>

                  <span
                    v-if="m.supportsAttachments"
                    class="relative inline-flex items-center justify-center w-5 h-5 rounded-(--radius-xs) cursor-default [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-(--color-state-hover)"
                  >
                    <Eye :size="11" :stroke-width="2" class="block text-(--color-info-text)" />
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Backdrop -->
    <div v-if="pickerOpen" class="fixed inset-0 z-[9999] bg-transparent" @click="closePicker" />
  </div>
</template>
