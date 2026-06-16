<script setup lang="ts">
import { Check, Loader, Plus, Server, Trash2, X, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const s = useSettingsStore()
const { mcpServers } = storeToRefs(s)

function onInput(id: string, key: string, e: Event) {
  s.updateMcpServer(id, { [key]: (e.target as HTMLInputElement).value })
}
</script>

<template>
  <section class="content-section">
    <div class="section-header-row">
      <h2 class="section-title">
        MCP
      </h2>
      <button class="add-btn" @click="s.addMcpServer()">
        <Plus :size="14" :stroke-width="2.5" />
        Add server
      </button>
    </div>

    <div v-for="server in mcpServers" :key="server.id" class="provider-card">
      <div class="provider-card-header">
        <div class="provider-info">
          <span class="provider-logo">
            <Server :size="15" :stroke-width="2" />
          </span>
          <div>
            <span class="provider-name">{{ server.name || 'Unnamed Server' }}</span>
            <span class="provider-url">{{ server.command || 'No command configured yet' }}</span>
          </div>
        </div>

        <div class="mcp-header-actions">
          <div
            v-if="server.status !== 'idle'"
            class="status-icon"
            :class="`status-icon--${server.status}`"
          >
            <Loader v-if="server.status === 'testing'" :size="14" class="spin" />
            <Check v-else-if="server.status === 'ok'" :size="14" :stroke-width="2.5" />
            <X v-else :size="14" :stroke-width="2.5" />
          </div>

          <label class="mcp-enabled-toggle">
            <span class="mcp-enabled-label">Enabled</span>
            <button
              class="model-toggle"
              :class="{ 'model-toggle--on': server.enabled }"
              type="button"
              :aria-pressed="server.enabled"
              @click="s.updateMcpServer(server.id, { enabled: !server.enabled })"
            >
              <span class="model-toggle-thumb" />
            </button>
          </label>

          <button class="icon-danger-btn" aria-label="Remove MCP server" @click="s.removeMcpServer(server.id)">
            <Trash2 :size="14" :stroke-width="2" />
          </button>
        </div>
      </div>

      <div class="mcp-grid">
        <div class="field-group">
          <label class="field-label">Display name</label>
          <input
            type="text" :value="server.name" class="field-input" placeholder="Filesystem, GitHub..."
            @input="onInput(server.id, 'name', $event)"
          >
        </div>

        <div class="field-group">
          <label class="field-label">Command</label>
          <input
            type="text" :value="server.command" class="field-input" placeholder="npx, uvx, node, python..."
            @input="onInput(server.id, 'command', $event)"
          >
        </div>

        <div class="field-group" style="grid-column: 1 / -1">
          <label class="field-label">
            Working directory
            <span class="field-optional">optional</span>
          </label>
          <input
            type="text" :value="server.cwd" class="field-input" placeholder="C:\path\to\server"
            @input="onInput(server.id, 'cwd', $event)"
          >
        </div>

        <div class="field-group">
          <label class="field-label">
            Arguments
            <span class="field-optional">one per line</span>
          </label>
          <textarea
            :value="server.argsText" class="field-textarea" rows="3"
            placeholder="-y&#10;@postman/mcp-server"
            @input="onInput(server.id, 'argsText', $event)"
          />
        </div>

        <div class="field-group">
          <label class="field-label">
            Environment
            <span class="field-optional">KEY=value per line</span>
          </label>
          <textarea
            :value="server.envText" class="field-textarea" rows="3"
            placeholder="GITHUB_TOKEN=ghp_...&#10;LOG_LEVEL=debug"
            @input="onInput(server.id, 'envText', $event)"
          />
        </div>
      </div>

      <div class="card-footer">
        <div class="mcp-tool-meta">
          <span><strong>{{ server.toolCount }}</strong> tools discovered</span>
          <span class="meta-divider">•</span>
          <span v-if="server.enabled">loaded into the agent when connected</span>
          <span v-else class="text-muted">saved but currently disabled</span>
        </div>

        <button
          class="test-btn"
          :disabled="server.status === 'testing' || !server.command.trim()"
          @click="s.testMcpServer(server.id)"
        >
          <Loader v-if="server.status === 'testing'" :size="13" class="spin" />
          <Zap v-else :size="13" :stroke-width="2" />
          Test connection
        </button>
      </div>

      <div v-if="server.tools.length > 0" class="mcp-tools-list">
        <div v-for="tool in server.tools" :key="tool.name" class="mcp-tool-item">
          <div class="mcp-tool-head">
            <span class="mcp-tool-name">{{ tool.title || tool.name }}</span>
            <span class="mcp-tool-id">{{ tool.name }}</span>
          </div>
          <p class="mcp-tool-desc">
            {{ tool.description || 'No description provided by this MCP server.' }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="mcpServers.length === 0" class="compat-empty">
      <div class="empty-icon-wrapper">
        <Server :size="20" :stroke-width="2" />
      </div>
      <h3 class="empty-title">
        No MCP servers configured
      </h3>
      <p class="compat-examples">
        Add a server command and the agent will discover its tools automatically.
      </p>
    </div>
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.content-section::-webkit-scrollbar,
.field-textarea::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.content-section::-webkit-scrollbar-track,
.field-textarea::-webkit-scrollbar-track {
  background: transparent;
}

.content-section::-webkit-scrollbar-thumb,
.field-textarea::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-md);
}

