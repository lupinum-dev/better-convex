import { waitForArrival } from './transport'

/** One file POST to a test upload URL. */
export interface BetterConvexTestStorageRequest {
  readonly url: string
  /** The body the upload sent, normally the `File`. */
  readonly file: Blob | null
  readonly contentType: string | null
  readonly state: 'pending' | 'resolved' | 'rejected' | 'aborted'
  /** Report byte progress; `total` defaults to the file size. */
  progress(loaded: number, total?: number): void
  /** Answer `200 { storageId }`, as Convex storage does. */
  resolve(storageId: string): void
  /** Answer with a failure status, for example `413` or `500`. */
  fail(status: number, statusText?: string): void
  /** Fail without a response, like a dropped connection. */
  networkError(): void
}

type StorageOutcome =
  | { readonly state: 'resolved'; readonly storageId: string }
  | { readonly state: 'failed'; readonly status: number; readonly statusText: string }

interface ControlledXhr {
  progress(loaded: number, total: number): void
  complete(status: number, statusText: string, body: string): void
  networkError(): void
}

export interface StorageOrigin {
  outcome?: StorageOutcome
}

export class StorageRequest implements BetterConvexTestStorageRequest {
  readonly url: string
  readonly file: Blob | null
  readonly contentType: string | null
  #state: BetterConvexTestStorageRequest['state'] = 'pending'
  readonly #xhr: ControlledXhr
  /** The `upload(ref)` control and arguments that minted this URL, if any. */
  readonly source: { readonly origin: StorageOrigin; readonly args: unknown } | undefined

  constructor(
    url: string,
    file: Blob | null,
    contentType: string | null,
    xhr: ControlledXhr,
    source: StorageRequest['source'],
  ) {
    this.url = url
    this.file = file
    this.contentType = contentType
    this.#xhr = xhr
    this.source = source
  }

  get state() {
    return this.#state
  }

  progress(loaded: number, total = this.file?.size ?? loaded): void {
    this.#assertPending()
    this.#xhr.progress(loaded, total)
  }

  resolve(storageId: string): void {
    this.#assertPending()
    this.#state = 'resolved'
    this.#xhr.complete(200, 'OK', JSON.stringify({ storageId }))
  }

  fail(status: number, statusText = 'Error'): void {
    this.#assertPending()
    this.#state = 'rejected'
    this.#xhr.complete(status, statusText, '')
  }

  networkError(): void {
    this.#assertPending()
    this.#state = 'rejected'
    this.#xhr.networkError()
  }

  /** Called by the controlled XHR when the client aborts the POST. */
  markAborted(): void {
    if (this.#state === 'pending') this.#state = 'aborted'
  }

  #assertPending(): void {
    if (this.#state !== 'pending') {
      throw new Error(`[better-convex-test] this upload request is already ${this.#state}`)
    }
  }
}

function applyStorageOutcome(outcome: StorageOutcome, request: StorageRequest): void {
  if (outcome.state === 'resolved') request.resolve(outcome.storageId)
  else request.fail(outcome.status, outcome.statusText)
}

interface StorageHost {
  accept(url: string, body: unknown, contentType: string | null, xhr: ControlledXhr): StorageRequest
}

const URL_PREFIX = 'https://storage.better-convex.test/'
const hosts = new Map<string, StorageHost>()
let hostSequence = 0
let installed: { readonly controlled: typeof XMLHttpRequest; readonly original: unknown } | null =
  null

function hostFor(url: string): StorageHost | undefined {
  if (!url.startsWith(URL_PREFIX)) return undefined
  return hosts.get(url.slice(URL_PREFIX.length).split('/')[0] ?? '')
}

function progressEvent(type: string, loaded: number, total: number): ProgressEvent {
  const init = { lengthComputable: true, loaded, total }
  return typeof ProgressEvent === 'function'
    ? new ProgressEvent(type, init)
    : ({ type, ...init } as unknown as ProgressEvent)
}

/** Stand-in where the environment has no XHR, for example Vitest's `node` environment. */
class DetachedXMLHttpRequest {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: ((event: ProgressEvent) => void) | null = null
  onerror: ((event: ProgressEvent) => void) | null = null
  onabort: ((event: ProgressEvent) => void) | null = null
  readonly status: number = 0
  readonly statusText: string = ''
  readonly responseText: string = ''
  readonly readyState: number = 0

  open(): void {
    throw new Error('[better-convex-test] XMLHttpRequest is unavailable in this environment')
  }
  setRequestHeader(): void {}
  send(): void {}
  abort(): void {}
}

/**
 * Wrap the environment's XHR: requests to test upload URLs are answered by the
 * test's storage control, and every other request keeps the original behavior.
 * The real upload transport therefore runs unchanged.
 */
