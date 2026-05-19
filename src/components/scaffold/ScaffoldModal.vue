<script setup lang="ts">
import type { Component } from 'vue'
import type { Category, ScaffoldOptionChoice, ScaffoldOptions, ScaffoldTemplate } from './templates'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { exists, writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import {
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  FolderOpen,
  LayoutGrid,
  MonitorSmartphone,
  Search,
  Server,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { getDeviconForFramework } from '@/utils/icons'
import ScaffoldDropdown from './ScaffoldDropdown.vue'
import ScaffoldMultiSelect from './ScaffoldMultiSelect.vue'
import { buildCommandLine, joinPath, runScaffold, sanitizeProjectName } from './scaffoldRunner'
import {

  getDefaultOptions,
  getTemplatesForCategory,
  scaffoldCategories,

} from './templates'
import { ASTRO_SVG } from './templates/astro'
import { BUN_SVG } from './templates/bun'
import { DOCUSAURUS_SVG } from './templates/docusaurus'
import { ELECTRON_SVG } from './templates/electron'
import { ELYSIA_SVG } from './templates/elysia'
import { FASTIFY_SVG } from './templates/fastify'
import { HONO_SVG } from './templates/hono'
import { NEXTJS_SVG } from './templates/nextjs'
import { NUXT_SVG } from './templates/nuxt'
import { REMIX_SVG } from './templates/remix'
import { SVELTEKIT_SVG } from './templates/sveltekit'
import { TANSTACK_SVG } from './templates/tanstack-start'
import { TAURI_SVG } from './templates/tauri'
import { TSDOWN_SVG } from './templates/tsdown'
import { VITE_ICONS } from './templates/vite'

const emit = defineEmits<{
  close: []
  success: [payload: { projectPath: string; templateId: string }]
}>()

const step = ref<'browse' | 'configure' | 'progress'>('browse')
const selectedCategory = ref<Category | 'all'>('all')
const searchQuery = ref('')

const categoryIcons: Record<string, Component> = {
  all: LayoutGrid,
  fullstack: Boxes,
  desktop: MonitorSmartphone,
  backend: Server,
  library: BookOpen,
  docs: FolderOpen,
}

const allCategories = computed(() => [
  { id: 'all', label: 'All', icon: categoryIcons.all },
  ...scaffoldCategories.map(c => ({
    id: c.id,
    label: c.label,
    icon: categoryIcons[c.id],
  })),
])

const inProgress = ref(false)

function selectCategory(id: string) {
  if (inProgress.value)
    return
  selectedCategory.value = id as Category | 'all'
  if (step.value !== 'browse') {
    step.value = 'browse'
  }
}
const selectedTemplate = ref<ScaffoldTemplate | null>(null)
const projectName = ref('')
const parentDir = ref('')
const outputLines = ref<{ text: string; type: 'info' | 'command' | 'error' | 'success' }[]>([])
const hadError = ref(false)
const errorMessage = ref('')
const createdPath = ref('')
const options = ref<ScaffoldOptions>({})

/* ── Extra toggle options ──────────────────────────────────────────────── */
const runInstall = ref(true)
const createInRoot = ref(false)
const openAfterInstall = ref(true)

const installLabel = computed(() => {
  const pm = String(options.value.packageManager || 'npm')
  if (pm === 'deno')
    return 'Run Deno Install'
  return `Run ${pm} install`
})
const outputScrollRef = ref<HTMLElement | null>(null)

function closeModal() {
  if (inProgress.value)
    return
  emit('close')
}

function resetSelection() {
  selectedTemplate.value = null
  options.value = {}
  projectName.value = ''
  parentDir.value = ''
  outputLines.value = []
  hadError.value = false
  errorMessage.value = ''
  createdPath.value = ''
  runInstall.value = true
  createInRoot.value = false
  openAfterInstall.value = true
  step.value = 'browse'
}

function selectTemplate(template: ScaffoldTemplate) {
  selectedTemplate.value = template
  options.value = getDefaultOptions(template)
  projectName.value = ''
  parentDir.value = ''
  outputLines.value = []
  hadError.value = false
  errorMessage.value = ''
  createdPath.value = ''
  step.value = 'configure'
}

function goBack() {
  if (inProgress.value)
    return
  if (step.value === 'configure') {
    step.value = 'browse'
    return
  }
  if (step.value === 'progress' && hadError.value) {
    step.value = 'configure'
    return
  }
  step.value = 'browse'
}

function normalizeOptions(template: ScaffoldTemplate) {
  const normalized: ScaffoldOptions = {}
  for (const option of template.options) {
    if (options.value[option.id] !== undefined) {
      normalized[option.id] = options.value[option.id]
      continue
    }
    normalized[option.id] = option.default
  }
  return normalized
}

async function chooseDirectory() {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select a parent directory',
  })

  if (typeof selected === 'string')
    parentDir.value = selected
}

