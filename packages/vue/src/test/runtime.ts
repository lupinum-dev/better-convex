import type { ConnectionState } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationResult,
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId } from 'convex/values'

import type { BetterConvexAttachment } from '../internal/attached-runtime'
import { createBetterConvexBrowserRuntime } from '../internal/browser-runtime'
import { createBetterConvex, type BetterConvexPlugin } from '../runtime-context'
import type { ConvexAuthMode } from '../use-query'
import {
  createTestAuth,
  DEFAULT_TEST_SUBJECT,
  type BetterConvexTestAuthControl,
  type BetterConvexTestAuthInput,
} from './auth'
import {
  createTestStorage,
  type BetterConvexTestStorageRequest,
  type StorageOrigin,
} from './storage'
import {
  anyQueryMatcher,
  createTestTransport,
  drainMicrotasks,
  exactQueryMatcher,
  listQueryMatcher,
  pageQueryMatcher,
  waitForArrival,
  type BetterConvexTestQueryCall,
  type BetterConvexTestRequest,
  type LoggedQueryCall,
  type QueryMatcher,
  type TestTransport,
  type WriteKind,
} from './transport'

type AnyQuery = FunctionReference<'query'>
type AnyPaginatedQuery = FunctionReference<
  'query',
  'public',
  { paginationOpts: { numItems: number; cursor: string | null } },
  PaginationResult<unknown>
>
type AnyWrite = FunctionReference<WriteKind>
type UploadUrlMutation = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>
type ListArgs<Query extends AnyQuery> = Omit<FunctionArgs<Query>, 'paginationOpts'>

export interface BetterConvexTestOptions {
  /**
   * The identity the test starts with: a signed-in subject, `anonymous`,
   * `loading`, `error`, or `false` for an application without auth.
   * @default { subject: 'test-user' }
   */
  readonly auth?: BetterConvexTestAuthInput | false
  /** Auth mode for queries whose options omit `auth`, as in `createBetterConvex`. */
  readonly defaultQueryAuth?: ConvexAuthMode
}

/** Answers for one query, one argument variant, or one page. */
export interface BetterConvexTestQueryControl<Query extends AnyQuery> {
  /** Subscriptions and one-shot reads this control matches, oldest first. */
  readonly calls: readonly BetterConvexTestQueryCall<FunctionArgs<Query>>[]
  /** Publish a result to matching subscriptions and pending reads, and to later ones. */
  resolve(value: FunctionReturnType<Query>): void
  /** A live update; the same as `resolve`. */
  push(value: FunctionReturnType<Query>): void
  /** Publish a query error, for example `invalidCursorError()` for a page. */
  reject(error: unknown): void
  /** Forget the configured answer; later subscriptions wait again. */
  reset(): void
  activeSubscriptions(): number
  /** Wait until the next matching call arrives and return it. */
  nextCall(): Promise<BetterConvexTestQueryCall<FunctionArgs<Query>>>
}

/** Answers for the pages of one paginated query. */
export interface BetterConvexTestPaginatedQueryControl<Query extends AnyQuery> {
  /** Every page subscription and page read, oldest first. */
  readonly calls: readonly BetterConvexTestQueryCall<FunctionArgs<Query>>[]
  /** The page requested with `cursor`; the first page has cursor `null` (the default). */
  page(cursor?: string | null): BetterConvexTestQueryControl<Query>
  activeSubscriptions(): number
}

/** Answers for one mutation or action. Requests stay pending until answered. */
export interface BetterConvexTestOperationControl<Operation extends AnyWrite> {
  readonly calls: readonly BetterConvexTestRequest<
    FunctionArgs<Operation>,
    FunctionReturnType<Operation>
  >[]
  /** Answer every pending request and every later one with `value`. */
  resolve(value: FunctionReturnType<Operation>): void
  /** Fail every pending request and every later one with `error`. */
  reject(error: unknown): void
  /** Answer every pending and later request by computing the result from its arguments. */
  respond(
    handler: (
      args: FunctionArgs<Operation>,
    ) => FunctionReturnType<Operation> | Promise<FunctionReturnType<Operation>>,
  ): void
  /** Forget the configured answer; later requests stay pending. */
  reset(): void
  /** Wait until the next request arrives and return it to answer or inspect. */
  nextCall(): Promise<
    BetterConvexTestRequest<FunctionArgs<Operation>, FunctionReturnType<Operation>>
  >
}

