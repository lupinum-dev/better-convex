import type { QueryExecutionOutcome } from './query-execution-gate'

export type SsrPaginationStatus = 'idle' | 'loading-first-page' | 'ready' | 'exhausted' | 'error'

export function isIncompletePaginationPage(
  page: { pageStatus?: 'SplitRecommended' | 'SplitRequired' | null } | null | undefined,
): boolean {
  return page?.pageStatus === 'SplitRequired'
}

export function computeSsrPaginationStatus(input: {
  execution: QueryExecutionOutcome
  hasError: boolean
  pending: boolean
  hasPage: boolean
  hasInitialData: boolean
  isDone: boolean
}): SsrPaginationStatus {
  if (input.execution === 'error' || input.hasError) return 'error'
  if (input.execution === 'idle') return 'idle'
  if (input.execution === 'wait' || input.pending) return 'loading-first-page'
  if (!input.hasPage && !input.hasInitialData) return 'idle'
  return input.isDone ? 'exhausted' : 'ready'
}
