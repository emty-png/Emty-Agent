<script setup lang="ts">
import { markRaw } from 'vue'

const props = defineProps<{
  filePath: string
  diff: string
  added: number
  removed: number
}>()

interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  oldLine: string
  newLine: string
  text: string
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface ParsedFileDiff {
  from: string
  to: string
  hunks: DiffHunk[]
}

function parseDiff(raw: string): ParsedFileDiff[] {
  if (!raw)
    return []
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const files: ParsedFileDiff[] = []
  let currentFile: ParsedFileDiff | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line === undefined)
      continue
    if (line.startsWith('--- ')) {
      currentFile = { from: line.slice(4).replace(/^a\//, ''), to: '', hunks: [] }
      files.push(currentFile)
      currentHunk = null
      continue
    }
    if (line.startsWith('+++ ') && currentFile) {
      currentFile.to = line.slice(4).replace(/^b\//, '')
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        if (!currentFile) {
          currentFile = { from: '', to: '', hunks: [] }
          files.push(currentFile)
        }
        oldLine = Number.parseInt(match[1]!, 10)
        newLine = Number.parseInt(match[2]!, 10)
        currentHunk = { header: line, lines: [] }
        currentFile.hunks.push(currentHunk)
      }
      continue
    }
    if (!currentHunk || line.startsWith('\\ No newline'))
      continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldLine: '', newLine: String(newLine++), text: line.substring(1) })
    }
    else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldLine: String(oldLine++), newLine: '', text: line.substring(1) })
    }
    else if (line.startsWith(' ') || line === '') {
      const text = line.startsWith(' ') ? line.substring(1) : line
      currentHunk.lines.push({ type: 'ctx', oldLine: String(oldLine++), newLine: String(newLine++), text })
    }
  }
  return files.filter(f => f.hunks.length > 0)
}

const parsedDiff = markRaw(parseDiff(props.diff))
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- File header -->
    <div class="flex items-center gap-3 py-2.5 px-3.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
      <span class="text-[12px] font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace] font-medium text-[var(--color-text-primary)] truncate">{{ filePath }}</span>
      <span class="ml-auto shrink-0 flex items-center gap-2 text-[11px] font-mono font-semibold">
        <span v-if="added > 0" class="text-[var(--color-success)]">+{{ added }}</span>
        <span v-if="removed > 0" class="text-[var(--color-danger)]">-{{ removed }}</span>
      </span>
    </div>

    <!-- Diff content -->
    <div class="flex-1 min-h-0 overflow-auto font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace] text-[11.5px] leading-[1.55] [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
      <div v-if="parsedDiff.length === 0" class="flex flex-col items-center justify-center gap-2 min-h-[220px] py-8 px-[18px] text-center">
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
          No diff available
        </p>
      </div>

      <div v-for="(file, fi) in parsedDiff" :key="fi">
        <div v-for="(hunk, hi) in file.hunks" :key="hi">
          <div class="py-1 px-3 text-[10.5px] text-[var(--color-text-dim)] bg-[color-mix(in_srgb,var(--color-bg-surface)_40%,transparent)] border-b border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)] select-none sticky top-0 z-1">
            {{ hunk.header }}
          </div>
          <div
            v-for="(line, li) in hunk.lines"
            :key="li"
            class="flex items-stretch min-w-max"
            :class="{
              'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]': line.type === 'add',
              'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]': line.type === 'del',
            }"
          >
            <div
              class="flex w-[72px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)]"
              :class="{
                'bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]': line.type === 'add',
                'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]': line.type === 'del',
              }"
            >
              <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.oldLine }}</span>
              <span class="w-[36px] text-right px-1.5 text-[var(--color-text-dim)] opacity-50 select-none text-[10.5px] leading-[inherit] shrink-0 flex items-center justify-end">{{ line.newLine }}</span>
            </div>
            <div
              class="w-[18px] shrink-0 text-center font-semibold text-[12px] select-none flex items-center justify-center"
              :class="{
                'text-[var(--color-success)]': line.type === 'add',
                'text-[var(--color-danger)]': line.type === 'del',
              }"
            >
              {{ line.type === 'add' ? '+' : line.type === 'del' ? '\u2212' : ' ' }}
            </div>
            <div
              class="px-3 whitespace-pre flex-1"
              :class="{
                'text-[color-mix(in_srgb,var(--color-success)_60%,var(--color-text-primary))]': line.type === 'add',
                'text-[color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]': line.type === 'del',
                'text-[var(--color-text-dim)] opacity-70': line.type === 'ctx',
              }"
            >
              {{ line.text }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
