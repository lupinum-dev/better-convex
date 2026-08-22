import type { FunctionReference, PaginationResult } from 'convex/server'
import type { ComputedRef, Ref } from 'vue'

import { normalizeConvexError, type ConvexCallError } from '../errors'
import {
  commitPaginationPageError,
  createPendingPaginationPage,
  type PaginationOperationContext,
  type PaginationPageOptions,
  type PaginationPageState,
} from './pagination-state'
import type { QuerySubscriptionClient } from './query-controller'

type SplitTarget = 'first' | PaginationPageOptions

interface PendingPageSplit<Item> {
  target: SplitTarget
  operation: PaginationOperationContext
  required: boolean
  parts: [
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
    { page: PaginationPageState<Item>; received: PaginationResult<Item> | null },
  ]
}

export interface PaginationSplitControllerInput<Item> {
  query: FunctionReference<'query'>
  pages: Ref<PaginationPageState<Item>[]>
  firstPageRealtime: Ref<PaginationResult<Item> | null>
  firstPageOptions: Ref<PaginationPageOptions | null>
  firstPageWithheld: Ref<boolean>
  initialOptions: ComputedRef<PaginationPageOptions>
  isDisposed(): boolean
  isLive(): boolean
  getClient(): QuerySubscriptionClient | null
  getArgs(): Record<string, unknown> | 'skip'
  getBoundaryKey(): string
  setBoundaryError(error: ConvexCallError | undefined, key: string): void
  captureOperation(): PaginationOperationContext
  isOperationCurrent(operation: PaginationOperationContext): boolean
  settleFirstPageIfTerminal(): void
  replaceFirstPageSubscription(unsubscribe: (() => void) | null): void
  acceptFirstPageResult(result: PaginationResult<Item>, operation: PaginationOperationContext): void
  acceptPageResult(options: PaginationPageOptions, result: PaginationResult<Item>): void
}

export interface PaginationSplitController<Item> {
  begin(target: SplitTarget, result: PaginationResult<Item>): void
  teardown(): void
}

function isSplitResult<Item>(result: PaginationResult<Item>): result is PaginationResult<Item> & {
  splitCursor: string
  pageStatus: 'SplitRecommended' | 'SplitRequired'
} {
  return (
    typeof result.splitCursor === 'string' &&
    (result.pageStatus === 'SplitRecommended' || result.pageStatus === 'SplitRequired')
  )
}

function visiblePage<Item>(result: PaginationResult<Item> | null) {
  return result?.pageStatus === 'SplitRequired' ? null : result
}

