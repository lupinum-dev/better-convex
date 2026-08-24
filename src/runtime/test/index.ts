import {
  createBetterConvex,
  useConvexAction,
  useConvexConnectionState,
  useConvexForm,
  useConvexMutation,
  useConvexPaginatedQuery,
  useConvexQuery,
  type BetterConvexPlugin,
} from '@lupinum/better-convex-vue'
import { createBetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'
import type { FunctionArgs, FunctionReference } from 'convex/server'

import type { ConvexUser } from '../utils/types'
import {
  createBetterConvexTestAuth,
  type BetterConvexTestAuth,
  type BetterConvexTestAuthPreset,
} from './auth'
import {
  BetterConvexTestClient,
  type BetterConvexTestOperationController,
  type BetterConvexTestQueryController,
} from './client'
import {
  createBetterConvexTestUploads,
  type BetterConvexTestFileUploadComposable,
  type BetterConvexTestUploadController,
} from './upload'

export type {
  BetterConvexTestCall,
  BetterConvexTestOperationController,
  BetterConvexTestQueryCall,
  BetterConvexTestQueryController,
} from './client'
export type {
  BetterConvexTestAuth,
  BetterConvexTestAuthPreset,
  BetterConvexTestAuthResult,
} from './auth'
export type {
  BetterConvexTestFileUploadComposable,
  BetterConvexTestUploadCall,
  BetterConvexTestUploadController,
} from './upload'

export interface BetterConvexTestOptions {
  readonly auth?: BetterConvexTestAuthPreset | ConvexUser
}

export interface BetterConvexTestRuntime {
  readonly plugin: BetterConvexPlugin
  readonly auth: BetterConvexTestAuth
  readonly composables: Readonly<{
    useConvexAction: typeof useConvexAction
    useConvexConnectionState: typeof useConvexConnectionState
    useConvexFileUpload: BetterConvexTestFileUploadComposable
    useConvexForm: typeof useConvexForm
    useConvexMutation: typeof useConvexMutation
    useConvexPaginatedQuery: typeof useConvexPaginatedQuery
    useConvexQuery: typeof useConvexQuery
    useConvexAuth: () => BetterConvexTestAuth
  }>
  query<Query extends FunctionReference<'query'>>(
    query: Query,
    args?: FunctionArgs<Query>,
  ): BetterConvexTestQueryController<Query>
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
  ): BetterConvexTestOperationController<Mutation>
  action<Action extends FunctionReference<'action'>>(
    action: Action,
  ): BetterConvexTestOperationController<Action>
  upload<Mutation extends FunctionReference<'mutation', 'public', Record<string, unknown>, string>>(
    mutation: Mutation,
  ): BetterConvexTestUploadController<Mutation>
}

export function setupBetterConvexTest(
  options: BetterConvexTestOptions = {},
): BetterConvexTestRuntime {
  const client = new BetterConvexTestClient()
  const { auth, observer } = createBetterConvexTestAuth(options.auth ?? 'authenticated')
  const uploads = createBetterConvexTestUploads()
  const attachment = createBetterConvexAttachment({
    client: client.handle,
    anonymousClient: client.handle,
    identity: observer,
    connection: {
      snapshot: () => client.connectionState(),
      subscribe: (listener) => client.subscribeToConnectionState(listener),
    },
  })
  const plugin = createBetterConvex({ attachment })

  return Object.freeze({
    plugin,
    auth,
    composables: Object.freeze({
      useConvexAction,
      useConvexConnectionState,
      useConvexFileUpload: uploads.useConvexFileUpload,
      useConvexForm,
      useConvexMutation,
      useConvexPaginatedQuery,
      useConvexQuery,
      useConvexAuth: () => auth,
    }),
    query: client.query.bind(client),
    mutation: <Mutation extends FunctionReference<'mutation'>>(mutation: Mutation) =>
      client.operation('mutation', mutation),
    action: <Action extends FunctionReference<'action'>>(action: Action) =>
      client.operation('action', action),
    upload: uploads.upload,
  })
}