function createControlledXhrClass(original: unknown): typeof XMLHttpRequest {
  const Parent = (typeof original === 'function'
    ? original
    : DetachedXMLHttpRequest) as unknown as typeof XMLHttpRequest

  return class ControlledXMLHttpRequest extends Parent {
    #target: { host: StorageHost; url: string } | null = null
    #contentType: string | null = null
    #request: StorageRequest | null = null

    override open(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      const target = String(url)
      const host = hostFor(target)
      this.#target = host ? { host, url: target } : null
      if (host) return
      super.open(method, url, async ?? true, username, password)
    }

    override setRequestHeader(name: string, value: string): void {
      if (!this.#target) {
        super.setRequestHeader(name, value)
        return
      }
      if (name.toLowerCase() === 'content-type') this.#contentType = value
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (!this.#target) {
        super.send(body)
        return
      }
      const handlers = this as unknown as {
        upload: { onprogress: ((event: ProgressEvent) => void) | null }
        onload: ((event: ProgressEvent) => void) | null
        onerror: ((event: ProgressEvent) => void) | null
      }
      const respond = (status: number, statusText: string, responseText: string) => {
        Object.defineProperties(this, {
          readyState: { configurable: true, value: 4 },
          status: { configurable: true, value: status },
          statusText: { configurable: true, value: statusText },
          responseText: { configurable: true, value: responseText },
        })
      }
      this.#request = this.#target.host.accept(this.#target.url, body, this.#contentType, {
        progress: (loaded, total) =>
          handlers.upload.onprogress?.call(this, progressEvent('progress', loaded, total)),
        complete: (status, statusText, responseText) => {
          respond(status, statusText, responseText)
          handlers.onload?.call(this, progressEvent('load', 0, 0))
        },
        networkError: () => {
          respond(0, '', '')
          handlers.onerror?.call(this, progressEvent('error', 0, 0))
        },
      })
    }

    override abort(): void {
      if (!this.#target) {
        super.abort()
        return
      }
      const request = this.#request
      if (!request || request.state !== 'pending') return
      request.markAborted()
      const handlers = this as unknown as { onabort: ((event: ProgressEvent) => void) | null }
      handlers.onabort?.call(this, progressEvent('abort', 0, 0))
    }
  }
}

function install(): void {
  const current = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest
  if (installed && current === installed.controlled) return
  installed = { controlled: createControlledXhrClass(current), original: current }
  ;(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = installed.controlled
}

function releaseIfUnused(): void {
  if (hosts.size > 0 || !installed) return
  const global = globalThis as { XMLHttpRequest?: unknown }
  if (global.XMLHttpRequest === installed.controlled) {
    if (installed.original === undefined) delete global.XMLHttpRequest
    else global.XMLHttpRequest = installed.original
  }
  installed = null
}

/** The storage side of uploads: test upload URLs and the file POSTs made to them. */
export function createTestStorage() {
  const id = `t${(hostSequence += 1)}`
  const requests: StorageRequest[] = []
  const minted = new Map<string, NonNullable<StorageRequest['source']>>()
  let urlSequence = 0
  let outcome: StorageOutcome | undefined
  let cursor = 0
  let disposed = false

  function outcomeFor(request: StorageRequest): StorageOutcome | undefined {
    return request.source?.origin.outcome ?? outcome
  }

  const host: StorageHost = {
    accept(url, body, contentType, xhr) {
      const request = new StorageRequest(
        url,
        typeof Blob === 'function' && body instanceof Blob ? body : null,
        contentType,
        xhr,
        minted.get(url),
      )
      requests.push(request)
      const configured = outcomeFor(request)
      if (configured) applyStorageOutcome(configured, request)
      return request
    },
  }

  function mintUrl(source?: NonNullable<StorageRequest['source']>): string {
    if (disposed) throw new Error('[better-convex-test] this test runtime is disposed')
    if (!hosts.has(id)) hosts.set(id, host)
    install()
    const url = `${URL_PREFIX}${id}/${(urlSequence += 1)}`
    if (source) minted.set(url, source)
    return url
  }

  function settlePending(origin?: StorageOrigin): void {
    for (const request of requests) {
      if (request.state !== 'pending') continue
      if (origin && request.source?.origin !== origin) continue
      const configured = outcomeFor(request)
      if (configured) applyStorageOutcome(configured, request)
    }
  }

  return {
    mintUrl,
    requests: (origin?: StorageOrigin) =>
      origin ? requests.filter((request) => request.source?.origin === origin) : requests.slice(),
    configure(next: StorageOutcome | undefined, origin?: StorageOrigin) {
      if (origin) origin.outcome = next
      else outcome = next
      settlePending(origin)
    },
    progress(loaded: number, total: number | undefined, origin?: StorageOrigin) {
      for (const request of requests) {
        if (request.state !== 'pending') continue
        if (origin && request.source?.origin !== origin) continue
        request.progress(loaded, total)
      }
    },
    nextRequest(origin?: StorageOrigin & { cursor?: number }): Promise<StorageRequest> {
      return waitForArrival(() => {
        if (origin) {
          const scoped = requests.filter((request) => request.source?.origin === origin)
          const next = scoped[origin.cursor ?? 0]
          if (next) origin.cursor = (origin.cursor ?? 0) + 1
          return next
        }
        const next = requests[cursor]
        if (next) cursor += 1
        return next
      }, 'file upload request')
    },
    dispose() {
      disposed = true
      hosts.delete(id)
      releaseIfUnused()
    },
  }
}

export type TestStorage = ReturnType<typeof createTestStorage>
export type { StorageOutcome }
