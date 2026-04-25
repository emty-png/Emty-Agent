<script setup lang="ts">
import type { ToolEvent } from '@/stores/chat'
import type { ArtifactPayload } from '@/utils/tools/artifact'
import { computed } from 'vue'

const props = defineProps<{
  event: ToolEvent
}>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeSvgClient(svgRaw: string): string {
  let svg = svgRaw.trim()
  if (!svg.startsWith('<svg'))
    return ''

  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
  svg = svg.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
  svg = svg.replace(/\s+(href|xlink:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
  svg = svg.replace(/\s+(href|xlink:href|src)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gi, '')
  return svg
}

function parseArtifact(value: unknown): ArtifactPayload | null {
  if (!isRecord(value))
    return null
  const artifactType = value.artifactType
  const title = value.title
  if (typeof artifactType !== 'string' || typeof title !== 'string')
    return null
  return value as ArtifactPayload
}

const artifact = computed(() => parseArtifact(props.event.metadata?.artifact))
const isArtifactEvent = computed(() => props.event.toolName === 'create_artifact')
const safeSvg = computed(() => artifact.value?.svg ? sanitizeSvgClient(artifact.value.svg) : '')
const edgeRows = computed(() => {
  if (!artifact.value?.edges)
    return []
  return artifact.value.edges.map(edge => ({
    key: `${edge.from}->${edge.to}:${edge.label ?? ''}`,
    text: edge.label ? `${edge.from} -> ${edge.to} (${edge.label})` : `${edge.from} -> ${edge.to}`,
  }))
})
</script>

<template>
  <div v-if="isArtifactEvent && artifact" class="artifact-card">
    <div class="artifact-header">
      <div class="artifact-title-wrap">
        <p class="artifact-type">
          {{ artifact.artifactType.replace('_', ' ') }}
        </p>
        <h4 class="artifact-title">
          {{ artifact.title }}
        </h4>
        <p v-if="artifact.subtitle" class="artifact-subtitle">
          {{ artifact.subtitle }}
        </p>
      </div>
    </div>

    <p v-if="artifact.description" class="artifact-description">
      {{ artifact.description }}
    </p>

    <div v-if="artifact.artifactType === 'mind_map' || artifact.artifactType === 'flow_graph'" class="artifact-graph">
      <div v-if="artifact.nodes?.length" class="artifact-column">
        <h5 class="artifact-section-title">
          Nodes
        </h5>
        <ul class="artifact-list">
          <li v-for="node in artifact.nodes" :key="node.id" class="artifact-list-item">
            <span class="artifact-list-key">{{ node.id }}</span>
            <span class="artifact-list-value">{{ node.label }}</span>
          </li>
        </ul>
      </div>
      <div v-if="edgeRows.length" class="artifact-column">
        <h5 class="artifact-section-title">
          Connections
        </h5>
        <ul class="artifact-list">
          <li v-for="edge in edgeRows" :key="edge.key" class="artifact-list-item">
            <span class="artifact-list-value">{{ edge.text }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="artifact.artifactType === 'ui_showcase' || artifact.artifactType === 'theme_showcase'" class="artifact-showcase">
      <div v-if="artifact.sections?.length" class="artifact-sections">
        <article v-for="section in artifact.sections" :key="section.title" class="artifact-section-card">
          <h5 class="artifact-section-title">
            {{ section.title }}
          </h5>
          <p v-if="section.description" class="artifact-section-description">
            {{ section.description }}
          </p>
          <ul v-if="section.bullets?.length" class="artifact-bullets">
            <li v-for="bullet in section.bullets" :key="bullet">
              {{ bullet }}
            </li>
          </ul>
        </article>
      </div>

      <div v-if="artifact.swatches?.length" class="artifact-swatches">
        <h5 class="artifact-section-title">
          Theme Tokens
        </h5>
        <div class="artifact-swatch-grid">
          <div v-for="swatch in artifact.swatches" :key="swatch.role + swatch.token" class="artifact-swatch">
            <span class="artifact-swatch-dot" />
            <span class="artifact-swatch-role">{{ swatch.role }}</span>
            <code class="artifact-swatch-token">{{ swatch.token }}</code>
          </div>
        </div>
      </div>
    </div>

    <div v-if="artifact.artifactType === 'svg' && safeSvg" class="artifact-svg-wrap">
      <div class="artifact-svg" v-html="safeSvg" />
    </div>
  </div>
</template>