.content-section::-webkit-scrollbar-thumb:hover,
.field-textarea::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

/* ── header ── */
.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.add-btn:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
}

/* ── card ── */
.provider-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.provider-logo {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-lg);
  flex-shrink: 0;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.provider-name {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.provider-url {
  display: block;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

/* ── status icon ── */
.status-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
}

.status-icon--testing {
  color: var(--color-text-tertiary);
}

.status-icon--ok {
  color: var(--color-success);
}

.status-icon--error {
  color: var(--color-danger);
}

/* ── header actions ── */
.mcp-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mcp-enabled-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}

.mcp-enabled-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.model-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 34px;
  height: 19px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-mid);
  background: var(--color-toggle-track-off);
  cursor: pointer;
  transition: all 150ms ease;
  flex-shrink: 0;
}

.model-toggle--on {
  background: var(--color-toggle-track-on);
  border-color: var(--color-accent);
}

.model-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--color-toggle-thumb-off);
  transition:
    transform 150ms cubic-bezier(0.4, 0, 0.2, 1),
    background 150ms ease;
}

.model-toggle--on .model-toggle-thumb {
  transform: translateX(15px);
  background: var(--color-text-primary);
}

.icon-danger-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}

.icon-danger-btn:hover {
  background: var(--color-danger-muted);
  color: var(--color-danger-text);
  border-color: var(--color-danger-muted);
}

/* ── fields ── */
.mcp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.field-optional {
  font-weight: 400;
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-left: 5px;
}

.field-input {
  height: 32px;
  padding: 0 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.field-input:focus,
.field-textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.field-input::placeholder,
.field-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.field-textarea {
  width: 100%;
  min-height: 66px;
  resize: vertical;
  padding: 8px 10px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12.5px;
  line-height: 1.5;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

/* ── footer ── */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-subtle);
}

.mcp-tool-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.meta-divider {
  color: var(--color-border-strong);
}
.text-muted {
  color: var(--color-text-tertiary);
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.test-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* ── tools list ── */
.mcp-tools-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border-subtle);
}

.mcp-tool-item {
  padding: 11px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-subtle);
  background: color-mix(in srgb, var(--color-bg-base) 40%, transparent);
}

.mcp-tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.mcp-tool-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.mcp-tool-id {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  background: var(--color-bg-elevated);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.mcp-tool-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

/* ── empty state ── */
.compat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 36px 24px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  gap: 10px;
}

.empty-icon-wrapper {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
}

.empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.compat-examples {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* ── spin ── */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── responsive ── */
@media (max-width: 768px) {
  .mcp-grid {
    grid-template-columns: 1fr;
  }
  .card-footer {
    flex-direction: column;
    align-items: flex-start;
  }
  .mcp-header-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
