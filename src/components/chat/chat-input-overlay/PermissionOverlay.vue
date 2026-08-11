<script setup lang="ts">
import { ShieldAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const currentPermission = computed(() => chat.activeTab.pendingPermissions[0] ?? null)
const queueCount = computed(() => chat.activeTab.pendingPermissions.length)

const overlayClasses = 'w-full bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) mb-2 flex flex-col overflow-hidden'
const headerClasses = 'flex items-start justify-between gap-3 px-4 pt-4 pb-3'
const headerCopyClasses = 'min-w-0'
const eyebrowClasses = 'inline-block mb-1.5 text-[11px] font-bold tracking-[0.08em] uppercase text-(--color-text-tertiary)'
const titleClasses = 'm-0 text-[14px] font-semibold text-(--color-text-primary) font-mono'

const badgeGroupClasses = 'flex flex-col items-end gap-1 shrink-0'
const badgeClasses = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-warning)_16%,transparent)] text-(--color-text-primary) text-[11px] font-semibold whitespace-nowrap'
const queueBadgeClasses = 'text-[10.5px] font-semibold text-(--color-text-tertiary) whitespace-nowrap'

const argsClasses = 'mx-4 my-0 px-[14px] py-3 rounded-(--radius-md) bg-(--color-state-hover) border border-(--color-border-subtle) text-(--color-text-secondary) text-[12px] leading-[1.5] flex flex-col gap-2'

const actionsClasses = 'flex flex-wrap gap-2 px-4 pt-3.5 pb-4'
const btnBase = 'inline-flex items-center justify-center gap-[7px] min-h-[34px] px-3 border rounded-(--radius-md) text-[12px] font-semibold cursor-pointer transition-[background,color,border-color] duration-[120ms] ease'

const btnDenyClasses = `${btnBase} bg-transparent border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-border-mid))] text-(--color-danger-text) hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]`
const btnDefaultClasses = `${btnBase} bg-transparent border-(--color-border-mid) text-(--color-text-secondary) hover:bg-(--color-state-hover) hover:text-(--color-text-primary)`
const btnPrimaryClasses = `${btnBase} bg-(--color-accent-muted) border-(--color-accent-dim) text-(--color-accent-text) hover:bg-[color-mix(in_srgb,var(--color-accent-muted)_90%,var(--color-bg-base)_10%)]`
</script>

<template>
  <div
    v-if="currentPermission"
    :class="overlayClasses"
    role="dialog"
    aria-modal="false"
    aria-label="Tool permission required"
  >
    <div :class="headerClasses">
      <div :class="headerCopyClasses">
        <span :class="eyebrowClasses">Tool permission required</span>
        <p :class="titleClasses">
          {{ currentPermission.actionTitle }}
        </p>
      </div>
      <div :class="badgeGroupClasses">
        <div :class="badgeClasses">
          <ShieldAlert :size="14" />
          <span>Paused</span>
        </div>
        <div v-if="queueCount > 1" :class="queueBadgeClasses">
          +{{ queueCount - 1 }} more
        </div>
      </div>
    </div>

    <div :class="argsClasses">
      <p
        v-for="(detail, index) in currentPermission.actionDetails"
        :key="`${currentPermission.requestId}-${index}`"
        class="m-0"
      >
        {{ detail }}
      </p>
    </div>

    <div :class="actionsClasses">
      <button
        :class="btnDenyClasses"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'deny', currentPermission.requestId)"
      >
        <span>Deny</span>
      </button>
      <button
        :class="btnDefaultClasses"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'allow-once', currentPermission.requestId)"
      >
        <span>Allow Once</span>
      </button>
      <button
        :class="btnPrimaryClasses"
        type="button"
        @click="chat.submitToolPermission(chat.activeId, 'allow-session', currentPermission.requestId)"
      >
        <span>Allow for this session</span>
      </button>
    </div>
  </div>
</template>