function pushLine(text: string, type: 'info' | 'command' | 'error' | 'success' = 'info') {
  let finalType = type
  if (type === 'info') {
    if (text.startsWith('> '))
      finalType = 'command'
    else if (text.startsWith('✔') || text.startsWith('\u2714') || text.startsWith('\u2728'))
      finalType = 'success'
    else if (text.toLowerCase().includes('error') || text.includes('ERR_') || text.toLowerCase().includes('failed'))
      finalType = 'error'
  }
  outputLines.value.push({ text, type: finalType })
  void nextTick(() => {
    const el = outputScrollRef.value
    if (el)
      el.scrollTop = el.scrollHeight
  })
}

async function onCreate() {
  if (!selectedTemplate.value || inProgress.value)
    return

  const useRoot = createInRoot.value
  const cleanedName = useRoot ? '.' : sanitizeProjectName(projectName.value)
  if (!cleanedName) {
    hadError.value = true
    errorMessage.value = 'Enter a valid project name without path separators or special shell characters.'
    step.value = 'progress'
    outputLines.value = [{ text: errorMessage.value, type: 'error' }]
    return
  }

  if (!parentDir.value) {
    hadError.value = true
    errorMessage.value = 'Pick a parent directory before creating the project.'
    step.value = 'progress'
    outputLines.value = [{ text: errorMessage.value, type: 'error' }]
    return
  }

  const template = selectedTemplate.value
  const normalizedOptions = normalizeOptions(template)

  inProgress.value = true
  hadError.value = false
  errorMessage.value = ''
  createdPath.value = useRoot ? parentDir.value : joinPath(parentDir.value, cleanedName)
  outputLines.value = [
    { text: `Scaffolding ${template.name}...`, type: 'info' },
    { text: `Target: ${createdPath.value}`, type: 'info' },
  ]
  step.value = 'progress'

  try {
    const result = await runScaffold(
      template,
      cleanedName,
      normalizedOptions,
      parentDir.value,
      (_kind, line) => {
        if (!line)
          return
        for (const chunk of line.split(/\r?\n/)) {
          const trimmed = chunk.trim()
          if (!trimmed)
            continue
          // Filter out noisy progress lines from pnpm/npm/etc
          if (trimmed.startsWith('Progress:') || (trimmed.includes('resolved') && trimmed.includes('reused')))
            continue
          pushLine(trimmed)
        }
      },
    )

    if (!result.success) {
      hadError.value = true
      errorMessage.value = `Scaffold exited with code ${result.exitCode ?? 'unknown'}`
      pushLine(errorMessage.value)
      return
    }

    /* Detect silent cancellation (e.g. create-vite exits 0 but does nothing) */
    const combined = (result.stdout + result.stderr).toLowerCase()
    const wasCancelled = combined.includes('operation cancelled') || combined.includes('canceled')
    const hasPkg = await exists(joinPath(createdPath.value, 'package.json'))

    if (wasCancelled || !hasPkg) {
      hadError.value = true
      errorMessage.value = wasCancelled
        ? 'Scaffold was cancelled — the target directory may not be empty.'
        : 'Scaffold completed but no package.json was created.'
      pushLine(errorMessage.value)
      return
    }

    pushLine('')
    pushLine('\u2714 Project scaffolded successfully.')

    /* ── Handle AGENTS.md ────────────────────────────────────────────── */
    if (normalizedOptions.agentsMd) {
      try {
        const agentsMdContent = '# AGENTS.md — Project Guide\n\nThis project was initialized with Next.js. Please follow best practices for App Router and Server Components.'
        const filePath = joinPath(createdPath.value, 'AGENTS.md')
        await writeTextFile(filePath, agentsMdContent)
        pushLine('\u2714 AGENTS.md created.')
      }
      catch (err) {
        console.warn('Failed to create AGENTS.md:', err)
      }
    }

    /* ── Run install if requested ────────────────────────────────────── */
    if (runInstall.value && !template.installsAutomatically) {
      const pm = String(normalizedOptions.packageManager || 'npm')
      const installCmd = pm === 'deno' ? 'deno install' : `${pm} install`
      pushLine('')
      pushLine(`Running ${installCmd}...`)

      const installResult = await runScaffold(
        { ...template, command: installCmd, args: () => [] },
        '',
        normalizedOptions,
        createdPath.value,
        (_kind, line) => {
          if (!line)
            return
          for (const chunk of line.split(/\r?\n/)) {
            const trimmed = chunk.trim()
            if (!trimmed)
              continue
            // Filter out noisy progress lines
            if (trimmed.startsWith('Progress:') || (trimmed.includes('resolved') && trimmed.includes('reused')))
              continue
            pushLine(trimmed)
          }
        },
      )

      if (!installResult.success) {
        hadError.value = true
        errorMessage.value = `Install failed with code ${installResult.exitCode ?? 'unknown'}`
        pushLine(errorMessage.value)
        return
      }

      pushLine('\u2714 Dependencies installed.')
    }

    pushLine('')
    pushLine('\u2728 All done — ready to code!')

    emit('success', {
      projectPath: createdPath.value,
      templateId: template.id,
    })

    /* ── Auto-open if requested ──────────────────────────────────────── */
    if (openAfterInstall.value && !useRoot) {
      try { await openPath(createdPath.value) }
      catch { /* silent */ }
    }
  }
  catch (error) {
    hadError.value = true
    errorMessage.value = error instanceof Error ? error.message : String(error)
    pushLine(errorMessage.value)
  }
  finally {
    inProgress.value = false
  }
}