export function createPaginationSplitController<Item>(
  input: PaginationSplitControllerInput<Item>,
): PaginationSplitController<Item> {
  const pendingSplits: PendingPageSplit<Item>[] = []

  function remove(split: PendingPageSplit<Item>): void {
    const index = pendingSplits.indexOf(split)
    if (index >= 0) pendingSplits.splice(index, 1)
  }

  function fail(split: PendingPageSplit<Item>, error: unknown): void {
    if (!input.isOperationCurrent(split.operation)) return
    for (const part of split.parts) part.page.unsubscribe?.()
    remove(split)
    input.setBoundaryError(normalizeConvexError(error), split.operation.boundaryKey)
    if (split.target === 'first') input.settleFirstPageIfTerminal()
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
      result: visiblePage(received!) ?? undefined,
      error: undefined,
      pending: received!.pageStatus === 'SplitRequired',
    })) as [PaginationPageState<Item>, PaginationPageState<Item>]

    if (split.target === 'first') {
      input.replaceFirstPageSubscription(promoted[0].unsubscribe)
      input.firstPageOptions.value = promoted[0].paginationOpts
      input.firstPageRealtime.value = promoted[0].result ?? null
      input.firstPageWithheld.value = promoted[0].pending
      input.pages.value = [promoted[1], ...input.pages.value]
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

    input.setBoundaryError(undefined, split.operation.boundaryKey)
    const firstResult = split.parts[0].received!
    const secondResult = split.parts[1].received!
    const firstTarget = split.target === 'first' ? 'first' : promoted[0].paginationOpts
    if (firstResult.pageStatus === 'SplitRecommended' || firstResult.pageStatus === 'SplitRequired')
      begin(firstTarget, firstResult)
    if (
      secondResult.pageStatus === 'SplitRecommended' ||
      secondResult.pageStatus === 'SplitRequired'
    )
      begin(promoted[1].paginationOpts, secondResult)
    if (split.target === 'first') input.settleFirstPageIfTerminal()
  }

  function subscribe(split: PendingPageSplit<Item>, partIndex: 0 | 1): void {
    const client = input.getClient()
    const args = input.getArgs()
    if (!client || args === 'skip') return
    const part = split.parts[partIndex]
    part.page.unsubscribe = client.onUpdate(
      input.query,
      { ...args, paginationOpts: part.page.paginationOpts },
      (raw) => {
        if (!input.isOperationCurrent(split.operation)) return
        const result = raw as PaginationResult<Item>
        if (pendingSplits.includes(split)) {
          part.received = result
          finish(split)
          return
        }
        if (
          split.target === 'first' &&
          partIndex === 0 &&
          input.firstPageOptions.value === part.page.paginationOpts
        ) {
          input.acceptFirstPageResult(result, split.operation)
          return
        }
        input.acceptPageResult(part.page.paginationOpts, result)
      },
      (error) => {
        if (!input.isOperationCurrent(split.operation)) return
        if (pendingSplits.includes(split)) {
          fail(split, error)
          return
        }
        if (
          split.target === 'first' &&
          partIndex === 0 &&
          input.firstPageOptions.value === part.page.paginationOpts
        ) {
          input.setBoundaryError(normalizeConvexError(error), split.operation.boundaryKey)
          return
        }
        const index = input.pages.value.findIndex(
          (candidate) => candidate.paginationOpts === part.page.paginationOpts,
        )
        if (index >= 0)
          input.pages.value = commitPaginationPageError(input.pages.value, index, error)
      },
    )
  }

  function rejectRequiredSplit(message: string, target: SplitTarget): void {
    input.setBoundaryError(normalizeConvexError(new Error(message)), input.getBoundaryKey())
    if (target === 'first') input.settleFirstPageIfTerminal()
  }

  function begin(target: SplitTarget, result: PaginationResult<Item>): void {
    if (input.isDisposed()) return
    if (!input.isLive()) {
      if (result.pageStatus === 'SplitRequired') {
        rejectRequiredSplit(
          '[better-convex-vue] SplitRequired pagination result needs a live bounded split',
          target,
        )
      }
      return
    }
    if (pendingSplits.some((split) => split.target === target)) return
    if (!isSplitResult(result)) {
      if (result.pageStatus === 'SplitRequired') {
        rejectRequiredSplit(
          '[better-convex-vue] SplitRequired pagination result has no split cursor',
          target,
        )
      }
      return
    }

    const targetOptions =
      target === 'first'
        ? (input.firstPageOptions.value ?? input.initialOptions.value)
        : input.pages.value.find((page) => page.paginationOpts === target)?.paginationOpts
    if (!targetOptions) return

    const split: PendingPageSplit<Item> = {
      target,
      operation: input.captureOperation(),
      required: result.pageStatus === 'SplitRequired',
      parts: [
        {
          page: createPendingPaginationPage({
            ...targetOptions,
            endCursor: result.splitCursor,
          }),
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

    if (split.required) {
      if (target === 'first') {
        input.firstPageWithheld.value = true
        input.firstPageRealtime.value = null
      } else {
        const index = input.pages.value.findIndex((page) => page.paginationOpts === target)
        if (index >= 0) {
          const page = input.pages.value[index]!
          input.pages.value = [
            ...input.pages.value.slice(0, index),
            { ...page, result: undefined, error: undefined, pending: true },
            ...input.pages.value.slice(index + 1),
          ]
        }
      }
    }

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
