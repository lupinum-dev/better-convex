import type { FunctionReference } from 'convex/server'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { getPackageEntry } from '../../scripts/package-entry-manifest.mjs'
import type {
  ConvexRuntimeConfig,
  NuxtConvexPaginatedQuery,
  NuxtConvexQuery,
  UseConvexPaginatedQueryOptions,
  UseConvexPaginatedQueryState,
  UseConvexQueryOptions,
  UseConvexQueryParameters,
  UseConvexQueryState,
} from '../../src/module'

type EmptyQuery = FunctionReference<'query', 'public', Record<string, never>, string>
type OptionalArgsQuery = FunctionReference<'query', 'public', { term?: string }, string[]>

function readonlyContracts(
  queryOptions: UseConvexQueryOptions,
  paginationOptions: UseConvexPaginatedQueryOptions,
  queryState: UseConvexQueryState<string>,
) {
  // @ts-expect-error public options are immutable configuration values
  queryOptions.server = false
  // @ts-expect-error inherited Vue options remain readonly at the Nuxt root
  queryOptions.auth = 'none'
  // @ts-expect-error pagination options are immutable configuration values
  paginationOptions.initialNumItems = 10
  // @ts-expect-error state members cannot be replaced by consumers
  queryState.data = undefined
}

function removedModulePolicyContracts() {
  const defaults: import('../../src/module').ModuleOptions = {
    // @ts-expect-error query transport policy is per call
    defaults: { server: false },
  }
  const upload: import('../../src/module').ModuleOptions = {
    // @ts-expect-error upload queue policy was removed with the queue
    upload: { maxConcurrent: 3 },
  }
  return { defaults, upload }
}

describe('Nuxt package-root query type contract', () => {
  it('uses one Nuxt-facing options name and exports nameable state contracts', () => {
    expectTypeOf<keyof ConvexRuntimeConfig>().toEqualTypeOf<'siteUrl' | 'url'>()
    expectTypeOf<keyof UseConvexQueryOptions>().toEqualTypeOf<
      'auth' | 'keepPreviousData' | 'server'
    >()
    expectTypeOf<keyof UseConvexPaginatedQueryOptions>().toEqualTypeOf<
      'auth' | 'initialNumItems' | 'keepPreviousData' | 'server'
    >()
    expectTypeOf<NuxtConvexQuery<string>>().toMatchTypeOf<Promise<UseConvexQueryState<string>>>()
    expectTypeOf<NuxtConvexQuery<string>>().toMatchTypeOf<UseConvexQueryState<string>>()
    expectTypeOf<NuxtConvexPaginatedQuery<string>>().toMatchTypeOf<
      Promise<UseConvexPaginatedQueryState<string>>
    >()
    expectTypeOf<NuxtConvexPaginatedQuery<string>>().toMatchTypeOf<
      UseConvexPaginatedQueryState<string>
    >()
    expectTypeOf(readonlyContracts).toBeFunction()
    expectTypeOf(removedModulePolicyContracts).toBeFunction()

    const rootTypes = getPackageEntry('nuxt', '.').typeExports
    expect(rootTypes).toEqual(
      expect.arrayContaining([
        'NuxtConvexPaginatedQuery',
        'NuxtConvexQuery',
        'UseConvexPaginatedQueryOptions',
        'UseConvexPaginatedQueryState',
        'UseConvexQueryOptions',
        'UseConvexQueryParameters',
        'UseConvexQueryState',
      ]),
    )
    expect(rootTypes).not.toContain('UseNuxtConvexPaginatedQueryOptions')
    expect(rootTypes).not.toContain('UseNuxtConvexQueryOptions')
  })

  it('keeps exact-empty args optional and declared optional keys positional', () => {
    expectTypeOf<
      [] extends UseConvexQueryParameters<EmptyQuery> ? true : false
    >().toEqualTypeOf<true>()
    expectTypeOf<
      [Record<PropertyKey, never>, { server: false }] extends UseConvexQueryParameters<EmptyQuery>
        ? true
        : false
    >().toEqualTypeOf<true>()
    expectTypeOf<
      [] extends UseConvexQueryParameters<OptionalArgsQuery> ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      [{ term: string }, { server: false }] extends UseConvexQueryParameters<OptionalArgsQuery>
        ? true
        : false
    >().toEqualTypeOf<true>()
  })
})
