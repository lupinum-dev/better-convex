<script setup lang="ts">
import type {
  McpUiToolInputNotification,
  McpUiToolResultNotification,
} from '@modelcontextprotocol/ext-apps'
import { useMcpApp } from 'better-convex-vue/mcp-app'
import { computed, ref, watch, watchEffect } from 'vue'

interface DashboardNote {
  body: string
  id: string
  revision: number
  title: string
  uri: string
  workspaceId: string
}

interface SearchInput {
  limit?: number
  query: string
  workspaceId: string
}

const {
  callServerTool,
  hostCapabilities,
  hostContext,
  openLink,
  phase,
  toolCancelled,
  toolInput,
  toolInputPartial,
  toolResult,
} = useMcpApp({
  capabilities: {},
  implementation: { name: 'better-convex-notes-dashboard', version: '0.0.0' },
})
const input = ref<SearchInput>({ query: '', workspaceId: '' })
const notes = ref<DashboardNote[]>([])
const status = ref<'connecting' | 'ready' | 'refreshing' | 'tool-denied' | 'link-denied' | 'error'>(
  'connecting',
)

const canRefresh = computed(
  () => status.value !== 'connecting' && input.value.workspaceId.length > 0,
)
const linkAvailable = computed(() => hostCapabilities.value?.openLinks !== undefined)

function safeInput(value: McpUiToolInputNotification['params']): SearchInput | undefined {
  const candidate = value.arguments
  if (!candidate || typeof candidate.workspaceId !== 'string') return undefined
  if (typeof candidate.query !== 'string') return undefined
  if (
    candidate.limit !== undefined &&
    (typeof candidate.limit !== 'number' || !Number.isInteger(candidate.limit))
  ) {
    return undefined
  }
  return {
    ...(candidate.limit === undefined ? {} : { limit: candidate.limit }),
    query: candidate.query,
    workspaceId: candidate.workspaceId,
  }
}

function safeNotes(value: McpUiToolResultNotification['params']): DashboardNote[] | undefined {
  const structured = value.structuredContent
  if (!structured || !Array.isArray(structured.matches)) return undefined

  const parsed: DashboardNote[] = []
  for (const candidate of structured.matches) {
    if (!candidate || typeof candidate !== 'object') return undefined
    const note = candidate as Partial<DashboardNote>
    if (
      typeof note.body !== 'string' ||
      typeof note.id !== 'string' ||
      typeof note.revision !== 'number' ||
      !Number.isInteger(note.revision) ||
      typeof note.title !== 'string' ||
      typeof note.uri !== 'string' ||
      typeof note.workspaceId !== 'string'
    ) {
      return undefined
    }
    parsed.push({
      body: note.body,
      id: note.id,
      revision: note.revision,
      title: note.title,
      uri: note.uri,
      workspaceId: note.workspaceId,
    })
  }
  return parsed
}

function handleToolInput(value: McpUiToolInputNotification['params']): void {
  const parsed = safeInput(value)
  if (parsed) input.value = parsed
}

function handleToolResult(value: McpUiToolResultNotification['params']): void {
  if (value.isError) {
    status.value = 'error'
    return
  }
  const parsed = safeNotes(value)
  if (!parsed) {
    status.value = 'error'
    return
  }
  notes.value = parsed
  status.value = 'ready'
}

async function refresh(): Promise<void> {
  if (!canRefresh.value) return
  status.value = 'refreshing'
  try {
    const arguments_: Record<string, unknown> = {
      ...(input.value.limit === undefined ? {} : { limit: input.value.limit }),
      query: input.value.query,
      workspaceId: input.value.workspaceId,
    }
    const result = await callServerTool({
      arguments: arguments_,
      name: 'search_notes',
    })
    handleToolResult(result)
  } catch {
    status.value = 'error'
  }
}

async function tryDeniedTool(): Promise<void> {
  try {
    const result = await callServerTool({
      arguments: {
        noteId: notes.value[0]?.id ?? 'missing',
        requestKey: 'app',
        title: 'Denied',
      },
      name: 'rename_note',
    })
    status.value = result.isError ? 'tool-denied' : 'error'
  } catch {
    status.value = 'tool-denied'
  }
}

async function openDocumentation(): Promise<void> {
  if (!linkAvailable.value) return
  try {
    const result = await openLink({
      url: 'https://docs.example.invalid/notes',
    })
    status.value = result.isError ? 'link-denied' : 'error'
  } catch {
    status.value = 'link-denied'
  }
}

watchEffect(() => {
  document.documentElement.dataset.theme = hostContext.value?.theme ?? 'light'
})

watch(toolInput, (value) => {
  if (value) handleToolInput(value)
})

watch(toolResult, (value) => {
  if (value) handleToolResult(value)
})

watch(phase, (value) => {
  if (value === 'ready') {
    status.value = 'ready'
  } else if (value === 'error') {
    status.value = 'error'
  } else if (value === 'closed') {
    window.setTimeout(() => {
      window.dispatchEvent(new Event('better-convex:notes-dashboard-teardown'))
    }, 0)
  }
})
</script>

<template>
  <main data-testid="notes-dashboard" :aria-busy="status === 'refreshing'">
    <header>
      <p class="eyebrow">Better Convex MCP App probe</p>
      <h1>Notes dashboard</h1>
      <p data-testid="status">{{ status }}</p>
    </header>

    <form aria-label="Search notes" @submit.prevent="refresh">
      <p data-testid="workspace">{{ input.workspaceId || 'No workspace' }}</p>
      <label>
        Search
        <input v-model="input.query" data-testid="query" maxlength="200" type="search" />
      </label>
      <label>
        Result limit
        <input v-model.number="input.limit" data-testid="limit" max="50" min="1" type="number" />
      </label>
      <button data-testid="refresh" type="submit" :disabled="!canRefresh" @click.prevent="refresh">
        Refresh through host
      </button>
      <p data-testid="partial-query" hidden>
        {{ toolInputPartial?.arguments?.query ?? '' }}
      </p>
      <p data-testid="cancel-reason" hidden>
        {{ toolCancelled?.reason ?? '' }}
      </p>
    </form>

    <ul aria-label="Note previews" data-testid="notes">
      <li v-for="note in notes" :key="note.id">
        <strong>{{ note.title }}</strong>
        <p>{{ note.body }}</p>
        <small>revision {{ note.revision }}</small>
      </li>
    </ul>

    <nav aria-label="Dashboard actions">
      <button data-testid="denied-tool" type="button" @click="tryDeniedTool">
        Try denied write
      </button>
      <button
        data-testid="open-link"
        type="button"
        :disabled="!linkAvailable"
        @click="openDocumentation"
      >
        Open documentation
      </button>
    </nav>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html) {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

:global(body) {
  margin: 0;
  color: #171717;
  background: #fafafa;
}

:global(html[data-theme='dark'] body) {
  color: #f5f5f5;
  background: #171717;
}

main,
form,
label {
  display: grid;
}

main {
  gap: 1rem;
  padding: 1rem;
}

form {
  gap: 0.75rem;
}

label {
  gap: 0.25rem;
}

h1,
p {
  margin: 0;
}

.eyebrow,
small {
  color: #737373;
}

ul {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

li {
  display: grid;
  gap: 0.25rem;
  padding-block: 0.75rem;
  border-block-start: 1px solid #d4d4d4;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

button {
  padding: 0.5rem 0.75rem;
}

input {
  max-width: 24rem;
  padding: 0.5rem;
}
</style>
