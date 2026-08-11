import { sanitizeDiagnosticValue } from '../utils/sanitize-diagnostic'
import type { MutationEntry, QueryRegistryEntry } from './types'

const MAX_MUTATIONS = 50
const MAX_QUERIES = 200

type QuerySubscriber = (entries: QueryRegistryEntry[]) => void
type MutationSubscriber = (entries: MutationEntry[]) => void

export interface DevtoolsSink {
  getQueries(): QueryRegistryEntry[]
  getQuery(id: string): QueryRegistryEntry | undefined
  upsertQuery(entry: Omit<QueryRegistryEntry, 'lastUpdated'>): void
  removeQuery(id: string): void
  subscribeToQueries(callback: QuerySubscriber): () => void
  registerMutation(entry: Omit<MutationEntry, 'id'>): string
  updateMutation(
    id: string,
    update: Partial<Pick<MutationEntry, 'state' | 'result' | 'error' | 'settledAt' | 'duration'>>,
  ): void
  getMutations(): MutationEntry[]
  subscribeToMutations(callback: MutationSubscriber): () => void
  clearIdentityOwned(): void
  dispose(): void
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function createDevtoolsSink(): DevtoolsSink {
  const queries = new Map<string, QueryRegistryEntry>()
  const mutations = new Map<string, MutationEntry>()
  const querySubscribers = new Set<QuerySubscriber>()
  const mutationSubscribers = new Set<MutationSubscriber>()
  let disposed = false

  const cloneEntry = <T>(entry: T): T => sanitizeDiagnosticValue(entry) as T
  const getQueries = () => [...queries.values()].map(cloneEntry)
  const getMutations = () =>
    [...mutations.values()].sort((left, right) => right.startedAt - left.startedAt).map(cloneEntry)

  const notifyQueries = () => {
    for (const subscriber of querySubscribers) {
      try {
        subscriber(getQueries())
      } catch {
        // Diagnostics must never affect application behavior.
      }
    }
  }
  const notifyMutations = () => {
    for (const subscriber of mutationSubscribers) {
      try {
        subscriber(getMutations())
      } catch {
        // Diagnostics must never affect application behavior.
      }
    }
  }

  return {
    getQueries,
    getQuery: (id) => {
      const entry = queries.get(id)
      return entry ? cloneEntry(entry) : undefined
    },
    upsertQuery(entry) {
      if (disposed) return
      queries.delete(entry.id)
      queries.set(entry.id, {
        ...entry,
        args: sanitizeDiagnosticValue(entry.args),
        data: sanitizeDiagnosticValue(entry.data),
        error: entry.error === undefined ? undefined : String(sanitizeDiagnosticValue(entry.error)),
        lastUpdated: Date.now(),
      })
      while (queries.size > MAX_QUERIES) queries.delete(queries.keys().next().value!)
      notifyQueries()
    },
    removeQuery(id) {
      if (queries.delete(id)) notifyQueries()
    },
    subscribeToQueries(callback) {
      if (disposed) return () => {}
      querySubscribers.add(callback)
      callback(getQueries())
      return () => querySubscribers.delete(callback)
    },
    registerMutation(entry) {
      if (disposed) return ''
      const id = createId()
      mutations.set(id, {
        ...entry,
        id,
        args: sanitizeDiagnosticValue(entry.args),
      })
      while (mutations.size > MAX_MUTATIONS) mutations.delete(mutations.keys().next().value!)
      notifyMutations()
      return id
    },
    updateMutation(id, update) {
      if (disposed) return
      const existing = mutations.get(id)
      if (!existing) return
      mutations.set(id, {
        ...existing,
        ...update,
        ...(update.result === undefined ? {} : { result: sanitizeDiagnosticValue(update.result) }),
        ...(update.error === undefined
          ? {}
          : { error: String(sanitizeDiagnosticValue(update.error)) }),
      })
      notifyMutations()
    },
    getMutations,
    subscribeToMutations(callback) {
      if (disposed) return () => {}
      mutationSubscribers.add(callback)
      callback(getMutations())
      return () => mutationSubscribers.delete(callback)
    },
    clearIdentityOwned() {
      if (disposed) return
      queries.clear()
      mutations.clear()
      notifyQueries()
      notifyMutations()
    },
    dispose() {
      if (disposed) return
      disposed = true
      queries.clear()
      mutations.clear()
      querySubscribers.clear()
      mutationSubscribers.clear()
    },
  }
}
