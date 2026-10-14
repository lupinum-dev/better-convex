import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createConvexArgsState } from '@lupinum/better-convex-vue/internal'
import { createEvent as createH3V1Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import type { NuxtApp } from '#app'

import { toAuthenticatedIdentity } from '../../src/runtime/auth/auth-identity'
import type { ConvexServerEvent } from '../../src/runtime/server/utils/event'
import { setServerConvexToken } from '../../src/runtime/utils/auth-identity-state'
import { useConvexSsrQuery } from '../../src/runtime/utils/query-foundation'

const nuxt = vi.hoisted(() => ({
  event: undefined as unknown,
  app: {} as object,
  state: new Map<string, { value: unknown }>(),
}))

// The server render of one query: `useAsyncData` runs the handler at once,
// as Nuxt does for an immediate SSR entry.
vi.mock('#app', () => ({
  onNuxtReady: () => {},
  useNuxtApp: () => nuxt.app,
  useRequestEvent: () => nuxt.event,
  useState: (key: string, init?: () => unknown) => {
    if (!nuxt.state.has(key)) nuxt.state.set(key, { value: init?.() })
    return nuxt.state.get(key)
  },
  useAsyncData: (_key: unknown, handler: () => Promise<unknown>) => {
    const data = shallowRef<unknown>(null)
    const status = shallowRef('pending')
    const settled = handler().then((value) => {
      data.value = value
      status.value = 'success'
    })
    return Object.assign(settled, { data, status, execute: () => settled })
  },
}))

vi.mock('../../src/runtime/utils/runtime-config', () => ({
  getConvexRuntimeConfig: () => ({
    url: 'https://demo.convex.cloud',
    server: {},
    auth: { origin: 'http://localhost:3000' },
  }),
}))

const SESSION_COOKIE = 'better-auth.session_token=abc'
const SERVER_TOKEN = 'plugin.resolved.jwt'

function nodeRequestResponse() {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/dashboard'
  req.headers = { host: 'localhost:3000', cookie: SESSION_COOKIE }
  return { req, res: new ServerResponse(req) }
}

// Catches an SSR query that stops reading the request through the event
// adapter: without the cookie it fetches without the signed-in token (and
// renders the page as signed out), and without the web signal a closed
// Nuxt 5 request keeps its Convex fetch running.
const shapes: {
  name: string
  create(): { event: ConvexServerEvent; signal: AbortSignal | undefined }
}[] = [
  {
    name: 'web-shaped event (Nuxt 5)',
    create() {
      const req = new Request('http://localhost:3000/dashboard', {
        headers: { cookie: SESSION_COOKIE },
      })
      return {
        event: { req, res: { headers: new Headers() }, context: {} },
        signal: req.signal,
      }
    },
  },
  {
    // Nuxt 4 SSR: no web signal; the cookie lives on the Node request.
    name: 'raw h3 v1 event (Nuxt 4)',
    create() {
      const { req, res } = nodeRequestResponse()
      return { event: createH3V1Event(req, res), signal: undefined }
    },
  },
]

beforeEach(() => {
  nuxt.state.clear()
  nuxt.app = {}
  nuxt.state.set('convex:pending', { value: false })
  nuxt.state.set('convex:identity', { value: toAuthenticatedIdentity({ id: 'A' }) })
  setServerConvexToken(nuxt.app as NuxtApp, SERVER_TOKEN)
})

describe.each(shapes)('useConvexSsrQuery on a $name', (shape) => {
  it('fetches with the request session token and the request abort signal', async () => {
    const { event, signal } = shape.create()
    nuxt.event = event
    const fetch = vi.fn(async () => 'notes')

    const query = useConvexSsrQuery({
      namespace: 'convex',
      functionName: 'notes:mine',
      auth: 'required',
      server: true,
      immediate: true,
      lazy: false,
      args: createConvexArgsState({}),
      keyHash: () => 'hash',
      fetch,
    })
    await query.settled

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://demo.convex.cloud', SERVER_TOKEN, signal, {})
    expect(query.view.value.value).toBe('notes')
  })
})
