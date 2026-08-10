<script setup lang="ts">
import {
  makeFunctionReference,
  type FunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server'
import { nextTick, onMounted, ref } from 'vue'

import {
  useConvexAction,
  useConvexAttachment,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
} from '#imports'

import {
  emitLatestSubscription,
  failLatestSubscription,
  failNextCall,
  readMockStats,
  readSubscriptions,
} from '../../browser-runtime/mock-convex-browser'

interface Note {
  id: string
}

interface OperationValue {
  operation: 'mutation' | 'action'
  value: string
}

const props = defineProps<{ dispose: () => void }>()
const attachment = useConvexAttachment()
const owner = ref('alice')
const notesQuery = makeFunctionReference<'query'>('notes:list') as FunctionReference<
  'query',
  'public',
  { owner: string },
  Note[]
>
const pagesQuery = makeFunctionReference<'query'>('notes:listPaginated') as FunctionReference<
  'query',
  'public',
  { owner: string; paginationOpts: PaginationOptions },
  PaginationResult<Note>
>
const writeNote = makeFunctionReference<'mutation'>('notes:write') as FunctionReference<
  'mutation',
  'public',
  { value: string },
  OperationValue
>
const generateNote = makeFunctionReference<'action'>('notes:generate') as FunctionReference<
  'action',
  'public',
  { value: string },
  OperationValue
>

const query = await useConvexQuery(notesQuery, () => ({ owner: owner.value }), {
  auth: 'none',
  initialData: [],
  server: false,
})
const pagination = await useConvexPaginatedQuery(pagesQuery, () => ({ owner: owner.value }), {
  auth: 'none',
  initialData: [],
  initialNumItems: 1,
  server: false,
})
const mutation = useConvexMutation(writeNote)
const action = useConvexAction(generateNote)

function serializeError(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const candidate = error as {
    name?: unknown
    kind?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    data?: unknown
  }
  return {
    name: candidate.name,
    kind: candidate.kind,
    message: candidate.message,
    code: candidate.code,
    status: candidate.status,
    data: candidate.data,
  }
}

function snapshot() {
  return {
    owner: owner.value,
    query: {
      data: query.data.value,
      status: query.status.value,
      pending: query.pending.value,
      error: serializeError(query.error.value),
    },
    pagination: {
      results: pagination.results.value,
      status: pagination.status.value,
      loading: pagination.isLoading.value,
      stale: pagination.isStale.value,
      hasNextPage: pagination.hasNextPage.value,
      error: serializeError(pagination.error.value),
    },
    mutation: {
      data: mutation.data.value,
      status: mutation.status.value,
      pending: mutation.pending.value,
      error: serializeError(mutation.error.value),
    },
    action: {
      data: action.data.value,
      status: action.status.value,
      pending: action.pending.value,
      error: serializeError(action.error.value),
    },
  }
}

onMounted(() => {
  window.__betterConvexNuxtLifecycle = {
    attachment() {
      const identity = attachment.identity.snapshot()
      return {
        frozen: Object.isFrozen(attachment),
        runtimeKeys: Object.keys(attachment).sort(),
        clientKeys: Object.keys(attachment.client).sort(),
        anonymousClientKeys: Object.keys(attachment.anonymousClient).sort(),
        identityKeys: Object.keys(attachment.identity).sort(),
        identitySnapshotKeys: Object.keys(identity).sort(),
        identity,
      }
    },
    snapshot,
    subscriptions: readSubscriptions,
    emitQuery(value: Note[]) {
      emitLatestSubscription('notes:list', value)
      return snapshot()
    },
    emitPage(cursor: string | null, value: PaginationResult<Note>) {
      emitLatestSubscription('notes:listPaginated', value, cursor)
      return snapshot()
    },
    loadMore(count = 1) {
      pagination.loadMore(count)
      return snapshot()
    },
    async setOwner(value: string) {
      owner.value = value
      await nextTick()
      return snapshot()
    },
    failQuery(message: string) {
      failLatestSubscription('notes:list', message)
      return snapshot()
    },
    async runMutation(value: string) {
      return await mutation({ value })
    },
    async runAction(value: string) {
      return await action({ value })
    },
    async safeMutation(kind: 'plain' | 'application', message: string) {
      failNextCall('mutation', kind, message)
      try {
        return { ok: true, data: await mutation({ value: 'denied' }) }
      } catch (error) {
        return { ok: false, error: serializeError(error) }
      }
    },
    async unmount() {
      props.dispose()
      await nextTick()
      return readMockStats()
    },
  }
})
</script>

<template>
  <p data-mounted>{{ JSON.stringify(snapshot()) }}</p>
</template>

<script lang="ts">
declare global {
  interface Window {
    __betterConvexNuxtLifecycle: Record<string, (...args: never[]) => unknown>
  }
}
</script>