/** Storage answers for file POSTs to test upload URLs (see `storage.url()`). */
export interface BetterConvexTestStorageControl {
  /** A fresh upload URL answered by this control; return it from an upload-URL mutation. */
  url(): string
  readonly calls: readonly BetterConvexTestStorageRequest[]
  /** Answer every pending and later POST with this storage ID. */
  resolve(storageId: string): void
  /** Fail every pending and later POST with an HTTP status. */
  fail(status: number, statusText?: string): void
  /** Report byte progress on every pending POST. */
  progress(loaded: number, total?: number): void
  reset(): void
  nextCall(): Promise<BetterConvexTestStorageRequest>
}

export interface BetterConvexTestUploadCall<Mutation extends UploadUrlMutation> {
  readonly file: Blob | null
  readonly args: FunctionArgs<Mutation>
}

export interface BetterConvexTestUploadOptions<Mutation extends UploadUrlMutation> {
  /**
   * Build the upload-URL mutation's result around a test upload URL, for a
   * mutation that returns more than the URL. By default it returns the URL.
   */
  readonly prepared?: (url: string, args: FunctionArgs<Mutation>) => FunctionReturnType<Mutation>
}

/**
 * Answers for `useConvexFileUpload(mutation)`: the upload-URL mutation returns
 * a test upload URL, and the file POSTs to it are answered here. A `complete`
 * step is an ordinary `mutation()` or `action()` control.
 */
export interface BetterConvexTestUploadControl<Mutation extends UploadUrlMutation> {
  /** File POSTs made to URLs this mutation returned, with the mutation's arguments. */
  readonly calls: readonly BetterConvexTestUploadCall<Mutation>[]
  progress(loaded: number, total?: number): void
  /** Answer pending and later POSTs with this storage ID. */
  resolve(storageId: GenericId<'_storage'> | string): void
  /** Fail pending and later POSTs with an HTTP status. */
  fail(status: number, statusText?: string): void
  /** Fail the upload-URL mutation itself for pending and later uploads. */
  reject(error: unknown): void
  /** Wait for the next file POST of this upload. */
  nextCall(): Promise<BetterConvexTestStorageRequest>
}

export interface BetterConvexTestRuntime {
  /** Install in the Vue app under test, like the plugin from `createBetterConvex`. */
  readonly plugin: BetterConvexPlugin
  /** The owner attachment, for an embedded app: `createBetterConvex({ attachment })`. */
  readonly attachment: BetterConvexAttachment
  readonly auth: BetterConvexTestAuthControl
  readonly storage: BetterConvexTestStorageControl
  query<Query extends AnyQuery>(
    query: Query,
    args?: FunctionArgs<Query>,
  ): BetterConvexTestQueryControl<Query>
  paginatedQuery<Query extends AnyPaginatedQuery>(
    query: Query,
    args?: ListArgs<Query>,
  ): BetterConvexTestPaginatedQueryControl<Query>
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
  ): BetterConvexTestOperationControl<Mutation>
  action<Action extends FunctionReference<'action'>>(
    action: Action,
  ): BetterConvexTestOperationControl<Action>
  upload<Mutation extends UploadUrlMutation>(
    mutation: Mutation,
    options?: BetterConvexTestUploadOptions<Mutation>,
  ): BetterConvexTestUploadControl<Mutation>
  /** Replace transport facts reported by `useConvexConnectionState`. */
  setConnectionState(update: Partial<ConnectionState>): void
  /** Let pending promise chains, Vue watchers, and identity changes settle. */
  flush(): Promise<void>
  /** Close every client and restore the environment's `XMLHttpRequest`. */
  dispose(): Promise<void>
}