const filteredTemplates = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return getTemplatesForCategory(selectedCategory.value).filter(template => {
    if (!query)
      return true
    return `${template.name} ${template.description}`.toLowerCase().includes(query)
  })
})

const currentTemplate = computed(() => selectedTemplate.value)

watch(step, async () => {
  await nextTick()
  const el = outputScrollRef.value
  if (el)
    el.scrollTop = el.scrollHeight
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeModal()
    return
  }

  if (event.key === 'Enter' && step.value === 'configure' && !inProgress.value) {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName?.toLowerCase()
    if (tag === 'textarea')
      return
    event.preventDefault()
    void onCreate()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

function getFrameworkSvg(name: string, useFallback = true): string {
  const deviconClass = getDeviconForFramework(name)
  if (deviconClass)
    return deviconClass

  const n = name.toLowerCase()
  if (n === 'electron')
    return ELECTRON_SVG
  if (n === 'tsdown')
    return TSDOWN_SVG
  if (n === 'docusaurus')
    return DOCUSAURUS_SVG
  if (n === 'sveltekit' || n.includes('svelte'))
    return SVELTEKIT_SVG
  if (n === 'hono' || n.includes('hono'))
    return HONO_SVG
  if (n === 'tauri' || n.includes('tauri'))
    return TAURI_SVG
  if (n === 'nuxt' || n.includes('nuxt'))
    return NUXT_SVG
  if (n === 'remix' || n.includes('remix'))
    return REMIX_SVG
  if (n === 'tanstack' || n.includes('tanstack'))
    return TANSTACK_SVG
  if (n === 'astro' || n.includes('astro'))
    return ASTRO_SVG
  if (n === 'bun' || n.includes('bun'))
    return BUN_SVG
  if (n === 'fastify' || n.includes('fastify'))
    return FASTIFY_SVG
  if (n === 'elysia' || n.includes('elysia'))
    return ELYSIA_SVG
  if (n === 'nextjs' || n.includes('next')) {
    // Next.js logo often needs a specific color to pop
    return NEXTJS_SVG.replace('currentColor', 'var(--color-text-primary)')
  }
  if (n === 'vite' || n.includes('vite'))
    return VITE_ICONS.vite
  if (n.includes('react'))
    return VITE_ICONS.react
  if (n.includes('vue'))
    return VITE_ICONS.vue
  if (n.includes('svelte'))
    return VITE_ICONS.svelte
  if (n.includes('solid'))
    return VITE_ICONS.solid
  if (n.includes('preact'))
    return VITE_ICONS.preact
  if (n.includes('lit'))
    return VITE_ICONS.lit
  if (n.includes('qwik'))
    return VITE_ICONS.qwik
  if (n.includes('vanilla'))
    return VITE_ICONS.vanilla

  if (!useFallback)
    return ''
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>'
}

function getOptionChoices(optionId: string) {
  const option = currentTemplate.value?.options.find(o => o.id === optionId)
  if (!option?.choices)
    return []

  return option.choices.map(choice => {
    const icon = getFrameworkSvg(choice.label, false)
    const result: ScaffoldOptionChoice & { icon?: string } = { ...choice }
    if (icon) {
      result.icon = icon
    }
    return result
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="settings-backdrop" @click.self="closeModal" @keydown="onKeydown">
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="New Project">
        <div class="modal-header">
          <span class="modal-title">New Project</span>
          <button class="modal-close" aria-label="Close" @click="closeModal">
            <X :size="14" :stroke-width="2" />
          </button>
        </div>

        <div class="modal-body">
          <nav class="settings-nav">
            <button
              v-for="item in allCategories"
              :key="item.id"
              class="nav-item"
              :class="{ 'nav-item--active': selectedCategory === item.id }"
              :disabled="inProgress"
              @click="selectCategory(item.id)"
            >
              <component :is="item.icon" :size="14" :stroke-width="1.8" class="nav-icon" />
              <span>{{ item.label }}</span>
              <ChevronRight
                :size="12"
                :stroke-width="2"
                class="nav-arrow"
                :class="{ 'nav-arrow--active': selectedCategory === item.id }"
              />
            </button>
          </nav>

          <div class="settings-content">
            <!-- STEP: BROWSE -->
            <template v-if="step === 'browse'">
              <div class="scaffold-toolbar">
                <div class="search-input-wrapper">
                  <Search :size="14" class="search-icon" />
                  <input v-model="searchQuery" class="search-input" type="search" placeholder="Search Vite templates...">
                </div>
              </div>

              <div class="template-grid">
                <button
                  v-for="template in filteredTemplates"
                  :key="template.id"
                  class="template-card"
                  @click="selectTemplate(template)"
                >
                  <div v-if="getFrameworkSvg(template.id).startsWith('<')" class="template-icon" v-html="getFrameworkSvg(template.id)" />
                  <i v-else class="template-icon" :class="getFrameworkSvg(template.id)" style="display:flex;align-items:center;justify-content:center;font-size:32px;" />
                  <div class="template-info">
                    <span class="template-name">{{ template.name }}</span>
                    <span class="template-category">Standard</span>
                  </div>
                </button>

                <div v-if="!filteredTemplates.length" class="empty-state">
                  No templates found.
                </div>
              </div>
            </template>

            <!-- STEP: CONFIGURE -->
            <template v-else-if="step === 'configure' && currentTemplate">
              <div class="configure-header">
                <button class="btn-back" type="button" @click="goBack">
                  <ChevronLeft :size="14" />
                  <span>Back</span>
                </button>
              </div>

              <div class="configure-hero">
                <div v-if="getFrameworkSvg(currentTemplate.id).startsWith('<')" class="configure-hero-icon" v-html="getFrameworkSvg(currentTemplate.id)" />
                <i v-else class="configure-hero-icon" :class="getFrameworkSvg(currentTemplate.id)" style="display:flex;align-items:center;justify-content:center;font-size:64px;" />
                <div class="configure-hero-text">
                  <h3>{{ currentTemplate.name }}</h3>
                  <p>{{ currentTemplate.description }}</p>
                </div>
              </div>

              <form class="configure-form" @submit.prevent="onCreate">
                <div class="form-grid">
                  <label v-if="!createInRoot" class="form-field">
                    <span class="field-label">Project name</span>
                    <input
                      v-model="projectName"
                      type="text"
                      class="base-input"
                      placeholder="my-app"
                      autocomplete="off"
                      spellcheck="false"
                      :disabled="inProgress"
                    >
                  </label>

                  <label class="form-field" :class="{ 'form-field--full': createInRoot }">
                    <span class="field-label">{{ createInRoot ? 'Project directory' : 'Parent directory' }}</span>
                    <div class="directory-picker">
                      <input
                        :value="parentDir"
                        type="text"
                        class="base-input"
                        placeholder="Choose a folder"
                        readonly
                        :disabled="inProgress"
                      >
                      <button class="btn-secondary" type="button" :disabled="inProgress" @click="chooseDirectory">
                        Pick
                      </button>
                    </div>
                  </label>
                </div>

                <div class="config-divider">
                  Configuration
                </div>

                <div class="options-grid">
                  <template v-for="opt in currentTemplate.options" :key="opt.id">
                    <ScaffoldDropdown
                      v-if="opt.type === 'select'"
                      v-model="(options as any)[opt.id]"
                      :label="opt.label"
                      :options="getOptionChoices(opt.id)"
                      :disabled="inProgress"
                    />

                    <ScaffoldMultiSelect
                      v-else-if="opt.type === 'multiselect'"
                      v-model="(options as any)[opt.id]"
                      :label="opt.label"
                      :options="getOptionChoices(opt.id)"
                      :disabled="inProgress"
                    />

                    <label v-else-if="opt.type === 'text'" class="form-field">
                      <span class="field-label">{{ opt.label }}</span>
                      <input
                        v-model="(options as any)[opt.id]"
                        type="text"
                        class="base-input"
                        :disabled="inProgress"
                        autocomplete="off"
                        spellcheck="false"
                      >
                    </label>

                    <label v-else-if="opt.type === 'toggle'" class="toggle-option toggle-option--inline">
                      <button
                        type="button"
                        class="toggle-checkbox"
                        :class="{ 'toggle-checkbox--checked': options[opt.id] }"
                        :disabled="inProgress"
                        @click="options[opt.id] = !options[opt.id]"
                      >
                        <svg v-if="options[opt.id]" class="toggle-check-icon" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </button>
                      <span class="toggle-label">{{ opt.label }}</span>
                    </label>
                  </template>
                </div>

                <div class="config-divider">
                  Options
                </div>

                <div class="toggle-row">
                  <label v-if="!currentTemplate.installsAutomatically" class="toggle-option">
                    <button
                      type="button"
                      class="toggle-checkbox"
                      :class="{ 'toggle-checkbox--checked': runInstall }"
                      :disabled="inProgress"
                      @click="runInstall = !runInstall"
                    >
                      <svg v-if="runInstall" class="toggle-check-icon" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                    <span class="toggle-label">{{ installLabel }}</span>
                  </label>

                  <label class="toggle-option">
                    <button
                      type="button"
                      class="toggle-checkbox"
                      :class="{ 'toggle-checkbox--checked': createInRoot }"
                      :disabled="inProgress"
                      @click="createInRoot = !createInRoot"
                    >
                      <svg v-if="createInRoot" class="toggle-check-icon" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                    <span class="toggle-label">Create in root</span>
                  </label>

                  <label class="toggle-option" :class="{ 'toggle-option--disabled': createInRoot }">
                    <button
                      type="button"
                      class="toggle-checkbox"
                      :class="{ 'toggle-checkbox--checked': openAfterInstall && !createInRoot }"
                      :disabled="inProgress || createInRoot"
                      @click="openAfterInstall = !openAfterInstall"
                    >
                      <svg v-if="openAfterInstall && !createInRoot" class="toggle-check-icon" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                    <span class="toggle-label">Open after install</span>
                  </label>
                </div>

                <div class="preview-section">
                  <span class="field-label">Command preview</span>
                  <div class="preview-code">
                    {{ buildCommandLine(currentTemplate, createInRoot ? '.' : (projectName || 'my-app'), options) }}
                  </div>
                </div>

                <div class="actions-footer">
                  <button class="scaffold-create-btn" type="submit" :disabled="inProgress">
                    Initialize Project
                  </button>
                </div>
              </form>
            </template>

            <!-- STEP: PROGRESS -->
            <template v-else-if="step === 'progress'">
              <div class="progress-header">
                <div class="progress-status">
                  <span v-if="inProgress" class="spinner" aria-hidden="true" />
                  <CircleCheckBig v-else-if="!hadError" class="status-icon success" :size="16" />
                  <CircleAlert v-else class="status-icon error" :size="16" />
                  <span class="status-text">
                    {{ hadError ? 'Creation failed' : inProgress ? 'Creating project...' : 'Ready to code' }}
                  </span>
                </div>
                <div v-if="createdPath" class="progress-path">
                  {{ createdPath }}
                </div>
              </div>

              <div ref="outputScrollRef" class="terminal-box">
                <div v-for="(line, idx) in outputLines" :key="idx" class="terminal-line" :class="`terminal-line--${line.type}`">
                  {{ line.text }}
                </div>
              </div>

              <div class="actions-footer">
                <button class="btn-secondary" type="button" :disabled="inProgress" @click="hadError ? (step = 'configure') : resetSelection()">
                  {{ hadError ? 'Try Again' : 'Create Another' }}
                </button>
                <button class="scaffold-create-btn" type="button" :disabled="inProgress || hadError" @click="emit('success', { projectPath: createdPath, templateId: currentTemplate?.id || '' })">
                  Open Project
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*  backdrop  */
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: color-mix(in srgb, var(--color-bg-base) 65%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/*  modal shell  */
.settings-modal {
  display: flex;
  flex-direction: column;
  width: 820px;
  max-width: 100%;
  height: 620px;
  max-height: calc(100vh - 48px);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  overflow: hidden;
  animation: modal-in 160ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/*  header  */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  min-height: 44px;
  padding-inline: 20px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.modal-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.modal-close:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

/*  body  */
.modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/*  left nav  */
.settings-nav {
  display: flex;
  flex-direction: column;
  width: 188px;
  min-width: 188px;
  padding: 12px 8px;
  gap: 1px;
  border-right: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding-inline: 10px 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 450;
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    color 120ms ease;
  position: relative;
}

.nav-item--active {
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-arrow {
  margin-left: auto;
  color: var(--color-text-tertiary);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.nav-item--active .nav-arrow {
  opacity: 1;
  transform: translateX(0);
  color: var(--color-accent-text);
}

/*  right content  */
.settings-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 28px 32px;
  overflow-y: auto;
}

/* --- Browse Step --- */
.scaffold-toolbar {
  display: flex;
  margin-bottom: 20px;
}

.search-input-wrapper {
  position: relative;
  width: 100%;
  max-width: 320px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
}

.search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 120ms ease;
}

.search-input:focus {
  border-color: var(--color-border-mid);
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.template-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.template-card:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
}

.template-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--color-text-primary);
}

.template-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.template-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-category {
  font-size: 11px;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.empty-state {
  grid-column: 1 / -1;
  padding: 32px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 13px;
  border: 1px dashed var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

/* --- Configure Step --- */
.configure-header {
  margin-bottom: 24px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms;
}

.btn-back:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.configure-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 32px;
  padding: 16px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.configure-hero-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  padding: 0;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow);
  color: var(--color-text-primary);
  flex-shrink: 0;
}

.configure-hero-icon :deep(svg) {
  width: 40px;
  height: 40px;
}

.configure-hero-text h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.configure-hero-text p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.configure-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.form-field--full {
  grid-column: 1 / -1;
}

.config-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.config-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border-subtle);
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.base-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: all 120ms;
}

.base-input:focus {
  border-color: var(--color-accent-primary);
  box-shadow: 0 0 0 2px var(--color-accent-muted);
}

.directory-picker {
  display: flex;
  gap: 8px;
}

.btn-secondary,
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-lg);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms ease;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-state-hover);
  border-color: var(--color-border-mid);
}

