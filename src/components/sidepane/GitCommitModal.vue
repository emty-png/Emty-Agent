<script setup lang="ts">
import type { useGitWorkspace } from '@/composables/useGitWorkspace'
import type { GitStatusResult } from '@/utils/git'
import { GitBranch, GitCommit, Loader2, ShieldCheck, X } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  status: GitStatusResult | null
  unstagedCount: number
  stagedCount: number
  workspace: ReturnType<typeof useGitWorkspace>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  committed: []
}>()

const {
  commitMsg,
  isCommitting,
  includeUnstaged,
  skipCommitHooks,
  amendCommit,
  commitDisabledReason,
  result,
  commit,
} = props.workspace

function close() {
  if (isCommitting.value)
    return
  emit('update:open', false)
}

async function submit() {
  const success = await commit()
  if (success) {
    emit('update:open', false)
    emit('committed')
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      leave-active-class="transition-opacity duration-100 ease-[cubic-bezier(0.7,0,0.84,0)]"
      enter-from-class="opacity-0 [&_.commit-modal]:scale-[0.96] [&_.commit-modal]:translate-y-1"
      leave-to-class="opacity-0 [&_.commit-modal]:scale-[0.96] [&_.commit-modal]:translate-y-1"
    >
      <div v-if="open" class="fixed inset-0 z-[99999] bg-[color-mix(in_srgb,var(--color-bg-base)_65%,transparent)] flex items-center justify-center p-6" @click.self="close">
        <div class="commit-modal bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-xl) w-full max-w-[480px] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.3)] overflow-hidden [transition:transform_150ms_cubic-bezier(0.16,1,0.3,1)]">
          <!-- Header -->
          <div class="flex flex-col gap-1.5 py-3.5 px-5 border-b border-(--color-border-subtle)">
            <div class="flex items-center gap-2.5">
              <div class="flex items-center justify-center w-6.5 h-6.5 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shrink-0">
                <GitCommit :size="13" class="text-[var(--color-accent)]" />
              </div>
              <span class="flex-1 text-[14px] font-semibold text-[var(--color-text-primary)] truncate">Commit changes</span>
              <button class="inline-flex items-center justify-center w-6 h-6 rounded-(--radius-sm) border-none bg-transparent text-[var(--color-text-tertiary)] cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1),color_100ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.94] active:duration-[80ms] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) shrink-0" @click="close">
                <X :size="13" />
              </button>
            </div>
            <!-- Branch / Files / Remote strip -->
            <div class="flex items-center gap-1.5 pl-[35px] flex-wrap">
              <span class="inline-flex items-center gap-1 py-0.5 px-2 rounded-(--radius-sm) bg-(--color-bg-card) border border-(--color-border-bright) font-mono text-[11px] text-[var(--color-text-primary)]">
                <GitBranch :size="10" class="text-[var(--color-text-tertiary)]" />
                {{ status?.branch || 'main' }}
              </span>
              <span class="text-[var(--color-text-dim)] text-[11px]">·</span>
              <span class="text-[11px] text-[var(--color-text-secondary)]">{{ unstagedCount + stagedCount }} file{{ (unstagedCount + stagedCount) === 1 ? '' : 's' }}</span>
              <template v-if="status?.upstream">
                <span class="text-[var(--color-text-dim)] text-[11px]">·</span>
                <span class="text-[11px] text-[var(--color-text-secondary)]">{{ status.upstream }}</span>
                <template v-if="status.aheadCount > 0 || status.behindCount > 0">
                  <span class="text-[11px]">
                    <span :class="status.aheadCount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-dim)]'">+{{ status.aheadCount }}</span>
                    <span class="text-[var(--color-text-dim)]">/</span>
                    <span :class="status.behindCount > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-dim)]'">{{ status.behindCount }}</span>
                  </span>
                </template>
              </template>
            </div>
          </div>

          <!-- Body -->
          <div class="flex flex-col overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-md)">
            <!-- Options -->
            <div class="mx-5 mt-4 mb-1 rounded-(--radius-lg) bg-(--color-bg-card) border border-(--color-border-bright) overflow-hidden">
              <div class="flex items-center gap-2 px-3.5 py-2 border-b border-(--color-border-subtle)">
                <span class="text-[10.5px] font-bold tracking-[0.06em] uppercase text-[var(--color-text-dim)] select-none">Options</span>
              </div>
              <div class="flex flex-col">
                <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                  <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                    <input v-model="includeUnstaged" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                    <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                    <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                  </span>
                  <div class="flex flex-col min-w-0">
                    <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Include unstaged changes</span>
                    <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Stage all working tree changes before committing</span>
                  </div>
                </label>
                <div class="mx-4 h-px bg-(--color-border-subtle)" />
                <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                  <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                    <input v-model="amendCommit" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                    <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                    <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                  </span>
                  <div class="flex flex-col min-w-0">
                    <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Amend previous commit</span>
                    <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Add staged changes to the last commit</span>
                  </div>
                </label>
                <div class="mx-4 h-px bg-(--color-border-subtle)" />
                <label class="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer [transition:background_100ms_cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--color-state-hover)] group/toggle">
                  <span class="relative shrink-0 w-9 h-5 cursor-pointer">
                    <input v-model="skipCommitHooks" type="checkbox" class="peer absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer">
                    <span class="absolute inset-0 bg-(--color-bg-base) border border-(--color-border-bright) rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] [transition:background_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent) peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]" />
                    <span class="absolute top-[2px] left-[2px] w-4 h-4 bg-(--color-text-primary) rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] [transition:transform_150ms_cubic-bezier(0.4,0,0.2,1)] peer-checked:translate-x-[14px]" />
                  </span>
                  <div class="flex flex-col min-w-0">
                    <span class="text-[12.5px] font-medium text-[var(--color-text-primary)] leading-tight">Skip hooks</span>
                    <span class="text-[10.5px] text-[var(--color-text-dim)] leading-tight mt-0.5">Run commit with --no-verify flag</span>
                  </div>
                </label>
              </div>
              <div v-if="skipCommitHooks" class="flex items-start gap-2 px-3.5 py-2 border-t border-(--color-border-subtle) bg-[color-mix(in_srgb,var(--color-warning)_6%,var(--color-bg-card))]">
                <ShieldCheck :size="12" class="shrink-0 mt-0.5 text-[var(--color-warning)]" />
                <span class="text-[11px] text-[var(--color-text-secondary)] leading-[1.45]">Hooks run until they finish. Skip only when checks have already passed.</span>
              </div>
            </div>

            <!-- Conflict warning -->
            <div v-if="status && status.conflicts.length > 0" class="mx-5 mt-3">
              <div class="py-2.5 px-3 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] border border-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] flex flex-col gap-0.5">
                <div class="font-bold text-[var(--color-danger)] text-[12px]">
                  Conflicts must be resolved
                </div>
                <div class="text-[11.5px] text-[var(--color-text-secondary)]">
                  {{ status.conflicts.length }} conflicted file{{ status.conflicts.length === 1 ? '' : 's' }} need attention.
                </div>
              </div>
            </div>

            <!-- Commit message -->
            <div class="px-5 pt-3 pb-4 flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--color-text-dim)] select-none">Message</span>
                <span class="text-[10px] text-[var(--color-text-dim)] font-medium">optional — auto-generated if blank</span>
              </div>
              <textarea
                v-model="commitMsg"
                class="w-full bg-(--color-bg-card) border border-(--color-border-mid) rounded-(--radius-lg) py-2.5 px-3.5 text-[var(--color-text-primary)] font-[inherit] text-[13px] resize-y min-h-[68px] box-border leading-[1.55] outline-none [transition:border-color_150ms_cubic-bezier(0.4,0,0.2,1),box-shadow_150ms_cubic-bezier(0.4,0,0.2,1)] focus:border-(--color-accent) focus:shadow-[0_0_0_3px_var(--color-accent-muted),0_0_0_1px_var(--color-accent-muted-plus)] placeholder-[var(--color-text-dim)]"
                placeholder="Leave blank to autogenerate…"
                rows="2"
              />

              <div v-if="result && result.type === 'err'" class="py-2 px-3 rounded-(--radius-md) bg-[color-mix(in_srgb,var(--color-danger)_8%,var(--color-bg-card))] border border-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] flex flex-col gap-0.5">
                <div class="font-bold text-[var(--color-danger)] text-[12px]">
                  Commit Failed
                </div>
                <div class="text-[11.5px] text-[var(--color-text-secondary)]">
                  {{ result.text }}
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2.5 py-3 px-5 bg-(--color-bg-surface) border-t border-(--color-border-mid)">
            <button class="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-(--radius-md) text-[12.5px] font-semibold cursor-pointer border border-(--color-border-mid) bg-transparent text-[var(--color-text-secondary)] [transition:background_120ms_cubic-bezier(0.4,0,0.2,1),border-color_120ms_cubic-bezier(0.4,0,0.2,1),color_120ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] active:duration-[80ms] hover:bg-(--color-state-hover) hover:text-(--color-text-primary) hover:border-(--color-border-bright)" @click="close">
              Cancel
            </button>
            <button class="inline-flex items-center justify-center gap-2 h-8 px-5 rounded-(--radius-md) text-[12.5px] font-bold cursor-pointer border border-transparent bg-[var(--color-accent)] text-[var(--color-bg-base)] [transition:opacity_120ms_cubic-bezier(0.4,0,0.2,1),box-shadow_120ms_cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97] active:duration-[80ms] hover:not(:disabled):opacity-90 hover:not(:disabled):shadow-[0_4px_12px_var(--color-accent-muted)] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="isCommitting || !!commitDisabledReason" :title="commitDisabledReason || 'Commit changes'" @click="submit">
              <Loader2 v-if="isCommitting" :size="13" class="animate-[spin_0.9s_linear_infinite]" />
              <GitCommit v-else :size="13" />
              {{ isCommitting ? (commitMsg.trim() ? 'Committing…' : 'Generating…') : 'Commit' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