const AUTH_DISABLED: BetterConvexTestAuthControl = Object.freeze({
  status: 'anonymous' as const,
  subject: null,
  signIn: authDisabled,
  signOut: authDisabled,
  renewSession: authDisabled,
  setLoading: authDisabled,
  fail: authDisabled,
  subscribe: () => () => {},
})

function authDisabled(): never {
  throw new Error('[better-convex-test] this runtime was created with auth: false')
}

function publicQueryCalls<Query extends AnyQuery>(
  transport: TestTransport,
  matcher: QueryMatcher,
): BetterConvexTestQueryCall<FunctionArgs<Query>>[] {
  return transport.queryCalls(matcher).map((call: LoggedQueryCall) => ({
    kind: call.kind,
    args: call.args as FunctionArgs<Query>,
    identity: call.identity,
  }))
}

function queryControl<Query extends AnyQuery>(
  transport: TestTransport,
  matcher: QueryMatcher,
): BetterConvexTestQueryControl<Query> {
  const record = transport.queryRecord(matcher)
  return Object.freeze({
    get calls() {
      return publicQueryCalls<Query>(transport, matcher)
    },
    resolve: (value: FunctionReturnType<Query>) =>
      transport.configureQuery(record, { state: 'resolved', value }),
    push: (value: FunctionReturnType<Query>) =>
      transport.configureQuery(record, { state: 'resolved', value }),
    reject: (error: unknown) => transport.configureQuery(record, { state: 'rejected', error }),
    reset: () => transport.configureQuery(record, undefined),
    activeSubscriptions: () => transport.activeSubscriptions(matcher),
    nextCall: () =>
      waitForArrival(() => {
        const call = publicQueryCalls<Query>(transport, matcher)[record.cursor]
        if (!call) return undefined
        record.cursor += 1
        return call
      }, `call to ${matcher.name}`),
  })
}

function operationControl<Operation extends AnyWrite>(
  transport: TestTransport,
  kind: WriteKind,
  reference: Operation,
): BetterConvexTestOperationControl<Operation> {
  const record = transport.writeRecord(kind, reference)
  type Request = BetterConvexTestRequest<FunctionArgs<Operation>, FunctionReturnType<Operation>>
  return Object.freeze({
    get calls() {
      return record.requests.slice() as unknown as Request[]
    },
    resolve: (value: FunctionReturnType<Operation>) =>
      transport.configureWrite(record, { state: 'resolved', value }),
    reject: (error: unknown) => transport.configureWrite(record, { state: 'rejected', error }),
    respond: (handler: (args: FunctionArgs<Operation>) => unknown) =>
      transport.configureWrite(record, {
        state: 'respond',
        handler: handler as (args: Record<string, unknown>) => unknown,
      }),
    reset: () => transport.configureWrite(record, undefined),
    nextCall: () =>
      waitForArrival(() => {
        const request = record.requests[record.cursor]
        if (!request) return undefined
        record.cursor += 1
        return request as unknown as Request
      }, `${kind} ${record.name}`),
  })
}

/**
 * Create a Better Convex runtime for component tests.
 *
 * Components run the real composables, controllers, client owner, and auth
 * port; only the Convex deployment is replaced by an in-memory transport the
 * test answers by function reference. Uploads run the real storage transport
 * against test upload URLs.
 *
 * @example
 * ```ts
 * const convex = setupBetterConvexTest()
 * convex.query(api.notes.list).resolve([{ _id: 'n1', title: 'First' }])
 * const create = convex.mutation(api.notes.create)
 *
 * const app = createApp(NotesScreen).use(convex.plugin)
 * app.mount(document.createElement('div'))
 *
 * submitForm()
 * const request = await create.nextCall()
 * convex.auth.signIn('someone-else')
 * request.resolve('n2') // the old identity's answer never reaches the screen
 * ```
 */