.btn-primary {
  background: var(--color-accent-muted);
  border: 1px solid var(--color-accent-dim);
  color: var(--color-accent-text);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-muted) 180%, transparent);
  border-color: var(--color-accent);
}

.hero-title-suffix {
  opacity: 0.7;
  font-weight: 500;
}

/* ── Initialize / primary CTA button ─────────────────────────────────── */
.scaffold-create-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 20px;
  border-radius: var(--radius-lg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  background: var(--color-accent-muted);
  border: 1px solid var(--color-accent-dim);
  color: var(--color-accent-text);
  letter-spacing: 0.01em;
}

.scaffold-create-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-muted) 220%, transparent);
  border-color: var(--color-accent);
  box-shadow: 0 0 12px var(--color-accent-muted);
}

.scaffold-create-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.preview-code {
  padding: 12px 16px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  font-family:
    ui-monospace,
    SFMono-Regular,
    SF Mono,
    Menlo,
    Consolas,
    monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.actions-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: auto;
}

/* ── Custom toggle checkboxes ────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.toggle-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.toggle-option--inline {
  padding-top: 24px;
}

.toggle-option--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.toggle-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--color-border-mid);
  background: var(--color-bg-base);
  color: transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: all 140ms ease;
}

.toggle-checkbox:hover:not(:disabled) {
  border-color: var(--color-border-bright);
  background: var(--color-state-hover);
}

.toggle-checkbox--checked {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.toggle-checkbox--checked:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-muted) 220%, transparent);
  border-color: var(--color-accent);
}

.toggle-check-icon {
  width: 12px;
  height: 12px;
}

.toggle-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

/* --- Progress Step --- */
.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.status-icon.success {
  color: var(--color-success-text);
}

.status-icon.error {
  color: var(--color-danger);
}

.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--color-accent-bright);
  border-right-color: var(--color-accent-bright); /* Creates a cleaner 50% arc spiral effect */
  opacity: 0.9;
  animation: scaffold-spin 700ms linear infinite;
}

@keyframes scaffold-spin {
  to {
    transform: rotate(360deg);
  }
}

.progress-path {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.terminal-box {
  flex: 1;
  min-height: 200px;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  font-family:
    ui-monospace,
    SFMono-Regular,
    SF Mono,
    Menlo,
    Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  overflow-y: auto;
}

.terminal-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.terminal-line--command {
  color: var(--color-accent-text);
  font-weight: 600;
  opacity: 0.9;
}

.terminal-line--error {
  color: var(--color-danger-text);
}

.terminal-line--success {
  color: var(--color-success-text);
  font-weight: 600;
}
</style>
