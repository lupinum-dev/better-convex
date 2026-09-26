import type { FunctionReference, PaginationResult } from 'convex/server'
import type { ComputedRef, Ref } from 'vue'

import { ConvexCallError, type ConvexCallErrorCode } from '../errors'
import {
  createPendingPaginationPage,
  needsPaginationSplit,
  type PaginationOperationContext,
  type PaginationPageOptions,
  type PaginationPageState,
} from './pagination-state'
import type { QuerySubscriptionClient } from './query-controller'

export type PaginationSplitTarget = 'first' | PaginationPageOptions

interface PendingPageSplit<Item> {
  target: PaginationSplitTarget
  operation: PaginationOperationContext
  parts: [
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
  ]
}

export interface PaginationSplitControllerInput<Item> {
  query: FunctionReference<'query'>
  initialNumItems: number
  pages: Ref<PaginationPageState<Item>[]>
  firstPageRealtime: Ref<PaginationResult<Item> | null>
  firstPageOptions: Ref<PaginationPageOptions | null>
  firstPageWithheld: Ref<boolean>
  initialOptions: ComputedRef<PaginationPageOptions>
  isDisposed(): boolean
  isLive(): boolean
  getClient(): QuerySubscriptionClient | null
  getArgs(): Record<string, unknown> | 'skip'
  setBoundaryError(error: ConvexCallError | undefined, key: string): void
  captureOperation(): PaginationOperationContext
  isOperationCurrent(operation: PaginationOperationContext): boolean
  settleFirstPageIfTerminal(): void
  replaceFirstPageSubscription(unsubscribe: (() => void) | null): void
  acceptFirstPageResult(result: PaginationResult<Item>, operation: PaginationOperationContext): void
  acceptPageResult(options: PaginationPageOptions, result: PaginationResult<Item>): void
  /** Fails the target page; `source` is the subscription that failed, when there is one. */
  rejectPage(target: PaginationSplitTarget, error: unknown, source?: PaginationPageOptions): void
}

export interface PaginationSplitController<Item> {
  /** Starts a bounded split when Convex's split rule asks for one; callers withhold `SplitRequired` pages. */
  begin(target: PaginationSplitTarget, result: PaginationResult<Item>): void
  teardown(): void
}

function visiblePage<Item>(result: PaginationResult<Item>) {
  return result.pageStatus === 'SplitRequired' ? undefined : result
}

function splitRequiredError(message: string): ConvexCallError {
  return new ConvexCallError({
    kind: 'unknown',
    code: 'PAGINATION_SPLIT_REQUIRED' satisfies ConvexCallErrorCode,
    message,
  })
}

export function createPaginationSplitController<Item>(
  input: PaginationSplitControllerInput<Item>,
): PaginationSplitController<Item> {
  const pendingSplits: PendingPageSplit<Item>[] = []

  function remove(split: PendingPageSplit<Item>): void {
    const index = pendingSplits.indexOf(split)
    if (index >= 0) pendingSplits.splice(index, 1)
  }

  function finish(split: PendingPageSplit<Item>): void {
    if (
      !input.isOperationCurrent(split.operation) ||
      split.parts.some((part) => part.received === null)
    )
      return

    remove(split)
    const promoted = split.parts.map(({ page, received }) => ({
      ...page,
      result: visiblePage(received!),
      error: undefined,
    })) as [PaginationPageState<Item>, PaginationPageState<Item>]

    if (split.target === 'first') {
      input.replaceFirstPageSubscription(promoted[0].unsubscribe)
      input.firstPageOptions.value = promoted[0].paginationOpts
      input.firstPageRealtime.value = promoted[0].result ?? null
      input.firstPageWithheld.value = promoted[0].result === undefined
      input.pages.value = [promoted[1], ...input.pages.value]
      input.setBoundaryError(undefined, split.operation.boundaryKey)
    } else {
      const index = input.pages.value.findIndex(
        (candidate) => candidate.paginationOpts === split.target,
      )
      if (index < 0) {
        for (const page of promoted) page.unsubscribe?.()
        return
      }
      input.pages.value[index]?.unsubscribe?.()
      input.pages.value = [
        ...input.pages.value.slice(0, index),
        ...promoted,
        ...input.pages.value.slice(index + 1),
      ]
    }

    begin(split.target === 'first' ? 'first' : promoted[0].paginationOpts, split.parts[0].received!)
    begin(promoted[1].paginationOpts, split.parts[1].received!)
    if (split.target === 'first') input.settleFirstPageIfTerminal()
  }

  function subscribe(split: PendingPageSplit<Item>, partIndex: 0 | 1): void {
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const part = split.parts[partIndex]
    const options = part.page.paginationOpts
    const ownsFirstPage = () =>
      split.target === 'first' && partIndex === 0 && input.firstPageOptions.value === options
    part.page.unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: options },
      (raw) => {
        if (!input.isOperationCurrent(split.operation)) return
        const result = raw as PaginationResult<Item>
        if (pendingSplits.includes(split)) {
          part.received = result
          finish(split)
          return
        }
        if (ownsFirstPage()) input.acceptFirstPageResult(result, split.operation)
        else input.acceptPageResult(options, result)
      },
      (error) => {
        if (!input.isOperationCurrent(split.operation)) return
        if (pendingSplits.includes(split)) {
          for (const pendingPart of split.parts) pendingPart.page.unsubscribe?.()
          remove(split)
          input.rejectPage(split.target, error, options)
          return
        }
        input.rejectPage(ownsFirstPage() ? 'first' : options, error, options)
      },
    )
  }

  function begin(target: PaginationSplitTarget, result: PaginationResult<Item>): void {
    if (input.isDisposed()) return
    const required = result.pageStatus === 'SplitRequired'
    if (!needsPaginationSplit(result, input.initialNumItems)) {
      if (required) {
        input.rejectPage(
          target,
          splitRequiredError('SplitRequired pagination result has no split cursor'),
        )
      }
      return
    }
    if (!input.isLive()) {
      if (required) {
        input.rejectPage(
          target,
          splitRequiredError('SplitRequired pagination result needs a live bounded split'),
        )
      }
      return
    }
    if (pendingSplits.some((split) => split.target === target)) return

    const targetOptions =
      target === 'first'
        ? (input.firstPageOptions.value ?? input.initialOptions.value)
        : input.pages.value.find((page) => page.paginationOpts === target)?.paginationOpts
    if (!targetOptions) return

    const split: PendingPageSplit<Item> = {
      target,
      operation: input.captureOperation(),
      parts: [
        {
          page: createPendingPaginationPage({ ...targetOptions, endCursor: result.splitCursor }),
          received: null,
        },
        {
          page: createPendingPaginationPage({
            ...targetOptions,
            cursor: result.splitCursor,
            endCursor: result.continueCursor,
          }),
          received: null,
        },
      ],
    }
    pendingSplits.push(split)
    subscribe(split, 0)
    subscribe(split, 1)
  }

  function teardown(): void {
    for (const split of pendingSplits.splice(0)) {
      for (const part of split.parts) part.page.unsubscribe?.()
    }
  }

  return { begin, teardown }
}