export function setupBetterConvexTest(
  options: BetterConvexTestOptions = {},
): BetterConvexTestRuntime {
  const transport = createTestTransport()
  const storage = createTestStorage()
  const auth =
    options.auth === false
      ? null
      : createTestAuth(options.auth ?? { subject: DEFAULT_TEST_SUBJECT })
  const browser = createBetterConvexBrowserRuntime({
    clientFactory: transport.createClient,
    auth: auth?.adapter,
  })
  const plugin = createBetterConvex({
    attachment: browser.attachment,
    defaultQueryAuth: options.defaultQueryAuth,
  })
  const uploadOrigins = new Map<string, StorageOrigin & { cursor?: number }>()

  const storageControl: BetterConvexTestStorageControl = Object.freeze({
    url: () => storage.mintUrl(),
    get calls() {
      return storage.requests()
    },
    resolve: (storageId: string) => storage.configure({ state: 'resolved', storageId }),
    fail: (status: number, statusText = 'Error') =>
      storage.configure({ state: 'failed', status, statusText }),
    progress: (loaded: number, total?: number) => storage.progress(loaded, total),
    reset: () => storage.configure(undefined),
    nextCall: () => storage.nextRequest(),
  })

  function upload<Mutation extends UploadUrlMutation>(
    mutation: Mutation,
    uploadOptions: BetterConvexTestUploadOptions<Mutation> = {},
  ): BetterConvexTestUploadControl<Mutation> {
    const name = getFunctionName(mutation)
    let origin = uploadOrigins.get(name)
    if (!origin) {
      origin = {}
      uploadOrigins.set(name, origin)
    }
    const scoped = origin
    const prepare = operationControl(transport, 'mutation', mutation)
    const prepared =
      uploadOptions.prepared ?? ((url: string) => url as FunctionReturnType<Mutation>)
    const answerWithUrls = () =>
      prepare.respond((args) => prepared(storage.mintUrl({ origin: scoped, args }), args))
    answerWithUrls()
    return Object.freeze({
      get calls() {
        return storage.requests(scoped).map((request) => ({
          file: request.file,
          args: request.source?.args as FunctionArgs<Mutation>,
        }))
      },
      progress: (loaded: number, total?: number) => storage.progress(loaded, total, scoped),
      resolve(storageId: string) {
        answerWithUrls()
        storage.configure({ state: 'resolved', storageId }, scoped)
      },
      fail(status: number, statusText = 'Error') {
        answerWithUrls()
        storage.configure({ state: 'failed', status, statusText }, scoped)
      },
      reject: (error: unknown) => prepare.reject(error),
      nextCall: () => storage.nextRequest(scoped),
    })
  }

  return Object.freeze({
    plugin,
    attachment: browser.attachment,
    auth: auth?.control ?? AUTH_DISABLED,
    storage: storageControl,
    query: <Query extends AnyQuery>(query: Query, args?: FunctionArgs<Query>) =>
      queryControl<Query>(
        transport,
        args === undefined
          ? anyQueryMatcher(getFunctionName(query))
          : exactQueryMatcher(getFunctionName(query), args),
      ),
    paginatedQuery<Query extends AnyPaginatedQuery>(query: Query, args?: ListArgs<Query>) {
      const name = getFunctionName(query)
      const list = listQueryMatcher(name, args)
      return Object.freeze({
        get calls() {
          return publicQueryCalls<Query>(transport, list)
        },
        page: (cursor: string | null = null) =>
          queryControl<Query>(transport, pageQueryMatcher(name, args, cursor)),
        activeSubscriptions: () => transport.activeSubscriptions(list),
      })
    },
    mutation: <Mutation extends FunctionReference<'mutation'>>(mutation: Mutation) =>
      operationControl(transport, 'mutation', mutation),
    action: <Action extends FunctionReference<'action'>>(action: Action) =>
      operationControl(transport, 'action', action),
    upload,
    setConnectionState: transport.setConnectionState,
    flush: drainMicrotasks,
    async dispose() {
      storage.dispose()
      await browser.dispose()
    },
  })
}
